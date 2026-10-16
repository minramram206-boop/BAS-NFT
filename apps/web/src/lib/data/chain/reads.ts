import {
  CITIZEN_STATE_DISCRIMINATOR,
  CITIZEN_STATE_LAYOUT,
  CORE_ASSET_LAYOUT,
  CORE_CANDY_GUARD_PROGRAM_ID,
  AUCTION_DISCRIMINATOR,
  AUCTION_LAYOUT,
  CORE_CANDY_MACHINE_PROGRAM_ID,
  LISTING_DISCRIMINATOR,
  LISTING_LAYOUT,
  OFFER_DISCRIMINATOR,
  OFFER_LAYOUT,
  MINT_LIMIT_ID,
  MPL_CORE_PROGRAM_ID,
  associatedTokenAddress,
  candyGuardAddress,
  decodeAuction,
  decodeCandyMachine,
  decodeCitizenState,
  decodeCoreAsset,
  decodeCoreAssetForMarket,
  decodeListing,
  decodeMarketConfig,
  decodeMintCounter,
  decodeOffer,
  decodePrizeConfig,
  decodeSeason,
  decodeTokenAccountAmount,
  PRIZE_VAULT_LENGTH,
  prizeConfigAddress,
  prizeVaultAddress,
  seasonAddress,
  marketAuthorityAddress,
  marketConfigAddress,
  mintCounterAddress,
  serialFromMetadataUri,
  type AuctionOnChain,
  type OfferOnChain,
  type ListingOnChain,
} from '@bas/chain-client/browser';
import { address, createSolanaRpc, getAddressEncoder, getBase58Decoder, getBase64Encoder, type Address } from '@solana/kit';
import type { Balances, ChainCitizen, DistrictReads, MarketReading, PrizeReading, SaleReading } from './types';

/**
 * Reads of the cluster through `@solana/kit`. The RPC is wrapped in a small
 * interface so the decoding and joining can be tested without a network.
 */

export interface RawAccount {
  readonly owner: string;
  readonly data: Uint8Array;
}

export interface ProgramFilter {
  /** Raw bytes that must sit at `offset`. */
  readonly offset: number;
  readonly bytes: Uint8Array;
}

export interface ReadRpc {
  programAccounts(program: string, filters: readonly ProgramFilter[], dataSize?: number): Promise<readonly (RawAccount & { address: string })[]>;
  account(address: string): Promise<RawAccount | null>;
  balance(address: string): Promise<bigint>;
  /** Lamports an account of `bytes` data must hold to be rent exempt. */
  rentExempt(bytes: number): Promise<bigint>;
}

export interface ReadsOptions {
  readonly rpc: ReadRpc;
  readonly programId: string;
  /** Official Core collection. */
  readonly collection: string;
  readonly utilityMint: string;
  /** Core Candy Machine of the public sale; without it `sale()` reports no sale. */
  readonly candyMachine?: string;
  /** The market program; without it `market()` reports no market. */
  readonly marketProgramId?: string;
  /** The prize vault program; without it `prize()` reports no vault. */
  readonly prizeVaultProgramId?: string;
}

const addressToBytes = (value: string): Uint8Array => new Uint8Array(getAddressEncoder().encode(address(value)));

/** `ReadRpc` over a JSON-RPC endpoint. */
export function kitReadRpc(url: string): ReadRpc {
  const rpc = createSolanaRpc(url);
  const base64 = getBase64Encoder();
  const decode = (data: readonly [string, string]): Uint8Array => new Uint8Array(base64.encode(data[0]));
  const base58 = getBase58Decoder();
  return {
    async programAccounts(program, filters, dataSize) {
      const accounts = await rpc
        .getProgramAccounts(address(program), {
          commitment: 'confirmed',
          encoding: 'base64',
          filters: [
            ...(dataSize === undefined ? [] : [{ dataSize: BigInt(dataSize) }]),
            ...filters.map((filter) => ({
              memcmp: {
                offset: BigInt(filter.offset),
                bytes: base58.decode(filter.bytes) as never,
                encoding: 'base58' as const,
              },
            })),
          ],
        })
        .send();
      return (accounts as readonly { pubkey: string; account: { owner: string; data: readonly [string, string] } }[]).map(
        (entry) => ({ address: entry.pubkey, owner: entry.account.owner, data: decode(entry.account.data) }),
      );
    },
    async account(target) {
      const { value } = await rpc.getAccountInfo(address(target), { commitment: 'confirmed', encoding: 'base64' }).send();
      return value ? { owner: value.owner, data: decode(value.data as unknown as readonly [string, string]) } : null;
    },
    async balance(target) {
      return (await rpc.getBalance(address(target), { commitment: 'confirmed' }).send()).value;
    },
    async rentExempt(bytes) {
      return rpc.getMinimumBalanceForRentExemption(BigInt(bytes)).send();
    },
  };
}

export function createReads(options: ReadsOptions): DistrictReads {
  const { rpc, programId, collection, utilityMint, candyMachine, marketProgramId, prizeVaultProgramId } = options;
  let tokenProgram: Promise<Address> | undefined;

  const mintProgram = (): Promise<Address> => {
    tokenProgram ??= rpc.account(utilityMint).then((mint) => {
      if (!mint) throw new Error(`the utility token mint ${utilityMint} does not exist on this cluster`);
      return address(mint.owner);
    });
    return tokenProgram;
  };

  return {
    async citizens() {
      const [assets, states] = await Promise.all([
        rpc.programAccounts(MPL_CORE_PROGRAM_ID, [{ offset: CORE_ASSET_LAYOUT.collectionOffset, bytes: addressToBytes(collection) }]),
        rpc.programAccounts(
          programId,
          [{ offset: 0, bytes: CITIZEN_STATE_DISCRIMINATOR }],
          CITIZEN_STATE_LAYOUT.length,
        ),
      ]);

      const stateOf = new Map<string, NonNullable<ReturnType<typeof decodeCitizenState>>>();
      for (const entry of states) {
        const state = decodeCitizenState(entry.data);
        if (state) stateOf.set(state.asset, state);
      }

      const citizens: ChainCitizen[] = [];
      for (const entry of assets) {
        const asset = decodeCoreAsset(entry.data);
        // The filter already matches the collection; this guards against a different account kind with the same bytes.
        if (!asset || asset.collection !== collection) continue;
        const plugins = decodeCoreAssetForMarket(entry.data);
        citizens.push({
          asset: entry.address,
          owner: asset.owner,
          serial: serialFromMetadataUri(asset.uri) ?? null,
          state: stateOf.get(entry.address) ?? null,
          transferDelegate: plugins?.transferDelegate ?? null,
          freezeDelegate: plugins?.freezeDelegate ?? null,
          frozen: plugins?.frozen ?? false,
        });
      }
      return citizens;
    },

    async sale(wallet): Promise<SaleReading | null> {
      if (!candyMachine) return null;
      const machine = await rpc.account(candyMachine);
      if (!machine || machine.owner !== CORE_CANDY_MACHINE_PROGRAM_ID) return null;
      const decoded = decodeCandyMachine(machine.data);
      if (!decoded) return null;

      let mintedByWallet = 0;
      if (wallet) {
        const counter = await mintCounterAddress({
          id: MINT_LIMIT_ID,
          user: address(wallet),
          candyMachine: address(candyMachine),
          candyGuard: await candyGuardAddress(address(candyMachine)),
        });
        const account = await rpc.account(counter);
        // The counter is only written by the guard program; anything else at that address is not a count.
        if (account && account.owner === CORE_CANDY_GUARD_PROGRAM_ID) mintedByWallet = decodeMintCounter(account.data) ?? 0;
      }
      return { itemsAvailable: decoded.itemsAvailable, itemsRedeemed: decoded.itemsRedeemed, mintedByWallet };
    },

    async market(): Promise<MarketReading | null> {
      if (!marketProgramId) return null;
      const program = address(marketProgramId);
      const [configAddress, authority] = await Promise.all([marketConfigAddress(program), marketAuthorityAddress(program)]);
      const [configAccount, entries, auctionEntries, offerEntries, offerDepositLamports] = await Promise.all([
        rpc.account(configAddress),
        rpc.programAccounts(marketProgramId, [{ offset: 0, bytes: LISTING_DISCRIMINATOR }], LISTING_LAYOUT.length),
        rpc.programAccounts(marketProgramId, [{ offset: 0, bytes: AUCTION_DISCRIMINATOR }], AUCTION_LAYOUT.length),
        rpc.programAccounts(marketProgramId, [{ offset: 0, bytes: OFFER_DISCRIMINATOR }], OFFER_LAYOUT.length),
        // The rent of a new offer account; clusters have changed the rate before, so it is asked, not assumed.
        rpc.rentExempt(OFFER_LAYOUT.length),
      ]);
      // Accounts the program does not own are not its state, whatever their bytes say.
      const config = configAccount?.owner === marketProgramId ? decodeMarketConfig(configAccount.data) : undefined;
      if (!config || config.collection !== collection) return null;
      const listings: ListingOnChain[] = [];
      for (const entry of entries) {
        const listing = entry.owner === marketProgramId ? decodeListing(entry.data) : undefined;
        if (listing) listings.push(listing);
      }
      const auctions: AuctionOnChain[] = [];
      for (const entry of auctionEntries) {
        const auction = entry.owner === marketProgramId ? decodeAuction(entry.data) : undefined;
        if (auction) auctions.push(auction);
      }
      const offers: OfferOnChain[] = [];
      for (const entry of offerEntries) {
        const offer = entry.owner === marketProgramId ? decodeOffer(entry.data) : undefined;
        if (offer) offers.push(offer);
      }
      return { config, authority, listings, auctions, offers, offerDepositLamports };
    },

    async prize(seasonId): Promise<PrizeReading | null> {
      if (!prizeVaultProgramId) return null;
      const program = address(prizeVaultProgramId);
      const [configAddress, vault, seasonKey] = await Promise.all([
        prizeConfigAddress(program),
        prizeVaultAddress(program),
        seasonAddress(program, seasonId),
      ]);
      const [configAccount, seasonAccount, vaultLamports, vaultRentLamports] = await Promise.all([
        rpc.account(configAddress),
        rpc.account(seasonKey),
        rpc.balance(vault),
        rpc.rentExempt(PRIZE_VAULT_LENGTH),
      ]);
      // As with the market: bytes in an account the program does not own are not its state.
      const config = configAccount?.owner === prizeVaultProgramId ? decodePrizeConfig(configAccount.data) : undefined;
      if (!config) return null;
      const season = seasonAccount?.owner === prizeVaultProgramId ? decodeSeason(seasonAccount.data) : undefined;
      return { vault, vaultLamports, vaultRentLamports, config, season: season?.seasonId === seasonId ? season : null };
    },

    async balances(owner): Promise<Balances> {
      const program = await mintProgram();
      const token = await associatedTokenAddress(address(owner), address(utilityMint), program);
      const [solLamports, account] = await Promise.all([rpc.balance(owner), rpc.account(token)]);
      const tokenAtoms = account ? (decodeTokenAccountAmount(account.data, address(utilityMint), address(owner)) ?? 0n) : 0n;
      return { solLamports, tokenAtoms };
    },
  };
}

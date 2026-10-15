import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CORE_CANDY_GUARD_PROGRAM_ID,
  CORE_CANDY_MACHINE_PROGRAM_ID,
  MPL_CORE_PROGRAM_ID,
  decodeCandyMachine,
  registerCitizenInstruction,
} from '@bas/chain-client';
import {
  CANDY_MACHINE_HIDDEN_SECTION,
  findMintCounterPda,
  getCandyGuardAccountDataSerializer,
  getCandyMachineAccountDataSerializer,
  getInitializeCandyMachineInstructionDataSerializer,
} from '@metaplex-foundation/mpl-core-candy-machine';
import { none, publicKey, some } from '@metaplex-foundation/umi';
import { address } from '@solana/kit';

import { CONFIG_LINES_PER_TRANSACTION, buildAddItems, buildCreateSale, candyGuardOf, guardSetFor, readSale, type SaleItem } from '../dist/index.js';
import { PROGRAM_ID, TREASURY, offlineUmi, signerOf } from './fixtures.ts';

const PREFIX = 'https://bas-district-devnet.vercel.app/templates/7/';
const GUARDS = {
  priceLamports: 10_000_000n,
  treasury: TREASURY,
  mintLimitPerWallet: 1,
  mintLimitId: 0,
  mintSigner: signerOf(offlineUmi(), 'mint-signer').publicKey,
};
const items: SaleItem[] = [
  { name: 'Farmer Hale #001', file: '001-artisan.json' },
  { name: 'Archivist Pell #002', file: '002-scholar.json' },
  { name: 'Warden Brisk #003', file: '003-sentinel.json' },
];

describe('sale creation', () => {
  it('creates the account, initializes the machine and the guard, then wraps one around the other', async () => {
    const umi = offlineUmi();
    const machine = signerOf(umi, 'machine');
    const builder = await buildCreateSale(umi, {
      candyMachine: machine,
      collection: signerOf(umi, 'collection').publicKey,
      collectionUpdateAuthority: signerOf(umi, 'update-authority'),
      uriPrefix: PREFIX,
      items,
      guards: GUARDS,
    });
    const programs = builder.items.map((item) => item.instruction.programId);
    assert.deepEqual(programs, [
      '11111111111111111111111111111111',
      CORE_CANDY_MACHINE_PROGRAM_ID,
      CORE_CANDY_GUARD_PROGRAM_ID,
      CORE_CANDY_GUARD_PROGRAM_ID,
    ]);

    const initialize = builder.items[1]?.instruction.data as Uint8Array;
    const data = getInitializeCandyMachineInstructionDataSerializer().deserialize(initialize)[0];
    assert.equal(data.itemsAvailable, 3n);
    assert.equal(data.isMutable, false);
    assert.deepEqual(data.configLineSettings, {
      __option: 'Some',
      value: { prefixName: '', nameLength: 32, prefixUri: PREFIX, uriLength: '003-sentinel.json'.length, isSequential: false },
    });
    // The first two signers are the machine keypair and the collection's update authority.
    const signers = builder.items.flatMap((item) => item.signers.map((signer) => signer.publicKey));
    assert.ok(signers.includes(machine.publicKey));
  });

  it('can be sent one instruction per transaction when the whole does not fit', async () => {
    const umi = offlineUmi();
    const roster: SaleItem[] = Array.from({ length: 10 }, (_, index) => ({
      name: `Citizen #${String(index + 1).padStart(3, '0')}`,
      file: `${String(index + 1).padStart(3, '0')}-artisan.json`,
    }));
    const builder = await buildCreateSale(umi, {
      candyMachine: signerOf(umi, 'machine'),
      collection: signerOf(umi, 'collection').publicKey,
      collectionUpdateAuthority: signerOf(umi, 'update-authority'),
      uriPrefix: PREFIX,
      items: roster,
      guards: { ...GUARDS, startsAt: 1_800_000_000, botTaxLamports: 10_000_000n },
    });
    for (const item of builder.items) {
      assert.equal(await builder.empty().add(item).fitsInOneTransaction(umi), true);
    }
  });

  it('stores the five guard settings the manifest asks for', async () => {
    const umi = offlineUmi();
    const machine = signerOf(umi, 'machine');
    const builder = await buildCreateSale(umi, {
      candyMachine: machine,
      collection: signerOf(umi, 'collection').publicKey,
      collectionUpdateAuthority: signerOf(umi, 'update-authority'),
      uriPrefix: PREFIX,
      items,
      guards: { ...GUARDS, startsAt: 1_800_000_000, botTaxLamports: 10_000_000n },
    });
    const guardInit = builder.items[2]?.instruction.data as Uint8Array;
    // `initialize` of the guard is `discriminator + guard set + groups`; reading it back as account data
    // (which adds base, bump and authority in front) is not possible, so compare the serialized set itself.
    const serializer = getCandyGuardAccountDataSerializer(umi);
    const expected = serializer.serialize({
      base: machine.publicKey,
      bump: 0,
      authority: umi.identity.publicKey,
      guards: { ...emptyGuards(), ...guardSetFor({ ...GUARDS, startsAt: 1_800_000_000, botTaxLamports: 10_000_000n }) },
      groups: [],
    } as never);
    // In account form the guard set follows discriminator(8) + base(32) + bump(1) + authority(32); in the
    // instruction it follows the discriminator(8) and a u32 byte length.
    const tail = expected.subarray(8 + 32 + 1 + 32);
    assert.deepEqual([...guardInit.subarray(12)], [...tail]);
    assert.equal(new DataView(guardInit.buffer, guardInit.byteOffset + 8, 4).getUint32(0, true), tail.length);
  });

  it('refuses an empty sale, a bad prefix and a name that does not fit', async () => {
    const umi = offlineUmi();
    const base = {
      candyMachine: signerOf(umi, 'machine'),
      collection: signerOf(umi, 'collection').publicKey,
      collectionUpdateAuthority: signerOf(umi, 'update-authority'),
      guards: GUARDS,
    };
    await assert.rejects(buildCreateSale(umi, { ...base, uriPrefix: PREFIX, items: [] }), /at least one item/);
    await assert.rejects(buildCreateSale(umi, { ...base, uriPrefix: 'http://x/', items }), /https URL/);
    await assert.rejects(buildCreateSale(umi, { ...base, uriPrefix: PREFIX, items: [{ name: 'x'.repeat(33), file: '001-artisan.json' }] }), /1 to 32/);
  });
});

function emptyGuards(): Record<string, unknown> {
  const none = { __option: 'None' };
  return Object.fromEntries(
    [
      'botTax', 'solPayment', 'tokenPayment', 'startDate', 'thirdPartySigner', 'tokenGate', 'gatekeeper', 'endDate',
      'allowList', 'mintLimit', 'nftPayment', 'redeemedAmount', 'addressGate', 'nftGate', 'nftBurn', 'tokenBurn',
      'freezeSolPayment', 'freezeTokenPayment', 'programGate', 'allocation', 'token2022Payment', 'solFixedFee',
      'nftMintLimit', 'edition', 'assetPayment', 'assetPaymentMulti', 'assetBurn', 'assetBurnMulti', 'assetMintLimit',
      'assetGate', 'vanityMint',
    ].map((name) => [name, none]),
  );
}

describe('config lines', () => {
  it('load every item in batches that start where the last one ended', () => {
    const umi = offlineUmi();
    const many: SaleItem[] = Array.from({ length: 25 }, (_, index) => ({
      name: `Citizen #${String(index + 1).padStart(3, '0')}`,
      file: `${String(index + 1).padStart(3, '0')}-artisan.json`,
    }));
    const batches = buildAddItems(umi, signerOf(umi, 'machine').publicKey, many);
    assert.equal(batches.length, Math.ceil(25 / CONFIG_LINES_PER_TRANSACTION));
    const starts = batches.map((batch) => new DataView((batch.items[0]?.instruction.data as Uint8Array).buffer, (batch.items[0]?.instruction.data as Uint8Array).byteOffset + 8, 4).getUint32(0, true));
    assert.deepEqual(starts, [0, 10, 20]);
  });
});

describe('resuming the item load', () => {
  it('starts at the first line the machine does not hold yet', () => {
    const umi = offlineUmi();
    const many: SaleItem[] = Array.from({ length: 25 }, (_, index) => ({
      name: `Citizen #${index + 1}`,
      file: `${String(index + 1).padStart(3, '0')}-artisan.json`,
    }));
    const machine = signerOf(umi, 'machine').publicKey;
    assert.deepEqual(buildAddItems(umi, machine, many, 25), []);
    assert.equal(buildAddItems(umi, machine, many, 20).length, 1);
    assert.throws(() => buildAddItems(umi, machine, many, 26), /25/);
    assert.throws(() => buildAddItems(umi, machine, many, -1));
  });
});

describe('reading the sale', () => {
  function machineBytes(redeemed: number, available: number, loaded: number): Uint8Array {
    const umi = offlineUmi();
    const data = getCandyMachineAccountDataSerializer().serialize({
      authority: signerOf(umi, 'deployer').publicKey,
      mintAuthority: signerOf(umi, 'guard').publicKey,
      collectionMint: signerOf(umi, 'collection').publicKey,
      itemsRedeemed: redeemed,
      data: {
        itemsAvailable: available,
        maxEditionSupply: 0,
        isMutable: false,
        configLineSettings: some({ prefixName: '', nameLength: 32, prefixUri: PREFIX, uriLength: 17, isSequential: false }),
        hiddenSettings: none(),
      },
    });
    // The SDK serializer writes the fixed part; the account keeps its lines at a fixed offset behind it:
    // loaded count, name/uri lines, loaded bitmap, then the shuffled indexes still to mint.
    const lineSize = 32 + 17;
    const hidden = 4 + available * lineSize + (Math.floor(available / 8) + 1) + available * 4;
    const out = new Uint8Array(CANDY_MACHINE_HIDDEN_SECTION + hidden);
    out.set(data, 0);
    new DataView(out.buffer).setUint32(CANDY_MACHINE_HIDDEN_SECTION, loaded, true);
    return out;
  }

  it('agrees with the byte offsets the chain reader uses', () => {
    const bytes = machineBytes(7, 100, 100);
    const decoded = decodeCandyMachine(bytes);
    assert.equal(decoded?.itemsRedeemed, 7);
    assert.equal(decoded?.itemsAvailable, 100);
    assert.equal(decoded?.collection, signerOf(offlineUmi(), 'collection').publicKey);
  });

  it('reports supply, load progress and the wallet counter', async () => {
    const umi = offlineUmi();
    const machine = signerOf(umi, 'machine').publicKey;
    const wallet = signerOf(umi, 'wallet').publicKey;
    const counterAddress = findMintCounterPda(umi, {
      id: 0,
      user: wallet,
      candyMachine: machine,
      candyGuard: publicKey(candyGuardOf(umi, machine)),
    })[0];
    const accounts = new Map<string, Uint8Array>([
      [machine, machineBytes(3, 10, 10)],
      [counterAddress, Uint8Array.of(1, 0)],
    ]);
    umi.rpc = {
      ...umi.rpc,
      getAccount: async (key) => {
        const data = accounts.get(key);
        return data
          ? { publicKey: key, exists: true, executable: false, owner: publicKey(PROGRAM_ID), lamports: { basisPoints: 1n, identifier: 'SOL', decimals: 9 }, rentEpoch: 0n, header: { executable: false, owner: publicKey(PROGRAM_ID), lamports: { basisPoints: 1n, identifier: 'SOL', decimals: 9 }, rentEpoch: 0n }, data }
          : { publicKey: key, exists: false };
      },
    } as typeof umi.rpc;
    assert.deepEqual(await readSale(umi, { candyMachine: machine, mintLimitId: 0, wallet }), {
      collection: signerOf(umi, 'collection').publicKey,
      mintAuthority: signerOf(umi, 'guard').publicKey,
      itemsAvailable: 10,
      itemsLoaded: 10,
      itemsRedeemed: 3,
      mintedByWallet: 1,
    });
    // Another wallet has no counter yet.
    const other = await readSale(umi, { candyMachine: machine, mintLimitId: 0, wallet: signerOf(umi, 'other').publicKey });
    assert.equal(other?.mintedByWallet, 0);
    assert.equal(await readSale(umi, { candyMachine: signerOf(umi, 'nowhere').publicKey, mintLimitId: 0, wallet }), undefined);
  });
});

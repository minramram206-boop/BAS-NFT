import { MINT_LIMIT_ID, createMintBackend } from '@bas/metaplex-client';
import { Authenticator } from './auth.js';
import { RpcChainReader } from './chain.js';
import { loadConfig } from './config.js';
import { createMissionServer } from './http.js';
import { MarketIndexer, describeSale, rpcMarketSource } from './market.js';
import { MemorySeenStore, PgSeenStore } from './market-seen.js';
import { PgMarketStore, openMarketDatabase } from './market-store.js';
import { MintService } from './mint.js';
import { PrizeBook } from './prizes.js';
import { MissionService } from './service.js';
import { FileStore } from './store.js';
import { openUpkeep } from './upkeep.js';

const config = loadConfig();

// Confirmed missions become lines in the citizen's public history, written by the chat worker.
const upkeep = await openUpkeep(config.redisUrl);

const service = new MissionService({
  programId: config.programId,
  authority: config.authority,
  season: config.season,
  events: config.events,
  store: new FileStore(config.storeFile),
  chain: new RpcChainReader(config.network.rpcUrl, { programId: config.programId, collection: config.collection }),
  ...(upkeep
    ? {
        onHistory: (event) =>
          upkeep.enqueuePublicLine(event).catch((error: unknown) => {
            console.error(`[mission-server] could not queue a history line: ${error instanceof Error ? error.message : String(error)}`);
          }),
      }
    : {}),
});

const { network, mint } = config;
const sale = mint
  ? new MintService({
      backend: createMintBackend({
        rpcUrl: network.rpcUrl,
        programId: network.districtProgramId,
        approvedTemplateId: network.approvedTemplateId,
        candyMachine: network.candyMachine,
        collection: network.coreCollection,
        treasury: network.solTreasury,
        ...(network.prizeVaultProgramId ? { prizeVaultProgramId: network.prizeVaultProgramId } : {}),
        ...(network.mintPrizeShareBps === undefined ? {} : { mintPrizeShareBps: network.mintPrizeShareBps }),
        mintLimitId: MINT_LIMIT_ID,
        mintSecretKey: mint.signer.secretKey,
      }),
      limitPerWallet: network.mintLimitPerWallet,
      ...(mint.opensAt === undefined ? {} : { opensAt: mint.opensAt }),
    })
  : undefined;

// Sales and bids of the market program: a line in the citizen's public history, and the feed of /market/activity.
const database = network.marketProgramId ? await openMarketDatabase(config.databaseUrl) : undefined;
const marketStore = database && network.marketProgramId ? new PgMarketStore(database, network.marketProgramId) : undefined;
const market = network.marketProgramId
  ? new MarketIndexer({
      source: rpcMarketSource(network.rpcUrl),
      programId: network.marketProgramId,
      ...(marketStore ? { store: marketStore } : {}),
      ...(upkeep
        ? {
            onSale: (record) =>
              void upkeep.enqueuePublicLine(describeSale(record, config.season)).catch((error: unknown) => {
                console.error(`[mission-server] could not queue a sale line: ${error instanceof Error ? error.message : String(error)}`);
              }),
          }
        : {}),
    })
  : undefined;
market?.start(15_000);

createMissionServer({
  ...(sale ? { mint: sale } : {}),
  ...(market ? { market } : {}),
  seen: database ? new PgSeenStore(database) : new MemorySeenStore(),
  prizes: new PrizeBook(config.prizesDir),
  service,
  auth: new Authenticator(config.tokenSecret),
  allowedOrigins: config.allowedOrigins,
}).listen(config.port, () => {
  console.log(`[mission-server] ${config.network.cluster} on port ${config.port}`);
});

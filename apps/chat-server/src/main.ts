import { OpenRouterClient, createChatService } from '@bas/ai';
import { parseCitizenRoster } from '@bas/content';
import { loadRepoJson } from '@bas/config';
import { ServiceUnreachableError } from '@bas/chat-store';
import { RpcAssetReader } from '@bas/server-kit';
import { PublicKey } from '@solana/web3.js';
import { loadServerConfig } from './config.js';
import { createCitizenDirectory } from './directory.js';
import { createChatServer } from './http.js';
import { createStores } from './runtime.js';

const config = loadServerConfig();
const stores = await createStores(config).catch((error: unknown) => {
  // A store that is down is an operator problem with a known fix; a stack trace would hide it.
  if (error instanceof ServiceUnreachableError) {
    console.error(`[chat-server] ${error.message}`);
    process.exit(1);
  }
  throw error;
});
const { chat } = config;

if (!chat.enabled) console.warn('[chat-server] CHAT_ENABLED is not true: owners will see chat as unavailable');

const reader = new RpcAssetReader(config.network.rpcUrl, {
  programId: new PublicKey(config.network.districtProgramId),
  collection: new PublicKey(config.network.coreCollection),
});
const roster = parseCitizenRoster(loadRepoJson<unknown>('content/en/citizens.json'));

const directory = createCitizenDirectory(reader, roster);

const service = createChatService({
  config: chat,
  dailyMessageLimit: config.network.dailyMessageLimit,
  model: new OpenRouterClient({
    apiKey: chat.apiKey,
    prices: chat.prices,
    reasoningEffort: chat.reasoningEffort,
    ...(config.siteUrl ? { siteUrl: config.siteUrl } : {}),
  }),
  quota: stores.quota,
  memory: stores.memory,
  conversations: stores.conversations,
  ledger: stores.ledger,
  lock: stores.lock,
  // Why an owner got no answer: the model name, the outcome and the status code. Never the message or the reply.
  onModelCall: (call) => {
    if (call.outcome === 'ok') return;
    console.warn(`[chat-server] model ${call.model} ${call.outcome}${call.detail ? ` (${call.detail})` : ''} after ${call.ms} ms`);
  },
  onSummaryGrown: async (asset, owner) => {
    const found = await directory.resolve(asset);
    if (found && stores.queue) await stores.queue.enqueueConsolidation({ asset, owner, citizenName: found.citizen.name });
  },
});
const server = createChatServer({
  chat: service,
  directory,
  memory: stores.memory,
  tokenSecret: config.tokenSecret,
  allowedOrigins: config.allowedOrigins,
});

server.listen(config.port, () => {
  console.log(`[chat-server] ${config.network.cluster} on port ${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      void stores.close().finally(() => process.exit(0));
    });
  });
}

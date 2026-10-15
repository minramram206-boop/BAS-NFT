import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { INSTRUCTION_DISCRIMINATORS, STAT_INDEX, citizenStateAddress, configAddress } from '@bas/chain-client';
import { address } from '@solana/kit';
import { Keypair, Transaction } from '@solana/web3.js';

import { TransactionFailedError, anchorErrorNumber, createTransactions, type SendRpc, type SignatureStatus } from '../src/lib/data/chain/transactions.ts';
import { PROGRAM_ID, TOKEN_PROGRAM, UTILITY_MINT } from './chainWorld.ts';

function fakeRpc(statuses: SignatureStatus[], overrides: Partial<SendRpc> = {}): SendRpc & { polls: number; sent: string[] } {
  const rpc = {
    polls: 0,
    sent: [] as string[],
    latestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n }),
    ownerOf: async (account: string) => (account === UTILITY_MINT ? TOKEN_PROGRAM : null),
    send: async (base64: string) => {
      rpc.sent.push(base64);
      return 'sig';
    },
    status: async (): Promise<SignatureStatus> => statuses[Math.min(rpc.polls++, statuses.length - 1)]!,
    ...overrides,
  };
  return rpc;
}

describe('upgrade_score transaction', () => {
  it('carries the program, accounts and stat the program expects, and is payable by the owner alone', async () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const asset = Keypair.generate().publicKey.toBase58();
    const transactions = createTransactions({ rpc: fakeRpc([]), programId: PROGRAM_ID.toBase58(), utilityMint: UTILITY_MINT });
    const bytes = await transactions.buildUpgradeScore({ owner, asset, stat: 'alignment' });

    const transaction = Transaction.from(bytes);
    assert.equal(transaction.feePayer!.toBase58(), owner);
    assert.equal(transaction.instructions.length, 1);
    const [instruction] = transaction.instructions;
    assert.equal(instruction!.programId.toBase58(), PROGRAM_ID.toBase58());
    assert.deepEqual([...instruction!.data], [...INSTRUCTION_DISCRIMINATORS.upgradeScore, STAT_INDEX.alignment]);
    const keys = instruction!.keys.map((entry) => entry.pubkey.toBase58());
    assert.equal(keys[0], await configAddress(address(PROGRAM_ID.toBase58())));
    assert.equal(keys[1], asset);
    assert.equal(keys[2], await citizenStateAddress(address(PROGRAM_ID.toBase58()), address(asset)));
    assert.equal(keys[3], owner);
    assert.equal(keys[4], UTILITY_MINT);
    assert.equal(keys[6], TOKEN_PROGRAM);
    assert.deepEqual(
      instruction!.keys.filter((entry) => entry.isSigner).map((entry) => entry.pubkey.toBase58()),
      [owner],
    );
  });

  it('refuses to build when the token mint is missing from the cluster', async () => {
    const transactions = createTransactions({
      rpc: fakeRpc([], { ownerOf: async () => null }),
      programId: PROGRAM_ID.toBase58(),
      utilityMint: UTILITY_MINT,
    });
    await assert.rejects(
      () => transactions.buildUpgradeScore({ owner: Keypair.generate().publicKey.toBase58(), asset: Keypair.generate().publicKey.toBase58(), stat: 'compute' }),
      TransactionFailedError,
    );
  });
});

describe('sending', () => {
  const options = (rpc: SendRpc, extra: { timeoutMs?: number } = {}) => ({
    rpc,
    programId: PROGRAM_ID.toBase58(),
    utilityMint: UTILITY_MINT,
    pollMs: 1,
    sleep: async () => {},
    ...extra,
  });

  it('waits until the cluster confirms the signature', async () => {
    const rpc = fakeRpc([
      { state: null, failed: false },
      { state: 'processed', failed: false },
      { state: 'confirmed', failed: false },
    ]);
    assert.equal(await createTransactions(options(rpc)).send(Uint8Array.of(1, 2, 3)), 'sig');
    assert.equal(rpc.polls, 3);
    assert.equal(rpc.sent[0], 'AQID', 'the signed bytes go out as base64');
  });

  it('fails when the cluster says the transaction failed', async () => {
    const rpc = fakeRpc([{ state: 'processed', failed: true }]);
    await assert.rejects(() => createTransactions(options(rpc)).send(Uint8Array.of(1)), TransactionFailedError);
  });

  it('fails when the node refuses it before it is taken', async () => {
    const rpc = fakeRpc([], { send: async () => { throw new Error('Transaction simulation failed'); } });
    await assert.rejects(() => createTransactions(options(rpc)).send(Uint8Array.of(1)), /simulation failed/);
  });

  it('gives up when the signature never shows up', async () => {
    const rpc = fakeRpc([{ state: null, failed: false }]);
    await assert.rejects(() => createTransactions(options(rpc, { timeoutMs: 20 })).send(Uint8Array.of(1)), /not confirmed in time/);
  });
});

describe('market refusals', () => {
  it('finds the Anchor error number in the logs or the custom error, however deep the RPC nests them', () => {
    assert.equal(anchorErrorNumber(new Error('Program log: AnchorError occurred. Error Code: PriceAboveLimit. Error Number: 6010.')), 6010);
    assert.equal(anchorErrorNumber(new Error('failed: custom program error: 0x1778')), 6008);
    // Shaped like @solana/kit's preflight failure: the logs sit in the context, the custom code in the cause.
    const preflight = Object.assign(new Error('Transaction simulation failed'), {
      context: { logs: ['Program EVjd invoke [1]', 'Program log: AnchorError thrown. Error Number: 6001. Error Message: The market is paused..'] },
      cause: Object.assign(new Error('custom program error: #6001'), { context: { code: 6001, index: 1 } }),
    });
    assert.equal(anchorErrorNumber(preflight), 6001);
    assert.equal(anchorErrorNumber(new Error('Blockhash not found')), undefined);
    assert.equal(anchorErrorNumber('not an error'), undefined);
  });

  it('names the market rule a preflight refusal broke', async () => {
    const rpc = fakeRpc([], {
      send: async () => {
        throw new Error('Program log: AnchorError occurred. Error Code: ListingStale. Error Number: 6008.');
      },
    });
    const transactions = createTransactions({ rpc, programId: PROGRAM_ID.toBase58(), utilityMint: UTILITY_MINT });
    const error = await transactions.send(Uint8Array.of(1, 2, 3)).catch((caught: unknown) => caught);
    assert.ok(error instanceof TransactionFailedError);
    assert.equal(error.marketError, 'ListingStale');
  });

  it('refuses to build a market transaction on a cluster without a market', async () => {
    const transactions = createTransactions({ rpc: fakeRpc([]), programId: PROGRAM_ID.toBase58(), utilityMint: UTILITY_MINT });
    const seller = Keypair.generate().publicKey.toBase58();
    await assert.rejects(transactions.buildChangeListingPrice({ seller, asset: seller, priceLamports: 1n }), /no market/);
  });
});

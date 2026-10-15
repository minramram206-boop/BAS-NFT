import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Wallet, WalletAccount } from '@wallet-standard/base';

import { WalletDeclinedError, type WalletSession } from '../src/lib/data/chain/types.ts';
import { WalletController, type WalletRegistry } from '../src/lib/wallet/controller.ts';
import { chainId } from '../src/lib/wallet/standard.ts';

const account = (address: string, chains: string[] = ['solana:devnet']): WalletAccount => ({
  address,
  publicKey: new Uint8Array(32),
  chains: chains as WalletAccount['chains'],
  features: [],
});

interface FakeOptions {
  accounts?: WalletAccount[];
  chains?: string[];
  rejectConnect?: boolean;
  rejectSign?: boolean;
  missing?: string[];
  connectDelay?: Promise<void>;
}

function fakeWallet(name: string, options: FakeOptions = {}) {
  const log = { connect: [] as unknown[], disconnects: 0, signMessage: 0, signTransaction: [] as unknown[] };
  const listeners = new Set<(change: { accounts?: readonly WalletAccount[] }) => void>();
  const features: Record<string, unknown> = {
    'standard:connect': {
      version: '1.0.0',
      connect: async (input: unknown) => {
        log.connect.push(input);
        await options.connectDelay;
        if (options.rejectConnect) throw new Error('User rejected the request.');
        return { accounts: options.accounts ?? [account(`${name}-address`)] };
      },
    },
    'standard:disconnect': { version: '1.0.0', disconnect: async () => void (log.disconnects += 1) },
    'standard:events': {
      version: '1.0.0',
      on: (_event: string, listener: (change: { accounts?: readonly WalletAccount[] }) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    'solana:signMessage': {
      version: '1.0.0',
      signMessage: async (...inputs: { message: Uint8Array }[]) => {
        log.signMessage += 1;
        if (options.rejectSign) throw new Error('User rejected the request.');
        return inputs.map((input) => ({ signedMessage: input.message, signature: Uint8Array.of(7, 7) }));
      },
    },
    'solana:signTransaction': {
      version: '1.0.0',
      supportedTransactionVersions: ['legacy'],
      signTransaction: async (...inputs: { transaction: Uint8Array; chain?: string }[]) => {
        log.signTransaction.push(inputs[0]?.chain);
        if (options.rejectSign) throw new Error('User rejected the request.');
        return inputs.map((input) => ({ signedTransaction: Uint8Array.of(...input.transaction, 9) }));
      },
    },
  };
  for (const feature of options.missing ?? []) delete features[feature];
  const wallet = { version: '1.0.0', name, icon: 'data:image/png;base64,AAAA', chains: options.chains ?? ['solana:devnet'], features, accounts: [] } as unknown as Wallet;
  return { wallet, log, emit: (change: { accounts?: readonly WalletAccount[] }) => listeners.forEach((listener) => listener(change)) };
}

function registry(initial: Wallet[]) {
  const wallets = [...initial];
  const listeners: Record<string, Set<() => void>> = { register: new Set(), unregister: new Set() };
  const api: WalletRegistry & { add(wallet: Wallet): void } = {
    get: () => wallets,
    on: (event, listener) => {
      listeners[event]!.add(listener);
      return () => listeners[event]!.delete(listener);
    },
    add(wallet) {
      wallets.push(wallet);
      listeners.register!.forEach((listener) => listener());
    },
  };
  return api;
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

function setup(wallets: Wallet[], storage = memoryStorage()) {
  const sessions: (WalletSession | null)[] = [];
  const reg = registry(wallets);
  const controller = new WalletController({ cluster: 'devnet', registry: reg, onSession: (s) => sessions.push(s), storage });
  return { controller, sessions, reg, storage };
}

describe('wallet standard', () => {
  it('names the chain of each cluster', () => {
    assert.equal(chainId('devnet'), 'solana:devnet');
    assert.equal(chainId('mainnet-beta'), 'solana:mainnet');
  });
});

describe('wallet controller', () => {
  it('lists only wallets that can sign messages and transactions for the cluster', () => {
    const good = fakeWallet('Good');
    const noTx = fakeWallet('NoTransactions', { missing: ['solana:signTransaction'] });
    const noMsg = fakeWallet('NoMessages', { missing: ['solana:signMessage'] });
    const other = fakeWallet('Mainnet', { chains: ['solana:mainnet'] });
    const { controller } = setup([good.wallet, noTx.wallet, noMsg.wallet, other.wallet]);
    assert.deepEqual(controller.getState().options.map((option) => option.name), ['Good']);
  });

  it('picks up a wallet that registers after the page loaded', () => {
    const { controller, reg } = setup([]);
    const stop = controller.start();
    assert.equal(controller.getState().options.length, 0);
    reg.add(fakeWallet('Late').wallet);
    assert.deepEqual(controller.getState().options.map((option) => option.name), ['Late']);
    stop();
  });

  it('connects, hands out a session that signs through the wallet, and remembers the choice', async () => {
    const fake = fakeWallet('Alpha');
    const { controller, sessions, storage } = setup([fake.wallet]);
    await controller.connect('Alpha');

    assert.equal(controller.getState().status, 'connected');
    assert.equal(controller.getState().address, 'Alpha-address');
    assert.equal(storage.data.get('bas.wallet'), 'Alpha');
    const session = sessions[0]!;
    assert.equal(session.address, 'Alpha-address');
    assert.deepEqual([...(await session.signMessage(Uint8Array.of(1)))], [7, 7]);
    assert.deepEqual([...(await session.signTransaction(Uint8Array.of(1, 2)))], [1, 2, 9]);
    assert.deepEqual(fake.log.signTransaction, ['solana:devnet']);
    assert.deepEqual(fake.log.connect, [undefined], 'a normal connect opens the wallet prompt');
  });

  it('reports a closed prompt as declined and tells nobody about a session', async () => {
    const { controller, sessions } = setup([fakeWallet('Alpha', { rejectConnect: true }).wallet]);
    await controller.connect('Alpha');
    assert.equal(controller.getState().status, 'idle');
    assert.equal(controller.getState().failure, 'declined');
    assert.deepEqual(sessions, []);
  });

  it('turns a closed signing prompt into a declined error', async () => {
    const { controller, sessions } = setup([fakeWallet('Alpha', { rejectSign: true }).wallet]);
    await controller.connect('Alpha');
    await assert.rejects(() => sessions[0]!.signMessage(Uint8Array.of(1)), WalletDeclinedError);
    await assert.rejects(() => sessions[0]!.signTransaction(Uint8Array.of(1)), WalletDeclinedError);
  });

  it('prefers the account that supports the cluster', async () => {
    const fake = fakeWallet('Alpha', { accounts: [account('main-only', ['solana:mainnet']), account('dev-ok')] });
    const { controller } = setup([fake.wallet]);
    await controller.connect('Alpha');
    assert.equal(controller.getState().address, 'dev-ok');
  });

  it('disconnects: forgets the choice, tells the game and the wallet', async () => {
    const fake = fakeWallet('Alpha');
    const { controller, sessions, storage } = setup([fake.wallet]);
    await controller.connect('Alpha');
    await controller.disconnect();
    assert.equal(controller.getState().status, 'idle');
    assert.equal(controller.getState().address, null);
    assert.equal(storage.data.has('bas.wallet'), false);
    assert.equal(sessions.at(-1), null);
    assert.equal(fake.log.disconnects, 1);
  });

  it('follows an account switch in the wallet and lets go when the account is removed', async () => {
    const fake = fakeWallet('Alpha');
    const { controller, sessions } = setup([fake.wallet]);
    await controller.connect('Alpha');
    fake.emit({ accounts: [account('second')] });
    assert.equal(controller.getState().address, 'second');
    assert.equal(sessions.at(-1)!.address, 'second');
    fake.emit({ accounts: [] });
    await Promise.resolve();
    assert.equal(controller.getState().status, 'idle');
    assert.equal(sessions.at(-1), null);
    fake.emit({});
  });

  it('restores the last wallet silently and stays quiet when that fails', async () => {
    const fake = fakeWallet('Alpha');
    const first = setup([fake.wallet], memoryStorage({ 'bas.wallet': 'Alpha' }));
    await first.controller.restore();
    assert.equal(first.controller.getState().status, 'connected');
    assert.deepEqual(fake.log.connect, [{ silent: true }]);

    const refusing = setup([fakeWallet('Alpha', { rejectConnect: true }).wallet], memoryStorage({ 'bas.wallet': 'Alpha' }));
    await refusing.controller.restore();
    assert.equal(refusing.controller.getState().failure, null);
    assert.equal(refusing.controller.getState().status, 'idle');

    const nothing = setup([fakeWallet('Alpha').wallet]);
    await nothing.controller.restore();
    assert.equal(nothing.controller.getState().status, 'idle');
  });

  it('ignores a slow connect that is overtaken by a newer one', async () => {
    let release: () => void = () => {};
    const slow = fakeWallet('Slow', { connectDelay: new Promise<void>((resolve) => (release = resolve)) });
    const quick = fakeWallet('Quick');
    const { controller, sessions } = setup([slow.wallet, quick.wallet]);
    const first = controller.connect('Slow');
    await controller.connect('Quick');
    release();
    await first;
    assert.equal(controller.getState().walletName, 'Quick');
    assert.deepEqual(sessions.map((session) => session?.address), ['Quick-address']);
    assert.equal(slow.log.disconnects, 1, 'the late connection is closed again');
  });

  it('refuses a wallet that cannot play on the cluster', async () => {
    const { controller } = setup([fakeWallet('Mainnet', { chains: ['solana:mainnet'] }).wallet]);
    await controller.connect('Mainnet');
    assert.equal(controller.getState().failure, 'failed');
  });
});

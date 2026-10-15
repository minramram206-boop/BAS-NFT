import type { Wallet } from '@wallet-standard/base';
import type { WalletSession } from '@/lib/data/chain/types';
import { connectStandardWallet, isUsable, type ConnectedWallet, type SolanaCluster } from './standard';

/** The part of `getWallets()` the controller uses. */
export interface WalletRegistry {
  get(): readonly Wallet[];
  on(event: 'register' | 'unregister', listener: () => void): () => void;
}

export interface WalletOption {
  readonly name: string;
  readonly icon: string;
}

export interface WalletState {
  /** Wallets in this browser that can play on the cluster. */
  readonly options: readonly WalletOption[];
  readonly status: 'idle' | 'connecting' | 'connected';
  readonly address: string | null;
  readonly walletName: string | null;
  /** Why the last connect did not finish; cleared by the next one. */
  readonly failure: 'declined' | 'failed' | null;
}

export interface WalletControllerOptions {
  readonly cluster: SolanaCluster;
  readonly registry: WalletRegistry;
  /** Told whenever the wallet the game plays with changes, including `null` on disconnect. */
  readonly onSession: (session: WalletSession | null) => void;
  /** Where the name of the last wallet is kept; defaults to nothing. */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

const STORAGE_KEY = 'bas.wallet';

/**
 * Keeps track of the wallets in the browser and the one the person plays with.
 * It owns no UI; `useWallets` shows its state and calls `connect` and `disconnect`.
 */
export class WalletController {
  private readonly options: WalletControllerOptions;
  private readonly listeners = new Set<() => void>();
  private current: ConnectedWallet | null = null;
  private stopWatching: (() => void) | null = null;
  private stopAccount: (() => void) | null = null;
  /** Bumped by every connect and disconnect, so a late answer from an older attempt is ignored. */
  private attempt = 0;
  private state: WalletState;

  constructor(options: WalletControllerOptions) {
    this.options = options;
    this.state = { options: this.listOptions(), status: 'idle', address: null, walletName: null, failure: null };
  }

  /** Immutable snapshot, replaced on every change. */
  getState = (): WalletState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Starts watching for wallets that register after the page loaded. */
  start(): () => void {
    const refresh = () => this.update({ options: this.listOptions() });
    const offs = [this.options.registry.on('register', refresh), this.options.registry.on('unregister', refresh)];
    this.stopWatching = () => offs.forEach((off) => off());
    return () => {
      this.stopWatching?.();
      this.stopAccount?.();
    };
  }

  /** Reconnects the wallet used last time, if it still trusts this site. Never opens a prompt. */
  async restore(): Promise<void> {
    const name = this.read();
    if (!name || this.current) return;
    const wallet = this.options.registry.get().find((item) => item.name === name);
    if (!wallet) return;
    await this.open(wallet, true);
  }

  async connect(name: string): Promise<void> {
    const wallet = this.options.registry.get().find((item) => item.name === name);
    if (!wallet || !isUsable(wallet, this.options.cluster)) {
      this.update({ failure: 'failed' });
      return;
    }
    await this.open(wallet, false);
  }

  async disconnect(): Promise<void> {
    const previous = this.current;
    this.attempt += 1;
    this.release();
    this.write(null);
    this.update({ status: 'idle', address: null, walletName: null, failure: null });
    this.options.onSession(null);
    // The wallet may refuse or lack the feature; the game has already let go of it.
    await previous?.disconnect().catch(() => undefined);
  }

  private async open(wallet: Wallet, silent: boolean): Promise<void> {
    const attempt = (this.attempt += 1);
    this.update({ status: 'connecting', failure: null });
    try {
      const connected = await connectStandardWallet(wallet, this.options.cluster, { silent });
      if (attempt !== this.attempt) {
        await connected.disconnect().catch(() => undefined);
        return;
      }
      this.release();
      this.current = connected;
      this.stopAccount = connected.onAccountChange((session) => this.follow(session));
      this.write(connected.name);
      this.update({ status: 'connected', address: connected.session.address, walletName: connected.name });
      this.options.onSession(connected.session);
    } catch (error) {
      if (attempt !== this.attempt) return;
      // A silent restore that fails is not news; the person just connects by hand.
      const declined = error instanceof Error && /reject|declin|denied|cancel|closed/i.test(error.message);
      this.update({ status: 'idle', failure: silent ? null : declined ? 'declined' : 'failed' });
    }
  }

  private follow(session: WalletSession | null): void {
    if (!session) {
      void this.disconnect();
      return;
    }
    this.update({ address: session.address });
    this.options.onSession(session);
  }

  private release(): void {
    this.stopAccount?.();
    this.stopAccount = null;
    this.current = null;
  }

  private listOptions(): readonly WalletOption[] {
    return this.options.registry
      .get()
      .filter((wallet) => isUsable(wallet, this.options.cluster))
      .map((wallet) => ({ name: wallet.name, icon: wallet.icon }));
  }

  private update(patch: Partial<WalletState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private read(): string | null {
    try {
      return this.options.storage?.getItem(STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private write(name: string | null): void {
    try {
      if (name) this.options.storage?.setItem(STORAGE_KEY, name);
      else this.options.storage?.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be blocked; the person then connects by hand next time.
    }
  }
}

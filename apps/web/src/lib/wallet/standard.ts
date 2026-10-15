import {
  SolanaSignMessage,
  SolanaSignTransaction,
  type SolanaSignMessageFeature,
  type SolanaSignTransactionFeature,
} from '@solana/wallet-standard-features';
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from '@wallet-standard/features';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { WalletDeclinedError, type WalletSession } from '@/lib/data/chain/types';

/**
 * Adapter from a Wallet Standard wallet to the `WalletSession` the chain data
 * source uses. Any wallet that registers itself with the standard and can sign
 * messages and transactions for Solana works; no wallet is named here.
 */

export type SolanaCluster = 'devnet' | 'mainnet-beta';

/** Wallet Standard chain id of a cluster. */
export function chainId(cluster: SolanaCluster): `solana:${string}` {
  return cluster === 'devnet' ? 'solana:devnet' : 'solana:mainnet';
}

type Features = StandardConnectFeature & SolanaSignMessageFeature & SolanaSignTransactionFeature;

/** True when the wallet can connect and sign what the game asks for, on this cluster. */
export function isUsable(wallet: Wallet, cluster: SolanaCluster): boolean {
  const features = wallet.features;
  return (
    StandardConnect in features &&
    SolanaSignMessage in features &&
    SolanaSignTransaction in features &&
    wallet.chains.includes(chainId(cluster))
  );
}

export interface ConnectedWallet {
  readonly session: WalletSession;
  /** The wallet's own name, for the next visit. */
  readonly name: string;
  disconnect(): Promise<void>;
  /** Called when the person switches or removes the account inside the wallet. */
  onAccountChange(listener: (session: WalletSession | null) => void): () => void;
}

function sessionOf(wallet: Wallet, account: WalletAccount, cluster: SolanaCluster): WalletSession {
  const features = wallet.features as unknown as Features;
  const sign = features[SolanaSignMessage];
  const signTx = features[SolanaSignTransaction];
  return {
    address: account.address,
    async signMessage(message) {
      try {
        const [output] = await sign.signMessage({ account, message });
        if (!output) throw new Error('the wallet returned no signature');
        return output.signature;
      } catch (error) {
        throw new WalletDeclinedError(error instanceof Error ? error.message : undefined);
      }
    },
    async signTransaction(transaction) {
      try {
        const [output] = await signTx.signTransaction({ account, transaction, chain: chainId(cluster) });
        if (!output) throw new Error('the wallet returned no transaction');
        return output.signedTransaction;
      } catch (error) {
        throw new WalletDeclinedError(error instanceof Error ? error.message : undefined);
      }
    },
  };
}

/** Asks the wallet for an account and wraps it. `silent` only reconnects an account the wallet already trusts. */
export async function connectStandardWallet(
  wallet: Wallet,
  cluster: SolanaCluster,
  options: { silent?: boolean } = {},
): Promise<ConnectedWallet> {
  if (!isUsable(wallet, cluster)) throw new Error(`${wallet.name} cannot sign for ${cluster}`);
  const features = wallet.features as unknown as Partial<StandardDisconnectFeature & StandardEventsFeature> & Features;
  const { accounts } = await features[StandardConnect].connect(options.silent ? { silent: true } : undefined);
  const account = accounts.find((item) => item.chains.includes(chainId(cluster))) ?? accounts[0];
  if (!account) throw new Error(`${wallet.name} did not share an account`);

  return {
    session: sessionOf(wallet, account, cluster),
    name: wallet.name,
    async disconnect() {
      await features[StandardDisconnect]?.disconnect();
    },
    onAccountChange(listener) {
      const events = features[StandardEvents];
      if (!events) return () => {};
      return events.on('change', ({ accounts: next }) => {
        if (!next) return;
        const current = next.find((item) => item.chains.includes(chainId(cluster))) ?? next[0];
        if (!current) return listener(null);
        if (current.address !== account.address) listener(sessionOf(wallet, current, cluster));
      });
    },
  };
}

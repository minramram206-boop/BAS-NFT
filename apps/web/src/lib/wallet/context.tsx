'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { getWallets } from '@wallet-standard/app';
import { useBasStoreApi } from '@/stores/BasStoreProvider';
import { WalletController, type WalletRegistry, type WalletState } from './controller';
import type { SolanaCluster } from './standard';

const REFRESH_MS = 30_000;

const emptyRegistry: WalletRegistry = { get: () => [], on: () => () => {} };

function browserRegistry(): WalletRegistry {
  if (typeof window === 'undefined') return emptyRegistry;
  const wallets = getWallets();
  return { get: () => wallets.get(), on: (event, listener) => wallets.on(event, listener) };
}

function browserStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

const optionalStorage = () => {
  const storage = browserStorage();
  return storage ? { storage } : {};
};

const WalletContext = createContext<WalletController | null>(null);

/**
 * Owns the wallet connection of a chain-mode page. It hands the connected
 * wallet to the store, restores the last one on load and keeps the district
 * fresh while the tab is open.
 */
export const WalletProvider: React.FC<{ cluster: SolanaCluster; children: React.ReactNode }> = ({ cluster, children }) => {
  const api = useBasStoreApi();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const lastAddress = useRef<string | null>(null);
  const [controller] = useState(
    () =>
      new WalletController({
        cluster,
        registry: browserRegistry(),
        onSession: (session) => {
          const address = session?.address ?? null;
          // Whatever the previous wallet said on screen is not for the next one to read.
          if (address !== lastAddress.current) api.getState().resetChat();
          const wasConnected = lastAddress.current !== null;
          lastAddress.current = address;
          void api.getState().connectWallet(session);
          // A disconnect sends the person back to the start, the same page a first visit opens on.
          if (address === null && wasConnected) routerRef.current.replace('/');
        },
        ...optionalStorage(),
      }),
  );

  useEffect(() => {
    const stop = controller.start();
    void controller.restore();
    // Citizens are public, so the city fills in before (or without) a wallet.
    void api.getState().refreshData();
    const refresh = () => {
      if (document.visibilityState === 'visible') void api.getState().refreshData();
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      stop();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [api, controller]);

  return <WalletContext.Provider value={controller}>{children}</WalletContext.Provider>;
};

export function useWalletController(): WalletController {
  const controller = useContext(WalletContext);
  if (!controller) throw new Error('useWalletController must be used inside <WalletProvider>');
  return controller;
}

export function useWalletState(): WalletState {
  const controller = useWalletController();
  return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
}

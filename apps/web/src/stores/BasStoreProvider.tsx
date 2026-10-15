'use client';

import React, { createContext, useContext, useRef } from 'react';
import type { CitizenRecord } from '@bas/content';
import { createBasStore, type BasStoreApi, type TrainingConfig } from './basStore';
import type { ChainOptions } from './types';

export interface BasStoreProviderProps {
  /** Validated roster produced by `@bas/content/server`. */
  citizens: readonly CitizenRecord[];
  /** Manifest values used for training costs. */
  trainingConfig: TrainingConfig;
  /** Lamports one mint costs, a decimal string from the manifest. */
  mintPriceLamports: string;
  /** Citizens one wallet can mint, from the manifest. */
  mintLimitPerWallet: number;
  /** Set to run the district on a cluster instead of the mock data. */
  chain?: ChainOptions;
  children: React.ReactNode;
}

const BasStoreContext = createContext<BasStoreApi | null>(null);

/**
 * Creates one store per page load and shares it through context.
 *
 * A per-request store keeps server rendering isolated between requests and
 * guarantees the client hydrates from the same roster the server rendered.
 */
export const BasStoreProvider: React.FC<BasStoreProviderProps> = ({ citizens, trainingConfig, mintPriceLamports, mintLimitPerWallet, chain, children }) => {
  const storeRef = useRef<BasStoreApi | null>(null);
  storeRef.current ??= createBasStore({ citizens, trainingConfig, mintPriceLamports, mintLimitPerWallet, ...(chain ? { chain } : {}) });

  return <BasStoreContext.Provider value={storeRef.current}>{children}</BasStoreContext.Provider>;
};

/** Access the store instance of the current page. */
export function useBasStoreApi(): BasStoreApi {
  const api = useContext(BasStoreContext);
  if (!api) {
    throw new Error('useBasStoreApi must be used inside <BasStoreProvider>');
  }
  return api;
}

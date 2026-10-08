'use client';

import React, { createContext, useContext, useRef } from 'react';
import type { CitizenRecord } from '@bas/content';
import {
  createBasStore,
  type BasStoreApi,
  type TrainingPreviewConfig,
} from './basStore';

export interface BasStoreProviderProps {
  /** Validated roster produced by `@bas/content/server`. */
  citizens: readonly CitizenRecord[];
  /** Maximum sample supply from the selected cluster manifest. */
  maxSupply: number;
  /** Manifest values used only for local training-cost estimates. */
  trainingConfig: TrainingPreviewConfig;
  children: React.ReactNode;
}

const BasStoreContext = createContext<BasStoreApi | null>(null);

/**
 * Creates one store per page load and shares it through context.
 *
 * A per-request store keeps server rendering isolated between requests and
 * guarantees the client hydrates from the same roster the server rendered.
 */
export const BasStoreProvider: React.FC<BasStoreProviderProps> = ({
  citizens,
  maxSupply,
  trainingConfig,
  children,
}) => {
  const storeRef = useRef<BasStoreApi | null>(null);
  storeRef.current ??= createBasStore({ citizens, maxSupply, trainingConfig });

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

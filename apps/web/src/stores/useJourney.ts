'use client';

import { useMemo } from 'react';
import type { CitizenRecord } from '@bas/content';
import { planJourney, type Journey } from '@/lib/data/journey';
import {
  useHistoryMap,
  useMissionProgress,
  useMissions,
  useOwnedIds,
  useSeason,
  useTrainingConfig,
  useWallet,
} from './selectors';
import { useBasStoreApi } from './BasStoreProvider';
import { useBasStoreSlice } from './basStore';

/** The route of one citizen, planned again whenever the district data it reads changes. */
export function useJourney(citizen: CitizenRecord | undefined): Journey | null {
  const api = useBasStoreApi();
  const credits = useBasStoreSlice(api, (state) => state.credits);
  const owned = useOwnedIds();
  const wallet = useWallet();
  const missions = useMissions();
  const missionProgress = useMissionProgress();
  const history = useHistoryMap();
  const season = useSeason();
  const { baseTrainingCostAtoms } = useTrainingConfig();

  return useMemo(
    () =>
      citizen
        ? planJourney(
            { owned, credits, wallet, missions, missionProgress, history, season, baseTrainingCostAtoms },
            citizen,
          )
        : null,
    [citizen, owned, credits, wallet, missions, missionProgress, history, season, baseTrainingCostAtoms],
  );
}

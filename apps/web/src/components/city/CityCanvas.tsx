'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';
import type { CityActivity, CityCitizen, CitySceneOptions, MissionTarget } from '@/game/CityScene';
import type { CityGame } from '@/game/createCityGame';
import { DISTRICT_ORDER } from '@/lib/data/districts';
import { currentStepOf, type CurrentStep } from '@/lib/data/missions';
import type { DistrictId } from '@/lib/data/types';
import { districtName, lockedRule } from '@/lib/format';
import { MESSAGES, formatMessage } from '@/messages';
import type { BasStore } from '@/stores/basStore';
import { useBasStoreApi } from '@/stores/BasStoreProvider';

const LABELS = Object.fromEntries(
  DISTRICT_ORDER.map((id) => [id, { name: districtName(id), locked: lockedRule(id) }]),
) as Record<DistrictId, { name: string; locked: string }>;

function sceneCitizens(state: BasStore): CityCitizen[] {
  return state.citizens.map((citizen) => ({
    id: citizen.id,
    name: citizen.name,
    sprite: citizen.sprite,
    roleKey: citizen.roleKey,
    owned: state.owned.includes(citizen.id),
    scores: { intelligence: citizen.intelligence, alignment: citizen.alignment, compute: citizen.compute },
  }));
}

function missionTarget(citizenId: number, playing: CurrentStep): MissionTarget | null {
  if (playing.step.kind !== 'goto') return null;
  return { citizenId, cell: playing.step.cell, key: `${playing.mission.id}:${playing.index}` };
}

function targetOf(state: BasStore): MissionTarget | null {
  const playing = currentStepOf(state, state.selectedCitizenId);
  return playing ? missionTarget(state.selectedCitizenId, playing) : null;
}

export interface CityCanvasProps {
  onActivity: (id: number, activity: CityActivity) => void;
}

/** Hosts the Phaser city and keeps it in step with the store. */
export const CityCanvas: React.FC<CityCanvasProps> = ({ onActivity }) => {
  const api = useBasStoreApi();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const activityRef = useRef(onActivity);
  activityRef.current = onActivity;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let game: CityGame | null = null;
    let cancelled = false;

    const optionsFrom = (state: BasStore): CitySceneOptions => ({
      citizens: sceneCitizens(state),
      selectedId: state.selectedCitizenId,
      mode: state.cityMode,
      labels: LABELS,
      onSelect: (id) => api.getState().pickFromCity(id),
      studio: { name: MESSAGES.studio.name, hint: MESSAGES.studio.cityHint },
      onStudio: () => routerRef.current.push('/studio'),
      onBlocked: (district) => {
        const current = api.getState();
        const citizen = current.citizens.find((item) => item.id === current.selectedCitizenId);
        current.openModal(
          MESSAGES.city.blockedTitle,
          formatMessage(MESSAGES.city.blockedMessage, {
            name: citizen?.name ?? '',
            district: districtName(district),
            rule: lockedRule(district),
          }),
        );
      },
      onNotOwned: () => api.getState().openModal(MESSAGES.city.notOwnedTitle, MESSAGES.city.notOwnedMessage),
      onActivity: (id, activity) => activityRef.current(id, activity),
      target: targetOf(state),
      onArrive: (key) => {
        const current = api.getState();
        const playing = currentStepOf(current, current.selectedCitizenId);
        if (playing && missionTarget(current.selectedCitizenId, playing)?.key === key) {
          current.markMissionArrival(`${playing.mission.id}:${playing.index + 1}`);
          void current.advanceMission(playing.mission, { kind: 'goto' });
        }
      },
    });

    void import('@/game/createCityGame').then(async ({ createCityGame }) => {
      if (cancelled) return;
      const created = await createCityGame(host, optionsFrom(api.getState()));
      if (cancelled) {
        created.destroy();
        return;
      }
      game = created;
      setReady(true);
    });

    const unsubscribe = api.subscribe((state, previous) => {
      if (!game) return;
      if (
        state.citizens !== previous.citizens ||
        state.selectedCitizenId !== previous.selectedCitizenId ||
        state.cityMode !== previous.cityMode ||
        state.owned !== previous.owned ||
        state.missionProgress !== previous.missionProgress
      ) {
        game.sync(optionsFrom(state));
      }
      if (state.zoomRequest.id !== previous.zoomRequest.id) game.zoomBy(state.zoomRequest.step);
      if (state.focusRequest !== previous.focusRequest) game.focusSelected();
      if (state.walkRequest !== previous.walkRequest) game.walkToTarget();
    });

    return () => {
      cancelled = true;
      unsubscribe();
      game?.destroy();
    };
  }, [api]);

  return (
    <div className="absolute inset-0 bg-[#17262d]">
      <div ref={hostRef} className="absolute inset-0" role="application" aria-label={MESSAGES.a11y.map} />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center font-heading text-xs text-[#c9d5e0]">
          {MESSAGES.city.loading}
        </div>
      )}
    </div>
  );
};

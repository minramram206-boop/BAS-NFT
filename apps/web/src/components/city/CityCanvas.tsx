'use client';

import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStudioPlayer } from '@/components/studio/StudioPlayer';
import { ExpandIcon, NoteIcon, PauseIcon, PlayIcon, SkipIcon, SpeakerIcon } from '@/components/ui/icons';
import type { CityActivity, CityCitizen, CitySceneOptions, MissionTarget, StudioStageView } from '@/game/CityScene';
import type { CityGame } from '@/game/createCityGame';
import { DISTRICT_ORDER } from '@/lib/data/districts';
import { currentStepOf, type CurrentStep } from '@/lib/data/missions';
import type { DistrictId } from '@/lib/data/types';
import { districtName, lockedRule } from '@/lib/format';
import { formatTime } from '@/lib/studio/playlist';
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
  const player = useStudioPlayer();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<CityGame | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const activityRef = useRef(onActivity);
  activityRef.current = onActivity;
  const [ready, setReady] = useState(false);
  const [studioView, setStudioView] = useState<StudioStageView>({
    inside: false,
    open: 0,
    screen: { left: 0, top: 0, width: 0, height: 0 },
  });
  const wasInsideRef = useRef(false);

  const attachStageVideo = useCallback(
    (element: HTMLVideoElement | null) => {
      videoRef.current = element;
      player.attachVideo(element);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Cue the first track automatically when the citizen walks into BAS Studio.
  useEffect(() => {
    if (studioView.inside && !wasInsideRef.current && !player.current && player.tracks.length > 0) {
      player.play(0);
    }
    wasInsideRef.current = studioView.inside;
  }, [studioView.inside, player]);

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
      fomo: { name: MESSAGES.fomo.name, hint: MESSAGES.fomo.cityHint },
      onStudioView: (view) => setStudioView(view),
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
      gameRef.current = created;
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
      gameRef.current = null;
      game?.destroy();
    };
  }, [api]);

  const copy = MESSAGES.studio;
  const track = player.current;
  const length = Number.isFinite(player.duration) ? player.duration : 0;

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#17262d]">
      <div ref={hostRef} className="absolute inset-0" role="application" aria-label={MESSAGES.a11y.map} />

      {studioView.open > 0.02 && (
        <div
          style={{
            left: `${studioView.screen.left}px`,
            top: `${studioView.screen.top}px`,
            width: `${studioView.screen.width}px`,
            opacity: studioView.open,
          }}
          className="pointer-events-auto absolute z-20 flex flex-col overflow-hidden bg-[#090612] shadow-[inset_0_2px_10px_rgba(0,0,0,0.9)]"
        >
          <div
            style={{ height: `${studioView.screen.height}px` }}
            className="relative w-full overflow-hidden bg-black"
          >
            {track?.kind === 'video' ? (
              <>
                <video
                  ref={attachStageVideo}
                  playsInline
                  onClick={player.toggle}
                  className="h-full w-full cursor-pointer object-cover"
                />
                <button
                  type="button"
                  aria-label={copy.fullscreen}
                  title={copy.fullscreen}
                  onClick={() => void videoRef.current?.requestFullscreen?.().catch(() => undefined)}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded border border-[#05090e] bg-[rgba(12,22,34,0.85)] text-[#f2f6fa] hover:bg-[#1a2734]"
                >
                  <ExpandIcon size={11} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={player.toggle}
                className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[#1d1530] text-[#f7d23d]"
              >
                <NoteIcon size={24} />
                <span className="max-w-[90%] truncate font-heading text-[9px] tracking-wide">
                  {(track?.title ?? copy.idleTitle).toUpperCase()}
                </span>
              </button>
            )}
          </div>

          <div
            role="region"
            aria-label={copy.title}
            style={{ height: `${Math.max(40, Math.round(studioView.screen.height * (34 / 144)))}px` }}
            className="flex w-full flex-col justify-between border-t border-[#f65cce] bg-[#140e24] px-2 py-1 text-[#f2f6fa]"
          >
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 rounded border border-[#05090e] bg-[#f65cce] px-1 py-0.5 font-heading text-[7px] leading-none text-[#05090e]">
                  {copy.stage}
                </span>
                <span className="truncate font-heading text-[8px] leading-none text-[#f7d23d]">
                  {(track?.title ?? copy.idleTitle).toUpperCase()}
                </span>
              </div>
              <button
                type="button"
                onClick={() => gameRef.current?.exitStudio()}
                className="shrink-0 rounded border border-[#05090e] bg-[#60e2f6] px-1.5 py-0.5 font-heading text-[7px] leading-none text-[#05090e] hover:bg-[#8ef0ff]"
              >
                {MESSAGES.app.back}
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label={copy.previous}
                onClick={player.previous}
                disabled={player.tracks.length === 0}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[#05090e] bg-[#2c2147] text-[#f2f6fa] disabled:opacity-40"
              >
                <SkipIcon size={9} className="-scale-x-100" />
              </button>
              <button
                type="button"
                aria-label={player.playing ? copy.pause : copy.play}
                onClick={player.toggle}
                disabled={player.tracks.length === 0}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[#05090e] bg-[#f7d23d] text-[#1a2734] disabled:opacity-40"
              >
                {player.playing ? <PauseIcon size={10} /> : <PlayIcon size={10} />}
              </button>
              <button
                type="button"
                aria-label={copy.next}
                onClick={player.next}
                disabled={player.tracks.length === 0}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[#05090e] bg-[#2c2147] text-[#f2f6fa] disabled:opacity-40"
              >
                <SkipIcon size={9} />
              </button>
              <span className="shrink-0 font-heading text-[8px] tabular-nums text-[#c9d5e0]">
                {formatTime(player.time)}
              </span>
              <input
                type="range"
                aria-label={copy.seek}
                min={0}
                max={length || 1}
                step={0.1}
                value={Math.min(player.time, length || 1)}
                disabled={!track || !length}
                onChange={(event) => player.seek(Number(event.target.value))}
                className="studio-range min-w-0 flex-1"
                style={{ '--fill': `${length ? (player.time / length) * 100 : 0}%` } as React.CSSProperties}
              />
              <span className="shrink-0 font-heading text-[8px] tabular-nums text-[#c9d5e0]">
                {formatTime(player.duration)}
              </span>
              <button
                type="button"
                aria-label={player.muted ? copy.unmute : copy.mute}
                onClick={player.toggleMute}
                className="flex h-5 w-5 shrink-0 items-center justify-center text-[#c9d5e0] hover:text-[#f2f6fa]"
              >
                <SpeakerIcon size={11} muted={player.muted || player.volume === 0} />
              </button>
            </div>
          </div>
        </div>
      )}

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center font-heading text-xs text-[#c9d5e0]">
          {MESSAGES.city.loading}
        </div>
      )}
    </div>
  );
};

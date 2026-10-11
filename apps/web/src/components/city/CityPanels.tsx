'use client';

import Link from 'next/link';
import React from 'react';
import type { CitizenRecord } from '@bas/content';
import { StatBar } from '@/components/ui/StatBar';
import { MinusIcon, PlusIcon, TargetIcon } from '@/components/ui/icons';
import { EVENT_OPENS_IN_HOURS, STAT_COLORS, STAT_ORDER } from '@/config/constants';
import type { CityActivity } from '@/game/CityScene';
import { topTier } from '@/lib/data/districts';
import { districtName, formatHours, statLabel, tierForScore } from '@/lib/format';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import {
  useCitizens,
  useCityMode,
  useFoundingIds,
  useIsOwned,
  useMissionProgress,
  useMissions,
  useOwnedIds,
  useRequestFocus,
  useRequestZoom,
  useSelectCitizen,
  useSelectedCitizen,
  useSetCityMode,
} from '@/stores/selectors';

export const EventCard: React.FC = () => (
  <section className="bas-panel pointer-events-auto flex w-72 flex-col gap-2.5 p-4">
    <div className="flex items-center justify-between">
      <span className="font-heading text-[12px] tracking-wide text-[#7a4689]">{MESSAGES.city.eventTag}</span>
      <span className="rounded bg-[#1a2734] px-1.5 py-0.5 font-heading text-[11px] text-[#f7d23d]">
        {formatMessage(MESSAGES.city.eventIn, { time: formatHours(EVENT_OPENS_IN_HOURS) })}
      </span>
    </div>
    <div className="font-heading text-[18px] tracking-wide">{MESSAGES.city.eventName}</div>
    <p className="m-0 text-[15px] leading-relaxed text-[#22354a]">{MESSAGES.city.eventBody}</p>
    <div className="flex gap-1.5">
      {STAT_ORDER.map((stat) => (
        <span
          key={stat}
          className="rounded px-2 py-1 text-[13px] font-semibold text-white"
          style={{ backgroundColor: STAT_COLORS[stat].fill }}
        >
          {statLabel(stat)}
        </span>
      ))}
    </div>
  </section>
);

export const ModeToggle: React.FC = () => {
  const mode = useCityMode();
  const setMode = useSetCityMode();
  const option = (value: 'auto' | 'control', label: string) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => setMode(value)}
      className={cn(
        'h-9 rounded px-3 font-heading text-[12px] tracking-wide',
        mode === value ? 'bg-[#f7d23d] text-[#1a2734]' : 'bg-transparent text-[#c9d5e0]',
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="pointer-events-auto flex flex-col items-end gap-1">
      <div role="group" aria-label={MESSAGES.city.modeLabel} className="flex gap-[3px] rounded-md bg-[#1a2734] p-[3px]">
        {option('auto', MESSAGES.city.modeAuto)}
        {option('control', MESSAGES.city.modeControl)}
      </div>
      <span className="bas-plate px-2.5 py-1 font-pixel text-[14px] tracking-normal">
        {mode === 'control' ? MESSAGES.city.hintControl : MESSAGES.city.hintAuto}
      </span>
    </div>
  );
};

export const ZoomControls: React.FC = () => {
  const zoom = useRequestZoom();
  const focus = useRequestFocus();
  const button = 'bas-btn h-11 w-11 min-h-0 px-0 bg-[#e3ecf4]';
  return (
    <div className="pointer-events-auto flex flex-col gap-1.5 md:flex-row">
      <button type="button" className={button} aria-label={MESSAGES.city.zoomIn} onClick={() => zoom(1)}>
        <PlusIcon />
      </button>
      <button type="button" className={button} aria-label={MESSAGES.city.zoomOut} onClick={() => zoom(-1)}>
        <MinusIcon />
      </button>
      <button type="button" className={button} aria-label={MESSAGES.city.center} onClick={focus}>
        <TargetIcon />
      </button>
    </div>
  );
};

function tierLine(citizen: CitizenRecord): string {
  const best = topTier(citizen);
  return `${citizen.role} · ${statLabel(best.stat)} T${best.tier}`;
}

export const MyCitizens: React.FC = () => {
  const owned = useOwnedIds();
  const citizens = useCitizens();
  const selected = useSelectedCitizen();
  const select = useSelectCitizen();
  const focus = useRequestFocus();
  const mine = owned.map((id) => citizens.find((citizen) => citizen.id === id)).filter(Boolean) as CitizenRecord[];

  return (
    <section aria-label={MESSAGES.city.myCitizens} className="bas-panel pointer-events-auto flex w-[480px] flex-col gap-2.5 p-3">
      <div className="flex items-center justify-between">
        <span className="bas-label">{MESSAGES.city.myCitizens}</span>
        <span className="text-[14px] font-medium text-[#33485c]">{formatMessage(MESSAGES.city.owned, { count: mine.length })}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {mine.map((citizen) => {
          const active = citizen.id === selected?.id;
          return (
            <button
              key={citizen.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                select(citizen.id);
                focus();
              }}
              className={cn(
                'bas-chip flex flex-col items-start gap-1 rounded-md p-2 text-left font-pixel',
                active ? 'border-[3px] border-[#f7d23d] bg-white outline outline-2 outline-[#1a2734]' : 'border-2 border-[#1b2a38] bg-[#f2f6fa]',
              )}
            >
              <img src={citizen.sprite} alt="" width={52} height={52} className="h-[52px] w-[52px]" />
              <span className="font-heading text-[12px] tracking-wide">{citizen.name.toUpperCase()}</span>
              <span className="text-[13px] font-medium text-[#33485c]">{tierLine(citizen)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
};

function activityLine(citizen: CitizenRecord, activity: CityActivity | null, missionLine: string | null): string {
  if (missionLine) return missionLine;
  if (!activity) return citizen.lore;
  const district = districtName(activity.zone);
  return formatMessage(activity.walking ? MESSAGES.city.walkingTo : MESSAGES.city.standingIn, { district });
}

/** The selected citizen: who it is, what it is doing, and where to go next. */
export const SelectedCitizenPanel: React.FC<{ activity: CityActivity | null; compact?: boolean }> = ({
  activity,
  compact = false,
}) => {
  const citizen = useSelectedCitizen();
  const owned = useIsOwned(citizen?.id ?? -1);
  const founding = useFoundingIds();
  const missions = useMissions();
  const progress = useMissionProgress();
  if (!citizen) return null;

  const missionEntry = Object.entries(progress).find(([, value]) => value.citizenId === citizen.id);
  const mission = missionEntry ? missions.find((item) => item.id === missionEntry[0]) : undefined;
  const missionLine =
    mission && missionEntry
      ? formatMessage(MESSAGES.city.onMission, {
          mission: MESSAGES.missions.catalog[mission.id as keyof typeof MESSAGES.missions.catalog].title,
          step: Math.min(missionEntry[1].done + 1, mission.steps.length),
          steps: mission.steps.length,
        })
      : null;

  return (
    <section
      aria-label={MESSAGES.city.selected}
      className={cn('bas-panel pointer-events-auto flex flex-col gap-3 p-3 md:p-4', compact ? 'w-full' : 'w-[460px]')}
    >
      <div className="flex gap-3">
        <div className="bas-inset bas-grid-bg flex h-[72px] w-[72px] shrink-0 items-center justify-center md:h-[84px] md:w-[84px]">
          <img src={citizen.sprite} alt={citizen.name} width={76} height={76} className="h-[64px] w-[64px] md:h-[76px] md:w-[76px]" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-[#1a2734] px-1.5 py-0.5 font-heading text-[11px] tracking-wide text-[#f7d23d]">{MESSAGES.city.selected}</span>
            <span className="text-[13px] font-medium text-[#33485c] md:text-[14px]">
              {citizen.code}
              {founding.includes(citizen.id) ? ` · ${MESSAGES.city.foundingCitizen}` : ''}
            </span>
          </div>
          <div className="truncate font-heading text-[18px] tracking-wide md:text-[21px]">{citizen.name.toUpperCase()}</div>
          <div className="text-[14px] font-medium leading-snug text-[#22354a] md:text-[15px]">
            {citizen.role} · {owned ? activityLine(citizen, activity, missionLine) : MESSAGES.city.notYours}
          </div>
        </div>
      </div>

      <div className={cn('flex flex-col gap-2', compact && 'hidden min-[420px]:flex')}>
        {STAT_ORDER.map((stat) => (
          <div key={stat} className="flex items-center gap-2">
            <span className="w-[76px] font-heading text-[12px] tracking-wide" style={{ color: STAT_COLORS[stat].fill }}>
              {MESSAGES.stats[stat].shortLabel}
            </span>
            <StatBar stat={stat} value={citizen[stat]} />
            <span className="w-6 text-right font-heading text-[15px]">{citizen[stat]}</span>
            <span className="rounded bg-[#d3dde6] px-1 font-heading text-[11px] text-[#22354a]">
              T{tierForScore(citizen[stat])}
            </span>
          </div>
        ))}
      </div>

      <div className={cn('grid gap-2', owned ? 'grid-cols-3' : 'grid-cols-2')}>
        <Link href={`/citizen/${citizen.id}`} className="bas-btn">
          {MESSAGES.city.profile}
        </Link>
        <Link href="/missions" className="bas-btn">
          {MESSAGES.city.missions}
        </Link>
        {owned && (
          <Link href="/training" className="bas-btn bas-btn-primary">
            {MESSAGES.city.train}
          </Link>
        )}
      </div>
    </section>
  );
};

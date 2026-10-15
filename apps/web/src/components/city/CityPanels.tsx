'use client';

import Link from 'next/link';
import React from 'react';
import type { CitizenRecord } from '@bas/content';
import { CitizenStats } from '@/components/citizen/CitizenStats';
import { CitizenRail } from '@/components/citizen/CitizenRail';
import { NextStepLine } from '@/components/journey/JourneyPanel';
import { ChevronIcon, MinusIcon, PlusIcon, TargetIcon } from '@/components/ui/icons';
import { STAT_COLORS, STAT_ORDER } from '@/config/constants';
import type { CityActivity } from '@/game/CityScene';
import { districtName, formatHours, statLabel } from '@/lib/format';
import { cn } from '@/lib/utils/cn';
import { usePersistedFlag } from '@/lib/utils/usePersistedFlag';
import { MESSAGES, formatMessage } from '@/messages';
import { WelcomePanel } from './WelcomePanel';
import {
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

/** One line while it is closed; the body drops down over the map instead of pushing anything. */
export const EventCard: React.FC = () => {
  const [open, toggle] = usePersistedFlag('bas.city.event', false);
  const event = useMissions().find((mission) => mission.event);
  // No event scheduled (or it is over): nothing to announce.
  if (!event) return null;
  return (
    <section aria-label={MESSAGES.city.eventTag} className="relative w-72">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="bas-panel bas-chip pointer-events-auto flex w-full items-center gap-2 p-3 text-left font-pixel"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-heading text-[11px] tracking-wide text-[#7a4689]">{MESSAGES.city.eventTag}</span>
          <span className="truncate font-heading text-[15px] tracking-wide">{MESSAGES.city.eventName}</span>
        </span>
        <span className="rounded bg-[#1a2734] px-1.5 py-0.5 font-heading text-[11px] text-[#f7d23d]">
          {event.opensInHours === undefined
            ? MESSAGES.city.eventOpen
            : formatMessage(MESSAGES.city.eventIn, { time: formatHours(event.opensInHours) })}
        </span>
        <ChevronIcon className={cn('shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="bas-panel pointer-events-auto absolute inset-x-0 top-full z-10 mt-2 flex flex-col gap-2.5 p-3">
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
        </div>
      )}
    </section>
  );
};

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
  const ownedIds = useOwnedIds();
  const select = useSelectCitizen();
  const focus = useRequestFocus();
  const missions = useMissions();
  const progress = useMissionProgress();
  // A wallet without a citizen has nothing to select yet; tell it where to start instead of leaving the sidebar empty.
  // A newcomer sees the way in and nothing else: no roster to browse and no citizen to play as.
  if (ownedIds.length === 0) return <WelcomePanel compact={compact} />;
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

  const actions = (
    <div className={cn('grid gap-2 md:[&_.bas-btn]:min-h-10', owned ? 'grid-cols-3' : 'grid-cols-2')}>
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
  );

  // The sidebar uses the same framed sections as Missions; the phone sheet stays one compact card.
  if (!compact) {
    return (
      <div aria-label={MESSAGES.city.selected} className="pointer-events-auto flex w-full flex-col gap-3">
        <CitizenRail
          column
          onPick={(id) => {
            select(id);
            focus();
          }}
          activity={owned ? activityLine(citizen, activity, missionLine) : null}
          actions={actions}
          skipContinue={missionEntry !== undefined}
        />
      </div>
    );
  }

  return (
    <section aria-label={MESSAGES.city.selected} className="bas-panel pointer-events-auto flex w-full flex-col gap-3 p-3 md:p-4">
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

      <CitizenStats citizen={citizen} compact className="hidden min-[420px]:flex" />

      {owned && <NextStepLine citizen={citizen} />}

      {actions}
    </section>
  );
};

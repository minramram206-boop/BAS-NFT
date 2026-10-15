'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CitizenRecord, StatKey } from '@bas/content';
import { trainingCostAtoms } from '@bas/chain-client/stats';
import { CitizenRail } from '@/components/citizen/CitizenRail';
import { WelcomeAction, WelcomePanel } from '@/components/city/WelcomePanel';
import { JourneyPanel } from '@/components/journey/JourneyPanel';
import { ScreenColumns, ScreenShell } from '@/components/layout/ScreenShell';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { StatSwatch } from '@/components/ui/StatBar';
import { CheckIcon, ClockIcon, LockIcon } from '@/components/ui/icons';
import { MAX_STAT_SCORE, STAT_COLORS, STAT_ORDER } from '@/config/constants';
import { DISTRICT_RULES, isDistrictOpen } from '@/lib/data/districts';
import { DAILY_MISSION_CREDITS, doneToday, missionPoints, missionsToday, startBlocker } from '@/lib/data/missions';
import type { DistrictActionError, MissionDefinition, MissionProgress } from '@/lib/data/types';
import { districtName, formatHours, formatTokens, lockedRule, statLabel, tierForScore } from '@/lib/format';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import {
  useAbandonMission,
  useAdvanceMission,
  useBusy,
  useCitizens,
  useDataMode,
  useFocus,
  useHistoryMap,
  useMissionProgress,
  useMissions,
  useNextDay,
  useOwnedIds,
  useSeason,
  useSelectedCitizen,
  useSetFocus,
  useStartMission,
  useTrainingConfig,
} from '@/stores/selectors';
import { MissionStepDialog } from './MissionStepDialog';
import { missionCopy, stepInstruction } from './missionCopy';

const copy = MESSAGES.missions;
type Filter = 'all' | StatKey | 'events';
type Status = 'active' | 'open' | 'locked' | 'busy' | 'soon' | 'done';

function statusOf(
  mission: MissionDefinition,
  citizen: CitizenRecord,
  progress: MissionProgress | undefined,
  finishedToday: boolean,
): Status {
  if (progress) return progress.citizenId === citizen.id ? 'active' : 'busy';
  if (mission.opensInHours !== undefined) return 'soon';
  if (!isDistrictOpen(citizen, mission.district)) return 'locked';
  return finishedToday ? 'done' : 'open';
}

/** The state a mission has for someone with no citizen yet: what a fresh Tier 0 citizen could do with it. */
function previewStatusOf(mission: MissionDefinition, progress: MissionProgress | undefined): Status {
  if (progress) return 'busy';
  if (mission.opensInHours !== undefined) return 'soon';
  return DISTRICT_RULES[mission.district].unlockScore > 0 ? 'locked' : 'open';
}

const STATUS_STYLE: Record<Status, string> = {
  active: 'bg-[#f7d23d] text-[#1a2734]',
  open: 'bg-[#3f9252] text-white',
  locked: 'bg-[#5b6b7a] text-white',
  busy: 'bg-[#1a2734] text-[#f7d23d]',
  soon: 'bg-[#8c579c] text-white',
  done: 'bg-[#3b74a6] text-white',
};

function statusLabel(status: Status, mission: MissionDefinition): string {
  switch (status) {
    case 'active':
      return copy.statusActive;
    case 'open':
      return copy.statusOpen;
    case 'locked':
      return copy.statusLocked;
    case 'busy':
      return copy.statusBusy;
    case 'done':
      return copy.statusDone;
    case 'soon':
      return formatMessage(copy.statusSoon, { time: formatHours(mission.opensInHours ?? 0) });
  }
}

function rewardLine(mission: MissionDefinition): string {
  if (mission.opensInHours !== undefined) return copy.rewardEvent;
  return formatMessage(copy.reward, { stats: mission.rewards.map(statLabel).join(' / ') });
}

const StatusBadge: React.FC<{ status: Status; mission: MissionDefinition }> = ({ status, mission }) => (
  <span className={cn('shrink-0 rounded px-1.5 py-0.5 font-heading text-[11px]', STATUS_STYLE[status])}>
    {statusLabel(status, mission)}
  </span>
);

/** The mission board: missions earn the credits that training spends. */
export const MissionsScreen: React.FC = () => {
  const citizen = useSelectedCitizen();
  const citizens = useCitizens();
  const missions = useMissions();
  const progress = useMissionProgress();
  const history = useHistoryMap();
  const season = useSeason();
  const owned = useOwnedIds();
  const mode = useDataMode();
  const nextDay = useNextDay();
  const busy = useBusy();
  const [filter, setFilter] = useState<Filter>('all');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [pathOpen, setPathOpen] = useState(false);
  const focus = useFocus();
  const setFocus = useSetFocus();
  const detailRef = useRef<HTMLDivElement | null>(null);

  // Below the wide layout the detail sits under the list, so bring it into view.
  const pick = (id: string) => {
    setPickedId(id);
    if (window.matchMedia('(max-width: 1279px)').matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  // A next-step button may have picked a mission; open it once and forget it.
  useEffect(() => {
    if (!focus.mission) return;
    setFilter('all');
    pick(focus.mission);
    setFocus({ mission: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.mission]);

  const visible = useMemo(
    () =>
      missions.filter((mission) => {
        if (filter === 'all') return true;
        if (filter === 'events') return mission.event === true;
        return mission.event !== true && mission.rewards.includes(filter);
      }),
    [missions, filter],
  );

  // Without a citizen the board is a preview: every mission is shown as a fresh Tier 0 citizen would see it.
  const preview = owned.length === 0;
  if (!citizen && !preview) return null;
  const actor = preview ? undefined : citizen;

  const limits = { history, season };
  const ownActive =
    actor && owned.includes(actor.id) ? missions.find((mission) => progress[mission.id]?.citizenId === actor.id) : undefined;
  const nameOf = (id: number) => citizens.find((item) => item.id === id)?.name ?? '';
  const status = (mission: MissionDefinition) =>
    actor
      ? statusOf(mission, actor, progress[mission.id], doneToday(limits, actor.id, mission.id))
      : previewStatusOf(mission, progress[mission.id]);
  // Open on a mission the citizen can take, not on one that is already taken.
  const picked =
    missions.find((mission) => mission.id === pickedId) ??
    ownActive ??
    visible.find((mission) => status(mission) === 'open') ??
    visible[0] ??
    missions[0];
  const left = actor ? Math.max(DAILY_MISSION_CREDITS - missionsToday(limits, actor.id), 0) : 0;

  const footLine = (mission: MissionDefinition, current: Status): string => {
    const entry = progress[mission.id];
    if (entry && (current === 'active' || current === 'busy')) {
      return formatMessage(copy.takenBy, {
        name: nameOf(entry.citizenId),
        step: Math.min(entry.done + 1, mission.steps.length),
        steps: mission.steps.length,
      });
    }
    if (current === 'soon') return copy.districtEvent;
    if (current === 'locked') return formatMessage(copy.needs, { rule: lockedRule(mission.district) });
    const rule = DISTRICT_RULES[mission.district];
    if (rule.unlockScore > 0) return formatMessage(copy.needsMet, { tier: tierForScore(rule.unlockScore) });
    return copy.anyCitizen;
  };

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: copy.all },
    ...STAT_ORDER.map((stat) => ({ id: stat as Filter, label: MESSAGES.stats[stat].shortLabel })),
    { id: 'events', label: copy.events },
  ];

  const mine = actor !== undefined && owned.includes(actor.id);

  return (
    <ScreenShell title={copy.title} subtitle={copy.subtitle}>
      <ScreenColumns
        side={
          preview ? (
            <>
              {/* The phone gets the short card so the board stays in reach; wider screens get the four steps. */}
              <WelcomePanel compact className="md:hidden" />
              <WelcomePanel className="hidden md:flex" />
            </>
          ) : (
            <CitizenRail />
          )
        }
      >
        <section aria-label={copy.title} className="bas-panel flex min-w-0 flex-col gap-3 p-3 md:gap-4 md:p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
  <div role="group" aria-label={copy.filterLabel} className="flex flex-wrap gap-1.5">
              {filters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                  className={cn(
                    'bas-chip h-10 rounded-md border-2 border-[#1b2a38] px-3 font-heading text-[12px]',
                    filter === item.id ? 'bg-[#f7d23d] text-[#1a2734]' : 'bg-[#c5d5e5] text-[#1a2734]',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {mine && (
              <div className="flex flex-wrap items-center gap-2 md:ml-auto">
                {mode === 'mock' && (
                  <button
                    type="button"
                    disabled={busy || season.day >= season.length}
                    onClick={() => void nextDay()}
                    title={copy.nextDayHint}
                    className="bas-btn min-h-10 bg-[#e3ecf4] text-[11px]"
                  >
                    <ClockIcon size={13} />
                    {copy.nextDay}
                  </button>
                )}
                <button
                  type="button"
                  aria-expanded={pathOpen}
                  onClick={() => setPathOpen((open) => !open)}
                  className="bas-btn min-h-10 bg-[#e3ecf4] text-[11px]"
                >
                  {pathOpen ? MESSAGES.journey.hidePath : MESSAGES.journey.showPath}
                </button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border-2 border-dashed border-[#5b6b7a] bg-[#d3dde6] px-3 py-2">
            <PixelIcon src="/icons/supply_crate.png" className="h-6 shrink-0" />
            {mine && (
              <span className="text-[14px] font-semibold text-[#1a2734]">
                {formatMessage(copy.limits, { left, max: DAILY_MISSION_CREDITS, name: actor?.name ?? '' })}
              </span>
            )}
            <p className="m-0 text-[14px] text-[#33485c]">{copy.note}</p>
          </div>

          {mine && pathOpen && actor && <JourneyPanel citizen={actor} showNext={false} />}

          <div className="grid gap-3 md:gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="grid content-start gap-3 min-[1400px]:grid-cols-2">
              {visible.map((mission) => {
                const current = status(mission);
                const active = mission.id === picked?.id;
                const text = missionCopy(mission);
                return (
                  <button
                    key={mission.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => pick(mission.id)}
                    className={cn(
                      'bas-chip flex flex-col overflow-hidden rounded-lg text-left font-pixel',
                      active
                        ? 'border-[3px] border-[#f7d23d] bg-white outline outline-2 outline-[#1a2734]'
                        : 'border-2 border-[#1b2a38] bg-[#f2f6fa]',
                      (current === 'locked' || current === 'done') && !active && 'opacity-80',
                    )}
                  >
                    <span className="flex flex-col gap-1.5 p-3">
                      <span className="flex items-start justify-between gap-2">
                        <span className="font-heading text-[14px] leading-tight">{text.title}</span>
                        <StatusBadge status={current} mission={mission} />
                      </span>
                      <span className="text-[13px] text-[#33485c]">
                        {districtName(mission.district)} · {formatMessage(copy.stepsCount, { count: mission.steps.length })}
                      </span>
                      <span className="text-[15px] leading-snug text-[#2b3d4f]">{text.body}</span>
                    </span>
                    <span className="mt-auto flex flex-col gap-1 border-t-2 border-[#b9c9d8] bg-[#d3dde6]/50 px-3 py-2">
                      <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                        {mission.rewards.map((stat) => (
                          <StatSwatch key={stat} stat={stat} />
                        ))}
                        {rewardLine(mission)}
                      </span>
                      <span className="flex items-center gap-1 text-[13px] text-[#33485c]">
                        {current === 'locked' && <LockIcon size={12} />}
                        {current === 'soon' && <ClockIcon size={12} />}
                        {footLine(mission, current)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {picked && (
              <div ref={detailRef} className="scroll-mt-2 self-start xl:sticky xl:top-0">
                <MissionDetail
                  mission={picked}
                  citizen={actor}
                  status={status(picked)}
                  progress={progress[picked.id]}
                  blocker={actor ? startBlocker({ owned, missionProgress: progress, history, season }, actor, picked) : null}
                  otherName={progress[picked.id] ? nameOf(progress[picked.id]!.citizenId) : ''}
                />
              </div>
            )}
          </div>
        </section>
      </ScreenColumns>
    </ScreenShell>
  );
};

interface MissionDetailProps {
  mission: MissionDefinition;
  /** Undefined for a wallet without a citizen, which can read a mission but not start it. */
  citizen: CitizenRecord | undefined;
  status: Status;
  progress: MissionProgress | undefined;
  /** Why the selected citizen cannot start this mission now. */
  blocker: DistrictActionError | null;
  otherName: string;
}

function hintFor(props: MissionDetailProps): string | null {
  const { mission, citizen, blocker, otherName } = props;
  if (!citizen) return null;
  const name = citizen.name;
  switch (blocker) {
    case 'district-locked':
      return formatMessage(copy.lockedHint, { name, district: districtName(mission.district) });
    case 'mission-busy':
      return formatMessage(copy.busyHint, { name: otherName });
    case 'mission-closed':
      return formatMessage(copy.soonHint, { time: formatHours(mission.opensInHours ?? 0) });
    case 'citizen-busy':
      return formatMessage(copy.citizenBusyHint, { name });
    case 'mission-cooldown':
      return formatMessage(copy.cooldownHint, { name });
    case 'daily-limit':
      return formatMessage(copy.limitHint, { name, max: DAILY_MISSION_CREDITS });
    case 'not-owner':
      return MESSAGES.city.notYours;
    default:
      return null;
  }
}

const MissionDetail: React.FC<MissionDetailProps> = (props) => {
  const { mission, citizen, status, progress } = props;
  const router = useRouter();
  const start = useStartMission();
  const advance = useAdvanceMission();
  const abandon = useAbandonMission();
  const busy = useBusy();
  const { baseTrainingCostAtoms, tokenDecimals, tokenSymbol } = useTrainingConfig();
  const [choice, setChoice] = useState<StatKey | null>(null);
  const [dialog, setDialog] = useState(false);

  const text = missionCopy(mission);
  const playing = status === 'active' && progress ? progress : undefined;
  const done = playing?.done ?? 0;
  const stat = playing?.stat ?? (choice && mission.rewards.includes(choice) ? choice : (mission.rewards[0] as StatKey));
  const score = citizen ? citizen[stat] : 0;
  const step = playing ? mission.steps[done] : undefined;
  const hint = playing ? null : hintFor(props);
  const canStart = citizen !== undefined && !playing && props.blocker === null;

  return (
    <section aria-label={text.title} className="bas-panel flex flex-col gap-3 p-3 md:p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="font-heading text-[17px] leading-tight">{text.title}</span>
          <span className="text-[13px] text-[#33485c]">
            {districtName(mission.district)}
            {mission.event ? ` · ${copy.districtEvent}` : ''}
          </span>
        </div>
        <StatusBadge status={status} mission={mission} />
      </div>
      <p className="m-0 text-[15px] leading-snug text-[#2b3d4f]">{text.body}</p>

      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {text.steps.map((item, index) => {
          const finished = playing !== undefined && index < done;
          const current = playing !== undefined && index === done;
          return (
            <li
              key={item.title}
              className={cn(
                'flex items-start gap-2 rounded-md border-2 px-2 py-1.5 text-[15px]',
                finished && 'border-[#3f9252] bg-[#e4f3e7]',
                current && 'border-[#1a2734] bg-white',
                !finished && !current && 'border-[#9fb3c6] bg-[#f2f6fa] text-[#33485c]',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 border-[#1b2a38] font-heading text-[11px]',
                  finished ? 'bg-[#3f9252] text-white' : 'bg-white',
                )}
              >
                {finished ? <CheckIcon size={10} /> : index + 1}
              </span>
              <span className="flex flex-col">
                <span className={cn(current && 'font-semibold')}>{item.title}</span>
                {current && step && (
                  <span className="text-[14px] leading-snug text-[#22354a]">
                    {stepInstruction(step, item, citizen?.name ?? '')}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {!playing && mission.rewards.length > 1 && mission.opensInHours === undefined && (
        <div className="flex flex-col gap-1.5">
          <span className="bas-label">{copy.chooseStat}</span>
          <div role="radiogroup" aria-label={copy.chooseStat} className="flex gap-2">
            {mission.rewards.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={stat === option}
                onClick={() => setChoice(option)}
                className={cn(
                  'bas-chip flex h-10 items-center gap-1.5 rounded-md border-2 px-3 font-heading text-[12px]',
                  stat === option ? 'border-[#1a2734] bg-[#f7d23d]' : 'border-[#1b2a38] bg-[#c5d5e5]',
                )}
              >
                <StatSwatch stat={option} />
                {MESSAGES.stats[option].shortLabel}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bas-inset flex gap-3 p-2.5" style={{ backgroundColor: STAT_COLORS[stat].soft }}>
        <PixelIcon src="/icons/supply_crate.png" className="h-10 shrink-0" />
        <div className="flex flex-col gap-1">
          <span className="bas-label">{copy.rewardTitle}</span>
          <span className="text-[15px] font-semibold">
            {mission.opensInHours !== undefined
              ? copy.rewardEvent
              : `${formatMessage(copy.reward, { stats: statLabel(stat) })} · ${formatMessage(copy.points, { points: missionPoints(mission) })}`}
          </span>
          {citizen && score < MAX_STAT_SCORE && mission.opensInHours === undefined && (
            <span className="text-[13px] leading-snug text-[#2b3d4f]">
              {formatMessage(copy.rewardNote, {
                name: citizen.name,
                cost: formatTokens(trainingCostAtoms(baseTrainingCostAtoms, score), tokenDecimals),
                symbol: tokenSymbol,
                stat: statLabel(stat),
                from: score,
                to: score + 1,
              })}
            </span>
          )}
        </div>
      </div>
      <p className="m-0 text-[13px] leading-snug text-[#33485c]">{copy.verified}</p>

      {hint && <p className="m-0 text-[15px] font-semibold text-[#a3432f]">{hint}</p>}

      {!citizen && (
        <div className="bas-inset flex flex-col items-start gap-2.5 p-3">
          <p className="m-0 text-[15px] font-semibold leading-snug">{copy.needCitizen}</p>
          <WelcomeAction />
        </div>
      )}

      {canStart && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            // A walking first step is played on the map, so go there right away.
            if ((await start(mission, stat)) && mission.steps[0]?.kind === 'goto') router.push('/');
          }}
          className="bas-btn bas-btn-primary min-h-12"
        >
          {copy.start}
        </button>
      )}
      {playing && step && (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          {step.kind === 'goto' ? (
            <Link href="/" className="bas-btn bas-btn-primary min-h-12">
              {copy.continue}
            </Link>
          ) : (
            <button type="button" disabled={busy} onClick={() => setDialog(true)} className="bas-btn bas-btn-primary min-h-12">
              {step.kind === 'talk' ? copy.answer : copy.solve}
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void abandon(mission.id)} className="bas-btn min-h-12">
            {copy.abandon}
          </button>
        </div>
      )}

      {dialog && (
        <MissionStepDialog
          mission={mission}
          index={done}
          onClose={() => setDialog(false)}
          onSubmit={async (proof) => {
            const outcome = await advance(mission, proof);
            if (outcome === 'ok') setDialog(false);
            return outcome;
          }}
        />
      )}
    </section>
  );
};

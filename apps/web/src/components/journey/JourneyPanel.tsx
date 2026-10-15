'use client';

import Link from 'next/link';
import React from 'react';
import type { CitizenRecord } from '@bas/content';
import { missionCopy } from '@/components/missions/missionCopy';
import { StatBar } from '@/components/ui/StatBar';
import { CheckIcon, LockIcon } from '@/components/ui/icons';
import { STAT_COLORS } from '@/config/constants';
import type { Journey, MissionOption, NextStep, StatPath } from '@/lib/data/journey';
import { DAILY_MISSION_CREDITS } from '@/lib/data/missions';
import { districtName, formatTokens, lockedRule, statLabel } from '@/lib/format';
import { PanelTab } from '@/components/ui/PanelTab';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import { useSetFocus, useTrainingConfig } from '@/stores/selectors';
import { useJourney } from '@/stores/useJourney';

const copy = MESSAGES.journey;
const noop = () => undefined;

interface NextStepView {
  text: string;
  cta: { label: string; href: string; onClick?: () => void } | null;
}

/** How long the closest tier takes, or `null` when there is nothing to estimate. */
function paceLine(journey: Journey): string | null {
  const { pace } = journey;
  if (!pace) return null;
  return formatMessage(pace.days === 1 ? copy.paceOne : copy.paceMany, { days: pace.days, tier: pace.tier, stat: statLabel(pace.stat) });
}

/** The sentence and the button for the next step, shared by the card and the one-line version. */
function useNextStepView(journey: Journey, citizen: CitizenRecord): NextStepView {
  const setFocus = useSetFocus();
  const { tokenDecimals, tokenSymbol } = useTrainingConfig();
  const name = citizen.name;
  const step: NextStep = journey.next;
  const titleOf = (id: string) => missionCopy({ id }).title;

  switch (step.kind) {
    case 'continue-mission':
      return {
        text: formatMessage(copy.next.continueMission, { mission: titleOf(step.missionId), step: step.step, steps: step.steps }),
        cta: { label: copy.cta.continue, href: '/' },
      };
    case 'start-mission':
      return {
        text: formatMessage(copy.next.start, { mission: titleOf(step.missionId), stat: statLabel(step.stat) }),
        cta: { label: copy.cta.mission, href: '/missions', onClick: () => setFocus({ mission: step.missionId }) },
      };
    case 'train':
      return {
        text: step.reachesTier
          ? formatMessage(copy.next.trainTier, { stat: statLabel(step.stat), from: step.from, to: step.from + 1, tier: step.reachesTier })
          : formatMessage(copy.next.train, { stat: statLabel(step.stat), from: step.from, to: step.from + 1 }),
        cta: { label: copy.cta.train, href: '/training', onClick: () => setFocus({ training: step.stat }) },
      };
    case 'earn-tokens':
      return {
        text: formatMessage(copy.next.earnTokens, {
          name,
          stat: statLabel(step.stat),
          missing: formatTokens(step.missing, tokenDecimals),
          symbol: tokenSymbol,
        }),
        cta: null,
      };
    case 'wait':
      return {
        text: formatMessage(step.reason === 'daily-limit' ? copy.next.waitDaily : copy.next.waitCooldown, {
          name,
          max: DAILY_MISSION_CREDITS,
        }),
        cta: { label: copy.cta.missions, href: '/missions' },
      };
    case 'idle':
      return { text: formatMessage(copy.next.idle, { name }), cta: { label: copy.cta.missions, href: '/missions' } };
    case 'complete':
      return { text: formatMessage(copy.next.complete, { name }), cta: { label: copy.cta.season, href: '/season' } };
    case 'not-owner':
      return { text: formatMessage(copy.next.notOwner, { name }), cta: null };
  }
}

/** One line with the next step and its button, small enough for the city panel. */
export const NextStepLine: React.FC<{
  citizen: CitizenRecord;
  className?: string | undefined;
  /** Leave the line out while the only next step is the mission already shown next to it. */
  skipContinue?: boolean | undefined;
  /** Put the button under the text, for narrow columns. */
  stacked?: boolean | undefined;
}> = ({ citizen, className, skipContinue = false, stacked = false }) => {
  const journey = useJourney(citizen);
  if (!journey || !journey.owned) return null;
  if (skipContinue && journey.next.kind === 'continue-mission') return null;
  return <NextStepLineView journey={journey} citizen={citizen} className={className} stacked={stacked} />;
};

const NextStepLineView: React.FC<{ journey: Journey; citizen: CitizenRecord; className?: string | undefined; stacked?: boolean | undefined }> = ({
  journey,
  citizen,
  className,
  stacked = false,
}) => {
  const { text, cta } = useNextStepView(journey, citizen);
  if (stacked) {
    const pace = paceLine(journey);
    return (
      <div className={cn('bas-inset flex flex-col gap-2 p-3', className)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PanelTab>{copy.nextLabel}</PanelTab>
          <span className="font-heading text-[11px] tracking-wide text-[#33485c]">{formatMessage(copy.goal, { tier: journey.tier })}</span>
        </div>
        <p className="m-0 rounded-md border-2 border-dashed border-[#b8962e] bg-[#fff7cf] px-3 py-2 text-[14px] leading-snug text-[#1a2734]">
          {text}
          {pace && <span className="mt-1 block text-[13px] text-[#6b5200]">{pace}</span>}
        </p>
        {cta && (
          <Link href={cta.href} onClick={cta.onClick ?? noop} className="bas-btn bas-btn-primary min-h-10 px-3 text-[12px]">
            {cta.label}
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className={cn('flex items-center gap-2 rounded-md border-2 border-[#1a2734] bg-[#fff7cf] px-2.5 py-2', className)}>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-heading text-[11px] tracking-wide text-[#7a5a00]">{copy.nextLabel}</span>
        <span className="text-[14px] leading-snug text-[#1a2734]">{text}</span>
      </div>
      {cta && (
        <Link href={cta.href} onClick={cta.onClick ?? noop} className="bas-btn bas-btn-primary min-h-10 shrink-0 px-3 text-[12px]">
          {cta.label}
        </Link>
      )}
    </div>
  );
};

function missionStatus(option: MissionOption): { label: string; tone: 'ready' | 'locked' | 'wait' } {
  switch (option.blocker) {
    case null:
      return { label: copy.missionReady, tone: 'ready' };
    case 'district-locked':
      return { label: formatMessage(copy.missionNeeds, { rule: lockedRule(option.mission.district) }), tone: 'locked' };
    case 'daily-limit':
    case 'mission-cooldown':
      return { label: copy.missionTomorrow, tone: 'wait' };
    case 'mission-closed':
      return { label: copy.missionEvent, tone: 'wait' };
    case 'mission-busy':
      return { label: copy.missionTaken, tone: 'wait' };
    default:
      return { label: copy.missionBusy, tone: 'wait' };
  }
}

const TONE: Record<'ready' | 'locked' | 'wait', string> = {
  ready: 'bg-[#3f9252] text-white',
  locked: 'bg-[#5b6b7a] text-white',
  wait: 'bg-[#1a2734] text-[#f7d23d]',
};

const StatRow: React.FC<{ path: StatPath }> = ({ path }) => {
  const setFocus = useSetFocus();
  const { tokenDecimals, tokenSymbol } = useTrainingConfig();
  const maxed = path.nextTier === null;
  const stat = path.stat;

  return (
    <li className="flex flex-col gap-1.5 rounded-md p-2" style={{ backgroundColor: STAT_COLORS[stat].soft }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="font-heading text-[14px]" style={{ color: STAT_COLORS[stat].fill }}>
          {MESSAGES.stats[stat].shortLabel} {path.score}/10
        </span>
        <span className="text-[13px] font-semibold text-[#22354a]">
          {maxed
            ? copy.maxedRow
            : formatMessage(path.upgradesLeft === 1 ? copy.toTierOne : copy.toTierMany, {
                count: path.upgradesLeft,
                tier: path.nextTier as number,
              })}
        </span>
      </div>
      <StatBar stat={stat} value={path.score} size="lg" className="mb-1.5" />

      {!maxed && (
        <div className="flex flex-col gap-0.5 text-[13px] text-[#2b3d4f]">
          <span>
            {formatMessage(copy.creditsLine, { have: path.credits, need: path.upgradesLeft })} ·{' '}
            {path.creditsMissing > 0
              ? formatMessage(copy.creditsMissing, { missing: path.creditsMissing })
              : copy.creditsReady}
          </span>
          <span>
            {formatMessage(copy.tokensLine, {
              amount: formatTokens(path.tierCost, tokenDecimals),
              symbol: tokenSymbol,
              tier: path.nextTier as number,
            })}
          </span>
          {path.opens.length > 0 && (
            <span className="font-semibold">
              {formatMessage(copy.opensLine, { districts: path.opens.map((id) => districtName(id)).join(copy.and) })}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="bas-label">{formatMessage(copy.missionsFor, { stat: statLabel(stat) })}</span>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {path.missions.map((option) => {
            const status = missionStatus(option);
            return (
              <li key={option.mission.id}>
                <Link
                  href="/missions"
                  onClick={() => setFocus({ mission: option.mission.id })}
                  className="bas-chip flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded border-2 border-[#1b2a38] bg-white px-2 py-1.5 text-left font-pixel"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[14px] font-semibold leading-tight">{missionCopy(option.mission).title}</span>
                    <span className="text-[12px] text-[#33485c]">{districtName(option.mission.district)}</span>
                  </span>
                  <span className={cn('flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-heading text-[10px]', TONE[status.tone])}>
                    {status.tone === 'locked' && <LockIcon size={10} />}
                    {status.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </li>
  );
};

const Ladder: React.FC<{ journey: Journey }> = ({ journey }) => (
  <div className="flex flex-col gap-1.5">
    <span className="bas-label">{copy.ladderTitle}</span>
    <ol className="m-0 grid list-none grid-cols-3 gap-1.5 p-0">
      {journey.rungs.map((rung) => {
        const districts = rung.districts.map((id) => districtName(id)).join(copy.and);
        const master = rung.tier === 3;
        return (
          <li
            key={rung.tier}
            className={cn(
              'flex flex-col gap-0.5 rounded-md border-2 p-2',
              rung.reached ? 'border-[#1b2a38] bg-white' : 'border-dashed border-[#9fb3c6] bg-[#e3ecf4]',
            )}
          >
            <span className="flex items-center justify-between gap-1">
              <span className="font-heading text-[12px]">{formatMessage(copy.tierName, { tier: rung.tier })}</span>
              {rung.reached ? (
                <span className="flex h-4 w-4 items-center justify-center rounded border-2 border-[#1b2a38] bg-[#3f9252] text-white">
                  <CheckIcon size={9} />
                </span>
              ) : (
                <LockIcon size={11} />
              )}
            </span>
            <span className="text-[12px] text-[#33485c]">{formatMessage(copy.anyStatAt, { score: rung.score })}</span>
            <span className="text-[13px] font-semibold leading-snug">
              {master
                ? formatMessage(copy.opensMaster, { districts, bracket: MESSAGES.season.bracketNames.master })
                : formatMessage(copy.opens, { districts })}
            </span>
          </li>
        );
      })}
    </ol>
    <p className="m-0 text-[12px] leading-snug text-[#33485c]">
      {copy.ladderNote}{' '}
      {formatMessage(copy.bracketNote, {
        rookie: MESSAGES.season.bracketNames.rookie,
        skilled: MESSAGES.season.bracketNames.skilled,
        elite: MESSAGES.season.bracketNames.elite,
        master: MESSAGES.season.bracketNames.master,
      })}
    </p>
  </div>
);

/** The route of one citizen: the next step, each stat's way to its next tier, and the tier ladder. */
export const JourneyPanel: React.FC<{
  citizen: CitizenRecord;
  /** Leave the next-step line out when the screen already shows it above the panel. */
  showNext?: boolean;
  className?: string | undefined;
}> = ({ citizen, showNext = true, className }) => {
  const journey = useJourney(citizen);
  if (!journey || !journey.owned) return null;
  return <JourneyPanelView journey={journey} citizen={citizen} showNext={showNext} className={className} />;
};

const JourneyPanelView: React.FC<{ journey: Journey; citizen: CitizenRecord; showNext: boolean; className?: string | undefined }> = ({
  journey,
  citizen,
  showNext,
  className,
}) => (
  <section aria-label={copy.title} className={cn('bas-panel flex flex-col gap-3 p-3 md:p-4', className)}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <PanelTab>{copy.title}</PanelTab>
      <span className="text-[13px] text-[#33485c]">{formatMessage(copy.subtitle, { name: citizen.name, tier: journey.tier })}</span>
    </div>
    {showNext && <NextStepLineView journey={journey} citizen={citizen} />}
    {!showNext && paceLine(journey) && <p className="m-0 text-[13px] text-[#33485c]">{paceLine(journey)}</p>}
    <ul className="m-0 grid list-none gap-2 p-0 md:grid-cols-3">
      {journey.paths.map((path) => (
        <StatRow key={path.stat} path={path} />
      ))}
    </ul>
    <Ladder journey={journey} />
  </section>
);

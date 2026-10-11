'use client';

import Link from 'next/link';
import React, { useEffect, useRef, useState } from 'react';
import type { CitizenRecord, StatKey } from '@bas/content';
import { trainingCostAtoms } from '@bas/chain-client/stats';
import { CitizenSwitcher } from '@/components/citizen/CitizenSwitcher';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { StatBar } from '@/components/ui/StatBar';
import { MAX_STAT_SCORE, STAT_COLORS, STAT_ORDER, TIER_SCORES } from '@/config/constants';
import type { StatCredits } from '@/lib/data/types';
import { formatTokens, statLabel, tierForScore } from '@/lib/format';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import {
  useBusy,
  useCredits,
  useIsOwned,
  useSelectedCitizen,
  useTrainStat,
  useTrainingConfig,
  useWallet,
} from '@/stores/selectors';

const copy = MESSAGES.training;

/** First stat that can be trained right now, so the screen opens on a usable choice. */
function firstTrainable(citizen: CitizenRecord, credits: StatCredits): StatKey {
  return (
    STAT_ORDER.find((stat) => credits[stat] > 0 && citizen[stat] < MAX_STAT_SCORE) ??
    STAT_ORDER.find((stat) => citizen[stat] < MAX_STAT_SCORE) ??
    'intelligence'
  );
}

function nextTierScore(score: number): number | undefined {
  return TIER_SCORES.find((threshold) => threshold > score);
}

function creditLine(count: number, tier: number): string {
  if (count === 0) return copy.noCredit;
  return formatMessage(count === 1 ? copy.cardCredit : copy.cardCredits, { count, tier });
}

const ReceiptRow: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-[#9fb3c6] py-1.5 last:border-0">
    <span className="text-[15px] text-[#33485c]">{label}</span>
    <span className={cn('text-right text-[15px]', strong ? 'font-heading text-[15px]' : 'font-semibold')}>{value}</span>
  </div>
);

/** `upgrade_score` as a screen: one credit plus a token burn raises one stat by 1. */
export const TrainingScreen: React.FC = () => {
  const citizen = useSelectedCitizen();
  const id = citizen?.id ?? -1;
  const owned = useIsOwned(id);
  const credits = useCredits(id);
  const wallet = useWallet();
  const { baseTrainingCostAtoms, tokenDecimals, tokenSymbol } = useTrainingConfig();
  const train = useTrainStat();
  const busy = useBusy();
  const ctaRef = useRef<HTMLButtonElement | null>(null);
  const [stat, setStat] = useState<StatKey>('intelligence');

  useEffect(() => {
    if (citizen) setStat(firstTrainable(citizen, credits));
    // Only a new citizen resets the choice; training keeps the stat picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const tokens = (atoms: bigint) => `${formatTokens(atoms, tokenDecimals)} ${tokenSymbol}`;

  if (!citizen) return null;

  const subtitle = formatMessage(copy.subtitle, { symbol: tokenSymbol });

  if (!owned) {
    return (
      <ScreenShell title={copy.title} subtitle={subtitle}>
        <div className="mx-auto flex max-w-xl flex-col gap-4">
          <CitizenSwitcher label={MESSAGES.missions.playingAs} />
          <section className="bas-panel flex flex-col items-center gap-3 p-5 text-center">
            <img src={citizen.sprite} alt="" width={96} height={96} className="h-24 w-24" />
            <p className="m-0 text-[17px] leading-snug">{formatMessage(copy.notYours, { name: citizen.name })}</p>
            <Link href={`/citizen/${citizen.id}`} className="bas-btn">
              {copy.viewProfile}
            </Link>
          </section>
        </div>
      </ScreenShell>
    );
  }

  const score = citizen[stat];
  const maxed = score >= MAX_STAT_SCORE;
  const cost = trainingCostAtoms(baseTrainingCostAtoms, score);
  const credit = credits[stat];
  const fromTier = tierForScore(score);
  const toTier = tierForScore(score + 1);
  const label = statLabel(stat);

  const speech = maxed
    ? formatMessage(copy.speechMaxed, { stat: label })
    : toTier > fromTier
      ? formatMessage(copy.speechTier, { stat: label, tier: toTier })
      : formatMessage(copy.speechReady, { stat: label, from: score, to: score + 1 });

  const tierLine = maxed
    ? copy.maxed
    : toTier > fromTier
      ? formatMessage(copy.reachesTier, { tier: toTier })
      : formatMessage(copy.staysTier, { tier: fromTier, next: nextTierScore(score) ?? MAX_STAT_SCORE });

  const disabled = busy || maxed || credit < 1;

  return (
    <ScreenShell title={copy.title} subtitle={subtitle}>
      <div className="mx-auto flex max-w-6xl flex-col gap-3 md:gap-4">
        <CitizenSwitcher label={MESSAGES.missions.playingAs} />

        <div className="grid gap-3 md:gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-w-0 flex-col gap-3 md:gap-4">
            <section
              className="bas-panel relative flex h-[220px] items-end justify-center overflow-hidden md:h-[300px]"
              style={{
                backgroundImage: "url('/images/district/courtyard_stage_bg.png')",
                backgroundSize: 'cover',
                backgroundPosition: 'center bottom',
                imageRendering: 'pixelated',
              }}
            >
              <div className="absolute left-3 right-3 top-3 md:left-auto md:right-6 md:top-6 md:max-w-[260px]">
                <div className="bas-panel px-3 py-2 text-[15px] leading-snug">{speech}</div>
              </div>
              <img
                src={citizen.image}
                alt={citizen.name}
                width={180}
                height={180}
                className="citizen-hop relative mb-3 h-[140px] w-[140px] md:mb-5 md:h-[180px] md:w-[180px]"
              />
              <div className="bas-plate absolute bottom-3 left-3 px-2 py-1">
                {citizen.name.toUpperCase()} · {citizen.code}
              </div>
            </section>

            <div className="grid grid-cols-3 gap-2 md:gap-3">
              {STAT_ORDER.map((key) => {
                const value = citizen[key];
                const active = key === stat;
                const count = credits[key];
                const atMax = value >= MAX_STAT_SCORE;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setStat(key)}
                    className={cn(
                      'bas-chip flex min-w-0 flex-col gap-2 rounded-lg p-2 text-left font-pixel sm:p-3',
                      active ? 'border-[3px] border-[#f7d23d] bg-white outline outline-2 outline-[#1a2734]' : 'border-2 border-[#1b2a38] bg-[#e3ecf4]',
                    )}
                    style={active ? { backgroundColor: STAT_COLORS[key].soft } : undefined}
                  >
                    <span className="flex items-center justify-between">
                      <span className="font-heading text-[13px]" style={{ color: STAT_COLORS[key].fill }}>
                        {MESSAGES.stats[key].shortLabel}
                      </span>
                      <span className="font-heading text-xl">{value}</span>
                    </span>
                    <StatBar stat={key} value={value} size="lg" className="mb-1.5" />
                    <span className="hidden text-[15px] font-semibold sm:block">
                      {atMax
                        ? copy.maxed
                        : formatMessage(copy.cardLine, {
                            from: value,
                            to: value + 1,
                            cost: formatTokens(trainingCostAtoms(baseTrainingCostAtoms, value), tokenDecimals),
                            symbol: tokenSymbol,
                          })}
                    </span>
                    <span className={cn('text-[13px] leading-tight sm:text-[13px]', count === 0 ? 'text-[#a3432f]' : 'text-[#33485c]')}>
                      {creditLine(count, tierForScore(value))}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3 md:gap-4">
            <section className="bas-panel flex flex-col gap-2 p-3 md:p-4">
              <div className="flex items-center gap-2">
                <PixelIcon src="/icons/icon_upgrade_arrow.png" className="h-7" />
                <span className="font-heading text-[17px]">
                  {maxed ? copy.maxed : formatMessage(copy.head, { stat: label.toUpperCase(), from: score, to: score + 1 })}
                </span>
              </div>
              <p className="m-0 text-[15px] text-[#2b3d4f]">{tierLine}</p>
              <div className="bas-inset mt-1 px-3 py-1">
                <ReceiptRow label={copy.cost} value={maxed ? '—' : tokens(cost)} strong />
                <ReceiptRow label={copy.rule} value={copy.ruleValue} />
                <ReceiptRow
                  label={copy.creditUsed}
                  value={formatMessage(copy.creditValue, { stat: label, before: credit, after: Math.max(credit - 1, 0) })}
                />
                <ReceiptRow label={copy.walletAfter} value={maxed ? '—' : tokens(wallet.tokenAtoms - cost)} />
                <ReceiptRow label={copy.where} value={copy.burned} />
              </div>
              {credit < 1 && !maxed && (
                <p className="m-0 text-[15px] text-[#a3432f]">
                  {formatMessage(copy.noCreditHint, { stat: label })} ·{' '}
                  <Link href="/missions" className="font-semibold text-[#1a2734]">
                    {MESSAGES.nav.missions}
                  </Link>
                </p>
              )}
              <button
                ref={ctaRef}
                type="button"
                disabled={disabled}
                onClick={() => void train(stat, ctaRef.current)}
                className="bas-btn bas-btn-primary mt-1 min-h-12 text-[14px]"
              >
                {formatMessage(copy.cta, { cost: formatTokens(cost, tokenDecimals), symbol: tokenSymbol })}
              </button>
              <p className="m-0 text-[13px] leading-snug text-[#33485c]">{copy.mockNote}</p>
            </section>

            <section className="bas-panel flex flex-col gap-2 p-3 md:p-4">
              <span className="bas-label">{copy.ladder}</span>
              <div className="flex h-28 items-end gap-1" aria-hidden>
                {Array.from({ length: MAX_STAT_SCORE }, (_, index) => {
                  const level = index + 1;
                  const reached = level <= score;
                  const next = level === score + 1;
                  return (
                    <div key={level} className="flex h-full flex-1 flex-col items-center gap-1">
                      <div className="flex w-full flex-1 items-end">
                        <div
                          className={cn('w-full border border-[#1b2a38]', next && 'outline outline-2 outline-[#f7d23d]')}
                          style={{
                            height: `${level * 10}%`,
                            backgroundColor: reached ? STAT_COLORS[stat].fill : next ? STAT_COLORS[stat].light : '#c3d0dc',
                          }}
                        />
                      </div>
                      <span className="font-heading text-[11px]">{level}</span>
                    </div>
                  );
                })}
              </div>
              <p className="m-0 text-[13px] text-[#33485c]">{copy.ladderNote}</p>
            </section>
          </div>
        </div>
      </div>
    </ScreenShell>
  );
};

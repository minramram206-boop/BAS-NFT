'use client';

import Link from 'next/link';
import React, { useEffect, useRef, useState } from 'react';
import type { CitizenRecord, StatKey } from '@bas/content';
import { trainingCostAtoms } from '@bas/chain-client/stats';
import { PlayerStrip } from '@/components/citizen/PlayerStrip';
import { NoCitizenPanel } from '@/components/mint/NoCitizenPanel';
import { GetTokenPanel } from '@/components/token/GetTokenPanel';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { PanelTab } from '@/components/ui/PanelTab';
import { ReceiptRow } from '@/components/ui/ReceiptRow';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { Ribbon } from '@/components/ui/Ribbon';
import { StatBar } from '@/components/ui/StatBar';
import { MAX_STAT_SCORE, STAT_COLORS, STAT_ORDER, TIER_SCORES } from '@/config/constants';
import type { StatCredits } from '@/lib/data/types';
import { formatTokens, statLabel, tierForScore } from '@/lib/format';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import {
  useBusy,
  useCredits,
  useDataMode,
  useFocus,
  useFoundingIds,
  useIsOwned,
  useOwnedIds,
  useSelectedCitizen,
  useSetFocus,
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

/** `upgrade_score` as a screen: one credit plus a token burn raises one stat by 1. */
export const TrainingScreen: React.FC = () => {
  const citizen = useSelectedCitizen();
  const id = citizen?.id ?? -1;
  const owned = useIsOwned(id);
  const ownedIds = useOwnedIds();
  const credits = useCredits(id);
  const wallet = useWallet();
  const { baseTrainingCostAtoms, tokenDecimals, tokenSymbol } = useTrainingConfig();
  const train = useTrainStat();
  const busy = useBusy();
  const mode = useDataMode();
  const ctaRef = useRef<HTMLButtonElement | null>(null);
  const founding = useFoundingIds();
  const focus = useFocus();
  const setFocus = useSetFocus();
  const [stat, setStat] = useState<StatKey>('intelligence');

  useEffect(() => {
    if (!citizen) return;
    // A next-step button may have picked the stat to train; read it once.
    setStat(focus.training ?? firstTrainable(citizen, credits));
    if (focus.training) setFocus({ training: null });
    // Only a new citizen resets the choice; training keeps the stat picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const tokens = (atoms: bigint) => `${formatTokens(atoms, tokenDecimals)} ${tokenSymbol}`;

  const subtitle = formatMessage(copy.subtitle, { symbol: tokenSymbol });

  if (ownedIds.length === 0) {
    return (
      <ScreenShell title={copy.title} subtitle={subtitle}>
        <NoCitizenPanel className="mx-auto my-auto max-w-[560px]" />
      </ScreenShell>
    );
  }

  if (!citizen) return null;

  if (!owned) {
    return (
      <ScreenShell title={copy.title} subtitle={subtitle}>
        <div className="flex flex-1 flex-col gap-3 md:gap-4">
          <PlayerStrip />
          <section className="bas-panel flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
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

  const needsCredit = credit < 1 && !maxed;

  const speech = maxed
    ? formatMessage(copy.speechMaxed, { stat: label })
    : needsCredit
      ? formatMessage(copy.speechNoCredit, { stat: label })
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
      <div className="grid grid-cols-1 content-start gap-3 md:gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-label={copy.title} className="bas-panel flex min-w-0 flex-col gap-3 p-3 md:gap-4 md:p-4">
          <div className="grid gap-3 md:grid-cols-[304px_minmax(0,1fr)] md:gap-4">
            {/* The portrait: the courtyard art at its own size, so the pixels stay sharp. */}
            <div className="bas-panel flex flex-col items-center justify-center gap-3 p-3">
              <div
                className="relative aspect-[276/224] w-[276px] max-w-full overflow-hidden rounded-md border-2 border-[#1b2a38]"
                style={{
                  backgroundImage: "url('/images/district/courtyard_stage_bg.png')",
                  backgroundSize: '100% 100%',
                  imageRendering: 'pixelated',
                }}
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_62%,transparent_50%,rgba(11,20,28,0.45)_100%)]"
                />
                <div className="absolute inset-x-0 bottom-[9%] flex justify-center">
                  <div className="relative">
                    <span
                      aria-hidden
                      className="absolute bottom-0 left-1/2 h-3 w-20 -translate-x-1/2 rounded-[50%] bg-[#0b141c]/40"
                    />
                    <img
                      src={citizen.image}
                      alt={citizen.name}
                      width={130}
                      height={130}
                      className="citizen-hop relative h-[130px] w-[130px]"
                    />
                  </div>
                </div>
              </div>
              <Ribbon>{citizen.name}</Ribbon>
              <p className="m-0 text-center text-[14px] leading-tight text-[#22354a]">
                {citizen.code}
                {founding.includes(citizen.id) ? ` · ${MESSAGES.city.foundingCitizen}` : ''} · {citizen.role}
              </p>
            </div>

            <div role="group" aria-label={copy.pick} className="bas-panel flex min-w-0 flex-col gap-3 p-3">
              <PanelTab>{copy.pick}</PanelTab>
              <div className="flex flex-1 flex-col gap-2">
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
                        'bas-chip grid flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-lg px-3 py-2.5 text-left font-pixel xl:py-4 sm:grid-cols-[112px_minmax(0,1fr)_auto]',
                        active ? 'border-[3px] border-[#f7d23d] bg-white outline outline-2 outline-[#1a2734]' : 'border-2 border-[#1b2a38] bg-[#e3ecf4]',
                      )}
                      style={active ? { backgroundColor: STAT_COLORS[key].soft } : undefined}
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-heading text-[13px]" style={{ color: STAT_COLORS[key].fill }}>
                          {MESSAGES.stats[key].shortLabel}
                        </span>
                        <span className={cn('text-[13px] leading-tight', count === 0 ? 'text-[#a3432f]' : 'text-[#33485c]')}>
                          {creditLine(count, tierForScore(value))}
                        </span>
                      </span>
                      <StatBar stat={key} value={value} size="lg" className="order-3 col-span-2 sm:order-none sm:col-span-1" />
                      <span className="flex flex-col items-end gap-0.5">
                        <span className="font-heading text-3xl leading-none">{value}</span>
                        <span className="whitespace-nowrap text-[13px] font-semibold text-[#33485c]">
                          {atMax
                            ? copy.maxed
                            : `${value + 1} · ${formatTokens(trainingCostAtoms(baseTrainingCostAtoms, value), tokenDecimals)} ${tokenSymbol}`}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-3 rounded-md border-2 border-dashed border-[#5b6b7a] bg-[#d3dde6] px-3 py-2">
                <PixelIcon src="/icons/icon_upgrade_arrow.png" className="h-7 shrink-0" />
                <p className="m-0 text-[15px] leading-snug text-[#22354a]">{tierLine}</p>
              </div>
            </div>
          </div>

          <div className="bas-inset relative px-4 py-3 text-[16px] leading-snug">
            <span
              aria-hidden
              className="absolute -top-[7px] left-24 hidden h-3 w-3 rotate-45 border-l-2 border-t-2 border-[#1b2a38] bg-[#f2f6fa] md:block"
            />
            {speech}
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            {needsCredit ? (
              <Link href="/missions" className="bas-btn bas-btn-primary min-h-12 text-[14px]">
                {copy.earnCta}
              </Link>
            ) : (
              <button
                ref={ctaRef}
                type="button"
                disabled={disabled}
                onClick={() => void train(stat, ctaRef.current)}
                className="bas-btn bas-btn-primary min-h-12 text-[14px]"
              >
                {formatMessage(copy.cta, { cost: formatTokens(cost, tokenDecimals), symbol: tokenSymbol })}
              </button>
            )}
            <Link href="/" className="bas-btn min-h-12 text-[14px] sm:px-6">
              {MESSAGES.app.back}
            </Link>
          </div>

          <PlayerStrip flat />
        </section>

        <aside className="flex min-w-0 flex-col gap-3 md:gap-4">
          <section className="bas-panel flex flex-col gap-3 p-3 md:p-4 lg:flex-1">
            <PanelTab icon="/icons/icon_upgrade_arrow.png">
              {maxed ? copy.maxed : formatMessage(copy.head, { stat: label, from: score, to: score + 1 })}
            </PanelTab>
            <div className="bas-inset flex flex-col px-3 py-1 lg:flex-1">
              <ReceiptRow label={copy.cost} value={maxed ? '—' : tokens(cost)} strong />
              <ReceiptRow label={copy.rule} value={copy.ruleValue} />
              <ReceiptRow
                label={copy.creditUsed}
                value={
                  credit < 1 ? copy.creditNone : formatMessage(copy.creditValue, { stat: label, before: credit, after: credit - 1 })
                }
              />
              <ReceiptRow label={copy.walletAfter} value={maxed ? '—' : tokens(wallet.tokenAtoms - cost)} />
              <ReceiptRow label={copy.where} value={copy.burned} />
            </div>
            <p className="m-0 text-[13px] leading-snug text-[#33485c]">{mode === 'chain' ? copy.chainNote : copy.mockNote}</p>
          </section>

          <section className="bas-panel flex flex-col gap-3 p-3 md:p-4">
            <PanelTab>{copy.ladder}</PanelTab>
            <p className="m-0 text-[13px] leading-snug text-[#33485c]">{copy.ladderNote}</p>
            <div className="flex h-24 items-end gap-1.5 md:h-28" aria-hidden>
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
          </section>

          <GetTokenPanel />
        </aside>
      </div>
    </ScreenShell>
  );
};

'use client';

import React, { useState } from 'react';
import { ROLE_KEYS, ROLE_LABELS } from '@bas/content';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { LockIcon } from '@/components/ui/icons';
import { MIN_VALID_ENTRIES, actualWinners, bracketPoolLamports, prizesLamports } from '@/lib/data/season';
import type { BracketId, BracketPool, LeaderboardEntry } from '@/lib/data/types';
import { formatSol } from '@/lib/format';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import { useBasStoreApi } from '@/stores/BasStoreProvider';
import { useCitizens, useOwnedIds, useSeason } from '@/stores/selectors';

const copy = MESSAGES.season;
/** Gold, silver and bronze for the first three places. */
const RANK_STYLE: Readonly<Record<number, string>> = {
  1: 'bg-[#f7d23d]',
  2: 'bg-[#d3dde6]',
  3: 'bg-[#e0a46a]',
};
const BRACKETS: readonly BracketId[] = ['open', 'rookie', 'skilled', 'elite', 'master'];

function roleLabel(key: LeaderboardEntry['roleKey']): string {
  return ROLE_LABELS[ROLE_KEYS.indexOf(key)] ?? key;
}

function percent(bps: number): string {
  return `${bps / 100}%`;
}

const Leaderboard: React.FC<{ pool: BracketPool; rows: readonly LeaderboardEntry[]; fundedLamports: bigint }> = ({
  pool,
  rows,
  fundedLamports,
}) => {
  const citizens = useCitizens();
  const owned = useOwnedIds();
  const prizes = prizesLamports(fundedLamports, pool);
  const winners = prizes.length;

  if (pool.validEntries < MIN_VALID_ENTRIES) {
    return <p className="m-0 rounded-md bg-[#f2f6fa] p-3 text-[15px]">{copy.noBoard}</p>;
  }
  if (rows.length === 0) {
    return <p className="m-0 rounded-md bg-[#f2f6fa] p-3 text-[15px]">{copy.previewOnly}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-y-1 text-left">
        <thead>
          <tr className="font-heading text-[11px] text-[#33485c]">
            <th className="px-2 font-normal">{copy.rank}</th>
            <th className="px-2 font-normal">{copy.citizen}</th>
            <th className="hidden px-2 font-normal sm:table-cell">{copy.role}</th>
            <th className="px-2 text-right font-normal">{copy.points}</th>
            <th className="px-2 text-right font-normal">{copy.prize}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rank = index + 1;
            const citizen = row.citizenId === null ? undefined : citizens.find((item) => item.id === row.citizenId);
            const mine = row.citizenId !== null && owned.includes(row.citizenId);
            const prize = prizes[index];
            return (
              <React.Fragment key={row.serial}>
                {rank === winners + 1 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-1">
                      <div className="border-t-2 border-dashed border-[#a3432f] pt-1 text-center font-heading text-[11px] text-[#a3432f]">
                        {formatMessage(copy.cutline, { rank: winners })}
                      </div>
                    </td>
                  </tr>
                )}
                <tr className={cn('text-[15px]', mine ? 'bg-[#fff6c9]' : 'bg-[#f2f6fa]')}>
                  <td className="rounded-l-md px-3 py-2">
                    <span
                      className={cn(
                        'inline-flex h-7 w-7 items-center justify-center rounded border-2 border-[#1b2a38] font-heading text-[13px]',
                        RANK_STYLE[rank] ?? 'bg-white',
                      )}
                    >
                      {rank}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      {citizen ? (
                        <img src={citizen.sprite} alt="" width={26} height={26} className="h-[26px] w-[26px]" />
                      ) : (
                        <span className="h-[26px] w-[26px] rounded bg-[#c3d0dc]" />
                      )}
                      <span className="font-semibold">{citizen?.name ?? row.serial}</span>
                      {mine && (
                        <span className="rounded bg-[#1a2734] px-1 py-0.5 font-heading text-[10px] text-[#f7d23d]">{copy.you}</span>
                      )}
                    </span>
                  </td>
                  <td className="hidden px-3 py-2 text-[#33485c] sm:table-cell">{roleLabel(row.roleKey)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-semibold sm:px-3">{row.points.toLocaleString('en-US')}</td>
                  <td className="whitespace-nowrap rounded-r-md px-2 py-2 text-right sm:px-3">
                    {prize === undefined ? <span className="text-[#33485c]">{copy.titleOnly}</span> : <b>{formatSol(prize, 3)}</b>}
                  </td>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

/** Season standings, the prize vault and how a prize is paid out. */
export const SeasonScreen: React.FC = () => {
  const season = useSeason();
  const api = useBasStoreApi();
  const [bracket, setBracket] = useState<BracketId>('skilled');
  const pool = season.pools.find((item) => item.id === bracket) ?? season.pools[0];
  if (!pool) return null;

  const steps = [
    { label: formatMessage(copy.stepEnd, { day: season.length }), text: copy.stepEndText },
    { label: copy.stepPosted, text: copy.stepPostedText },
    { label: copy.stepChallenge, text: copy.stepChallengeText },
    { label: copy.stepClaim, text: copy.stepClaimText },
  ];

  return (
    <ScreenShell
      title={formatMessage(copy.title, { number: season.number })}
      subtitle={formatMessage(copy.subtitle, {
        day: season.day,
        length: season.length,
        left: season.length - season.day,
      })}
    >
      <div className="mx-auto grid max-w-6xl gap-3 md:gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="bas-panel flex min-w-0 flex-col gap-3 self-start p-3 md:p-4">
          <div role="tablist" aria-label={copy.bracketLabel} className="flex flex-wrap gap-1.5">
            {BRACKETS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={bracket === id}
                onClick={() => setBracket(id)}
                className={cn(
                  'bas-chip h-10 rounded-md border-2 border-[#1b2a38] px-3 font-heading text-[12px]',
                  bracket === id ? 'bg-[#f7d23d]' : 'bg-[#c5d5e5]',
                )}
              >
                {copy.brackets[id]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-heading text-[17px]">
              {formatMessage(copy.bracketHeading, { bracket: copy.bracketNames[bracket].toUpperCase() })}
            </span>
            <span className="text-[15px] text-[#2b3d4f]">
              {formatMessage(copy.entries, { entries: pool.validEntries, winners: actualWinners(pool) })}
            </span>
          </div>
          <Leaderboard pool={pool} rows={season.leaderboards[bracket] ?? []} fundedLamports={season.fundedLamports} />
          <p className="m-0 text-[13px] leading-snug text-[#33485c]">{copy.rules}</p>
        </section>

        <div className="flex flex-col gap-3 md:gap-4">
          <section className="bas-panel flex flex-col gap-2.5 p-3 md:p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <PixelIcon src="/icons/shield_crest.png" className="h-8" />
                <span className="bas-label">{copy.vault}</span>
              </span>
              <span className="flex items-center gap-1 rounded bg-[#1a2734] px-1.5 py-0.5 font-heading text-[11px] text-[#8fdc9b]">
                <LockIcon size={10} />
                {copy.noWithdraw}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bas-inset flex flex-col gap-0.5 p-2">
                <span className="text-[13px] text-[#33485c]">{copy.inVault}</span>
                <span className="font-heading text-[17px]">{formatSol(season.vaultLamports)}</span>
              </div>
              <div className="bas-inset flex flex-col gap-0.5 p-2">
                <span className="text-[13px] text-[#33485c]">{formatMessage(copy.locked, { number: season.number })}</span>
                <span className="font-heading text-[17px]">{formatSol(season.fundedLamports)}</span>
              </div>
            </div>
            <button
              type="button"
              className="bas-btn"
              onClick={() => api.getState().openModal(copy.explorerTitle, copy.explorerMessage)}
            >
              {copy.explorer} · {season.vaultAddress}
            </button>
          </section>

          <section className="bas-panel flex flex-col gap-2 p-3 md:p-4">
            <span className="bas-label">{formatMessage(copy.pools, { number: season.number })}</span>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {season.pools.map((item) => (
                <li
                  key={item.id}
                  className={cn(
                    'grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md px-3 py-2 text-[15px]',
                    item.id === bracket ? 'bg-[#fff6c9]' : 'bg-[#f2f6fa]',
                  )}
                >
                  <span className="font-semibold">{copy.bracketNames[item.id]}</span>
                  <span className="text-[13px] text-[#33485c]">
                    {percent(item.shareBps)} · {formatMessage(copy.maxWinners, { count: item.maxWinners })}
                  </span>
                  <span className="text-right font-heading text-[13px]">
                    {formatSol(bracketPoolLamports(season.fundedLamports, item))}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="bas-panel flex flex-col gap-2 p-3 md:p-4">
            <span className="bas-label">{copy.howFundsLeave}</span>
            <ol className="m-0 grid list-none grid-cols-4 gap-1.5 p-0">
              {steps.map((step) => (
                <li key={step.label} className="flex flex-col items-center gap-1 rounded-md bg-[#f2f6fa] p-1.5 text-center">
                  <span className="font-heading text-[12px]">{step.label}</span>
                  <span className="text-[13px] leading-tight text-[#33485c]">{step.text}</span>
                </li>
              ))}
            </ol>
            <p className="m-0 text-[13px] leading-snug text-[#2b3d4f]">{copy.disclosure}</p>
          </section>
        </div>
      </div>
    </ScreenShell>
  );
};

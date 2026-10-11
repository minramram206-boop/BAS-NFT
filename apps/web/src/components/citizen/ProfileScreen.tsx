'use client';

import Link from 'next/link';
import React from 'react';
import type { CitizenRecord, StatKey } from '@bas/content';
import { MAX_STAT_SCORE } from '@bas/content';
import { trainingCostAtoms } from '@bas/chain-client/stats';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { StatBar, StatSwatch } from '@/components/ui/StatBar';
import { CheckIcon, LockIcon, StarIcon } from '@/components/ui/icons';
import { STAT_COLORS, STAT_ORDER } from '@/config/constants';
import { DISTRICT_ORDER, DISTRICT_RULES, bracketOf, highestStat, isDistrictOpen, unlockingStat } from '@/lib/data/districts';
import type { HistoryEntry, StatCredits } from '@/lib/data/types';
import { districtName, formatTokens, lockedRule, statLabel, tierForScore } from '@/lib/format';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import { useBasStoreApi } from '@/stores/BasStoreProvider';
import {
  useCitizen,
  useCredits,
  useFoundingIds,
  useHistory,
  useIsOwned,
  useMissions,
  useSelectCitizen,
  useTrainingConfig,
  useWallet,
} from '@/stores/selectors';

const copy = MESSAGES.profile;

function creditCopy(count: number, stat: StatKey): string {
  const label = statLabel(stat);
  if (count === 0) return formatMessage(copy.noCredits, { stat: label });
  if (count === 1) return formatMessage(copy.credit, { stat: label });
  return formatMessage(copy.credits, { count, stat: label });
}

/** Scores at registration: today's scores minus every training step in the history. */
function startingScores(citizen: CitizenRecord, history: readonly HistoryEntry[]): Record<StatKey, number> {
  const start: Record<StatKey, number> = {
    intelligence: citizen.intelligence,
    alignment: citizen.alignment,
    compute: citizen.compute,
  };
  for (const entry of history) if (entry.kind === 'train') start[entry.stat] -= 1;
  return start;
}

const Panel: React.FC<{ title: string; note?: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }> = ({
  title,
  note,
  icon,
  children,
  className,
}) => (
  <section className={cn('bas-panel flex flex-col gap-2.5 p-3 md:p-4', className)}>
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5">
        {icon}
        <span className="bas-label">{title}</span>
      </span>
      {note && <span className="text-[13px] text-[#33485c]">{note}</span>}
    </div>
    {children}
  </section>
);

const StatsPanel: React.FC<{ citizen: CitizenRecord; credits: StatCredits; owned: boolean }> = ({ citizen, credits, owned }) => {
  const { baseTrainingCostAtoms, tokenDecimals, tokenSymbol } = useTrainingConfig();
  return (
    <Panel title={copy.statsTitle} note={copy.statsRule}>
      {STAT_ORDER.map((stat) => {
        const score = citizen[stat];
        return (
          <div key={stat} className="flex flex-col gap-1.5 rounded-md p-2" style={{ backgroundColor: STAT_COLORS[stat].soft }}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-heading text-[14px]" style={{ color: STAT_COLORS[stat].fill }}>
                {MESSAGES.stats[stat].shortLabel}
              </span>
              <span className="flex items-baseline gap-2">
                <span className="text-[13px] text-[#33485c]">{formatMessage(copy.tier, { tier: tierForScore(score) })}</span>
                <span className="font-heading text-lg">
                  {score}
                  <span className="text-[13px] text-[#33485c]">/{MAX_STAT_SCORE}</span>
                </span>
              </span>
            </div>
            <StatBar stat={stat} value={score} size="lg" className="mb-1.5" />
            {owned && (
              <div className="flex flex-wrap justify-between gap-x-3 text-[13px] text-[#2b3d4f]">
                <span>{creditCopy(credits[stat], stat)}</span>
                <span>
                  {score >= MAX_STAT_SCORE
                    ? copy.maxed
                    : formatMessage(copy.nextCost, {
                        cost: formatTokens(trainingCostAtoms(baseTrainingCostAtoms, score), tokenDecimals),
                        symbol: tokenSymbol,
                      })}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </Panel>
  );
};

const DistrictsPanel: React.FC<{ citizen: CitizenRecord }> = ({ citizen }) => (
  <Panel
    title={copy.districtsTitle}
    note={copy.districtsRule}
    icon={<PixelIcon src="/icons/door_icon.png" className="h-5" />}
  >
    <ul className="m-0 grid list-none gap-1.5 p-0 sm:grid-cols-2">
      {DISTRICT_ORDER.map((id) => {
        const open = isDistrictOpen(citizen, id);
        const rule = DISTRICT_RULES[id];
        const opener = open && rule.unlockScore > 0 ? unlockingStat(citizen, id) : undefined;
        const detail = !open
          ? lockedRule(id)
          : opener
            ? formatMessage(MESSAGES.districts.unlockedBy, {
                stat: statLabel(opener),
                score: citizen[opener],
                tier: tierForScore(citizen[opener]),
              })
            : MESSAGES.districts.always;
        return (
          <li
            key={id}
            className={cn(
              'flex items-center gap-2 rounded-md border-2 px-2 py-1.5',
              open ? 'border-[#1b2a38] bg-[#f2f6fa]' : 'border-dashed border-[#5b6b7a] bg-[#d3dde6] text-[#33485c]',
            )}
          >
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 border-[#1b2a38]',
                open ? 'bg-[#3f9252] text-white' : 'bg-[#5b6b7a] text-white',
              )}
            >
              {open ? <CheckIcon size={12} /> : <LockIcon size={12} />}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[15px] font-semibold leading-tight">{districtName(id)}</span>
              <span className="text-[13px]">{detail}</span>
            </span>
          </li>
        );
      })}
    </ul>
  </Panel>
);

interface Achievement {
  key: string;
  title: string;
  detail: string;
  earned: boolean;
  icon: React.ReactNode;
}

const AchievementsPanel: React.FC<{ citizen: CitizenRecord; founding: boolean }> = ({ citizen, founding }) => {
  const items: Achievement[] = [
    {
      key: 'founding',
      title: copy.achFounding,
      detail: copy.achFoundingDetail,
      earned: founding,
      icon: <PixelIcon src="/icons/icon_mint_egg.png" className="h-7" />,
    },
    ...STAT_ORDER.map((stat) => ({
      key: `tier-${stat}`,
      title: formatMessage(copy.achFirstTier, { stat: statLabel(stat) }),
      detail: formatMessage(copy.achFirstTierDetail, { stat: statLabel(stat) }),
      earned: citizen[stat] >= 3,
      icon: <StarIcon size={24} color={STAT_COLORS[stat].light} />,
    })),
    { key: 'event', title: copy.achEvent, detail: copy.achEventDetail, earned: false, icon: <StarIcon size={24} color="#d3a8e0" /> },
    { key: 'master', title: copy.achMaster, detail: copy.achMasterDetail, earned: false, icon: <StarIcon size={24} /> },
  ];

  return (
    <Panel title={copy.achievementsTitle}>
      <ul className="m-0 grid list-none grid-cols-2 gap-1.5 p-0 sm:grid-cols-3">
        {items.map((item) => (
          <li
            key={item.key}
            className={cn(
              'flex flex-col items-center gap-1 rounded-md border-2 p-2 text-center',
              item.earned ? 'border-[#1b2a38] bg-white' : 'border-dashed border-[#9fb3c6] bg-[#e3ecf4] opacity-60 grayscale',
            )}
          >
            {item.icon}
            <span className="text-[14px] font-semibold leading-tight">{item.title}</span>
            <span className="text-[13px] text-[#33485c]">{item.detail}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
};

const HistoryPanel: React.FC<{ citizen: CitizenRecord; history: readonly HistoryEntry[] }> = ({ citizen, history }) => {
  const { tokenDecimals, tokenSymbol } = useTrainingConfig();
  const missions = useMissions();
  const start = startingScores(citizen, history);
  const entries: readonly HistoryEntry[] = history.length > 0 ? history : [{ day: 1, kind: 'register' }];

  const lines = (entry: HistoryEntry): { title: string; detail: string; stat?: StatKey } => {
    switch (entry.kind) {
      case 'register':
        return {
          title: formatMessage(MESSAGES.history.register, { role: citizen.role }),
          detail: formatMessage(MESSAGES.history.registerDetail, {
            insight: start.intelligence,
            bond: start.alignment,
            craft: start.compute,
          }),
        };
      case 'train':
        return {
          stat: entry.stat,
          title: formatMessage(MESSAGES.history.train, { stat: statLabel(entry.stat), from: entry.from, to: entry.from + 1 }),
          detail: formatMessage(MESSAGES.history.trainDetail, {
            amount: formatTokens(entry.burnedAtoms, tokenDecimals),
            symbol: tokenSymbol,
            stat: statLabel(entry.stat),
          }),
        };
      case 'mission': {
        const mission = MESSAGES.missions.catalog[entry.missionId as keyof typeof MESSAGES.missions.catalog];
        return {
          stat: entry.stat,
          title: formatMessage(MESSAGES.history.mission, { mission: mission?.title ?? entry.missionId }),
          detail: formatMessage(MESSAGES.history.missionDetail, {
            district: districtName(missions.find((item) => item.id === entry.missionId)?.district),
            stat: statLabel(entry.stat),
          }),
        };
      }
    }
  };

  return (
    <Panel title={copy.historyTitle}>
      <ol className="m-0 flex max-h-[420px] list-none flex-col gap-1.5 overflow-y-auto p-0 pr-1">
        {entries.map((entry, index) => {
          const line = lines(entry);
          return (
            <li key={`${entry.day}-${entry.kind}-${index}`} className="flex gap-3 rounded-md bg-[#f2f6fa] px-3 py-2">
              <span className="w-16 shrink-0 font-heading text-[11px] leading-5 text-[#33485c]">
                {formatMessage(MESSAGES.history.day, { day: entry.day })}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                  {line.stat && <StatSwatch stat={line.stat} />}
                  {line.title}
                </span>
                <span className="text-[13px] text-[#33485c]">{line.detail}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
};

/** Public profile of one citizen: stats, districts, achievements and history. */
export const ProfileScreen: React.FC<{ id: number }> = ({ id }) => {
  const citizen = useCitizen(id);
  const owned = useIsOwned(id);
  const credits = useCredits(id);
  const history = useHistory(id);
  const founding = useFoundingIds();
  const wallet = useWallet();
  const select = useSelectCitizen();
  const api = useBasStoreApi();

  if (!citizen) {
    return (
      <ScreenShell title={copy.title}>
        <section className="bas-panel mx-auto max-w-md p-5 text-center text-[17px]">{copy.missing}</section>
      </ScreenShell>
    );
  }

  const bracket = bracketOf(citizen);

  return (
    <ScreenShell title={copy.title} subtitle={`${citizen.name} · ${citizen.code}`}>
      <div className="mx-auto grid max-w-6xl gap-3 md:gap-4 lg:grid-cols-[300px_minmax(0,1fr)_minmax(0,1fr)]">
        <section className="bas-panel flex flex-col gap-3 self-start p-3 md:p-4">
          <div className="bas-inset bas-grid-bg mx-auto flex aspect-square w-full max-w-[200px] items-center justify-center overflow-hidden lg:max-w-none">
            <img src={citizen.image} alt={citizen.name} width={240} height={240} className="citizen-hop h-[78%] w-[78%] object-contain" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-[#33485c]">{citizen.code}</span>
            <span className="font-heading text-lg leading-tight">{citizen.name.toUpperCase()}</span>
            <span className="text-[15px] text-[#2b3d4f]">
              {formatMessage(copy.bracket, {
                role: citizen.role,
                bracket: MESSAGES.season.bracketNames[bracket],
                score: highestStat(citizen),
              })}
            </span>
            <span className="text-[13px] text-[#33485c]">
              {owned ? formatMessage(copy.ownerYou, { address: wallet.label }) : copy.ownerOther}
            </span>
          </div>
          <p className="m-0 text-[15px] leading-snug text-[#2b3d4f]">{citizen.lore}</p>
          <div className={cn('grid gap-2', owned ? 'grid-cols-2' : 'grid-cols-1')}>
            <button
              type="button"
              className="bas-btn"
              onClick={() => api.getState().openModal(copy.talkTitle, copy.talkMessage)}
            >
              {copy.talk}
            </button>
            {owned && (
              <Link href="/training" onClick={() => select(citizen.id)} className="bas-btn bas-btn-primary">
                {copy.train}
              </Link>
            )}
          </div>
        </section>

        <div className="flex min-w-0 flex-col gap-3 md:gap-4">
          <StatsPanel citizen={citizen} credits={credits} owned={owned} />
          <DistrictsPanel citizen={citizen} />
        </div>

        <div className="flex min-w-0 flex-col gap-3 md:gap-4">
          <AchievementsPanel citizen={citizen} founding={founding.includes(citizen.id)} />
          <HistoryPanel citizen={citizen} history={history} />
        </div>
      </div>
    </ScreenShell>
  );
};

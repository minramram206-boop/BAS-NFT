'use client';

import Link from 'next/link';
import React from 'react';
import type { CitizenRecord, StatKey } from '@bas/content';
import { MAX_STAT_SCORE } from '@bas/content';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { JourneyPanel } from '@/components/journey/JourneyPanel';
import { CitizenSwitcher, SwitcherLabel } from '@/components/citizen/CitizenSwitcher';
import { ScreenColumns, ScreenShell } from '@/components/layout/ScreenShell';
import { PanelTab } from '@/components/ui/PanelTab';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { auctionAction } from '@/components/market/AuctionCard';
import { AuctionDialog } from '@/components/market/AuctionDialog';
import { BuyDialog } from '@/components/market/BuyDialog';
import { SellDialog } from '@/components/market/SellDialog';
import { Ribbon } from '@/components/ui/Ribbon';
import { StatBar, StatSwatch } from '@/components/ui/StatBar';
import { CheckIcon, LockIcon, StarIcon } from '@/components/ui/icons';
import { STAT_COLORS, STAT_ORDER, TIER_SCORES } from '@/config/constants';
import { DISTRICT_ORDER, DISTRICT_RULES, bracketOf, highestStat, isDistrictOpen, unlockingStat } from '@/lib/data/districts';
import type { HistoryEntry } from '@/lib/data/types';
import { auctionStage, formatSolExact, timeLeftText } from '@/lib/data/market';
import { useNow } from '@/lib/utils/useNow';
import { districtName, formatTokens, lockedRule, statLabel, tierForScore } from '@/lib/format';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import { useBasStoreApi } from '@/stores/BasStoreProvider';
import {
  useCitizen,
  useCitizenReaction,
  useFoundingIds,
  useHistory,
  useIsOwned,
  useAuction,
  useListing,
  useMarket,
  useMissions,
  useSelectCitizen,
  useTrainingConfig,
  useWallet,
} from '@/stores/selectors';

const copy = MESSAGES.profile;

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

const Panel: React.FC<{ title: string; note?: string; icon?: string; children: React.ReactNode; className?: string }> = ({
  title,
  note,
  icon,
  children,
  className,
}) => (
  <section className={cn('bas-panel flex flex-col gap-2.5 p-3 md:p-4', className)}>
    <div className="flex items-center justify-between gap-2">
      <PanelTab icon={icon}>{title}</PanelTab>
      {note && <span className="text-[13px] text-[#33485c]">{note}</span>}
    </div>
    {children}
  </section>
);

const StatsPanel: React.FC<{ citizen: CitizenRecord }> = ({ citizen }) => (
  <Panel title={copy.statsTitle} note={copy.statsRule}>
    <div className="grid gap-2 md:grid-cols-3">
      {STAT_ORDER.map((stat) => {
        const score = citizen[stat];
        return (
          <div key={stat} className="flex flex-col gap-1.5 rounded-md p-2.5" style={{ backgroundColor: STAT_COLORS[stat].soft }}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-heading text-[14px]" style={{ color: STAT_COLORS[stat].fill }}>
                {MESSAGES.stats[stat].shortLabel}
              </span>
              <span className="font-heading text-lg">
                {score}
                <span className="text-[13px] text-[#33485c]">/{MAX_STAT_SCORE}</span>
              </span>
            </div>
            <StatBar stat={stat} value={score} size="lg" className="mb-1.5" />
            <span className="text-[13px] text-[#2b3d4f]">{formatMessage(copy.tier, { tier: tierForScore(score) })}</span>
          </div>
        );
      })}
    </div>
  </Panel>
);

const DistrictsPanel: React.FC<{ citizen: CitizenRecord }> = ({ citizen }) => (
  <Panel
    title={copy.districtsTitle}
    note={copy.districtsRule}
    icon="/icons/door_icon.png"
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
      earned: citizen[stat] >= TIER_SCORES[0],
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
      case 'sale':
        return {
          title: MESSAGES.history.sale,
          detail: formatMessage(MESSAGES.history.saleDetail, { price: formatSolExact(entry.priceLamports) }),
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
      <ol className="m-0 grid max-h-[420px] list-none content-start gap-1.5 overflow-y-auto p-0 pr-1 md:grid-cols-2">
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
/** Longest a one-off reaction runs; after it the portrait goes back to its idle hop. */
const REACTION_MS = 1700;
/** How long the mood label stays up. It does not depend on motion, so it also reaches people who turned animation off. */
const MOOD_MS = 3500;

/**
 * The citizen's portrait. It hops while idle and plays the animation the latest
 * reply asked for once, so the answer shows on the face the owner is looking at.
 * A short mood label goes with it, because motion alone is not seen by everyone.
 */
const Portrait: React.FC<{ citizen: CitizenRecord }> = ({ citizen }) => {
  const reaction = useCitizenReaction(citizen.id);
  const [playing, setPlaying] = React.useState<string | null>(null);
  const [mood, setMood] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!reaction) {
      setPlaying(null);
      setMood(null);
      return undefined;
    }
    setPlaying(reaction.animation === 'idle' ? null : reaction.animation);
    const label = MESSAGES.chat.moods[reaction.emotion];
    setMood(label === '' ? null : label);
    const motionTimer = window.setTimeout(() => setPlaying(null), REACTION_MS);
    const moodTimer = window.setTimeout(() => setMood(null), MOOD_MS);
    return () => {
      window.clearTimeout(motionTimer);
      window.clearTimeout(moodTimer);
    };
  }, [reaction]);

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <img
        key={playing ? reaction?.nonce : 'idle'}
        src={citizen.image}
        alt={citizen.name}
        width={240}
        height={240}
        className={cn('h-[78%] w-[78%] object-contain', playing ? `react-${playing}` : 'citizen-hop')}
        data-reaction={playing ?? undefined}
      />
      {playing === 'thinking' && (
        <span aria-hidden="true" className="absolute right-[12%] top-[8%] font-heading text-[18px] leading-none text-[#1a2734]">
          ...
        </span>
      )}
      <span
        role="status"
        data-mood={mood ?? undefined}
        className={cn(
          'absolute left-[6%] top-[6%] rounded-md border-2 border-[#1b2a38] bg-[#fff3c4] px-2 py-0.5 font-heading text-[12px] uppercase leading-none tracking-widest text-[#1b2a38]',
          mood ? '' : 'hidden',
        )}
      >
        {mood}
      </span>
    </div>
  );
};

export const ProfileScreen: React.FC<{ id: number }> = ({ id }) => {
  const citizen = useCitizen(id);
  const owned = useIsOwned(id);
  const history = useHistory(id);
  const founding = useFoundingIds();
  const wallet = useWallet();
  const select = useSelectCitizen();
  const api = useBasStoreApi();
  const listing = useListing(id);
  const auction = useAuction(id);
  const market = useMarket();
  const now = useNow();
  const [marketDialog, setMarketDialog] = React.useState<'buy' | 'sell' | 'auction' | null>(null);
  const closeMarketDialog = React.useCallback(() => setMarketDialog(null), []);
  /** Same button as the auction's market card, except that a live auction names the bid to beat. */
  const auctionButton = (current: NonNullable<typeof auction>): { label: string; primary: boolean } => {
    const stage = auctionStage(current, now);
    if (stage !== 'live') return auctionAction(stage, current.sellerIsMe, current.leading);
    if (current.sellerIsMe) return { label: MESSAGES.market.manage, primary: false };
    if (current.leading) return { label: MESSAGES.market.youLead, primary: false };
    return { label: formatMessage(MESSAGES.market.profileBid, { price: formatSolExact(current.minBidLamports) }), primary: true };
  };

  if (!citizen) {
    return (
      <ScreenShell title={copy.title}>
        <section className="bas-panel mx-auto flex max-w-md flex-col items-center gap-3 p-5 text-center">
          <p className="m-0 text-[17px] leading-snug">{copy.missing}</p>
          <Link href="/" className="bas-btn">
            {MESSAGES.app.back}
          </Link>
        </section>
      </ScreenShell>
    );
  }

  const bracket = bracketOf(citizen);

  const identity = (
    <section className="bas-panel flex flex-col gap-3 p-3 md:p-4">
      <div className="flex flex-col gap-1.5">
        <SwitcherLabel>{MESSAGES.city.myCitizens}</SwitcherLabel>
        <CitizenSwitcher label={MESSAGES.city.myCitizens} activeId={citizen.id} href={(next) => `/citizen/${next}`} />
      </div>
      <div className="bas-inset bas-grid-bg mx-auto flex aspect-square w-full max-w-[220px] items-center justify-center overflow-hidden">
        <Portrait citizen={citizen} />
      </div>
      <div className="flex flex-col items-center gap-1 text-center">
        <Ribbon>{citizen.name}</Ribbon>
        <span className="text-[13px] text-[#33485c]">{citizen.code}</span>
        <span className="text-[15px] text-[#2b3d4f]">
          {formatMessage(copy.bracket, {
            role: citizen.role,
            bracket: MESSAGES.season.bracketNames[bracket],
            score: highestStat(citizen),
          })}
        </span>
        <span className="text-[13px] text-[#33485c]">
          {owned
            ? formatMessage(copy.ownerYou, { address: wallet.label })
            : auction?.sellerIsMe
              ? copy.ownerAuction
              : copy.ownerOther}
        </span>
      </div>
      <p className="m-0 border-t-2 border-[#b9c9d8] pt-3 text-[15px] leading-snug text-[#2b3d4f]">{citizen.lore}</p>
      <div className={cn('grid gap-2', owned ? 'grid-cols-2' : 'grid-cols-1')}>
        <button
          type="button"
          className="bas-btn"
          onClick={() => {
            if (!owned) {
              api.getState().openModal(copy.talkTitle, copy.talkMessage);
              return;
            }
            document.getElementById('citizen-chat')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          {copy.talk}
        </button>
        {owned && (
          <Link href="/training" onClick={() => select(citizen.id)} className="bas-btn bas-btn-primary">
            {copy.train}
          </Link>
        )}
      </div>
      {market.open && (owned || listing || auction) && (
        <div className="flex flex-col gap-2 border-t-2 border-[#b9c9d8] pt-3">
          {listing && (
            <span className="text-center text-[15px] font-semibold text-[#1d6b34]">
              {formatMessage(MESSAGES.market.profileForSale, { price: formatSolExact(listing.priceLamports) })}
            </span>
          )}
          {auction && (
            <span className="text-center text-[15px] font-semibold text-[#1d6b34]">
              {now !== null && now >= auction.endsAt
                ? formatMessage(MESSAGES.market.profileAuctionEnded, {
                    price: formatSolExact(auction.highestBidLamports ?? auction.startPriceLamports),
                  })
                : formatMessage(MESSAGES.market.profileAuction, {
                    price: formatSolExact(auction.highestBidLamports ?? auction.startPriceLamports),
                    time: now === null ? '—' : timeLeftText(auction.endsAt - now),
                  })}
            </span>
          )}
          {auction ? (
            <button
              type="button"
              className={cn('bas-btn', auctionButton(auction).primary && 'bas-btn-primary')}
              onClick={() => setMarketDialog('auction')}
            >
              {auctionButton(auction).label}
            </button>
          ) : owned ? (
            <button type="button" className="bas-btn" onClick={() => setMarketDialog('sell')}>
              {listing ? MESSAGES.market.manage : MESSAGES.market.sell}
            </button>
          ) : (
            listing && (
              <button type="button" className="bas-btn bas-btn-primary" onClick={() => setMarketDialog('buy')}>
                {formatMessage(MESSAGES.market.profileBuy, { price: formatSolExact(listing.priceLamports) })}
              </button>
            )
          )}
        </div>
      )}
    </section>
  );

  return (
    <ScreenShell title={copy.title} subtitle={`${citizen.name} · ${citizen.code}`}>
      <ScreenColumns side={identity}>
        {owned && <ChatPanel citizen={citizen} />}
        {owned ? <JourneyPanel citizen={citizen} /> : <StatsPanel citizen={citizen} />}
        <div className="grid gap-3 md:gap-4 xl:grid-cols-2">
          <DistrictsPanel citizen={citizen} />
          <AchievementsPanel citizen={citizen} founding={founding.includes(citizen.id)} />
        </div>
        <HistoryPanel citizen={citizen} history={history} />
      </ScreenColumns>
      {marketDialog === 'sell' && owned && <SellDialog citizenId={citizen.id} onClose={closeMarketDialog} />}
      {marketDialog === 'buy' && !owned && <BuyDialog citizenId={citizen.id} onClose={closeMarketDialog} />}
      {marketDialog === 'auction' && <AuctionDialog citizenId={citizen.id} onClose={closeMarketDialog} />}
    </ScreenShell>
  );
};

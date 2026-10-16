'use client';

import Link from 'next/link';
import React from 'react';
import { bracketOf } from '@/lib/data/districts';
import type { MarketAuction } from '@/lib/data/types';
import { auctionStage, formatSolExact, timeLeftText, type AuctionStage } from '@/lib/data/market';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import { useCitizen, useMarket } from '@/stores/selectors';
import { StatTiles } from './CitizenLine';

const copy = MESSAGES.market;

export function bidCountText(count: number): string {
  if (count === 0) return copy.bidsNone;
  if (count === 1) return copy.bidsOne;
  return formatMessage(copy.bidsMany, { count });
}

/** `Ends in 3h 10m`, or `Ended`; empty until the clock is known. */
export function endsText(auction: MarketAuction, now: number | null): string {
  if (now === null) return '';
  return now >= auction.endsAt ? copy.ended : formatMessage(copy.endsIn, { time: timeLeftText(auction.endsAt - now) });
}

/** The card's button for each stage, and whether it is the one to press. */
export function auctionAction(stage: AuctionStage, mine: boolean, leading: boolean): { label: string; primary: boolean } {
  switch (stage) {
    case 'live':
      return { label: mine ? copy.manage : copy.bid, primary: !mine && !leading };
    case 'claim':
      return { label: copy.claim, primary: true };
    case 'collect':
      return { label: copy.collect, primary: true };
    case 'take-back':
      return { label: copy.takeBack, primary: true };
    case 'refund':
      return { label: copy.takeBidBack, primary: true };
    case 'close':
      return { label: copy.endAuction, primary: false };
    case 'waiting':
      return { label: copy.details, primary: false };
  }
}

/** One citizen up for auction: who it is, the bid to beat, the time left and the way to act on it. */
export const AuctionCard: React.FC<{
  auction: MarketAuction;
  now: number | null;
  onOpen: (citizenId: number) => void;
}> = ({ auction, now, onOpen }) => {
  const citizen = useCitizen(auction.citizenId);
  const { extensionSeconds } = useMarket().auctionClock;
  if (!citizen) return null;

  const ended = now !== null && now >= auction.endsAt;
  const closing = !ended && now !== null && auction.endsAt - now < extensionSeconds;
  const mine = auction.sellerIsMe;
  const stage = auctionStage(auction, now);
  const action = auctionAction(stage, mine, auction.leading);

  return (
    <li className="bas-panel flex min-w-0 flex-col gap-2 p-2.5">
      <Link
        href={`/citizen/${citizen.id}`}
        aria-label={formatMessage(MESSAGES.a11y.openProfile, { name: citizen.name })}
        className="flex flex-col gap-2 text-inherit no-underline"
      >
        <div className="bas-inset bas-grid-bg relative flex aspect-[2/1] w-full items-center justify-center overflow-hidden">
          <img src={citizen.image} alt="" width={160} height={160} className="h-[88%] w-auto object-contain" />
          {auction.leading && (
            <span className="absolute left-2 top-2 rounded border-2 border-[#1b2a38] bg-[#7ed38f] px-1.5 py-0.5 font-heading text-[10px]">
              {stage === 'claim' ? copy.youWon : copy.youLead}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="truncate font-heading text-[15px]">{citizen.name}</span>
          <span className="text-[14px] text-[#33485c]">
            {citizen.code} · {citizen.role} · {MESSAGES.season.bracketNames[bracketOf(citizen)]}
          </span>
        </div>
      </Link>

      <StatTiles citizen={citizen} compact />

      <div className="flex items-baseline justify-between gap-2 border-t-2 border-[#b9c9d8] pt-1.5">
        <span className="text-[14px] text-[#33485c]">{auction.highestBidLamports === null ? copy.startingBid : copy.currentBid}</span>
        <span className="font-heading text-[18px]">{formatSolExact(auction.highestBidLamports ?? auction.startPriceLamports)}</span>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px] text-[#5b6b7a]">
        <span className="whitespace-nowrap">
          {bidCountText(auction.bidCount)}
          {endsText(auction, now) !== '' && (
            <>
              {' · '}
              <span className={cn(closing && 'font-semibold text-[#9a2b2b]')}>{endsText(auction, now)}</span>
            </>
          )}
        </span>
        <span className="min-w-0 truncate">{mine ? copy.yourAuction : formatMessage(copy.seller, { seller: auction.seller })}</span>
      </div>
      {!auction.deliverable && <span className="text-[13px] font-semibold text-[#9a2b2b]">{copy.stopped}</span>}
      {stage === 'waiting' && auction.deliverable && (
        <span className="text-[13px] font-semibold text-[#33485c]">{auction.bidCount > 0 ? copy.waitingWinner : copy.waitingNoBids}</span>
      )}

      <button type="button" className={cn('bas-btn min-h-10', action.primary && 'bas-btn-primary')} onClick={() => onOpen(citizen.id)}>
        {action.label}
      </button>
    </li>
  );
};

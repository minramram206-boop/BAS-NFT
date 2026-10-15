'use client';

import React from 'react';
import type { MarketAuction, MarketBid } from '@/lib/data/types';
import { bidFeed, formatSolExact, timeAgoText } from '@/lib/data/market';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import { useCitizens } from '@/stores/selectors';

const copy = MESSAGES.market;

/** Rows in the feed beside the auctions; older bids are counted, not drawn. */
const FEED_LIMIT = 20;

const StatusTag: React.FC<{ leading: boolean }> = ({ leading }) => (
  <span
    className={cn(
      'shrink-0 rounded border-2 border-[#1b2a38] px-1.5 py-0.5 font-heading text-[9px] leading-none',
      leading ? 'bg-[#7ed38f]' : 'bg-[#c5d5e5] text-[#33485c]',
    )}
  >
    {leading ? copy.historyLeading : copy.historyOutbid}
  </span>
);

/** Who placed a bid and how long ago: `You · 4m ago`, `Kx3p…9Qe · 2h ago`. */
const BidderLine: React.FC<{ bid: MarketBid; now: number | null }> = ({ bid, now }) => (
  <span className="truncate text-[13px] text-[#5b6b7a]">
    <span className={cn(bid.mine && 'font-semibold text-[#1d6b34]')}>{bid.mine ? copy.historyYou : bid.bidder}</span>
    {now !== null && ` · ${timeAgoText(bid.at, now)}`}
  </span>
);

/**
 * Every bid on the auctions shown, newest first, beside the auction cards.
 * A row opens its auction.
 */
export const BidHistoryPanel: React.FC<{
  auctions: readonly MarketAuction[];
  filtered: boolean;
  now: number | null;
  onOpen: (citizenId: number) => void;
}> = ({ auctions, filtered, now, onOpen }) => {
  const citizens = useCitizens();
  const total = auctions.reduce((sum, auction) => sum + auction.bids.length, 0);
  const feed = bidFeed(auctions, FEED_LIMIT);

  return (
    <aside className="bas-panel flex min-w-0 flex-col gap-2.5 self-start p-3 xl:sticky xl:top-3">
      <div className="flex items-baseline justify-between gap-2 border-b-2 border-[#b9c9d8] pb-2">
        <span className="bas-label">{copy.historyTab}</span>
        {total > 0 && <span className="font-heading text-[11px] text-[#5b6b7a]">{total}</span>}
      </div>
      {feed.length === 0 ? (
        <p className="m-0 text-[14px] leading-snug text-[#33485c]">{filtered ? copy.historyNoneFilter : copy.historyNone}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 xl:max-h-[560px] xl:overflow-y-auto">
          {feed.map(({ citizenId, bid, leading }, index) => {
            const citizen = citizens.find((item) => item.id === citizenId);
            return (
              <li key={`${citizenId}-${bid.at ?? 'new'}-${index}`}>
                <button
                  type="button"
                  onClick={() => onOpen(citizenId)}
                  className="bas-chip flex w-full items-center gap-2 rounded-md border-2 border-transparent bg-[#f2f6fa] p-2 text-left text-inherit hover:border-[#8ba5ba] focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#f7d23d]"
                >
                  {citizen && <img src={citizen.sprite} alt="" width={32} height={32} className="h-8 w-8 shrink-0" />}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px] font-semibold leading-tight">{citizen?.name ?? `#${citizenId}`}</span>
                    <BidderLine bid={bid} now={now} />
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-heading text-[13px]">{formatSolExact(bid.amountLamports)}</span>
                    <StatusTag leading={leading} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {total > feed.length && (
        <p className="m-0 text-[13px] text-[#5b6b7a]">{formatMessage(copy.historyOlder, { count: total - feed.length })}</p>
      )}
    </aside>
  );
};

/** The bids of one auction, newest first, inside its dialog. */
export const AuctionBids: React.FC<{ bids: readonly MarketBid[]; now: number | null }> = ({ bids, now }) => {
  if (bids.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="bas-label">{copy.historyTab}</span>
      <ul className="bas-inset m-0 flex max-h-44 list-none flex-col overflow-y-auto px-3 py-1">
        {bids.map((bid, index) => (
          <li
            key={`${bid.at ?? 'new'}-${index}`}
            className="flex items-center gap-2 border-b border-dashed border-[#b9c9d8] py-1.5 last:border-b-0"
          >
            <span className="flex min-w-0 flex-1">
              <BidderLine bid={bid} now={now} />
            </span>
            <span className="shrink-0 font-heading text-[13px]">{formatSolExact(bid.amountLamports)}</span>
            <StatusTag leading={index === 0} />
          </li>
        ))}
      </ul>
    </div>
  );
};

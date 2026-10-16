'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import type { MarketSale } from '@/lib/data/types';
import { formatSolExact, timeAgoText } from '@/lib/data/market';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import { useCitizen } from '@/stores/selectors';
import { AuctionBids } from './BidHistory';

const copy = MESSAGES.market;

/** One side of a sale: its short address, or "you" in green. */
const Party: React.FC<{ address: string; me: boolean }> = ({ address, me }) => (
  <span className={cn(me && 'font-semibold text-[#1d6b34]')}>{me ? copy.saleYou : address}</span>
);

/** Splits a message around its `{party}` slot so the address can be styled. */
function around(message: string, slot: string): [string, string] {
  const [before = '', after = ''] = message.split(`{${slot}}`);
  return [before, after];
}

const SoldRow: React.FC<{ sale: MarketSale; now: number | null }> = ({ sale, now }) => {
  const citizen = useCitizen(sale.citizenId);
  const [open, setOpen] = useState(false);
  if (!citizen) return null;
  const auction = sale.kind === 'auction';
  const [soldBy, soldByAfter] = around(copy.saleSeller, 'seller');
  const [soldTo, soldToAfter] = around(copy.saleBuyer, 'buyer');

  return (
    <li className="bas-panel flex min-w-0 flex-col gap-2 p-2.5">
      <div className="flex items-center gap-3">
        <Link
          href={`/citizen/${citizen.id}`}
          aria-label={formatMessage(MESSAGES.a11y.openProfile, { name: citizen.name })}
          className="bas-inset bas-grid-bg flex h-14 w-14 shrink-0 items-center justify-center"
        >
          <img src={citizen.sprite} alt="" width={48} height={48} className="h-12 w-12" />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-heading text-[14px]">{citizen.name}</span>
            <span
              className={cn(
                'shrink-0 rounded border-2 border-[#1b2a38] px-1.5 py-0.5 font-heading text-[9px] leading-none',
                auction ? 'bg-[#f7d23d]' : 'bg-[#c5d5e5]',
              )}
            >
              {auction ? copy.saleAuction : copy.saleFixed}
            </span>
          </div>
          <span className="truncate text-[13px] text-[#33485c]">
            {citizen.code} · {citizen.role}
          </span>
          <span className="text-[13px] leading-snug text-[#5b6b7a]">
            {soldBy}
            <Party address={sale.seller} me={sale.sellerIsMe} />
            {soldByAfter} {soldTo}
            <Party address={sale.buyer} me={sale.buyerIsMe} />
            {soldToAfter}
            {now !== null && ` · ${timeAgoText(sale.at, now)}`}
          </span>
        </div>
        <span className="shrink-0 font-heading text-[16px]">{formatSolExact(sale.priceLamports)}</span>
      </div>
      {auction && sale.bids.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="bas-btn min-h-9 self-start px-2.5 text-[11px]"
          >
            {open ? copy.hideBids : sale.bids.length === 1 ? copy.showBid : formatMessage(copy.showBids, { count: sale.bids.length })}
          </button>
          {open && <AuctionBids bids={sale.bids} now={now} ended />}
        </>
      )}
    </li>
  );
};

/** Finished sales and auctions, newest first; an auction's bids open under it. */
export const SoldList: React.FC<{ sales: readonly MarketSale[]; total: number; now: number | null }> = ({ sales, total, now }) =>
  sales.length === 0 ? (
    <p className="m-0 rounded-md bg-[#f2f6fa] p-3 text-[15px]">{total === 0 ? copy.emptySold : copy.emptySoldFilter}</p>
  ) : (
    <ul className="m-0 grid list-none items-start gap-3 p-0 xl:grid-cols-2">
      {sales.map((sale) => (
        <SoldRow key={sale.id} sale={sale} now={now} />
      ))}
    </ul>
  );

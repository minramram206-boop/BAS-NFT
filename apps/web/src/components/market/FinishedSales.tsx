'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { ReceiptRow } from '@/components/ui/ReceiptRow';
import type { MarketSale } from '@/lib/data/types';
import { formatSolExact, timeAgoText } from '@/lib/data/market';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import { useCitizen } from '@/stores/selectors';
import { bidCountText } from './AuctionCard';
import { AuctionBids } from './BidHistory';

const copy = MESSAGES.market;

type Part = 'auction' | 'fixed';

/** An address in a receipt row, or "You" in green for the wallet. */
const Party: React.FC<{ address: string; me: boolean }> = ({ address, me }) => (
  <span className={cn(me && 'text-[#1d6b34]')}>{me ? copy.saleYou : address}</span>
);

/**
 * One finished sale, laid out like the market's receipts: who it is and when
 * at the top, then the winner or buyer, the seller and the price, and for an
 * auction its bids under a button. A citizen back on the market says so, so
 * an old result is not taken for the one running now.
 */
const FinishedRow: React.FC<{ sale: MarketSale; now: number | null; again: 'auction' | 'listed' | null }> = ({ sale, now, again }) => {
  const citizen = useCitizen(sale.citizenId);
  const [open, setOpen] = useState(false);
  if (!citizen) return null;
  const auction = sale.kind === 'auction';

  return (
    <li className="bas-panel flex min-w-0 flex-col gap-2.5 p-3">
      <div className="flex items-center gap-3">
        <Link
          href={`/citizen/${citizen.id}`}
          aria-label={formatMessage(MESSAGES.a11y.openProfile, { name: citizen.name })}
          className="bas-inset bas-grid-bg flex h-12 w-12 shrink-0 items-center justify-center"
        >
          <img src={citizen.sprite} alt="" width={40} height={40} className="h-10 w-10" />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-heading text-[15px]">{citizen.name}</span>
          <span className="truncate text-[13px] text-[#33485c]">
            {citizen.code} · {citizen.role}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {now !== null && <span className="text-[13px] text-[#5b6b7a]">{timeAgoText(sale.at, now)}</span>}
          {again && (
            <span className="rounded border-2 border-[#1b2a38] bg-[#c5d5e5] px-1.5 py-0.5 font-heading text-[9px] leading-none text-[#33485c]">
              {again === 'auction' ? copy.againAuction : copy.againListed}
            </span>
          )}
        </div>
      </div>

      <div className="bas-inset flex flex-col px-3 py-1">
        <ReceiptRow label={auction ? copy.rowWinner : copy.rowBuyer} value={<Party address={sale.buyer} me={sale.buyerIsMe} />} />
        <ReceiptRow label={copy.rowSeller} value={<Party address={sale.seller} me={sale.sellerIsMe} />} />
        {auction && <ReceiptRow label={copy.rowBids} value={bidCountText(sale.bids.length)} />}
        <ReceiptRow label={auction ? copy.rowFinalPrice : copy.rowPrice} value={formatSolExact(sale.priceLamports)} strong />
      </div>

      {auction && sale.bids.length > 0 && (
        <>
          <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="bas-btn min-h-9 text-[11px]">
            {open ? copy.hideBids : sale.bids.length === 1 ? copy.showBid : formatMessage(copy.showBids, { count: sale.bids.length })}
          </button>
          {open && <AuctionBids bids={sale.bids} now={now} ended />}
        </>
      )}
    </li>
  );
};

/**
 * What has finished in the market, in two parts that are never mixed:
 * auction results and fixed-price sales, each newest first.
 */
export const FinishedSales: React.FC<{
  sales: readonly MarketSale[];
  /** Before the role filter, to tell an empty market from an empty filter. */
  all: readonly MarketSale[];
  now: number | null;
  /** Citizens on the market again, by what they are in now. */
  againOf: (citizenId: number) => 'auction' | 'listed' | null;
}> = ({ sales, all, now, againOf }) => {
  const [part, setPart] = useState<Part>('auction');
  const shown = sales.filter((sale) => sale.kind === part);
  const total = all.filter((sale) => sale.kind === part).length;
  const parts: readonly { key: Part; label: string; count: number }[] = [
    { key: 'auction', label: copy.resultsTab, count: sales.filter((sale) => sale.kind === 'auction').length },
    { key: 'fixed', label: copy.fixedSalesTab, count: sales.filter((sale) => sale.kind === 'fixed').length },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={copy.finishedTab} className="flex flex-wrap gap-1.5 border-b-2 border-[#b9c9d8] pb-3">
        {parts.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={part === item.key}
            onClick={() => setPart(item.key)}
            className={cn(
              'bas-chip h-9 rounded-md border-2 border-[#1b2a38] px-2.5 font-heading text-[11px]',
              part === item.key ? 'bg-[#1b2a38] text-[#f2f6fa]' : 'bg-[#f2f6fa]',
            )}
          >
            {item.label} · {item.count}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="m-0 rounded-md bg-[#f2f6fa] p-3 text-[15px]">
          {total > 0 ? copy.emptyFinishedFilter : part === 'auction' ? copy.emptyResults : copy.emptyFixedSales}
        </p>
      ) : (
        <ul className="m-0 grid list-none items-start gap-3 p-0 xl:grid-cols-2">
          {shown.map((sale) => (
            <FinishedRow key={sale.id} sale={sale} now={now} again={againOf(sale.citizenId)} />
          ))}
        </ul>
      )}
    </div>
  );
};

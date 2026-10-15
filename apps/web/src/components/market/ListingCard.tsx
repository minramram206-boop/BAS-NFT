'use client';

import Link from 'next/link';
import React from 'react';
import { bracketOf } from '@/lib/data/districts';
import type { MarketListing } from '@/lib/data/types';
import { formatSolExact } from '@/lib/data/market';
import { MESSAGES, formatMessage } from '@/messages';
import { useCitizen } from '@/stores/selectors';
import { StatTiles } from './CitizenLine';

const copy = MESSAGES.market;

/** One citizen for sale: who it is, how it stands, the asking price and the way to act on it. */
export const ListingCard: React.FC<{
  listing: MarketListing;
  mine: boolean;
  onBuy: (citizenId: number) => void;
  onManage: (citizenId: number) => void;
}> = ({ listing, mine, onBuy, onManage }) => {
  const citizen = useCitizen(listing.citizenId);
  if (!citizen) return null;

  return (
    <li className="bas-panel flex min-w-0 flex-col gap-2 p-2.5">
      <Link
        href={`/citizen/${citizen.id}`}
        aria-label={formatMessage(MESSAGES.a11y.openProfile, { name: citizen.name })}
        className="flex flex-col gap-2 text-inherit no-underline"
      >
        <div className="bas-inset bas-grid-bg flex aspect-[2/1] w-full items-center justify-center overflow-hidden">
          <img src={citizen.image} alt="" width={160} height={160} className="h-[88%] w-auto object-contain" />
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
        <span className="text-[14px] text-[#33485c]">{copy.price}</span>
        <span className="font-heading text-[18px]">{formatSolExact(listing.priceLamports)}</span>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px] text-[#5b6b7a]">
        <span className="min-w-0 truncate">{mine ? copy.yours : formatMessage(copy.seller, { seller: listing.seller })}</span>
        <span className="whitespace-nowrap">{formatMessage(copy.listedDay, { day: listing.listedDay })}</span>
      </div>

      {mine ? (
        <button type="button" className="bas-btn min-h-10" onClick={() => onManage(citizen.id)}>
          {copy.manage}
        </button>
      ) : (
        <button type="button" className="bas-btn bas-btn-primary min-h-10" onClick={() => onBuy(citizen.id)}>
          {copy.buy}
        </button>
      )}
    </li>
  );
};

'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import type { CitizenRecord } from '@bas/content';
import { ReceiptRow } from '@/components/ui/ReceiptRow';
import { bestOffer, formatSolExact, offerExpired, offersOn, timeAgoText, timeLeftText } from '@/lib/data/market';
import type { MarketListing, MarketOffer } from '@/lib/data/types';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import { OfferTag, offerCountText } from './OffersDialog';

const copy = MESSAGES.market;

type Part = 'received' | 'made';

/** Who an offer card is about, with a way to its profile, and when the offer last moved. */
const CardHead: React.FC<{ citizen: CitizenRecord; at: number; now: number | null; tag?: React.ReactNode }> = ({ citizen, at, now, tag }) => (
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
      {now !== null && <span className="text-[13px] text-[#5b6b7a]">{timeAgoText(at, now)}</span>}
      {tag}
    </div>
  </div>
);

const openFor = (offer: MarketOffer, now: number | null): string =>
  now === null ? '—' : offerExpired(offer, now) ? copy.offerExpired : timeLeftText(offer.expiresAt - now);

/**
 * The offers that concern the wallet, in two parts that are never mixed:
 * those made on its citizens, one card per citizen with the best offer and a
 * way to review them all, and those it made itself, with a way to change them.
 */
export const OffersPanel: React.FC<{
  offers: readonly MarketOffer[];
  citizens: readonly CitizenRecord[];
  listings: readonly MarketListing[];
  /** The wallet's citizens, those it has at auction included. */
  mine: readonly number[];
  /** True when the role filter hides some citizens, to tell an empty part from an empty filter. */
  filtered: boolean;
  now: number | null;
  onReview: (citizenId: number) => void;
  onChange: (citizenId: number) => void;
}> = ({ offers, citizens, listings, mine, filtered, now, onReview, onChange }) => {
  const [part, setPart] = useState<Part>('received');
  const shownCitizens = (ids: readonly number[]) => citizens.filter((citizen) => ids.includes(citizen.id));
  const received = shownCitizens([...new Set(offers.filter((offer) => mine.includes(offer.citizenId)).map((offer) => offer.citizenId))]);
  const made = offers.filter((offer) => offer.mine && citizens.some((citizen) => citizen.id === offer.citizenId));
  const parts: readonly { key: Part; label: string; count: number }[] = [
    { key: 'received', label: copy.offersReceived, count: received.length },
    { key: 'made', label: copy.offersMade, count: made.length },
  ];
  const empty = part === 'received' ? received.length === 0 : made.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={copy.offersTab} className="flex flex-wrap gap-1.5 border-b-2 border-[#b9c9d8] pb-3">
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

      {empty ? (
        <p className="m-0 rounded-md bg-[#f2f6fa] p-3 text-[15px]">
          {filtered ? copy.offersEmptyFilter : part === 'received' ? copy.offersEmptyReceived : copy.offersEmptyMade}
        </p>
      ) : part === 'received' ? (
        <ul className="m-0 grid list-none items-start gap-3 p-0 xl:grid-cols-2">
          {received.map((citizen) => {
            const list = offersOn(offers, citizen.id, now);
            const best = bestOffer(offers, citizen.id, now);
            const newest = Math.max(...list.map((offer) => offer.madeAt));
            return (
              <li key={citizen.id} className="bas-panel flex min-w-0 flex-col gap-2.5 p-3">
                <CardHead citizen={citizen} at={newest} now={now} />
                <div className="bas-inset flex flex-col px-3 py-1">
                  <ReceiptRow label={copy.rowOffers} value={offerCountText(list, now)} />
                  {best ? (
                    <>
                      <ReceiptRow label={copy.rowFrom} value={best.buyer} />
                      <ReceiptRow label={copy.rowBestOffer} value={formatSolExact(best.amountLamports)} strong />
                    </>
                  ) : (
                    // Only expired offers: nothing to accept, and each buyer takes the SOL back.
                    <ReceiptRow label={copy.rowBestOffer} value={copy.offersNoneOpen} />
                  )}
                </div>
                <button type="button" className="bas-btn bas-btn-primary min-h-10" onClick={() => onReview(citizen.id)}>
                  {copy.reviewOffers}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="m-0 grid list-none items-start gap-3 p-0 xl:grid-cols-2">
          {made.map((offer) => {
            const citizen = citizens.find((item) => item.id === offer.citizenId) as CitizenRecord;
            const listing = listings.find((item) => item.citizenId === offer.citizenId);
            const best = bestOffer(offers, offer.citizenId, now);
            const expired = offerExpired(offer, now);
            return (
              <li key={offer.id} className="bas-panel flex min-w-0 flex-col gap-2.5 p-3">
                <CardHead
                  citizen={citizen}
                  at={offer.madeAt}
                  now={now}
                  tag={
                    expired ? (
                      <OfferTag tone="expired">{copy.offerExpiredLabel}</OfferTag>
                    ) : best?.id === offer.id ? (
                      <OfferTag tone="best">{copy.offerBestLabel}</OfferTag>
                    ) : undefined
                  }
                />
                <div className="bas-inset flex flex-col px-3 py-1">
                  <ReceiptRow label={copy.rowYourOffer} value={formatSolExact(offer.amountLamports)} strong />
                  <ReceiptRow label={copy.rowBestOffer} value={best ? formatSolExact(best.amountLamports) : '—'} />
                  {listing && <ReceiptRow label={copy.rowListedPrice} value={formatSolExact(listing.priceLamports)} />}
                  <ReceiptRow label={copy.rowExpires} value={openFor(offer, now)} />
                </div>
                <button type="button" className="bas-btn min-h-10" onClick={() => onChange(offer.citizenId)}>
                  {copy.changeOffer}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

'use client';

import React, { useState } from 'react';
import { ReceiptRow } from '@/components/ui/ReceiptRow';
import { formatSolExact, offerExpired, offersOn, splitSale, timeAgoText, timeLeftText } from '@/lib/data/market';
import type { MarketOffer } from '@/lib/data/types';
import { cn } from '@/lib/utils/cn';
import { useNow } from '@/lib/utils/useNow';
import { MESSAGES, formatMessage } from '@/messages';
import { useAcceptOffer, useAuction, useBusy, useCitizen, useDataMode, useIsOwned, useMarket, useSimulateOffer } from '@/stores/selectors';
import { CitizenLine, StatTiles } from './CitizenLine';
import { Note } from './DialogParts';
import { MarketDialog } from './MarketDialog';

const copy = MESSAGES.market;

/** When an offer was made and how long it stays open, or that it has run out. */
export function offerTimeText(offer: MarketOffer, now: number | null): string {
  if (now === null) return '';
  const made = timeAgoText(offer.madeAt, now);
  return offerExpired(offer, now) ? `${made} · ${copy.offerExpired}` : `${made} · ${formatMessage(copy.offerExpiresIn, { time: timeLeftText(offer.expiresAt - now) })}`;
}

/** `2 offers · 1 expired`: those the owner can still accept, then those that ran out. */
export function offerCountText(offers: readonly MarketOffer[], now: number | null): string {
  const expired = offers.filter((offer) => offerExpired(offer, now)).length;
  const open = offers.length - expired;
  if (open === 0) return expired === 1 ? copy.offersExpiredOne : formatMessage(copy.offersExpiredOnly, { count: expired });
  const openText = open === 1 ? copy.offersOne : formatMessage(copy.offersCount, { count: open });
  return expired === 0 ? openText : `${openText} · ${formatMessage(copy.offersExpiredCount, { count: expired })}`;
}

/** The line under a citizen with offers: `2 offers · best 0.30 SOL · 1 expired`. `offers` is one citizen's, as `offersOn` sorts them. */
export function offersLineText(offers: readonly MarketOffer[], now: number | null): string {
  const best = offers.find((offer) => !offerExpired(offer, now));
  const expired = offers.filter((offer) => offerExpired(offer, now)).length;
  if (!best) return offerCountText(offers, now);
  const open = offers.length - expired;
  const line = formatMessage(copy.offerLine, {
    count: open === 1 ? copy.offersOne : formatMessage(copy.offersCount, { count: open }),
    price: formatSolExact(best.amountLamports),
  });
  return expired === 0 ? line : `${line} · ${formatMessage(copy.offersExpiredCount, { count: expired })}`;
}

/** A small label on an offer row: the best one, the wallet's own, or one that ran out. */
export const OfferTag: React.FC<{ tone: 'best' | 'you' | 'expired'; children: React.ReactNode }> = ({ tone, children }) => (
  <span
    className={cn(
      'rounded border-2 border-[#1b2a38] px-1.5 py-0.5 font-heading text-[9px] leading-none',
      tone === 'best' && 'bg-[#7ed38f]',
      tone === 'you' && 'bg-[#f7d23d]',
      tone === 'expired' && 'bg-[#c5d5e5] text-[#5b6b7a]',
    )}
  >
    {children}
  </span>
);

/**
 * The offers on one of the wallet's citizens, the highest first. The owner
 * picks one and confirms it: the citizen goes to that buyer and the owner is
 * paid in the same step. An offer past its time can no longer be accepted.
 */
export const OffersDialog: React.FC<{ citizenId: number; onClose: () => void }> = ({ citizenId, onClose }) => {
  const citizen = useCitizen(citizenId);
  const market = useMarket();
  const auction = useAuction(citizenId);
  const owned = useIsOwned(citizenId);
  const mode = useDataMode();
  const busy = useBusy();
  const now = useNow();
  const accept = useAcceptOffer();
  const simulateOffer = useSimulateOffer();
  const [picked, setPicked] = useState<string | null>(null);
  if (!citizen) return null;

  const offers = offersOn(market.offers, citizenId, now);
  const open = offers.filter((offer) => !offerExpired(offer, now));
  const chosen = offers.find((offer) => offer.id === picked && !offerExpired(offer, now) && !offer.mine);
  // The market holds a citizen at auction, so nobody can sell it another way until the auction is over.
  const acceptable = owned && !auction;
  const split = chosen ? splitSale(chosen.amountLamports, market.royaltyBps) : null;

  return (
    <MarketDialog title={formatMessage(copy.offersTitle, { name: citizen.name.toUpperCase() })} onClose={onClose}>
      <CitizenLine citizen={citizen} />
      <StatTiles citizen={citizen} />

      {offers.length === 0 ? (
        <p className="m-0 rounded-md bg-[#f2f6fa] p-3 text-[15px]">{formatMessage(copy.offersNone, { name: citizen.name })}</p>
      ) : (
        <ul className="bas-inset m-0 flex list-none flex-col p-0">
          {offers.map((offer) => {
            const expired = offerExpired(offer, now);
            const selected = offer.id === chosen?.id;
            return (
              <li
                key={offer.id}
                className={cn(
                  'flex items-center gap-2 border-b-2 border-dashed border-[#b9c9d8] px-3 py-2 last:border-b-0',
                  selected && 'bg-[#fff3c4]',
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={cn('font-heading text-[15px]', expired && 'text-[#5b6b7a] line-through')}>
                      {formatSolExact(offer.amountLamports)}
                    </span>
                    {offer.id === open[0]?.id && <OfferTag tone="best">{copy.offerBestLabel}</OfferTag>}
                    {expired && <OfferTag tone="expired">{copy.offerExpiredLabel}</OfferTag>}
                  </span>
                  <span className="truncate text-[13px] text-[#5b6b7a]">
                    {offer.buyer} · {offerTimeText(offer, now)}
                  </span>
                </span>
                {acceptable && !expired && !offer.mine && (
                  <button
                    type="button"
                    aria-pressed={selected}
                    className={cn('bas-btn min-h-9 shrink-0 px-3 text-[11px]', selected && 'bas-btn-primary')}
                    onClick={() => setPicked(selected ? null : offer.id)}
                  >
                    {copy.acceptOffer}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {auction?.sellerIsMe && <Note>{formatMessage(copy.acceptNoteAuction, { name: citizen.name })}</Note>}

      {chosen && split && (
        <>
          <div className="bas-inset flex flex-col px-3 py-1">
            <ReceiptRow label={copy.rowOffer} value={formatSolExact(chosen.amountLamports)} />
            <ReceiptRow label={formatMessage(copy.rowRoyalty, { percent: `${market.royaltyBps / 100}%` })} value={formatSolExact(split.royaltyLamports)} />
            <ReceiptRow label={copy.rowReceive} value={formatSolExact(split.proceedsLamports)} strong />
          </div>
          <Note>{formatMessage(copy.acceptNote, { name: citizen.name, buyer: chosen.buyer })}</Note>
        </>
      )}
      {mode === 'mock' && <p className="m-0 text-[13px] leading-snug text-[#5b6b7a]">{copy.mockNote}</p>}

      <div className="grid gap-2">
        {chosen && (
          <button
            type="button"
            className="bas-btn bas-btn-primary min-h-12"
            disabled={busy}
            onClick={() =>
              void accept(citizenId, chosen.id).then((ok) => {
                if (ok) onClose();
              })
            }
          >
            {busy ? copy.working : copy.confirmAccept}
          </button>
        )}
        {mode === 'mock' && owned && (
          <button type="button" className="bas-btn" disabled={busy} onClick={() => void simulateOffer(citizenId)}>
            {copy.previewOffer}
          </button>
        )}
        <button type="button" className="bas-btn" onClick={onClose}>
          {copy.back}
        </button>
      </div>
    </MarketDialog>
  );
};

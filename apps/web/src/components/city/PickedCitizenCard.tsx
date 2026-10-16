'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { CitizenStats } from '@/components/citizen/CitizenStats';
import { OfferDialog } from '@/components/market/OfferDialog';
import { formatSolExact, myOffer } from '@/lib/data/market';
import { MESSAGES, formatMessage } from '@/messages';
import { useAuction, useCitizen, useListing, useMarket, usePickFromCity } from '@/stores/selectors';

const copy = MESSAGES.city;

/** Where the citizen stands in the market, in the words the market screen uses. */
function marketLine(listing: ReturnType<typeof useListing>, auction: ReturnType<typeof useAuction>): string {
  if (listing) return formatMessage(MESSAGES.market.listedFor, { price: formatSolExact(listing.priceLamports) });
  if (auction) {
    return auction.highestBidLamports === null
      ? formatMessage(MESSAGES.market.inAuctionFrom, { price: formatSolExact(auction.startPriceLamports) })
      : formatMessage(MESSAGES.market.inAuction, { price: formatSolExact(auction.highestBidLamports) });
  }
  return MESSAGES.market.notListed;
}

/**
 * A citizen of another player, tapped in the city by a wallet that has none
 * of its own yet: who it is, whether it is for sale, and a way to make an
 * offer without minting first.
 */
export const PickedCitizenCard: React.FC<{ citizenId: number }> = ({ citizenId }) => {
  const citizen = useCitizen(citizenId);
  const market = useMarket();
  const listing = useListing(citizenId);
  const auction = useAuction(citizenId);
  const pick = usePickFromCity();
  const [offering, setOffering] = useState(false);
  if (!citizen) return null;

  // An auctioned citizen is bought by bidding, from the market screen.
  const canOffer = market.offersOpen && !auction;
  const mine = myOffer(market.offers, citizenId);

  return (
    <section aria-label={copy.picked} className="bas-panel pointer-events-auto flex w-full flex-col gap-3 p-3 md:p-4">
      <div className="flex gap-3">
        <div className="bas-inset bas-grid-bg flex h-[72px] w-[72px] shrink-0 items-center justify-center">
          <img src={citizen.sprite} alt={citizen.name} width={64} height={64} className="h-16 w-16" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[13px] font-medium text-[#33485c]">
            {citizen.code} · {citizen.role}
          </span>
          <span className="truncate font-heading text-[18px] tracking-wide">{citizen.name.toUpperCase()}</span>
          <span className="text-[14px] font-medium leading-snug text-[#22354a]">{marketLine(listing, auction)}</span>
        </div>
        <button
          type="button"
          aria-label={copy.pickedClose}
          onClick={() => pick(null)}
          className="bas-btn h-9 w-9 min-h-0 shrink-0 self-start px-0 text-[14px]"
        >
          ×
        </button>
      </div>

      <CitizenStats citizen={citizen} compact />

      <p className="m-0 text-[14px] leading-snug text-[#33485c]">
        {canOffer ? formatMessage(copy.pickedOfferNote, { name: citizen.name }) : copy.notYours}
      </p>

      <div className="grid grid-cols-2 gap-2 md:[&_.bas-btn]:min-h-10">
        <Link href={`/citizen/${citizen.id}`} className="bas-btn">
          {copy.profile}
        </Link>
        {canOffer ? (
          <button type="button" className="bas-btn bas-btn-primary" onClick={() => setOffering(true)}>
            {mine ? MESSAGES.market.changeOffer : MESSAGES.market.makeOffer}
          </button>
        ) : (
          <Link href="/market" className="bas-btn bas-btn-primary">
            {copy.pickedMarket}
          </Link>
        )}
      </div>

      {offering && <OfferDialog citizenId={citizen.id} onClose={() => setOffering(false)} />}
    </section>
  );
};

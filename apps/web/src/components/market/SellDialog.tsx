'use client';

import React, { useState } from 'react';
import { ReceiptRow } from '@/components/ui/ReceiptRow';
import { cn } from '@/lib/utils/cn';
import { AUCTION_CLOCKS, clockSpan, formatSolExact, parseSolInput, priceProblem, solInputText, splitSale } from '@/lib/data/market';
import { MESSAGES, formatMessage } from '@/messages';
import {
  useAuctionCitizen,
  useBusy,
  useCancelListing,
  useChangeListingPrice,
  useCitizen,
  useDataMode,
  useListCitizen,
  useListing,
  useMarket,
  useSimulateSale,
} from '@/stores/selectors';
import { CitizenLine, StatTiles } from './CitizenLine';
import { Chip } from './DialogParts';
import { MarketDialog } from './MarketDialog';

const copy = MESSAGES.market;

/** What the form says about the typed price, or `null` while it is fine or still empty. */
function priceMessage(text: string, parsed: bigint | null, market: ReturnType<typeof useMarket>): string | null {
  if (text.trim() === '') return null;
  if (parsed === null) return copy.priceInvalid;
  const problem = priceProblem(parsed, market);
  if (problem === 'too-low') return formatMessage(copy.priceLow, { min: formatSolExact(market.minPriceLamports) });
  if (problem === 'too-high') return formatMessage(copy.priceHigh, { max: formatSolExact(market.maxPriceLamports) });
  return null;
}

type SaleMode = 'fixed' | 'auction';

/**
 * Lists an owned citizen at a fixed price or puts it up for auction, or
 * changes and cancels the listing it already has. The citizen stays in the
 * wallet either way; only a buyer or the winner of the auction moves it.
 */
export const SellDialog: React.FC<{ citizenId: number; onClose: () => void }> = ({ citizenId, onClose }) => {
  const citizen = useCitizen(citizenId);
  const listing = useListing(citizenId);
  const market = useMarket();
  const mode = useDataMode();
  const busy = useBusy();
  const list = useListCitizen();
  const change = useChangeListingPrice();
  const cancel = useCancelListing();
  const simulateSale = useSimulateSale();
  const startAuction = useAuctionCitizen();
  const [text, setText] = useState(listing ? solInputText(listing.priceLamports) : '');
  const [saleMode, setSaleMode] = useState<SaleMode>('fixed');
  const [hours, setHours] = useState<number>(market.auctionHours[0] ?? 24);
  if (!citizen) return null;

  const parsed = parseSolInput(text);
  const message = priceMessage(text, parsed, market);
  const valid = parsed !== null && message === null;
  const split = valid ? splitSale(parsed, market.royaltyBps) : null;
  const unchanged = listing !== undefined && parsed === listing.priceLamports;
  const percent = `${market.royaltyBps / 100}%`;
  const auction = !listing && saleMode === 'auction';

  const submit = () => {
    if (!valid || busy) return;
    const action = listing
      ? change(citizenId, parsed)
      : auction
        ? startAuction(citizenId, parsed, hours)
        : list(citizenId, parsed);
    void action.then((done) => {
      if (done) onClose();
    });
  };

  return (
    <MarketDialog
      title={formatMessage(listing ? copy.manageTitle : copy.sellTitle, { name: citizen.name.toUpperCase() })}
      onClose={onClose}
    >
      <CitizenLine citizen={citizen} />
      <StatTiles citizen={citizen} />

      {!listing && (
        <div className="flex gap-1.5">
          <Chip pressed={saleMode === 'fixed'} onClick={() => setSaleMode('fixed')}>
            {copy.modeFixed}
          </Chip>
          <Chip pressed={saleMode === 'auction'} onClick={() => setSaleMode('auction')}>
            {copy.modeAuction}
          </Chip>
        </div>
      )}

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="bas-label">{auction ? copy.startPriceLabel : copy.priceLabel}</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            value={text}
            placeholder={copy.pricePlaceholder}
            aria-invalid={message !== null}
            onChange={(event) => setText(event.target.value)}
            className="bas-inset min-h-12 w-full px-3 font-heading text-[18px] outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#f7d23d]"
          />
        </label>
        {message && (
          <p role="alert" className="m-0 text-[14px] font-semibold text-[#9a2b2b]">
            {message}
          </p>
        )}

        {auction && (
          <div className="flex flex-col gap-1.5">
            <span className="bas-label">{copy.durationLabel}</span>
            <div role="group" aria-label={copy.durationLabel} className="flex gap-1.5">
              {market.auctionHours.map((option) => (
                <Chip key={option} pressed={hours === option} onClick={() => setHours(option)}>
                  {clockSpan(option * market.auctionClock.hourSeconds).toUpperCase()}
                </Chip>
              ))}
            </div>
          </div>
        )}

        <div className="bas-inset flex flex-col px-3 py-1">
          <ReceiptRow
            label={auction ? copy.startingBid : copy.rowPrice}
            value={split && parsed !== null ? formatSolExact(parsed) : '—'}
          />
          <ReceiptRow
            label={formatMessage(copy.rowRoyalty, { percent })}
            value={split ? formatSolExact(split.royaltyLamports) : '—'}
          />
          <ReceiptRow
            label={auction ? copy.rowAtStart : copy.rowReceive}
            value={split ? formatSolExact(split.proceedsLamports) : '—'}
            strong
          />
        </div>

        {auction ? (
          <>
            <p className="m-0 text-[14px] leading-snug text-[#33485c]">{copy.auctionNoteHeld}</p>
            <p className="m-0 text-[14px] leading-snug text-[#33485c]">{copy.auctionNoteCancel}</p>
            <p className="m-0 text-[14px] leading-snug text-[#33485c]">
              {formatMessage(copy.auctionNoteLate, { window: clockSpan(market.auctionClock.extensionSeconds) })}
            </p>
            {market.auctionClock.hourSeconds !== AUCTION_CLOCKS.real.hourSeconds && (
              <p className="m-0 text-[14px] font-semibold leading-snug text-[#8a5a12]">
                {formatMessage(copy.testClockNote, { hour: clockSpan(market.auctionClock.hourSeconds) })}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="m-0 text-[14px] leading-snug text-[#33485c]">{copy.sellNoteStay}</p>
            <p className="m-0 text-[14px] leading-snug text-[#33485c]">{copy.sellNoteSale}</p>
          </>
        )}
        {mode === 'mock' && <p className="m-0 text-[13px] leading-snug text-[#5b6b7a]">{copy.mockNote}</p>}

        <div className="grid gap-2">
          <button
            type="submit"
            className="bas-btn bas-btn-primary min-h-12"
            disabled={busy || !valid || unchanged}
          >
            {busy ? copy.working : listing ? copy.updatePrice : auction ? copy.confirmAuction : copy.confirmSell}
          </button>
          {listing && (
            <button
              type="button"
              className="bas-btn"
              disabled={busy}
              onClick={() =>
                void cancel(citizenId).then((done) => {
                  if (done) onClose();
                })
              }
            >
              {copy.cancelListing}
            </button>
          )}
          {listing && mode === 'mock' && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                className="bas-btn"
                disabled={busy}
                onClick={() =>
                  void simulateSale(citizenId).then(() => {
                    onClose();
                  })
                }
              >
                {copy.previewSale}
              </button>
              <span className="text-center text-[13px] text-[#5b6b7a]">{copy.previewSaleHint}</span>
            </div>
          )}
          <button type="button" className="bas-btn" onClick={onClose}>
            {copy.back}
          </button>
        </div>
      </form>
    </MarketDialog>
  );
};

'use client';

import React, { useState } from 'react';
import { ReceiptRow } from '@/components/ui/ReceiptRow';
import {
  NETWORK_FEE_LAMPORTS,
  bestOffer,
  formatSolExact,
  myOffer,
  offerExpired,
  offerSpanText,
  parseSolInput,
  solInputText,
  timeLeftText,
  walletCost,
} from '@/lib/data/market';
import { useNow } from '@/lib/utils/useNow';
import { MESSAGES, formatMessage } from '@/messages';
import {
  useBusy,
  useCitizen,
  useDataMode,
  useListing,
  useMakeOffer,
  useMarket,
  useOpenWallet,
  useSimulateOfferAccepted,
  useWallet,
  useWithdrawOffer,
} from '@/stores/selectors';
import { CitizenLine, StatTiles } from './CitizenLine';
import { Chip, Note } from './DialogParts';
import { MarketDialog } from './MarketDialog';

const copy = MESSAGES.market;

/**
 * Makes, changes or takes back the wallet's offer on a citizen it does not
 * own. The SOL is held by the market until the owner accepts or the wallet
 * takes it back; a new offer replaces the old one in the same step.
 */
export const OfferDialog: React.FC<{ citizenId: number; onClose: () => void }> = ({ citizenId, onClose }) => {
  const citizen = useCitizen(citizenId);
  const market = useMarket();
  const listing = useListing(citizenId);
  const wallet = useWallet();
  const mode = useDataMode();
  const busy = useBusy();
  const now = useNow();
  const makeOffer = useMakeOffer();
  const withdraw = useWithdrawOffer();
  const simulateAccepted = useSimulateOfferAccepted();
  const openWallet = useOpenWallet();
  const current = myOffer(market.offers, citizenId);
  const best = bestOffer(market.offers, citizenId, now);
  const [text, setText] = useState(current ? solInputText(current.amountLamports) : '');
  const [days, setDays] = useState(market.offerDays[1] ?? market.offerDays[0] ?? 3);
  if (!citizen) return null;

  const needsWallet = mode === 'chain' && !wallet.connected;
  const expired = current !== undefined && offerExpired(current, now);
  const parsed = parseSolInput(text);
  const problem =
    text.trim() === ''
      ? null
      : parsed === null
        ? copy.priceInvalid
        : parsed < market.minPriceLamports
          ? formatMessage(copy.priceLow, { min: formatSolExact(market.minPriceLamports) })
          : parsed > market.maxPriceLamports
            ? formatMessage(copy.priceHigh, { max: formatSolExact(market.maxPriceLamports) })
            : null;
  const valid = parsed !== null && problem === null;
  // The SOL of the wallet's current offer comes back in the same step, so it counts toward the new one.
  const available = wallet.solLamports + (current?.amountLamports ?? 0n);
  // A first offer leaves its account's rent with the market; it comes back when the offer closes.
  const deposit = current ? 0n : market.offerDepositLamports;
  const cost = parsed === null ? null : walletCost(parsed, mode) + deposit;
  const enough = valid && cost !== null && available >= cost;
  const done = (ok: boolean) => {
    if (ok) onClose();
  };

  return (
    <MarketDialog title={formatMessage(copy.offerTitle, { name: citizen.name.toUpperCase() })} onClose={onClose}>
      <CitizenLine citizen={citizen} />
      <StatTiles citizen={citizen} />

      <div className="bas-inset flex flex-col px-3 py-1">
        {listing && <ReceiptRow label={copy.rowListedPrice} value={formatSolExact(listing.priceLamports)} />}
        <ReceiptRow label={copy.rowBestOffer} value={best ? formatSolExact(best.amountLamports) : '—'} />
        {current && (
          <ReceiptRow
            label={copy.rowYourOffer}
            value={`${formatSolExact(current.amountLamports)} · ${
              expired || now === null ? copy.offerExpired : timeLeftText(current.expiresAt - now)
            }`}
            strong
          />
        )}
        {!needsWallet && <ReceiptRow label={copy.rowYourSol} value={formatSolExact(wallet.solLamports)} />}
        {deposit > 0n && <ReceiptRow label={copy.rowOfferDeposit} value={formatSolExact(deposit)} />}
        {mode === 'chain' && <ReceiptRow label={copy.rowNetworkFee} value={formatSolExact(NETWORK_FEE_LAMPORTS)} />}
        {!needsWallet && enough && cost !== null && (
          <ReceiptRow label={copy.rowAfterOffer} value={formatSolExact(available - cost)} />
        )}
      </div>

      {expired && <Note strong>{copy.offerNoteExpired}</Note>}

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || !enough || busy || needsWallet || parsed === null) return;
          void makeOffer(citizenId, parsed, days).then(done);
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="bas-label">{copy.offerLabel}</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            placeholder={listing ? solInputText(listing.priceLamports) : undefined}
            value={text}
            aria-invalid={problem !== null}
            onChange={(event) => setText(event.target.value)}
            className="bas-inset min-h-12 w-full px-3 font-heading text-[18px] outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#f7d23d]"
          />
        </label>
        {problem && (
          <p role="alert" className="m-0 text-[14px] font-semibold text-[#9a2b2b]">
            {problem}
          </p>
        )}
        {!problem && valid && !needsWallet && !enough && (
          <p role="alert" className="m-0 text-[14px] font-semibold text-[#9a2b2b]">
            {copy.notEnough}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="bas-label">{copy.offerOpenFor}</span>
          <div role="group" aria-label={copy.offerOpenFor} className="flex gap-1.5">
            {market.offerDays.map((option) => (
              <Chip key={option} pressed={days === option} onClick={() => setDays(option)}>
                {offerSpanText(option, market.auctionClock).toUpperCase()}
              </Chip>
            ))}
          </div>
        </div>

        <Note>{copy.offerNoteHeld}</Note>
        <Note>{formatMessage(copy.offerNoteAccept, { name: citizen.name, percent: `${market.royaltyBps / 100}%` })}</Note>
        {current && <Note>{copy.offerNoteReplace}</Note>}
        {listing && <Note>{formatMessage(copy.offerNoteListed, { name: citizen.name, price: formatSolExact(listing.priceLamports) })}</Note>}
        {mode === 'mock' && <p className="m-0 text-[13px] leading-snug text-[#5b6b7a]">{copy.mockNote}</p>}

        {needsWallet ? (
          <button type="button" className="bas-btn bas-btn-primary min-h-12" onClick={openWallet}>
            {MESSAGES.wallet.connect}
          </button>
        ) : (
          <button type="submit" className="bas-btn bas-btn-primary min-h-12" disabled={busy || !valid || !enough}>
            {busy ? copy.working : current ? copy.updateOffer : copy.confirmOffer}
          </button>
        )}
      </form>

      <div className="grid gap-2">
        {current && (
          <button type="button" className="bas-btn" disabled={busy} onClick={() => void withdraw(citizenId).then(done)}>
            {copy.withdrawOffer}
          </button>
        )}
        {mode === 'mock' && current && !expired && (
          <button type="button" className="bas-btn" disabled={busy} onClick={() => void simulateAccepted(citizenId).then(onClose)}>
            {copy.previewAccepted}
          </button>
        )}
        <button type="button" className="bas-btn" onClick={onClose}>
          {copy.back}
        </button>
      </div>
    </MarketDialog>
  );
};

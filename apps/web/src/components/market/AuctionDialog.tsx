'use client';

import React, { useEffect, useState } from 'react';
import { ReceiptRow } from '@/components/ui/ReceiptRow';
import {
  AUCTION_CLOCKS,
  auctionStage,
  clockSpan,
  formatSolExact,
  parseSolInput,
  solInputText,
  splitSale,
  suggestedBid,
  timeLeftText,
  type AuctionStage,
} from '@/lib/data/market';
import { cn } from '@/lib/utils/cn';
import { useNow } from '@/lib/utils/useNow';
import { MESSAGES, formatMessage } from '@/messages';
import {
  useAuction,
  useBusy,
  useCancelAuction,
  useCitizen,
  useDataMode,
  useMarket,
  useOpenWallet,
  usePlaceBid,
  useSettleAuction,
  useSimulateAuctionEnd,
  useSimulateBid,
  useWallet,
} from '@/stores/selectors';
import { bidCountText } from './AuctionCard';
import { AuctionBids } from './BidHistory';
import { CitizenLine, StatTiles } from './CitizenLine';
import { MarketDialog } from './MarketDialog';

const copy = MESSAGES.market;

const Note: React.FC<{ children: React.ReactNode; strong?: boolean }> = ({ children, strong }) => (
  <p className={strong ? 'm-0 text-[14px] font-semibold leading-snug text-[#1d6b34]' : 'm-0 text-[14px] leading-snug text-[#33485c]'}>
    {children}
  </p>
);

/**
 * One auction, seen by whoever opens it: a bidder bids, the seller can cancel
 * until the first bid, and anyone finishes it once it has ended.
 */
export const AuctionDialog: React.FC<{ citizenId: number; onClose: () => void }> = ({ citizenId, onClose }) => {
  const citizen = useCitizen(citizenId);
  const auction = useAuction(citizenId);
  const market = useMarket();
  const wallet = useWallet();
  const mode = useDataMode();
  const busy = useBusy();
  const now = useNow();
  const placeBid = usePlaceBid();
  const cancel = useCancelAuction();
  const settle = useSettleAuction();
  const simulateBid = useSimulateBid();
  const simulateEnd = useSimulateAuctionEnd();
  const openWallet = useOpenWallet();
  const [text, setText] = useState(auction ? solInputText(suggestedBid(auction.minBidLamports)) : '');
  // Someone else bid while the dialog was open: start again from the new lowest bid.
  const minBid = auction?.minBidLamports;
  useEffect(() => {
    if (minBid !== undefined) setText(solInputText(suggestedBid(minBid)));
  }, [minBid]);
  if (!citizen || !auction) return null;

  const ended = now !== null && now >= auction.endsAt;
  const mine = auction.sellerIsMe;
  const stage = auctionStage(auction, now);
  const finishable = stage !== 'live';
  const biddable = !finishable && !mine && !auction.leading && auction.deliverable;
  const finalPrice = auction.highestBidLamports ?? auction.startPriceLamports;
  const facts = {
    name: citizen.name,
    price: formatSolExact(finalPrice),
    amount: formatSolExact(splitSale(finalPrice, market.royaltyBps).proceedsLamports),
    percent: `${market.royaltyBps / 100}%`,
  };
  const stageNote: Record<Exclude<AuctionStage, 'live'>, string> = {
    claim: formatMessage(copy.claimNote, facts),
    collect: formatMessage(copy.collectNote, facts),
    'take-back': formatMessage(copy.takeBackNote, facts),
    refund: formatMessage(copy.refundNote, facts),
    close: formatMessage(copy.closeNote, facts),
    waiting: auction.deliverable ? copy.waitingNote : copy.stoppedWaitingNote,
  };
  // Someone with no part in the auction only reads about it; the winner or the seller finishes it.
  const stageAction: Record<Exclude<AuctionStage, 'live' | 'waiting'>, string> = {
    claim: copy.claim,
    collect: copy.collect,
    'take-back': copy.takeBack,
    refund: copy.takeBidBack,
    close: copy.endAuction,
  };
  const needsWallet = mode === 'chain' && !wallet.connected;

  const parsed = parseSolInput(text);
  const problem =
    text.trim() === ''
      ? null
      : parsed === null
        ? copy.priceInvalid
        : parsed < auction.minBidLamports
          ? formatMessage(copy.bidLow, { min: formatSolExact(auction.minBidLamports) })
          : parsed > market.maxPriceLamports
            ? formatMessage(copy.priceHigh, { max: formatSolExact(market.maxPriceLamports) })
            : null;
  const valid = parsed !== null && problem === null;
  const enough = valid && wallet.solLamports >= parsed;
  const done = (ok: boolean) => {
    if (ok) onClose();
  };

  return (
    <MarketDialog title={formatMessage(copy.auctionTitle, { name: citizen.name.toUpperCase() })} onClose={onClose}>
      <CitizenLine citizen={citizen} />
      <StatTiles citizen={citizen} />

      <div className="bas-inset flex flex-col px-3 py-1">
        <ReceiptRow
          label={auction.highestBidLamports === null ? copy.startingBid : copy.currentBid}
          value={formatSolExact(auction.highestBidLamports ?? auction.startPriceLamports)}
          strong
        />
        <ReceiptRow label={copy.rowBids} value={bidCountText(auction.bidCount)} />
        <ReceiptRow label={copy.rowEnds} value={now === null ? '—' : ended ? copy.ended : timeLeftText(auction.endsAt - now)} />
        {biddable && <ReceiptRow label={copy.rowMinBid} value={formatSolExact(auction.minBidLamports)} />}
        {biddable && !needsWallet && <ReceiptRow label={copy.rowYourSol} value={formatSolExact(wallet.solLamports)} />}
        {biddable && !needsWallet && enough && parsed !== null && (
          <ReceiptRow label={copy.rowAfterBid} value={formatSolExact(wallet.solLamports - parsed)} />
        )}
      </div>

      <AuctionBids bids={auction.bids} now={now} ended={ended} />

      {stage !== 'live' && <Note strong={stage === 'claim' || stage === 'collect'}>{stageNote[stage]}</Note>}
      {!finishable && auction.leading && <Note strong>{copy.leadNote}</Note>}
      {!finishable && mine && <Note>{auction.bidCount === 0 ? copy.mineNoBids : copy.mineBids}</Note>}

      {biddable && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || !enough || busy || needsWallet || parsed === null) return;
            void placeBid(citizenId, parsed).then(done);
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="bas-label">{copy.bidLabel}</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
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
          <Note>{copy.bidNoteHeld}</Note>
          <Note>{formatMessage(copy.bidNoteWin, { percent: facts.percent })}</Note>
          <Note>{formatMessage(copy.auctionNoteLate, { window: clockSpan(market.auctionClock.extensionSeconds) })}</Note>
          {market.auctionClock.hourSeconds !== AUCTION_CLOCKS.real.hourSeconds && (
            <Note>{formatMessage(copy.testClockNote, { hour: clockSpan(market.auctionClock.hourSeconds) })}</Note>
          )}
          {mode === 'mock' && <p className="m-0 text-[13px] leading-snug text-[#5b6b7a]">{copy.mockNote}</p>}
          {needsWallet ? (
            <button type="button" className="bas-btn bas-btn-primary min-h-12" onClick={openWallet}>
              {MESSAGES.wallet.connect}
            </button>
          ) : (
            <button type="submit" className="bas-btn bas-btn-primary min-h-12" disabled={busy || !valid || !enough}>
              {busy ? copy.working : copy.confirmBid}
            </button>
          )}
        </form>
      )}

      <div className="grid gap-2">
        {stage !== 'live' &&
          stage !== 'waiting' &&
          (needsWallet ? (
            <button type="button" className="bas-btn bas-btn-primary min-h-12" onClick={openWallet}>
              {MESSAGES.wallet.connect}
            </button>
          ) : (
            <button
              type="button"
              className={cn('bas-btn min-h-12', stage !== 'close' && 'bas-btn-primary')}
              disabled={busy}
              onClick={() => void settle(citizenId).then(done)}
            >
              {busy ? copy.working : stageAction[stage]}
            </button>
          ))}
        {!finishable && mine && auction.bidCount === 0 && (
          <button type="button" className="bas-btn" disabled={busy} onClick={() => void cancel(citizenId).then(done)}>
            {copy.cancelAuction}
          </button>
        )}
        {mode === 'mock' && !ended && auction.deliverable && (
          <>
            <button type="button" className="bas-btn" disabled={busy} onClick={() => void simulateBid(citizenId)}>
              {copy.previewBid}
            </button>
            <button type="button" className="bas-btn" disabled={busy} onClick={() => void simulateEnd(citizenId)}>
              {copy.previewEnd}
            </button>
          </>
        )}
        <button type="button" className="bas-btn" onClick={onClose}>
          {copy.back}
        </button>
      </div>
    </MarketDialog>
  );
};

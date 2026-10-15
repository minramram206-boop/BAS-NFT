'use client';

import React from 'react';
import { ReceiptRow } from '@/components/ui/ReceiptRow';
import { formatSolExact } from '@/lib/data/market';
import { MESSAGES, formatMessage } from '@/messages';
import {
  useBusy,
  useBuyCitizen,
  useCitizen,
  useDataMode,
  useListing,
  useOpenWallet,
  useWallet,
} from '@/stores/selectors';
import { CitizenLine, StatTiles } from './CitizenLine';
import { MarketDialog } from './MarketDialog';

const copy = MESSAGES.market;

/** Confirms the purchase of one listed citizen and shows what the wallet pays and keeps. */
export const BuyDialog: React.FC<{ citizenId: number; onClose: () => void }> = ({ citizenId, onClose }) => {
  const citizen = useCitizen(citizenId);
  const listing = useListing(citizenId);
  const wallet = useWallet();
  const mode = useDataMode();
  const busy = useBusy();
  const buy = useBuyCitizen();
  const openWallet = useOpenWallet();
  if (!citizen || !listing) return null;

  const needsWallet = mode === 'chain' && !wallet.connected;
  const enough = wallet.solLamports >= listing.priceLamports;

  return (
    <MarketDialog title={formatMessage(copy.buyTitle, { name: citizen.name.toUpperCase() })} onClose={onClose}>
      <CitizenLine citizen={citizen} />
      <StatTiles citizen={citizen} />

      <div className="bas-inset flex flex-col px-3 py-1">
        <ReceiptRow label={copy.rowPrice} value={formatSolExact(listing.priceLamports)} strong />
        <ReceiptRow label={copy.rowYourSol} value={needsWallet ? MESSAGES.mint.notConnected : formatSolExact(wallet.solLamports)} />
        {!needsWallet && enough && (
          <ReceiptRow label={copy.rowAfter} value={formatSolExact(wallet.solLamports - listing.priceLamports)} />
        )}
      </div>

      {!needsWallet && !enough && (
        <p role="alert" className="m-0 text-[14px] font-semibold text-[#9a2b2b]">
          {copy.notEnough}
        </p>
      )}

      <p className="m-0 text-[14px] leading-snug text-[#33485c]">{copy.buyNoteOne}</p>
      <p className="m-0 text-[14px] leading-snug text-[#33485c]">{copy.buyNoteRecord}</p>
      {mode === 'mock' && <p className="m-0 text-[13px] leading-snug text-[#5b6b7a]">{copy.mockNote}</p>}

      <div className="grid gap-2">
        {needsWallet ? (
          <button type="button" className="bas-btn bas-btn-primary min-h-12" onClick={openWallet}>
            {MESSAGES.wallet.connect}
          </button>
        ) : (
          <button
            type="button"
            className="bas-btn bas-btn-primary min-h-12"
            disabled={busy || !enough}
            onClick={() =>
              void buy(citizenId).then((done) => {
                if (done) onClose();
              })
            }
          >
            {busy ? copy.working : copy.confirmBuy}
          </button>
        )}
        <button type="button" className="bas-btn" onClick={onClose}>
          {copy.back}
        </button>
      </div>
    </MarketDialog>
  );
};

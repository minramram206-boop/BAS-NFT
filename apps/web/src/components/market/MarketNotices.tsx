'use client';

import React, { useEffect, useState } from 'react';
import type { CitizenRecord } from '@bas/content';
import type { MarketNotice } from '@/lib/data/types';
import { formatSolExact, markNoticesSeen, unseenNotices } from '@/lib/data/market';
import { MESSAGES, formatMessage } from '@/messages';
import { createPortal } from 'react-dom';
import { PixelMessageFrame } from '@/components/modal/PixelModal';
import { useCitizens, useDataMode, useMarket, useWallet } from '@/stores/selectors';

const copy = MESSAGES.market;
/** Lines shown at once; the rest are counted. */
const SHOWN = 4;

function noticeText(notice: MarketNotice, citizens: readonly CitizenRecord[]): string {
  const name = citizens.find((citizen) => citizen.id === notice.citizenId)?.name ?? `#${notice.citizenId}`;
  switch (notice.kind) {
    case 'sold':
      return formatMessage(copy.noticeSold, {
        name,
        price: formatSolExact(notice.priceLamports),
        amount: formatSolExact(notice.proceedsLamports),
      });
    case 'won':
      return formatMessage(copy.noticeWon, { name, price: formatSolExact(notice.priceLamports) });
    case 'outbid':
      return formatMessage(copy.noticeOutbid, { name, amount: formatSolExact(notice.refundedLamports) });
  }
}

function readSeen(key: string): string[] {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Tells the wallet what happened to it in the market while it was away: a
 * citizen sold, an auction won, a bid beaten. Each notice is shown once; this
 * browser remembers which ones per wallet. Without storage they show once per visit.
 */
export const MarketNotices: React.FC = () => {
  const { notices } = useMarket();
  const wallet = useWallet();
  const mode = useDataMode();
  const citizens = useCitizens();
  const key = wallet.connected || mode === 'mock' ? `bas.market.seen.${mode}.${wallet.label}` : null;
  const [seen, setSeen] = useState<{ key: string; ids: readonly string[] } | null>(null);

  useEffect(() => {
    setSeen(key ? { key, ids: readSeen(key) } : null);
  }, [key]);

  if (!key || !seen || seen.key !== key) return null;
  const fresh = unseenNotices(notices, seen.ids);
  if (fresh.length === 0) return null;

  const dismiss = () => {
    const ids = markNoticesSeen(seen.ids, notices);
    setSeen({ key, ids });
    try {
      window.localStorage.setItem(key, JSON.stringify(ids));
    } catch {
      // Not saved; they stay dismissed for this visit.
    }
  };

  // Drawn on the page body, like the other dialogs, so no screen layer clips it.
  return createPortal(
    <PixelMessageFrame title={copy.noticeTitle} onClose={dismiss}>
      <ul className="m-0 flex list-none flex-col p-0 font-pixel text-[15px] leading-relaxed text-[#27384a]">
        {fresh.slice(0, SHOWN).map((notice) => (
          <li key={notice.id} className="border-b border-dashed border-[#8ba5ba] py-1.5 first:pt-0 last:border-b-0 last:pb-0">
            {noticeText(notice, citizens)}
          </li>
        ))}
      </ul>
      {fresh.length > SHOWN && (
        <p className="m-0 text-[14px] text-[#33485c]">{formatMessage(copy.noticeMore, { count: fresh.length - SHOWN })}</p>
      )}
    </PixelMessageFrame>,
    document.body,
  );
};

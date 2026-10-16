'use client';

import { usePathname, useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CitizenRecord } from '@bas/content';
import { PixelMessageFrame } from '@/components/modal/PixelModal';
import type { MarketNotice } from '@/lib/data/types';
import { auctionNotices, formatSolExact, markNoticesSeen, mergeSeen, unseenNotices } from '@/lib/data/market';
import { useNow } from '@/lib/utils/useNow';
import { MESSAGES, formatMessage } from '@/messages';
import { useCitizens, useDataMode, useMarket, useSeenNoticesPort, useWallet } from '@/stores/selectors';

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
    case 'claim':
      return formatMessage(copy.noticeClaim, { name, price: formatSolExact(notice.priceLamports) });
    case 'collect':
      return formatMessage(copy.noticeCollect, { name, price: formatSolExact(notice.priceLamports) });
    case 'offer':
      return formatMessage(copy.noticeOffer, { name, amount: formatSolExact(notice.amountLamports) });
    case 'offer-accepted':
      return formatMessage(copy.noticeOfferAccepted, { name, amount: formatSolExact(notice.amountLamports) });
  }
}

/** An ended auction that waits for the wallet to claim or collect. */
const auctionWaits = (notice: MarketNotice) => notice.kind === 'claim' || notice.kind === 'collect';
/** Notices that ask the wallet to act in the market, rather than tell it what happened. */
const waitsOnWallet = (notice: MarketNotice) => auctionWaits(notice) || notice.kind === 'offer';

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
 * citizen sold, an auction won, a bid beaten. It also says when an auction the
 * wallet won or sold has ended and waits for it to claim the citizen or collect
 * the payment, with a way to the market. Each notice is shown once per
 * wallet: this browser remembers which ones, and on chain the mission server
 * does too, so another browser does not show them again (D-0096). Without
 * either they show once per visit.
 */
export const MarketNotices: React.FC = () => {
  const market = useMarket();
  const now = useNow();
  const wallet = useWallet();
  const mode = useDataMode();
  const citizens = useCitizens();
  const router = useRouter();
  const pathname = usePathname();
  const key = wallet.connected || mode === 'mock' ? `bas.market.seen.${mode}.${wallet.label}` : null;
  const port = useSeenNoticesPort();
  const [seen, setSeen] = useState<{ key: string; ids: readonly string[] } | null>(null);

  useEffect(() => {
    if (!key) {
      setSeen(null);
      return;
    }
    const local = readSeen(key);
    if (!port) {
      setSeen({ key, ids: local });
      return;
    }
    // Wait for the server's list, so a notice dismissed elsewhere does not flash up first.
    let current = true;
    void port.load().then((remote) => {
      if (!current) return;
      setSeen({ key, ids: mergeSeen(remote, local) });
      // Dismissed here while the wallet was not signed in: hand them over now.
      if (local.some((id) => !remote.includes(id))) void port.save(local);
    });
    return () => {
      current = false;
    };
  }, [key, port]);

  if (!key || !seen || seen.key !== key) return null;
  const notices = [...auctionNotices(market.auctions, now), ...market.notices];
  const fresh = unseenNotices(notices, seen.ids);
  if (fresh.length === 0) return null;
  const actionable = fresh.some(waitsOnWallet);

  const dismiss = () => {
    const ids = markNoticesSeen(seen.ids, notices);
    setSeen({ key, ids });
    try {
      window.localStorage.setItem(key, JSON.stringify(ids));
    } catch {
      // Not saved here; the server may still keep them.
    }
    void port?.save(ids);
  };

  // Drawn on the page body, like the other dialogs, so no screen layer clips it.
  return createPortal(
    <PixelMessageFrame
      title={fresh.every(auctionWaits) ? copy.noticeEndedTitle : copy.noticeTitle}
      onClose={dismiss}
      {...(actionable && pathname !== '/market'
        ? {
            action: {
              label: copy.noticeOpenMarket,
              onClick: () => {
                dismiss();
                router.push('/market');
              },
            },
          }
        : {})}
    >
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

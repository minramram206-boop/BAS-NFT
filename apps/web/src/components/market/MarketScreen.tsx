'use client';

import React, { useMemo, useState } from 'react';
import { ROLE_KEYS, ROLE_LABELS } from '@bas/content';
import { ScreenColumns, ScreenShell } from '@/components/layout/ScreenShell';
import { PanelTab } from '@/components/ui/PanelTab';
import { ReceiptRow } from '@/components/ui/ReceiptRow';
import { MARKET_SORTS, formatSolExact, shownAuctions, shownListings, shownSales, type MarketSort, type RoleFilter } from '@/lib/data/market';
import { cn } from '@/lib/utils/cn';
import { useNow } from '@/lib/utils/useNow';
import { MESSAGES, formatMessage } from '@/messages';
import { useCitizens, useDataMode, useMarket, useOwnedIds, useWallet } from '@/stores/selectors';
import { AuctionCard } from './AuctionCard';
import { AuctionDialog } from './AuctionDialog';
import { BidHistoryPanel } from './BidHistory';
import { BuyDialog } from './BuyDialog';
import { ListingCard } from './ListingCard';
import { SellDialog } from './SellDialog';
import { FinishedSales } from './FinishedSales';

const copy = MESSAGES.market;

type DialogState = { kind: 'buy' | 'sell' | 'auction'; id: number } | null;
type Tab = 'listings' | 'auctions' | 'finished';

const Panel: React.FC<{ title: string; icon?: string; children: React.ReactNode }> = ({ title, icon, children }) => (
  <section className="bas-panel flex flex-col gap-2.5 p-3 md:p-4">
    <PanelTab icon={icon}>{title}</PanelTab>
    {children}
  </section>
);

/** What a citizen of the wallet is doing in the market, as one short line. */
function statusOf(market: ReturnType<typeof useMarket>, id: number): { text: string; active: boolean } {
  const listing = market.listings.find((item) => item.citizenId === id);
  if (listing) return { text: formatMessage(copy.listedFor, { price: formatSolExact(listing.priceLamports) }), active: true };
  const auction = market.auctions.find((item) => item.citizenId === id);
  if (auction) {
    return {
      text:
        auction.highestBidLamports === null
          ? formatMessage(copy.inAuctionFrom, { price: formatSolExact(auction.startPriceLamports) })
          : formatMessage(copy.inAuction, { price: formatSolExact(auction.highestBidLamports) }),
      active: true,
    };
  }
  return { text: copy.notListed, active: false };
}

/** The wallet's SOL and its citizens, each with the way to sell it or manage its listing or auction. */
const YourCitizens: React.FC<{ onSell: (id: number) => void; onAuction: (id: number) => void }> = ({ onSell, onAuction }) => {
  const market = useMarket();
  const citizens = useCitizens();
  const owned = useOwnedIds();
  const wallet = useWallet();
  const mode = useDataMode();
  const mine = owned.flatMap((id) => citizens.filter((citizen) => citizen.id === id));

  return (
    <Panel title={copy.yourTab} icon="/icons/icon_citizens_group.png">
      {(mode === 'mock' || wallet.connected) && (
        <div className="bas-inset px-3 py-1">
          <ReceiptRow label={copy.yourSol} value={formatSolExact(wallet.solLamports)} />
        </div>
      )}
      {mine.length === 0 ? (
        <p className="m-0 rounded-md border-2 border-dashed border-[#5b6b7a] bg-[#d3dde6] p-2.5 text-[14px] text-[#22354a]">
          {copy.yourNone}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {mine.map((citizen) => {
            const status = statusOf(market, citizen.id);
            const auction = market.auctions.some((item) => item.citizenId === citizen.id);
            return (
              <li key={citizen.id} className="flex items-center gap-2 rounded-md bg-[#f2f6fa] p-2">
                <img src={citizen.sprite} alt="" width={40} height={40} className="h-10 w-10 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-semibold leading-tight">{citizen.name}</span>
                  <span className={cn('text-[13px]', status.active ? 'font-semibold text-[#1d6b34]' : 'text-[#33485c]')}>
                    {status.text}
                  </span>
                </span>
                <button
                  type="button"
                  className="bas-btn min-h-9 shrink-0 px-2.5 text-[11px]"
                  disabled={!market.open}
                  onClick={() => (auction ? onAuction(citizen.id) : onSell(citizen.id))}
                >
                  {status.active ? copy.manage : copy.sell}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
};

const HowSalesWork: React.FC = () => {
  const { royaltyBps } = useMarket();
  return (
    <Panel title={copy.howTab}>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {copy.how.map((step, index) => (
          <li key={step.title} className="flex gap-2.5 rounded-md bg-[#f2f6fa] p-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 border-[#1b2a38] bg-[#f7d23d] font-heading text-[12px]">
              {index + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] font-semibold leading-tight">{step.title}</span>
              <span className="text-[14px] leading-snug text-[#33485c]">
                {formatMessage(step.text, { percent: `${royaltyBps / 100}%` })}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
};

const Filters: React.FC<{
  role: RoleFilter;
  sort: MarketSort | null;
  onRole: (role: RoleFilter) => void;
  onSort: (sort: MarketSort) => void;
}> = ({ role, sort, onRole, onSort }) => {
  const chips: readonly { key: RoleFilter; label: string }[] = [
    { key: 'all', label: copy.allRoles },
    ...ROLE_KEYS.map((key, index) => ({ key, label: ROLE_LABELS[index] ?? key })),
  ];
  return (
    <div className="flex flex-col gap-2.5 md:flex-row md:items-start md:justify-between">
      <div role="group" aria-label={copy.filterRole} className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            aria-pressed={role === chip.key}
            onClick={() => onRole(chip.key)}
            className={cn(
              'bas-chip h-9 rounded-md border-2 border-[#1b2a38] px-2.5 font-heading text-[11px]',
              role === chip.key ? 'bg-[#f7d23d]' : 'bg-[#c5d5e5]',
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>
      {sort !== null && (
        <label className="flex shrink-0 items-center gap-2">
          <span className="bas-label">{copy.sortLabel}</span>
          <select
            value={sort}
            onChange={(event) => onSort(event.target.value as MarketSort)}
            className="bas-inset h-9 cursor-pointer px-2 text-[15px] outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#f7d23d]"
          >
            {MARKET_SORTS.map((key) => (
              <option key={key} value={key}>
                {copy.sorts[key]}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onClick}
    className={cn(
      'bas-chip min-h-10 rounded-md border-2 border-[#1b2a38] px-3 font-heading text-[12px]',
      active ? 'bg-[#f7d23d]' : 'bg-[#c5d5e5]',
    )}
  >
    {children}
  </button>
);

/** Citizens for sale at a fixed price or up for auction, and the wallet's own citizens to put on the market. */
export const MarketScreen: React.FC = () => {
  const market = useMarket();
  const citizens = useCitizens();
  const owned = useOwnedIds();
  const [role, setRole] = useState<RoleFilter>('all');
  const [sort, setSort] = useState<MarketSort>('newest');
  const [tab, setTab] = useState<Tab>('listings');
  const [dialog, setDialog] = useState<DialogState>(null);
  const now = useNow();
  const shown = useMemo(() => shownListings(market.listings, citizens, { role, sort }), [market.listings, citizens, role, sort]);
  const auctions = useMemo(() => shownAuctions(market.auctions, citizens, role), [market.auctions, citizens, role]);
  const sales = useMemo(() => shownSales(market.sales, citizens, role), [market.sales, citizens, role]);
  const againOf = React.useCallback(
    (citizenId: number) =>
      market.auctions.some((auction) => auction.citizenId === citizenId)
        ? ('auction' as const)
        : market.listings.some((listing) => listing.citizenId === citizenId)
          ? ('listed' as const)
          : null,
    [market.auctions, market.listings],
  );
  const close = React.useCallback(() => setDialog(null), []);
  const openAuction = React.useCallback((id: number) => setDialog({ kind: 'auction', id }), []);

  const count = market.listings.length;
  const auctionCount = market.auctions.length;
  const subtitle = !market.open
    ? copy.subtitle
    : auctionCount > 0
      ? formatMessage(copy.subtitleBoth, { sale: count, auction: auctionCount })
      : count === 0
        ? copy.countNone
        : count === 1
          ? copy.countOne
          : formatMessage(copy.countMany, { count });

  return (
    <ScreenShell title={copy.title} subtitle={subtitle}>
      <ScreenColumns
        side={
          <div className="flex flex-col gap-3 md:gap-4">
            <YourCitizens onSell={(id) => setDialog({ kind: 'sell', id })} onAuction={openAuction} />
            <HowSalesWork />
          </div>
        }
      >
        {!market.open ? (
          <section className="bas-panel mx-auto flex w-full max-w-xl flex-col items-center gap-2 p-5 text-center">
            <span className="font-heading text-[16px]">{copy.closedTitle}</span>
            <p className="m-0 text-[15px] leading-snug text-[#33485c]">{copy.closedText}</p>
          </section>
        ) : (
          <section className="bas-panel flex min-w-0 flex-col gap-3 p-3 md:p-4">
            <div role="tablist" className="flex flex-wrap gap-1.5">
              <TabButton active={tab === 'listings'} onClick={() => setTab('listings')}>
                {copy.listingsTab} · {count}
              </TabButton>
              <TabButton active={tab === 'auctions'} onClick={() => setTab('auctions')}>
                {copy.auctionsTab} · {auctionCount}
              </TabButton>
              <TabButton active={tab === 'finished'} onClick={() => setTab('finished')}>
                {copy.finishedTab} · {market.sales.length}
              </TabButton>
            </div>
            <Filters role={role} sort={tab === 'listings' ? sort : null} onRole={setRole} onSort={setSort} />
            {tab === 'finished' ? (
              <FinishedSales sales={sales} all={market.sales} now={now} againOf={againOf} />
            ) : tab === 'auctions' ? (
              auctions.length === 0 ? (
                <p className="m-0 rounded-md bg-[#f2f6fa] p-3 text-[15px]">
                  {auctionCount === 0 ? copy.emptyAuctions : copy.emptyFilter}
                </p>
              ) : (
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]">
                  <ul className="m-0 grid list-none content-start gap-3 p-0 sm:grid-cols-2 2xl:grid-cols-3">
                    {auctions.map((auction) => (
                      <AuctionCard
                        key={auction.citizenId}
                        auction={auction}
                        mine={(owned as readonly number[]).includes(auction.citizenId)}
                        now={now}
                        onOpen={openAuction}
                      />
                    ))}
                  </ul>
                  <BidHistoryPanel auctions={auctions} filtered={role !== 'all'} now={now} onOpen={openAuction} />
                </div>
              )
            ) : shown.length === 0 ? (
              <p className="m-0 rounded-md bg-[#f2f6fa] p-3 text-[15px]">
                {count === 0 ? copy.emptyAll : copy.emptyFilter}
              </p>
            ) : (
              <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((listing) => (
                  <ListingCard
                    key={listing.citizenId}
                    listing={listing}
                    mine={(owned as readonly number[]).includes(listing.citizenId)}
                    onBuy={(id) => setDialog({ kind: 'buy', id })}
                    onManage={(id) => setDialog({ kind: 'sell', id })}
                  />
                ))}
              </ul>
            )}
          </section>
        )}
      </ScreenColumns>
      {dialog?.kind === 'buy' && <BuyDialog citizenId={dialog.id} onClose={close} />}
      {dialog?.kind === 'sell' && <SellDialog citizenId={dialog.id} onClose={close} />}
      {dialog?.kind === 'auction' && <AuctionDialog citizenId={dialog.id} onClose={close} />}
    </ScreenShell>
  );
};

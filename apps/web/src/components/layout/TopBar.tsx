'use client';

import Link from 'next/link';
import React from 'react';
import { BackIcon, ClockIcon, CoinIcon, CrestIcon } from '@/components/ui/icons';
import { cn } from '@/lib/utils/cn';
import { useNavTabs } from './BottomNav';
import { formatTokens } from '@/lib/format';
import { MESSAGES, formatMessage } from '@/messages';
import {
  useCanMint,
  useCitizens,
  useDataMode,
  useOpenWallet,
  useOwnedIds,
  useSeason,
  useTrainingConfig,
  useWallet,
} from '@/stores/selectors';

export const TokenPill: React.FC = () => {
  const wallet = useWallet();
  const mode = useDataMode();
  const { tokenDecimals, tokenSymbol } = useTrainingConfig();
  // A balance only means something once a wallet is connected.
  if (mode === 'chain' && !wallet.connected) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-[#1a2734] px-2 py-1.5 font-heading text-[11px] tracking-wide text-[#f7d23d] sm:px-3 sm:py-2 sm:text-[12px] md:text-[13px]">
      <CoinIcon />
      {formatTokens(wallet.tokenAtoms, tokenDecimals)} {tokenSymbol}
    </div>
  );
};

export const MockBadge: React.FC = () => {
  const mode = useDataMode();
  if (mode === 'chain') return null;
  return (
    <div className="shrink-0 whitespace-nowrap rounded-md border-2 border-[#1a2734] bg-[#f7d23d] px-1.5 py-1 font-heading text-[10px] tracking-wide md:px-2.5 md:py-1.5 md:text-[12px]">
      <span className="sm:hidden">{MESSAGES.app.mockShort}</span>
      <span className="hidden sm:inline">{MESSAGES.app.mockData}</span>
    </div>
  );
};

/** The wallet of the header: the connect button on a cluster, the mock wallet in the preview. */
export const WalletButton: React.FC = () => {
  const mode = useDataMode();
  const wallet = useWallet();
  const openWallet = useOpenWallet();
  if (mode === 'chain') {
    return (
      <button type="button" onClick={openWallet} className="bas-btn bas-btn-primary min-h-10 shrink-0 whitespace-nowrap px-2.5 text-[12px] md:px-4 md:text-[13px]">
        {wallet.connected ? wallet.label.toUpperCase() : MESSAGES.wallet.connect}
      </button>
    );
  }
  return (
    <button type="button" onClick={openWallet} className="bas-btn bas-btn-primary hidden min-h-10 text-[13px] md:inline-flex">
      {formatMessage(MESSAGES.app.mockWallet, { address: wallet.label.toUpperCase() })}
    </button>
  );
};

const barClass =
  'bas-panel pointer-events-auto flex h-14 items-center gap-2 px-2 sm:gap-3 sm:px-3 md:h-16 md:gap-4 md:px-4';

/** Header of the city: crest, district, season, the places of the app and the wallet. */
export const CityTopBar: React.FC = () => {
  const season = useSeason();
  const citizens = useCitizens();
  const newcomer = useOwnedIds().length === 0;
  const canMint = useCanMint();
  const mode = useDataMode();
  const wallet = useWallet();
  // Someone without a citizen needs the mint, not the standings; the wallet button is already the way to connect.
  const mintNow = newcomer && canMint && (mode !== 'chain' || wallet.connected);

  return (
    <header className={barClass}>
      <div className="flex min-w-0 items-center gap-2.5">
        <CrestIcon />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-heading text-[14px] tracking-wider md:text-[17px]">{MESSAGES.app.name}</span>
          <span className="truncate text-[12px] font-medium text-[#33485c] md:text-[14px]">
            {MESSAGES.app.districtName} · {formatMessage(MESSAGES.app.citizensInTown, { count: citizens.length })}
          </span>
        </div>
      </div>
      <div className="hidden h-8 w-0.5 bg-[#9fb3c6] 2xl:block" />
      <div className="hidden items-center gap-2 2xl:flex">
        <ClockIcon />
        <span className="font-heading text-[13px] tracking-wide">
          {formatMessage(MESSAGES.app.season, { number: season.number, day: season.day, length: season.length })}
        </span>
        {mintNow && (
          <Link href="/mint" className="bas-btn bas-btn-primary min-h-9 px-3 text-[12px]">
            {MESSAGES.noCitizen.cta}
          </Link>
        )}
      </div>
      <div className="flex-1" />
      <HeaderNav />
      <div className="flex-1" />
      <TokenPill />
      <MockBadge />
      <WalletButton />
    </header>
  );
};

/** Other screens only show the wallet on a cluster; the preview keeps its header as it was. */
const ChainWalletButton: React.FC = () => (useDataMode() === 'chain' ? <WalletButton /> : null);

/** The six places of the app as a tab group, for the header from desktop width up. */
const HeaderNav: React.FC = () => {
  const tabs = useNavTabs(16);
  return (
    <nav aria-label={MESSAGES.nav.label} className="hidden gap-1 rounded-md bg-[#1a2734] p-1 lg:flex">
      {tabs.map((tab) => (
        <Link
          key={tab.label}
          href={tab.href}
          title={tab.label}
          aria-current={tab.active ? 'page' : undefined}
          className={cn(
            'flex h-9 items-center gap-2 rounded px-2.5 font-heading text-[12px] tracking-wide no-underline xl:px-3',
            tab.active ? 'bg-[#f7d23d] text-[#1a2734]' : 'text-[#c9d5e0] hover:bg-[#2a3b4d]',
          )}
        >
          {tab.icon}
          {/* Between laptop and wide-desktop widths only the current place keeps its name, so the title stays readable. */}
          <span className={cn(!tab.active && 'sr-only xl:not-sr-only')}>{tab.label}</span>
        </Link>
      ))}
    </nav>
  );
};

/** Header of every other screen: back to the city, title, the places of the app, balance. */
export const ScreenTopBar: React.FC<{ title: string; subtitle?: string; right?: React.ReactNode }> = ({
  title,
  subtitle,
  right,
}) => (
  <header className={barClass}>
    <Link href="/" aria-label={MESSAGES.app.back} className="bas-btn min-h-9 shrink-0 px-2.5 lg:hidden">
      <BackIcon size={14} />
      <span className="hidden sm:inline">{MESSAGES.app.back}</span>
    </Link>
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate font-heading text-[14px] tracking-wider md:text-[17px]">{title}</span>
      {subtitle && <span className="hidden truncate text-[13px] font-medium text-[#33485c] sm:block md:text-[14px]">{subtitle}</span>}
    </div>
    <div className="flex-1" />
    <HeaderNav />
    <div className="flex-1" />
    {right}
    <TokenPill />
    <MockBadge />
    <ChainWalletButton />
  </header>
);

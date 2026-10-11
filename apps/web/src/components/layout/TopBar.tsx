'use client';

import Link from 'next/link';
import React from 'react';
import { BackIcon, ClockIcon, CoinIcon, CrestIcon } from '@/components/ui/icons';
import { formatTokens } from '@/lib/format';
import { MESSAGES, formatMessage } from '@/messages';
import {
  useCitizens,
  useSeason,
  useShowWalletConnectorUnavailable,
  useTrainingConfig,
  useWallet,
} from '@/stores/selectors';

export const TokenPill: React.FC = () => {
  const wallet = useWallet();
  const { tokenDecimals, tokenSymbol } = useTrainingConfig();
  return (
    <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-[#1a2734] px-2 py-1.5 font-heading text-[11px] tracking-wide text-[#f7d23d] sm:px-3 sm:py-2 sm:text-[12px] md:text-[13px]">
      <CoinIcon />
      {formatTokens(wallet.tokenAtoms, tokenDecimals)} {tokenSymbol}
    </div>
  );
};

export const MockBadge: React.FC = () => (
  <div className="shrink-0 whitespace-nowrap rounded-md border-2 border-[#1a2734] bg-[#f7d23d] px-1.5 py-1 font-heading text-[10px] tracking-wide md:px-2.5 md:py-1.5 md:text-[12px]">
    <span className="sm:hidden">{MESSAGES.app.mockShort}</span>
    <span className="hidden sm:inline">{MESSAGES.app.mockData}</span>
  </div>
);

const barClass =
  'bas-panel pointer-events-auto flex h-14 items-center gap-2 px-2 sm:gap-3 sm:px-3 md:h-16 md:gap-4 md:px-4';

/** Header of the city: crest, district, season and the wallet. */
export const CityTopBar: React.FC = () => {
  const season = useSeason();
  const citizens = useCitizens();
  const wallet = useWallet();
  const showWallet = useShowWalletConnectorUnavailable();

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
      <div className="hidden h-8 w-0.5 bg-[#9fb3c6] lg:block" />
      <div className="hidden items-center gap-2 lg:flex">
        <ClockIcon />
        <span className="font-heading text-[13px] tracking-wide">
          {formatMessage(MESSAGES.app.season, { number: season.number, day: season.day, length: season.length })}
        </span>
        <Link href="/season" className="rounded-md border-2 border-[#1b2a38] bg-[#c5d5e5] px-2.5 py-1 text-[14px] font-semibold text-[#1a2734] no-underline hover:bg-[#d6e2ee]">
          {MESSAGES.app.seasonBoard}
        </Link>
      </div>
      <div className="flex-1" />
      <TokenPill />
      <MockBadge />
      <button type="button" onClick={showWallet} className="bas-btn bas-btn-primary hidden min-h-10 text-[13px] md:inline-flex">
        {formatMessage(MESSAGES.app.mockWallet, { address: wallet.label.toUpperCase() })}
      </button>
    </header>
  );
};

/** Header of every other screen: back to the city, title, balance. */
export const ScreenTopBar: React.FC<{ title: string; subtitle?: string; right?: React.ReactNode }> = ({
  title,
  subtitle,
  right,
}) => (
  <header className={barClass}>
    <Link href="/" aria-label={MESSAGES.app.back} className="bas-btn min-h-9 shrink-0 px-2.5">
      <BackIcon size={14} />
      <span className="hidden sm:inline">{MESSAGES.app.back}</span>
    </Link>
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate font-heading text-[14px] tracking-wider md:text-[17px]">{title}</span>
      {subtitle && <span className="hidden truncate text-[13px] font-medium text-[#33485c] sm:block md:text-[14px]">{subtitle}</span>}
    </div>
    <div className="flex-1" />
    {right}
    <TokenPill />
    <MockBadge />
  </header>
);

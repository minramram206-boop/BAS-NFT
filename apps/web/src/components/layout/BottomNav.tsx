'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';
import { BoardIcon, MarketIcon, PersonIcon, PlazaIcon, PlusIcon, TrophyIcon, UpIcon } from '@/components/ui/icons';
import { cn } from '@/lib/utils/cn';
import { MESSAGES } from '@/messages';
import { useOwnedIds, useSelectedCitizenId } from '@/stores/selectors';

export interface NavTab {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
}

/** The six places of the app, with the current one marked. Shared by the phone bar and the desktop header. */
export function useNavTabs(iconSize = 20): NavTab[] {
  const pathname = usePathname();
  const selectedId = useSelectedCitizenId();
  const newcomer = useOwnedIds().length === 0;
  return [
    { href: '/', label: MESSAGES.nav.city, icon: <PlazaIcon size={iconSize} />, active: pathname === '/' },
    { href: '/missions', label: MESSAGES.nav.missions, icon: <BoardIcon size={iconSize} />, active: pathname === '/missions' },
    { href: '/training', label: MESSAGES.nav.training, icon: <UpIcon size={iconSize} />, active: pathname === '/training' },
    { href: '/season', label: MESSAGES.nav.season, icon: <TrophyIcon size={iconSize} />, active: pathname === '/season' },
    { href: '/market', label: MESSAGES.nav.market, icon: <MarketIcon size={iconSize} />, active: pathname === '/market' },
    // Someone without a citizen has no profile of their own yet; the last place is where one is minted.
    newcomer
      ? { href: '/mint', label: MESSAGES.nav.mint, icon: <PlusIcon size={iconSize} />, active: pathname === '/mint' }
      : {
          href: `/citizen/${selectedId}`,
          label: MESSAGES.nav.citizen,
          icon: <PersonIcon size={iconSize} />,
          active: pathname.startsWith('/citizen'),
        },
  ];
}

/** Tab bar for phones; hidden from tablet width up, where the header carries the links. */
export const BottomNav: React.FC = () => {
  const tabs = useNavTabs();

  return (
    <nav
      aria-label={MESSAGES.nav.label}
      className="pointer-events-auto grid h-16 shrink-0 grid-cols-6 border-t-2 border-[#05090e] bg-[#1a2734] px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.label}
          href={tab.href}
          aria-current={tab.active ? 'page' : undefined}
          className={cn(
            'flex flex-col items-center justify-center gap-1 font-heading text-[9px] no-underline',
            tab.active ? 'text-[#f7d23d]' : 'text-[#c9d5e0]',
          )}
        >
          {tab.icon}
          {tab.label}
        </Link>
      ))}
    </nav>
  );
};

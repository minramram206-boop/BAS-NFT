'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';
import { BoardIcon, PersonIcon, PlazaIcon, TrophyIcon, UpIcon } from '@/components/ui/icons';
import { cn } from '@/lib/utils/cn';
import { MESSAGES } from '@/messages';
import { useSelectedCitizenId } from '@/stores/selectors';

/** Tab bar for phones; hidden from tablet width up, where panels carry the links. */
export const BottomNav: React.FC = () => {
  const pathname = usePathname();
  const selectedId = useSelectedCitizenId();
  const tabs = [
    { href: '/', label: MESSAGES.nav.city, icon: <PlazaIcon size={20} />, active: pathname === '/' },
    { href: '/missions', label: MESSAGES.nav.missions, icon: <BoardIcon size={20} />, active: pathname === '/missions' },
    { href: '/training', label: MESSAGES.nav.training, icon: <UpIcon size={20} />, active: pathname === '/training' },
    { href: '/season', label: MESSAGES.nav.season, icon: <TrophyIcon size={20} />, active: pathname === '/season' },
    {
      href: `/citizen/${selectedId}`,
      label: MESSAGES.nav.citizen,
      icon: <PersonIcon size={20} />,
      active: pathname.startsWith('/citizen'),
    },
  ];

  return (
    <nav
      aria-label={MESSAGES.nav.label}
      className="pointer-events-auto grid h-16 shrink-0 grid-cols-5 border-t-2 border-[#05090e] bg-[#1a2734] px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
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

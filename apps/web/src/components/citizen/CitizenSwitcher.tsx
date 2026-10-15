'use client';

import Link from 'next/link';
import React from 'react';
import type { CitizenRecord } from '@bas/content';
import { PanelTab } from '@/components/ui/PanelTab';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import { useCanMint, useCitizens, useOwnedIds } from '@/stores/selectors';

export interface CitizenSwitcherProps {
  /** Accessible name of the group. */
  label: string;
  /** The citizen shown as chosen. */
  activeId: number | undefined;
  /** Picks a citizen in place. Ignored when `href` is given. */
  onPick?: ((id: number) => void) | undefined;
  /** Makes every tab a link instead, for screens that are one page per citizen. */
  href?: ((id: number) => string) | undefined;
  /** From laptop width, spread the tabs over the full width of the column, four to a row. */
  fill?: boolean | undefined;
  className?: string | undefined;
}

/** Heading above the tabs: the group icon and a name. */
export const SwitcherLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <PanelTab icon="/icons/icon_citizens_group.png">{children}</PanelTab>
);

/** The wallet's citizens as a row of avatar tabs. */
export const CitizenSwitcher: React.FC<CitizenSwitcherProps> = ({ label, activeId, onPick, href, fill = false, className }) => {
  const owned = useOwnedIds();
  const citizens = useCitizens();
  const canMint = useCanMint();
  const mine = owned
    .map((id) => citizens.find((citizen) => citizen.id === id))
    .filter((citizen): citizen is CitizenRecord => citizen !== undefined);

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(fill ? 'flex flex-wrap gap-1.5 p-0.5 lg:grid lg:grid-cols-4 lg:gap-2' : 'flex flex-wrap gap-1.5 p-0.5', className)}
    >
      {mine.map((citizen) => {
        const active = citizen.id === activeId;
        const name = formatMessage(MESSAGES.a11y.selectCitizen, { name: citizen.name });
        const tab = cn(
          'bas-chip flex items-center justify-center rounded-md no-underline',
          fill ? 'h-12 w-12 lg:aspect-square lg:h-auto lg:w-full' : 'h-12 w-12',
          active ? 'border-[3px] border-[#f7d23d] bg-white outline outline-2 outline-[#1a2734]' : 'border-2 border-[#1b2a38] bg-[#f2f6fa]',
        );
        const sprite = <img src={citizen.sprite} alt="" width={48} height={48} className={fill ? 'h-9 w-9 lg:h-[72%] lg:w-[72%]' : 'h-9 w-9'} />;
        return href ? (
          <Link key={citizen.id} href={href(citizen.id)} aria-label={name} aria-current={active ? 'page' : undefined} title={citizen.name} className={tab}>
            {sprite}
          </Link>
        ) : (
          <button
            key={citizen.id}
            type="button"
            aria-pressed={active}
            aria-label={name}
            title={citizen.name}
            onClick={() => onPick?.(citizen.id)}
            className={tab}
          >
            {sprite}
          </button>
        );
      })}
      {canMint && (
        <Link
          href="/mint"
          aria-label={MESSAGES.a11y.mintCitizen}
          title={MESSAGES.a11y.mintCitizen}
          className={cn(
            'flex items-center justify-center rounded-md border-2 border-dashed border-[#5f7a92] bg-transparent font-heading text-[20px] text-[#33485c] no-underline hover:bg-[#f2f6fa]',
            fill ? 'h-12 w-12 lg:aspect-square lg:h-auto lg:w-full' : 'h-12 w-12',
          )}
        >
          +
        </Link>
      )}
    </div>
  );
};

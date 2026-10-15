import React from 'react';
import type { CitizenRecord } from '@bas/content';
import { STAT_COLORS, STAT_ORDER } from '@/config/constants';
import { MESSAGES } from '@/messages';

/**
 * The three scores of a citizen as small tiles, in the colors of their stats.
 * `compact` puts the label and the score on one line, for the market cards.
 */
export const StatTiles: React.FC<{ citizen: CitizenRecord; compact?: boolean }> = ({ citizen, compact = false }) => (
  <ul className="m-0 grid list-none grid-cols-3 gap-1.5 p-0">
    {STAT_ORDER.map((stat) => (
      <li
        key={stat}
        className={
          compact
            ? 'flex min-w-0 items-center justify-center gap-1.5 rounded-md py-1'
            : 'flex min-w-0 flex-col items-center gap-0.5 rounded-md py-1'
        }
        style={{ backgroundColor: STAT_COLORS[stat].soft }}
      >
        <span className="font-heading text-[10px]" style={{ color: STAT_COLORS[stat].fill }}>
          {MESSAGES.stats[stat].shortLabel}
        </span>
        <span className={compact ? 'font-heading text-[15px] leading-none' : 'font-heading text-[17px] leading-none'}>
          {citizen[stat]}
        </span>
      </li>
    ))}
  </ul>
);

/** Who a dialog is about: the portrait, the name and the role. */
export const CitizenLine: React.FC<{ citizen: CitizenRecord }> = ({ citizen }) => (
  <div className="flex items-center gap-3">
    <div className="bas-inset bas-grid-bg flex h-16 w-16 shrink-0 items-center justify-center">
      <img src={citizen.sprite} alt="" width={56} height={56} className="h-14 w-14" />
    </div>
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate font-heading text-[15px]">{citizen.name}</span>
      <span className="text-[14px] text-[#33485c]">
        {citizen.code} · {citizen.role}
      </span>
    </div>
  </div>
);

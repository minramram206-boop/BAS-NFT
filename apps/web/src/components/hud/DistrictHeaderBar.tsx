'use client';

import React from 'react';
import Link from 'next/link';
import { retroAudio } from '@/lib/audio/RetroAudioSynthesizer';
import {
  useIsLoggedIn,
  useSfxEnabled,
  useSupplyCount,
  useToggleLogin,
  useToggleSfx,
  useTokensBurned,
  useWalletAddress,
} from '@/stores/selectors';
import { BROADCAST, INITIAL_SUPPLY_COUNT, UI } from '@/config/constants';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { ArcadeHeaderBar, HeaderTrailingMeta } from './ArcadeHeaderBar';
import { HeaderBay } from './HeaderBay';
import { HeaderSeam } from './HeaderSeam';

const NAME_CLASS =
  'font-heading font-extrabold tracking-wider whitespace-nowrap leading-none text-[#091827]';
const VALUE_CLASS = 'font-heading font-extrabold tracking-wider whitespace-nowrap leading-none text-[#091827]';

/** District 01 header: identity, supply, burn telemetry, and session controls. */
export const DistrictHeaderBar: React.FC = () => {
  const supplyCount = useSupplyCount();
  const tokensBurned = useTokensBurned();
  const sfxEnabled = useSfxEnabled();
  const toggleSfx = useToggleSfx();
  const toggleLogin = useToggleLogin();
  const isLoggedIn = useIsLoggedIn();
  const walletAddress = useWalletAddress();

  return (
    <ArcadeHeaderBar
      pillLabel={UI.networkBadge}
      broadcastTag={BROADCAST.district.tag}
      broadcastMessage={`${UI.districtName} ONLINE • ${INITIAL_SUPPLY_COUNT - supplyCount}/${INITIAL_SUPPLY_COUNT} CITIZENS ACTIVE • ${BROADCAST.district.message}`}
      trailing={<HeaderTrailingMeta>24ms</HeaderTrailingMeta>}
      start={
        <>
          <HeaderBay className="gap-2.5 px-3 md:gap-3 md:px-4">
            <PixelIcon
              src="/icons/shield_crest.png"
              alt="District 01 shield crest"
              className="h-8 md:h-9"
            />
            <span className={`${NAME_CLASS} text-sm md:text-base lg:text-[17px]`}>
              {UI.districtName}
            </span>
          </HeaderBay>

          <HeaderBay className="gap-2 px-3 md:px-4">
            <PixelIcon src="/icons/supply_crate.png" alt="Supply crate" className="h-7 md:h-8" />
            <span className={`${VALUE_CLASS} text-sm md:text-base`}>
              SUPPLY <strong className="text-[#06121f]">{supplyCount}</strong>
            </span>
          </HeaderBay>

          <HeaderBay className="gap-1.5 px-3 md:gap-2 md:px-4">
            <span className="text-sm leading-none md:text-base">🔥</span>
            <span className={`${VALUE_CLASS} text-xs md:text-sm lg:text-[15px]`}>
              BURN{' '}
              <strong className="text-amber-700">
                {tokensBurned} {UI.burnTokenSymbol}
              </strong>
            </span>
          </HeaderBay>
        </>
      }
      end={
        <>
          <HeaderSeam />

          <HeaderBay className="px-2 md:px-2.5">
            <Link
              href="/training"
              onClick={() => retroAudio.play('switch')}
              title="Beralih ke Agent Training Dojo"
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#182635] bg-[#284a6e] px-2 py-1 font-heading text-[10px] font-bold text-white shadow-xs transition-all hover:bg-[#345c88]"
            >
              {UI.switchToDojo}
            </Link>
          </HeaderBay>

          <HeaderBay className="px-2 md:px-2.5">
            <button
              type="button"
              onClick={toggleSfx}
              title="Toggle Audio 8-bit"
              className="inline-flex cursor-pointer items-center rounded-md border border-[#182635] bg-[#ffffff] px-2 py-1 font-heading text-[10px] text-[#102232] transition-colors hover:bg-[#eef5fa]"
            >
              {sfxEnabled ? '🔊 ON' : '🔇 OFF'}
            </button>
          </HeaderBay>

          <HeaderBay className="gap-2.5 px-3 md:gap-3 md:px-4" seamAfter={false}>
            <PixelIcon
              src="/icons/door_icon.png"
              alt="District gate"
              className="h-7 cursor-pointer hover:brightness-110 md:h-8"
            />
            <button
              type="button"
              onClick={toggleLogin}
              title={isLoggedIn ? `Logged in: ${walletAddress}` : 'Login Wallet'}
              className="cursor-pointer whitespace-nowrap rounded-md border-2 border-[#2b1a09] bg-gradient-to-b from-[#d5ad77] via-[#c89c5f] to-[#b6894c] px-3 py-1 font-heading text-xs font-extrabold tracking-wider text-[#2a1a08] shadow-[inset_0_1.5px_0_#e8cd9c,0_2px_0_#2b1a09] transition-all hover:brightness-105 active:translate-y-0.5 active:shadow-[inset_0_1.5px_0_#e8cd9c] md:px-3.5 md:text-sm"
            >
              {isLoggedIn ? walletAddress : 'LOGIN'}
            </button>
          </HeaderBay>
        </>
      }
    />
  );
};

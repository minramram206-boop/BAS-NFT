'use client';

import React from 'react';
import Link from 'next/link';
import { formatTokenAtoms } from '@bas/chain-client/stats';
import {
  usePreviewCostAtoms,
  useShowWalletConnectorUnavailable,
  useSfxEnabled,
  useSupplyCount,
  useToggleSfx,
} from '@/stores/selectors';
import { BROADCAST, UI, districtBroadcastMessage } from '@/config/constants';
import { MESSAGES } from '@/messages';
import { useDistrictTelemetry } from '@/components/layout/DistrictTelemetryProvider';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { ArcadeHeaderBar, HeaderTrailingMeta } from './ArcadeHeaderBar';
import { HeaderBay } from './HeaderBay';
import { HeaderSeam } from './HeaderSeam';

const NAME_CLASS =
  'font-heading font-extrabold tracking-wider whitespace-nowrap leading-none text-[#091827]';
const VALUE_CLASS =
  'font-heading font-extrabold tracking-wider whitespace-nowrap leading-none text-[#091827]';

/** District 01 header: configured network, preview capacity and estimated cost. */
export const DistrictHeaderBar: React.FC = () => {
  const telemetry = useDistrictTelemetry();
  const supplyCount = useSupplyCount();
  const previewCostAtoms = usePreviewCostAtoms();
  const estimatedCost = formatTokenAtoms(previewCostAtoms, telemetry.tokenDecimals);
  const sfxEnabled = useSfxEnabled();
  const toggleSfx = useToggleSfx();
  const showWalletConnectorUnavailable = useShowWalletConnectorUnavailable();

  return (
    <ArcadeHeaderBar
      pillLabel={MESSAGES.district.onlineLabel}
      broadcastTag={BROADCAST.districtTag}
      broadcastMessage={districtBroadcastMessage(
        telemetry.maxSupply - supplyCount,
        telemetry.maxSupply,
        telemetry.networkLabel,
      )}
      trailing={<HeaderTrailingMeta>{telemetry.programShort}</HeaderTrailingMeta>}
      start={
        <>
          <HeaderBay className="gap-2.5 px-3 md:gap-3 md:px-4">
            <PixelIcon
              src="/icons/shield_crest.png"
              alt={MESSAGES.district.shieldAlt}
              className="h-8 md:h-9"
            />
            <span className={`${NAME_CLASS} text-sm md:text-base lg:text-[17px]`}>
              {UI.districtName}
            </span>
          </HeaderBay>

          <HeaderBay className="gap-2 px-3 md:px-4">
            <PixelIcon
              src="/icons/supply_crate.png"
              alt={MESSAGES.district.supplyAlt}
              className="h-7 md:h-8"
            />
            <span className={`${VALUE_CLASS} text-xs md:text-sm`}>
              {MESSAGES.district.supplyLabel}{' '}
              <strong className="text-[#06121f]">{supplyCount}</strong>
            </span>
          </HeaderBay>

          <HeaderBay className="gap-1.5 px-3 md:gap-2 md:px-4">
            <span className="text-sm leading-none md:text-base">🧾</span>
            <span className={`${VALUE_CLASS} text-[10px] md:text-xs lg:text-[13px]`}>
              {MESSAGES.district.previewCostLabel}{' '}
              <strong className="text-amber-700">
                {estimatedCost} {UI.burnTokenSymbol}
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
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#182635] bg-[#284a6e] px-2 py-1 font-heading text-[10px] font-bold text-white shadow-xs transition-all hover:bg-[#345c88]"
            >
              {MESSAGES.training.switchToTraining}
            </Link>
          </HeaderBay>

          <HeaderBay className="px-2 md:px-2.5">
            <button
              type="button"
              onClick={toggleSfx}
              title={sfxEnabled ? MESSAGES.a11y.audioOnTitle : MESSAGES.a11y.audioOffTitle}
              className="inline-flex cursor-pointer items-center rounded-md border border-[#182635] bg-[#ffffff] px-2 py-1 font-heading text-[10px] text-[#102232] transition-colors hover:bg-[#eef5fa]"
            >
              {sfxEnabled ? MESSAGES.district.audioOn : MESSAGES.district.audioOff}
            </button>
          </HeaderBay>

          <HeaderBay className="gap-2.5 px-3 md:gap-3 md:px-4" seamAfter={false}>
            <PixelIcon
              src="/icons/door_icon.png"
              alt={MESSAGES.district.gateAlt}
              className="h-7 md:h-8"
            />
            <button
              type="button"
              onClick={showWalletConnectorUnavailable}
              title={MESSAGES.a11y.loggedInTitle}
              className="cursor-pointer whitespace-nowrap rounded-md border-2 border-[#2b1a09] bg-gradient-to-b from-[#d5ad77] via-[#c89c5f] to-[#b6894c] px-2 py-1 font-heading text-[9px] font-extrabold tracking-wider text-[#2a1a08] shadow-[inset_0_1.5px_0_#e8cd9c,0_2px_0_#2b1a09] transition-all hover:brightness-105 active:translate-y-0.5 md:px-2.5 md:text-[10px]"
            >
              {MESSAGES.a11y.loginButton}
            </button>
          </HeaderBay>
        </>
      }
    />
  );
};

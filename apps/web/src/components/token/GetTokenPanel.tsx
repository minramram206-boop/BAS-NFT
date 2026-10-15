'use client';

import React from 'react';
import { useDistrictTelemetry } from '@/components/layout/DistrictTelemetryProvider';
import { PanelTab } from '@/components/ui/PanelTab';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import { useTrainingConfig } from '@/stores/selectors';

const copy = MESSAGES.token;

/**
 * Where the official token comes from. It is bought on Pump.fun; the app never
 * sells it and never asks for a transfer. The page of the token is linked on
 * mainnet only, because the devnet mint is a test token Pump.fun does not list.
 */
export const GetTokenPanel: React.FC<{ className?: string | undefined }> = ({ className }) => {
  const { tokenSymbol } = useTrainingConfig();
  const { network, utilityTokenMint } = useDistrictTelemetry();
  const live = network === 'mainnet-beta';

  return (
    <section aria-label={formatMessage(copy.tab, { symbol: tokenSymbol })} className={cn('bas-panel flex flex-col gap-3 p-3', className)}>
      <PanelTab icon="/icons/supply_crate.png">{formatMessage(copy.tab, { symbol: tokenSymbol })}</PanelTab>
      <p className="m-0 text-[14px] leading-snug text-[#22354a]">
        {formatMessage(live ? copy.text : copy.testText, { symbol: tokenSymbol })}
      </p>
      <p className="m-0 rounded-md border-2 border-dashed border-[#9fb3c6] px-3 py-2 text-[13px] leading-snug text-[#33485c]">{copy.safe}</p>
      {live && (
        <a
          href={`https://pump.fun/coin/${utilityTokenMint}`}
          target="_blank"
          rel="noreferrer noopener"
          className="bas-btn bas-btn-primary min-h-10 px-3 text-[12px]"
        >
          {copy.buy}
        </a>
      )}
    </section>
  );
};

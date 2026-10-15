'use client';

import Link from 'next/link';
import React from 'react';
import { CheckIcon } from '@/components/ui/icons';
import { PanelTab } from '@/components/ui/PanelTab';
import { formatSol } from '@/lib/format';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import { useCanMint, useDataMode, useMint, useOpenWallet, useTrainingConfig, useWallet } from '@/stores/selectors';

const copy = MESSAGES.welcome;

/** The one next move for a wallet without a citizen: connect, mint, or the reason it cannot. */
export const WelcomeAction: React.FC<{ className?: string }> = ({ className }) => {
  const mode = useDataMode();
  const wallet = useWallet();
  const openWallet = useOpenWallet();
  const mint = useMint();
  const canMint = useCanMint();
  const needsWallet = mode === 'chain' && !wallet.connected;
  const button = cn('bas-btn bas-btn-primary min-h-11 px-3 text-[13px]', className);

  if (needsWallet) {
    return (
      <button type="button" onClick={openWallet} className={button}>
        {copy.connectCta}
      </button>
    );
  }
  if (canMint) {
    return (
      <Link href="/mint" className={button}>
        {formatMessage(copy.mintCta, { price: formatSol(mint.priceLamports) })}
      </Link>
    );
  }
  return (
    <p className="m-0 text-[14px] text-[#33485c]">
      {mint.minted >= mint.maxSupply ? MESSAGES.mint.soldOutNote : MESSAGES.mint.limitNote}
    </p>
  );
};

/**
 * What a wallet without a citizen sees where a citizen would act: the four steps
 * from connecting to training, with the next one as the button.
 */
export const WelcomePanel: React.FC<{ compact?: boolean; className?: string | undefined }> = ({
  compact = false,
  className,
}) => {
  const mode = useDataMode();
  const wallet = useWallet();
  const mint = useMint();
  const { tokenSymbol } = useTrainingConfig();

  const price = formatSol(mint.priceLamports);
  const needsWallet = mode === 'chain' && !wallet.connected;
  const current = needsWallet ? 0 : 1;

  if (compact) {
    return (
      <section aria-label={copy.title} className={cn('bas-panel pointer-events-auto flex w-full flex-col gap-2.5 p-3', className)}>
        <PanelTab>{copy.title}</PanelTab>
        <p className="m-0 text-[14px] leading-snug text-[#22354a]">{needsWallet ? copy.introConnect : copy.introMint}</p>
        <WelcomeAction />
      </section>
    );
  }

  return (
    <section aria-label={copy.title} className={cn('bas-panel pointer-events-auto flex w-full flex-col gap-3 p-4', className)}>
      <PanelTab>{copy.title}</PanelTab>
      <p className="m-0 text-[15px] leading-snug text-[#22354a]">{copy.intro}</p>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {copy.steps.map((step, index) => {
          const done = index < current;
          const next = index === current;
          return (
            <li
              key={step.title}
              aria-current={next ? 'step' : undefined}
              className={cn('flex gap-2.5 rounded-md p-2', next && 'bg-[#fff7cf] ring-2 ring-[#b8962e]')}
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 border-[#1b2a38] font-heading text-[12px]',
                  done ? 'bg-[#3a9a52] text-white' : next ? 'bg-[#f7d23d] text-[#1a2734]' : 'bg-[#c5d5e5] text-[#33485c]',
                )}
              >
                {done ? <CheckIcon size={12} /> : index + 1}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-heading text-[13px] tracking-wide">
                  {formatMessage(step.title, { symbol: tokenSymbol })}
                </span>
                <span className="text-[14px] leading-snug text-[#33485c]">
                  {formatMessage(step.text, { price, symbol: tokenSymbol })}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <WelcomeAction />
      <Link href="/season" className="text-[14px] font-medium text-[#33485c] underline">
        {copy.browse}
      </Link>
    </section>
  );
};

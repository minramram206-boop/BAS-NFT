'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { CitizenStats } from '@/components/citizen/CitizenStats';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { GetTokenPanel } from '@/components/token/GetTokenPanel';
import { PanelTab } from '@/components/ui/PanelTab';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { ReceiptRow } from '@/components/ui/ReceiptRow';
import { Ribbon } from '@/components/ui/Ribbon';
import { formatSol } from '@/lib/format';
import { MESSAGES, formatMessage } from '@/messages';
import {
  useBusy,
  useCitizen,
  useDataMode,
  useMint,
  useMintCitizen,
  useOpenWallet,
  useTrainingConfig,
  useWallet,
} from '@/stores/selectors';

const copy = MESSAGES.mint;

/**
 * The first step of the route: a citizen is minted, not picked. The mint draws
 * one, the program registers it in the same transaction, and it starts at
 * Tier 0 with the scores of its role (SPEC §6).
 */
export const MintScreen: React.FC = () => {
  const mint = useMint();
  const wallet = useWallet();
  const busy = useBusy();
  const mode = useDataMode();
  const mintCitizen = useMintCitizen();
  const openWallet = useOpenWallet();
  const { tokenSymbol } = useTrainingConfig();
  const [mintedId, setMintedId] = useState<number | null>(null);
  const minted = useCitizen(mintedId ?? -1);

  const soldOut = mint.minted >= mint.maxSupply;
  const limitReached = mint.mintedByWallet >= mint.limitPerWallet;
  // Nothing more can be minted by this wallet, whether the sale is out or the wallet hit its limit.
  const done = soldOut || limitReached;
  const price = formatSol(mint.priceLamports);
  // On a cluster nothing can be minted, or even priced against a balance, before a wallet is connected.
  const needsWallet = mode === 'chain' && !wallet.connected;
  const afterLamports = wallet.solLamports >= mint.priceLamports ? wallet.solLamports - mint.priceLamports : 0n;

  const onMint = async () => {
    if (needsWallet) {
      openWallet();
      return;
    }
    const id = await mintCitizen();
    if (id !== null) setMintedId(id);
  };

  const speech = busy
    ? copy.minting
    : minted
      ? copy.speechAfter
      : soldOut
        ? copy.soldOutNote
        : limitReached
          ? copy.limitNote
          : needsWallet
            ? copy.speechConnect
            : copy.speech;

  return (
    <ScreenShell title={copy.title} subtitle={copy.subtitle}>
      <div className="grid grid-cols-1 content-start gap-3 md:gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-label={copy.title} className="bas-panel flex min-w-0 self-start flex-col gap-3 p-3 md:gap-4 md:p-4">
          <div className="grid gap-3 md:grid-cols-[304px_minmax(0,1fr)] md:gap-4">
            <div className="bas-panel flex flex-col items-center justify-center gap-3 p-3">
              <div
                className="relative flex aspect-[276/224] w-[276px] max-w-full items-end justify-center overflow-hidden rounded-md border-2 border-[#1b2a38] pb-[9%]"
                style={{
                  backgroundImage: "url('/images/district/courtyard_stage_bg.png')",
                  backgroundSize: '100% 100%',
                  imageRendering: 'pixelated',
                }}
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_62%,transparent_50%,rgba(11,20,28,0.45)_100%)]"
                />
                <div className="relative">
                  <span aria-hidden className="absolute bottom-0 left-1/2 h-3 w-20 -translate-x-1/2 rounded-[50%] bg-[#0b141c]/40" />
                  {minted ? (
                    <img src={minted.image} alt={minted.name} width={130} height={130} className="citizen-hop relative h-[130px] w-[130px]" />
                  ) : (
                    <PixelIcon src="/icons/icon_mint_egg.png" className="relative h-24" />
                  )}
                </div>
              </div>
              <Ribbon>{minted ? minted.name : copy.mystery}</Ribbon>
              {minted && (
                <p className="m-0 text-center text-[14px] leading-tight text-[#22354a]">
                  {minted.code} · {formatMessage(copy.startsAt, { role: minted.role })}
                </p>
              )}
            </div>

            <div className="bas-panel flex min-w-0 flex-col gap-3 p-3">
              <PanelTab>{minted ? copy.registeredTab : copy.stageTab}</PanelTab>
              {minted ? (
                <>
                  <p className="m-0 text-[15px] leading-snug">{formatMessage(copy.registered, { code: minted.code })}</p>
                  <div className="bas-inset p-3">
                    <CitizenStats citizen={minted} />
                  </div>
                </>
              ) : (
                <>
                  <div className="bas-inset flex flex-1 items-center p-3">
                    <p className="m-0 text-[16px] leading-snug">{speech}</p>
                  </div>
                  <div className="bas-inset flex flex-col px-3 py-1">
                    <ReceiptRow label={copy.getRole} value={copy.getRoleValue} />
                    <ReceiptRow label={copy.getStart} value={copy.getStartValue} />
                    <ReceiptRow label={copy.getScores} value={copy.getScoresValue} />
                  </div>
                </>
              )}
            </div>
          </div>

          {minted && (
            <div className="bas-inset relative rounded-md p-3">
              <p className="m-0 text-[16px] leading-snug">{speech}</p>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            {minted && done ? (
              <Link href="/missions" className="bas-btn bas-btn-primary min-h-12 text-[14px]">
                {copy.firstMission}
              </Link>
            ) : (
              <button
                type="button"
                onClick={onMint}
                disabled={busy || done}
                className="bas-btn bas-btn-primary min-h-12 text-[14px]"
              >
                {soldOut
                  ? copy.soldOut
                  : limitReached
                    ? copy.limitReached
                    : busy
                      ? copy.minting
                      : needsWallet
                        ? copy.ctaConnect
                        : formatMessage(minted ? copy.ctaAgain : copy.cta, { price })}
              </button>
            )}
            {minted && !done ? (
              <Link href="/missions" className="bas-btn min-h-12 px-5 text-[14px]">
                {copy.firstMission}
              </Link>
            ) : (
              <Link href="/" className="bas-btn min-h-12 px-5 text-[14px]">
                {MESSAGES.app.back}
              </Link>
            )}
          </div>
        </section>

        <aside className="flex min-w-0 flex-col gap-3 md:gap-4">
          <section className="bas-panel flex flex-col gap-3 p-3 md:p-4">
            <PanelTab icon="/icons/icon_mint_egg.png">{copy.receiptTab}</PanelTab>
            <div className="bas-inset flex flex-col px-3 py-1">
              <ReceiptRow label={copy.price} value={price} strong />
              <ReceiptRow label={copy.minted} value={formatMessage(copy.mintedValue, { minted: mint.minted, max: mint.maxSupply })} />
              <ReceiptRow label={copy.yourMints} value={needsWallet ? copy.notConnected : formatMessage(copy.yourMintsValue, { used: mint.mintedByWallet, limit: mint.limitPerWallet })} />
              <ReceiptRow label={copy.balance} value={needsWallet ? copy.notConnected : formatSol(wallet.solLamports)} />
              {!done && !needsWallet && <ReceiptRow label={copy.after} value={formatSol(afterLamports)} />}
            </div>
            <p className="m-0 text-[13px] leading-snug text-[#33485c]">{mode === 'chain' ? copy.chainNote : copy.mockNote}</p>
          </section>

          <section className="bas-panel flex flex-col gap-3 p-3 md:p-4">
            <PanelTab>{copy.howTab}</PanelTab>
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {copy.how.map((step, index) => (
                <li key={step.title} className="bas-inset flex items-start gap-3 p-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border-2 border-[#0b141c] bg-[#f7d23d] font-heading text-[13px]">
                    {index + 1}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-heading text-[13px] tracking-wide">{formatMessage(step.title, { symbol: tokenSymbol })}</span>
                    <span className="text-[14px] leading-snug text-[#33485c]">{formatMessage(step.text, { symbol: tokenSymbol })}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <GetTokenPanel />
        </aside>
      </div>
    </ScreenShell>
  );
};

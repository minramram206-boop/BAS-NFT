'use client';

import React from 'react';
import { useWalletController, useWalletState } from '@/lib/wallet/context';
import { MESSAGES, formatMessage } from '@/messages';
import { useCloseWalletDialog, useWalletDialog } from '@/stores/selectors';

const copy = MESSAGES.wallet;

/** Lists the wallets in this browser and connects the one the person picks. */
export const WalletDialog: React.FC<{ cluster: 'devnet' | 'mainnet-beta' }> = ({ cluster }) => {
  const open = useWalletDialog();
  const close = useCloseWalletDialog();
  const controller = useWalletController();
  const state = useWalletState();
  if (!open) return null;

  const network = cluster === 'devnet' ? copy.networkDevnet : copy.networkMainnet;
  const connected = state.status === 'connected' && state.walletName !== null;

  return (
    <div role="presentation" onClick={close} className="fixed inset-0 z-[55] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        onClick={(event) => event.stopPropagation()}
        className="bas-panel flex w-full max-w-sm flex-col gap-3 p-5"
      >
        <div className="border-b border-[#8ba5ba] pb-2 text-center font-heading text-[16px] font-bold tracking-wide">{copy.title}</div>

        {connected ? (
          <>
            <p className="m-0 text-center text-[15px] leading-snug text-[#27384a]">
              {formatMessage(copy.connectedWith, { wallet: state.walletName ?? '' })}
            </p>
            <div className="bas-inset break-all px-3 py-2 text-center font-heading text-[13px]">{state.address}</div>
            <button
              type="button"
              className="bas-btn min-h-11"
              onClick={() => {
                void controller.disconnect();
                close();
              }}
            >
              {copy.disconnect}
            </button>
          </>
        ) : (
          <>
            <p className="m-0 text-[15px] leading-snug text-[#27384a]">{copy.choose}</p>
            <p className="m-0 text-[14px] leading-snug text-[#33485c]">{formatMessage(copy.network, { network })}</p>

            {state.options.length === 0 ? (
              <p className="m-0 rounded-md border-2 border-[#1b2a38] bg-white p-3 text-[14px] leading-snug">{copy.none}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {state.options.map((option) => (
                  <li key={option.name}>
                    <button
                      type="button"
                      disabled={state.status === 'connecting'}
                      onClick={() =>
                        void controller.connect(option.name).then(() => {
                          if (controller.getState().status === 'connected') close();
                        })
                      }
                      className="bas-btn flex min-h-12 w-full items-center justify-start gap-3 px-3 disabled:opacity-60"
                    >
                      {/* The icon is a data: URI the wallet supplies. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={option.icon} alt="" width={28} height={28} className="h-7 w-7 rounded" />
                      <span className="font-heading text-[14px]">{option.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {state.status === 'connecting' && (
              <p className="m-0 text-center text-[14px] font-semibold text-[#22354a]">{formatMessage(copy.connecting, { wallet: state.walletName ?? '…' })}</p>
            )}
            {state.failure && (
              <p role="alert" className="m-0 text-center text-[14px] font-semibold text-[#9a2b2b]">
                {state.failure === 'declined' ? copy.declined : copy.failed}
              </p>
            )}
            <p className="m-0 text-[13px] leading-snug text-[#5b6b7a]">{copy.signInNote}</p>
          </>
        )}

        <button type="button" onClick={close} className="bas-btn min-h-11">
          {MESSAGES.actions.closeModal}
        </button>
      </div>
    </div>
  );
};

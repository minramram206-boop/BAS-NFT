'use client';

import React from 'react';
import type { CitizenRecord } from '@bas/content';
import { PanelTab } from '@/components/ui/PanelTab';
import { MAX_CHAT_MESSAGE_CHARS } from '@/lib/data/chat';
import { formatWait } from '@/lib/format';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import type { ChatLine } from '@/stores/types';
import { useOpenWallet, useWallet } from '@/stores/selectors';
import { useCitizenChat } from './useCitizenChat';

const copy = MESSAGES.chat;

const Bubble: React.FC<{ line: ChatLine; name: string }> = ({ line, name }) => {
  if (line.from === 'notice') {
    return <p className="m-0 self-center rounded-md bg-[#e3ecf4] px-3 py-1.5 text-center text-[13px] text-[#2b3d4f]">{line.text}</p>;
  }
  const mine = line.from === 'owner';
  return (
    <div className={cn('flex max-w-[88%] flex-col gap-0.5', mine ? 'items-end self-end' : 'items-start self-start')}>
      <span className="text-[12px] text-[#33485c]">
        {mine ? copy.youLabel : name}
        {line.emotion && line.emotion !== 'neutral' ? ` · ${line.emotion}` : ''}
      </span>
      <p
        className={cn(
          'm-0 whitespace-pre-wrap break-words rounded-md border-2 border-[#1b2a38] px-3 py-1.5 text-[15px] leading-snug',
          mine ? 'bg-[#cfe3f7]' : 'bg-white',
        )}
      >
        {line.text}
      </p>
    </div>
  );
};

const MemoryBlock: React.FC<{ name: string; chat: ReturnType<typeof useCitizenChat> }> = ({ name, chat }) => {
  const { memory } = chat;
  return (
    <div className="flex flex-col gap-2 rounded-md bg-[#f2f6fa] p-3">
      <span className="font-heading text-[12px] uppercase tracking-widest text-[#2b3d4f]">{formatMessage(copy.memoryTitle, { name })}</span>
      {memory ? (
        <>
          {memory.nickname || memory.summary ? (
            <div className="flex flex-col gap-1 text-[14px] text-[#1a2734]">
              {memory.nickname && <span>{formatMessage(copy.memoryNickname, { nickname: memory.nickname })}</span>}
              {memory.summary && <span>{memory.summary}</span>}
              <span className="text-[13px] text-[#33485c]">{formatMessage(copy.memoryPrivate, { name })}</span>
            </div>
          ) : (
            <span className="text-[14px] text-[#33485c]">{copy.memoryNothing}</span>
          )}
          <span className="font-heading text-[12px] uppercase tracking-widest text-[#2b3d4f]">{copy.memoryPublic}</span>
          {memory.publicHistory.length > 0 ? (
            <ul className="m-0 grid list-disc gap-0.5 pl-5 text-[14px]">
              {memory.publicHistory.map((entry, index) => (
                <li key={`${index}-${entry}`}>{entry}</li>
              ))}
            </ul>
          ) : (
            <span className="text-[14px] text-[#33485c]">{copy.memoryPublicNothing}</span>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="bas-btn" disabled={chat.memoryBusy} onClick={chat.forget}>
              {formatMessage(copy.forget, { name: name.toUpperCase() })}
            </button>
            <button type="button" className="bas-btn" onClick={chat.hideMemory}>
              {copy.memoryHide}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
};

/** Owner-only conversation with one citizen, with the quota, the memory and the AI disclosure in plain view. */
export const ChatPanel: React.FC<{ citizen: CitizenRecord; className?: string }> = ({ citizen, className }) => {
  const chat = useCitizenChat(citizen.id, citizen.name);
  const wallet = useWallet();
  const openWallet = useOpenWallet();
  const endRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [chat.log.length, chat.sending]);

  const { status } = chat;
  const spent = status !== null && status.remaining <= 0;
  const canWrite = chat.available && chat.phase === 'ready' && status?.enabled === true && !spent;

  const body = (() => {
    if (!chat.available) return <p className="m-0 text-[15px] text-[#2b3d4f]">{copy.previewOnly}</p>;
    if (chat.phase === 'checking') return <p className="m-0 text-[15px] text-[#2b3d4f]">{copy.checking}</p>;
    if (chat.phase === 'signed-out') {
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="m-0 text-[15px] text-[#2b3d4f]">{formatMessage(copy.connect, { name: citizen.name })}</p>
          <button type="button" className="bas-btn bas-btn-primary" onClick={wallet.connected ? chat.retry : openWallet}>
            {wallet.connected ? copy.retry : MESSAGES.wallet.connect}
          </button>
        </div>
      );
    }
    if (chat.phase === 'unreachable') {
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="m-0 text-[15px] text-[#2b3d4f]">{copy.unreachable}</p>
          <button type="button" className="bas-btn" onClick={chat.retry}>
            {copy.retry}
          </button>
        </div>
      );
    }
    if (status && !status.enabled) return <p className="m-0 text-[15px] text-[#2b3d4f]">{copy.off}</p>;

    return (
      <>
        <div className="bas-inset flex max-h-[300px] min-h-[120px] flex-col gap-2 overflow-y-auto p-3" aria-live="polite">
          {chat.log.length === 0 && (
            <p className="m-0 self-center py-4 text-center text-[14px] text-[#33485c]">{formatMessage(copy.empty, { name: citizen.name })}</p>
          )}
          {chat.log.map((line) => (
            <Bubble key={line.id} line={line} name={citizen.name} />
          ))}
          {chat.sending && <p className="m-0 text-[13px] text-[#33485c]">{formatMessage(copy.thinking, { name: citizen.name })}</p>}
          <div ref={endRef} />
        </div>

        {status?.breakReminder && (
          <p className="m-0 rounded-md border-2 border-[#b58a1d] bg-[#fff3cf] px-3 py-2 text-[14px] text-[#4a3a0a]">{copy.breakReminder}</p>
        )}

        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void chat.send();
          }}
        >
          <textarea
            value={chat.draft}
            onChange={(event) => chat.setDraft(event.target.value.slice(0, MAX_CHAT_MESSAGE_CHARS))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void chat.send();
              }
            }}
            rows={2}
            maxLength={MAX_CHAT_MESSAGE_CHARS}
            disabled={!canWrite || chat.sending}
            placeholder={formatMessage(copy.placeholder, { name: citizen.name })}
            aria-label={formatMessage(copy.placeholder, { name: citizen.name })}
            className="w-full resize-none rounded-md border-2 border-[#1b2a38] bg-white px-3 py-2 font-sans text-[15px] leading-snug text-[#1a2734] disabled:bg-[#d3dde6]"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] text-[#33485c]">
              {status &&
                (spent
                  ? formatMessage(MESSAGES.chat.notices.quota, { name: citizen.name, time: formatWait(status.resetsInMs) })
                  : formatMessage(copy.remaining, { remaining: status.remaining, limit: status.limit }))}
              {' · '}
              {formatMessage(copy.counter, { count: [...chat.draft].length, max: MAX_CHAT_MESSAGE_CHARS })}
            </span>
            <button type="submit" className="bas-btn bas-btn-primary" disabled={!canWrite || chat.sending || chat.draft.trim() === ''}>
              {copy.send}
            </button>
          </div>
        </form>

        {chat.memory ? (
          <MemoryBlock name={citizen.name} chat={chat} />
        ) : (
          <button type="button" className="bas-btn self-start" disabled={chat.memoryBusy} onClick={chat.showMemory}>
            {copy.memoryShow}
          </button>
        )}
      </>
    );
  })();

  return (
    <section id="citizen-chat" className={cn('bas-panel flex flex-col gap-2.5 p-3 md:p-4', className)}>
      <PanelTab icon="/icons/door_icon.png">{formatMessage(copy.title, { name: citizen.name })}</PanelTab>
      <p className="m-0 text-[13px] leading-snug text-[#33485c]">{formatMessage(copy.aiNote, { name: citizen.name })}</p>
      {body}
    </section>
  );
};

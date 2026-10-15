'use client';

import React from 'react';
import { ChatPortError, MAX_CHAT_MESSAGE_CHARS, type ChatMemoryView, type ChatStatusView } from '@/lib/data/chat';
import { formatWait } from '@/lib/format';
import { MESSAGES, formatMessage } from '@/messages';
import { useChatLog, useChatLogActions, useChatPort } from '@/stores/selectors';

const copy = MESSAGES.chat;

export type ChatPhase = 'checking' | 'ready' | 'unreachable' | 'signed-out';

/** The sentence for a refusal, by the code the data source reports. */
function noticeFor(code: ChatPortError['code'], name: string): string {
  if (code === 'declined') return copy.notices.declinedSignIn;
  if (code === 'not-connected') return formatMessage(copy.connect, { name });
  const notices = copy.notices as Readonly<Record<string, string>>;
  return formatMessage(notices[code] ?? copy.notices.unavailable, { name, max: MAX_CHAT_MESSAGE_CHARS, time: '' });
}

/**
 * Everything the chat panel needs for one citizen: the quota, the lines on
 * screen, sending, and the citizen's memory of this wallet. A message the
 * citizen could not answer is taken off the screen and put back in the box, so
 * it is never lost.
 */
export function useCitizenChat(citizenId: number, name: string) {
  const port = useChatPort();
  const log = useChatLog(citizenId);
  const { addChatLine, removeChatLine, clearChatLog, react } = useChatLogActions();

  const [phase, setPhase] = React.useState<ChatPhase>('checking');
  const [status, setStatus] = React.useState<ChatStatusView | null>(null);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [memory, setMemory] = React.useState<ChatMemoryView | null>(null);
  const [memoryBusy, setMemoryBusy] = React.useState(false);
  const mounted = React.useRef(true);
  // Read by `send` so a reply can refresh the notes only while the owner has them open.
  const memoryOpen = React.useRef(false);
  memoryOpen.current = memory !== null;

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadStatus = React.useCallback(async () => {
    if (!port) return;
    setPhase('checking');
    try {
      setStatus(await port.status(citizenId));
      if (mounted.current) setPhase('ready');
    } catch (error) {
      if (!mounted.current) return;
      const code = error instanceof ChatPortError ? error.code : 'unavailable';
      setPhase(code === 'not-connected' || code === 'declined' ? 'signed-out' : 'unreachable');
    }
  }, [port, citizenId]);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const notice = React.useCallback(
    (text: string) => {
      addChatLine(citizenId, { from: 'notice', text });
    },
    [addChatLine, citizenId],
  );

  /** The server saves a new note before it answers, so the panel is brought up to date once the reply arrives. */
  const refreshMemory = React.useCallback(async () => {
    if (!port || !memoryOpen.current) return;
    try {
      const fresh = await port.memory(citizenId);
      if (mounted.current && memoryOpen.current) setMemory(fresh);
    } catch {
      // The panel keeps what it shows; opening it again retries.
    }
  }, [port, citizenId]);

  const send = React.useCallback(async () => {
    const text = draft.trim();
    if (!port || sending || text === '') return;
    setSending(true);
    setDraft('');
    const lineId = addChatLine(citizenId, { from: 'owner', text });
    const giveBack = () => {
      removeChatLine(citizenId, lineId);
      setDraft(text);
    };
    try {
      const result = await port.send(citizenId, text);
      if (!mounted.current) return;
      setStatus((current) =>
        current ? { ...current, remaining: result.remaining, breakReminder: result.breakReminder } : current,
      );
      if (result.kind === 'reply') {
        addChatLine(citizenId, { from: 'citizen', text: result.reply, emotion: result.emotion });
        react(citizenId, result.animation, result.emotion);
        void refreshMemory();
      } else if (result.kind === 'declined') {
        notice(formatMessage(copy.notices.declined, { name }));
      } else {
        const notices = copy.notices as Readonly<Record<string, string>>;
        const reset = formatWait(result.quotaResetsInMs ?? 0);
        notice(formatMessage(notices[result.reason] ?? copy.notices.unavailable, { name, time: reset }));
        // Chat is off or the citizen was busy: the message was never used, so it goes back in the box.
        if (result.reason !== 'quota') giveBack();
      }
    } catch (error) {
      if (!mounted.current) return;
      const code = error instanceof ChatPortError ? error.code : 'unavailable';
      notice(noticeFor(code, name));
      giveBack();
    } finally {
      if (mounted.current) setSending(false);
    }
  }, [port, sending, draft, citizenId, name, addChatLine, removeChatLine, react, notice, refreshMemory]);

  const showMemory = React.useCallback(async () => {
    if (!port) return;
    setMemoryBusy(true);
    try {
      setMemory(await port.memory(citizenId));
    } catch {
      notice(copy.notices.unavailable);
    } finally {
      if (mounted.current) setMemoryBusy(false);
    }
  }, [port, citizenId, notice]);

  const forget = React.useCallback(async () => {
    if (!port) return;
    setMemoryBusy(true);
    try {
      await port.forget(citizenId);
      setMemory(await port.memory(citizenId));
      notice(formatMessage(copy.forgot, { name }));
    } catch {
      notice(copy.notices.unavailable);
    } finally {
      if (mounted.current) setMemoryBusy(false);
    }
  }, [port, citizenId, name, notice]);

  return {
    available: port !== undefined,
    phase,
    status,
    log,
    draft,
    setDraft,
    sending,
    send,
    retry: loadStatus,
    memory,
    memoryBusy,
    showMemory,
    hideMemory: () => setMemory(null),
    forget,
    clearLog: () => clearChatLog(citizenId),
  };
}

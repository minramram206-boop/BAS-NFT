'use client';

import React, { useMemo, useState } from 'react';
import type { MissionDefinition, MissionStep } from '@/lib/data/types';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import { missionCopy, type StepCopy } from './missionCopy';

const copy = MESSAGES.missions;

/** Same order on every render for a given step, never the solved order. */
function scrambled(count: number, seed: string): number[] {
  let state = [...seed].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const order = Array.from({ length: count }, (_, index) => index);
  for (let index = count - 1; index > 0; index -= 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    const swap = state % (index + 1);
    [order[index], order[swap]] = [order[swap] as number, order[index] as number];
  }
  if (order.every((value, index) => value === index)) order.reverse();
  return order;
}

const Talk: React.FC<{ step: Extract<MissionStep, { kind: 'talk' }>; text: StepCopy; onSolved: () => void }> = ({
  step,
  text,
  onSolved,
}) => {
  const [wrong, setWrong] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-2">
      {(text.options ?? []).map((option, index) => (
        <button
          key={option}
          type="button"
          onClick={() => (index === step.answer ? onSolved() : setWrong(index))}
          className={cn(
            'bas-chip rounded-md border-2 px-3 py-2.5 text-left text-[15px] leading-snug',
            wrong === index ? 'border-[#a3432f] bg-[#f6e1dc]' : 'border-[#1b2a38] bg-white hover:bg-[#f2f6fa]',
          )}
        >
          {option}
        </button>
      ))}
      {wrong !== null && <p className="m-0 text-[14px] font-semibold text-[#a3432f]">{copy.wrongAnswer}</p>}
    </div>
  );
};

const Puzzle: React.FC<{ text: StepCopy; seed: string; onSolved: () => void }> = ({ text, seed, onSolved }) => {
  const pieces = text.pieces ?? [];
  const order = useMemo(() => scrambled(pieces.length, seed), [pieces.length, seed]);
  const [placed, setPlaced] = useState<number[]>([]);
  const [wrong, setWrong] = useState(false);

  const pick = (piece: number) => {
    if (piece !== placed.length) {
      setPlaced([]);
      setWrong(true);
      return;
    }
    const next = [...placed, piece];
    setPlaced(next);
    setWrong(false);
    if (next.length === pieces.length) onSolved();
  };

  return (
    <div className="flex flex-col gap-3">
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {pieces.map((_, index) => (
          <li
            key={index}
            className={cn(
              'flex h-10 items-center gap-2 rounded-md border-2 border-dashed px-3 text-[15px]',
              index < placed.length ? 'border-solid border-[#3f9252] bg-[#e4f3e7] font-semibold' : 'border-[#9fb3c6] bg-[#f2f6fa] text-[#5b6b7a]',
            )}
          >
            <span className="font-heading text-[12px]">{index + 1}</span>
            <span className="flex-1">{index < placed.length ? pieces[index] : ''}</span>
            {index === 0 && <span className="text-[12px] text-[#5b6b7a]">{copy.slotFirst}</span>}
            {index === pieces.length - 1 && <span className="text-[12px] text-[#5b6b7a]">{copy.slotLast}</span>}
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-2 gap-2">
        {order.map((piece) => (
          <button
            key={piece}
            type="button"
            disabled={placed.includes(piece)}
            onClick={() => pick(piece)}
            className="bas-btn min-h-11 bg-white font-pixel text-[15px] normal-case tracking-normal"
          >
            {pieces[piece]}
          </button>
        ))}
      </div>
      <p className={cn('m-0 text-[14px]', wrong ? 'font-semibold text-[#a3432f]' : 'text-[#33485c]')}>
        {wrong ? copy.wrongOrder : formatMessage(copy.puzzleProgress, { placed: placed.length, total: pieces.length })}
      </p>
    </div>
  );
};

export interface MissionStepDialogProps {
  mission: MissionDefinition;
  index: number;
  onSolved: () => void;
  onClose: () => void;
}

/** The talk and puzzle steps of a mission, played in a dialog. */
export const MissionStepDialog: React.FC<MissionStepDialogProps> = ({ mission, index, onSolved, onClose }) => {
  const step = mission.steps[index];
  const text = missionCopy(mission).steps[index];
  if (!step || !text || step.kind === 'goto') return null;

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={text.title}
        onClick={(event) => event.stopPropagation()}
        className="bas-panel flex w-full max-w-md flex-col gap-3 p-5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-heading text-[12px] tracking-wide text-[#7a4689]">{missionCopy(mission).title}</span>
          <span className="text-[13px] text-[#33485c]">
            {formatMessage(copy.trackerStep, { step: index + 1, steps: mission.steps.length })}
          </span>
        </div>
        <div className="font-heading text-[17px] tracking-wide">{text.title}</div>
        {text.prompt && <p className="m-0 text-[15px] leading-relaxed text-[#22354a]">{text.prompt}</p>}
        {step.kind === 'talk' ? (
          <Talk step={step} text={text} onSolved={onSolved} />
        ) : (
          <Puzzle text={text} seed={`${mission.id}:${index}`} onSolved={onSolved} />
        )}
        <button type="button" onClick={onClose} className="bas-btn self-end">
          {copy.close}
        </button>
      </div>
    </div>
  );
};

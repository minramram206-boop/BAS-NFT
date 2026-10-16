'use client';

import React, { useCallback, useState } from 'react';
import { ScreenShell } from '@/components/layout/ScreenShell';
import { PanelTab } from '@/components/ui/PanelTab';
import {
  ExpandIcon,
  NoteIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  ShuffleIcon,
  SkipIcon,
  SpeakerIcon,
} from '@/components/ui/icons';
import { formatTime, type Track, type TrackKind } from '@/lib/studio/playlist';
import { cn } from '@/lib/utils/cn';
import { MESSAGES, formatMessage } from '@/messages';
import { PLAYLIST, useStudioPlayer, type StudioPlayer } from './StudioPlayer';

const copy = MESSAGES.studio;
type Filter = 'all' | TrackKind;

/** A record on a turntable: the cover sits on the label, and the disc turns while music plays. */
const Turntable: React.FC<{ track: Track | null; playing: boolean }> = ({ track, playing }) => (
  <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border-2 border-[#05090e] bg-[#1d1530] lg:aspect-[2/1]">
    <div
      aria-hidden
      className="absolute inset-0 opacity-60"
      style={{
        backgroundImage:
          'radial-gradient(circle at 20% 0%, rgba(246,92,206,0.35), transparent 45%), radial-gradient(circle at 85% 100%, rgba(96,226,246,0.3), transparent 50%)',
      }}
    />
    <div
      className={cn('studio-disc relative aspect-square h-[78%] rounded-full', playing && 'studio-disc-spin')}
      style={{
        background:
          'repeating-radial-gradient(circle, #15121c 0 3px, #221d2c 3px 5px), #15121c',
        boxShadow: '0 0 0 3px #05090e, 0 0 0 6px #f65cce, 0 0 28px rgba(246,92,206,0.45)',
      }}
    >
      <div className="absolute inset-[31%] overflow-hidden rounded-full border-2 border-[#05090e] bg-[#f7d23d]">
        {track?.cover ? (
          <img src={track.cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[#3a2c5c]">
            <NoteIcon size={40} />
          </div>
        )}
      </div>
    </div>
    <Equalizer playing={playing} className="absolute bottom-3 left-3" />
    <Equalizer playing={playing} className="absolute bottom-3 right-3" />
  </div>
);

const Equalizer: React.FC<{ playing: boolean; className?: string }> = ({ playing, className }) => (
  <div aria-hidden className={cn('flex h-10 items-end gap-1', className)}>
    {[0, 1, 2, 3, 4].map((bar) => (
      <span
        key={bar}
        className={cn('w-1.5 bg-[#60e2f6]', playing ? 'studio-bar' : 'h-1.5')}
        style={playing ? { animationDelay: `${bar * -0.23}s` } : undefined}
      />
    ))}
  </div>
);

const Stage: React.FC<{ player: StudioPlayer }> = ({ player }) => {
  const track = player.current;
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const attach = useCallback(
    (element: HTMLVideoElement | null) => {
      setVideo(element);
      player.attachVideo(element);
    },
    // attachVideo is a state setter and never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (track?.kind === 'video') {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-md border-2 border-[#05090e] bg-black">
        <video ref={attach} playsInline className="h-full w-full" onClick={player.toggle} />
        <button
          type="button"
          aria-label={copy.fullscreen}
          onClick={() => void video?.requestFullscreen?.().catch(() => undefined)}
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded border-2 border-[#05090e] bg-[rgba(12,22,34,0.8)] text-[#f2f6fa]"
        >
          <ExpandIcon size={14} />
        </button>
      </div>
    );
  }
  return <Turntable track={track} playing={player.playing} />;
};

const ControlButton: React.FC<{
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, active, disabled, children }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    aria-pressed={active}
    disabled={disabled}
    onClick={onClick}
    className={cn('bas-btn relative h-11 w-11 min-h-0 px-0', active && 'bg-[#f7d23d]')}
  >
    {children}
  </button>
);

const Controls: React.FC<{ player: StudioPlayer }> = ({ player }) => {
  const empty = player.tracks.length === 0;
  const length = Number.isFinite(player.duration) ? player.duration : 0;
  const repeatLabel = { all: copy.repeatAll, one: copy.repeatOne, off: copy.repeatOff }[player.repeat];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 font-heading text-[11px] text-[#33485c]">
        <span className="w-12 text-right tabular-nums">{formatTime(player.time)}</span>
        <input
          type="range"
          aria-label={copy.seek}
          min={0}
          max={length || 1}
          step={0.1}
          value={Math.min(player.time, length || 1)}
          disabled={!player.current || !length}
          onChange={(event) => player.seek(Number(event.target.value))}
          className="studio-range flex-1"
          style={{ '--fill': `${length ? (player.time / length) * 100 : 0}%` } as React.CSSProperties}
        />
        <span className="w-12 tabular-nums">{formatTime(player.duration)}</span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <ControlButton label={copy.shuffle} active={player.shuffle} onClick={player.toggleShuffle} disabled={empty}>
          <ShuffleIcon size={16} />
        </ControlButton>
        <ControlButton label={copy.previous} onClick={player.previous} disabled={empty}>
          <SkipIcon size={16} className="-scale-x-100" />
        </ControlButton>
        <button
          type="button"
          aria-label={player.playing ? copy.pause : copy.play}
          onClick={player.toggle}
          disabled={empty}
          className="bas-btn bas-btn-primary h-14 w-14 min-h-0 px-0"
        >
          {player.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
        </button>
        <ControlButton label={copy.next} onClick={player.next} disabled={empty}>
          <SkipIcon size={16} />
        </ControlButton>
        <ControlButton label={repeatLabel} active={player.repeat !== 'off'} onClick={player.cycleRepeat} disabled={empty}>
          <RepeatIcon size={16} />
          {player.repeat === 'one' && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-[#1b2a38] bg-[#f2f6fa] font-heading text-[8px]">
              1
            </span>
          )}
        </ControlButton>
      </div>

      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          aria-label={player.muted ? copy.unmute : copy.mute}
          onClick={player.toggleMute}
          className="flex h-9 w-9 items-center justify-center text-[#33485c]"
        >
          <SpeakerIcon size={16} muted={player.muted || player.volume === 0} />
        </button>
        <input
          type="range"
          aria-label={copy.volume}
          min={0}
          max={1}
          step={0.01}
          value={player.muted ? 0 : player.volume}
          onChange={(event) => player.setVolume(Number(event.target.value))}
          className="studio-range w-40"
          style={{ '--fill': `${(player.muted ? 0 : player.volume) * 100}%` } as React.CSSProperties}
        />
      </div>
    </div>
  );
};

const Row: React.FC<{ track: Track; player: StudioPlayer }> = ({ track, player }) => {
  const current = player.current?.index === track.index;
  const broken = player.failed.has(track.index);
  return (
    <li>
      <button
        type="button"
        onClick={() => (current ? player.toggle() : player.play(track.index))}
        aria-current={current ? 'true' : undefined}
        className={cn(
          'bas-chip flex w-full items-center gap-3 rounded-md border-2 p-2 text-left',
          current ? 'border-[#1b2a38] bg-[#fff6c9]' : 'border-transparent bg-[#f2f6fa] hover:border-[#9fb2c4]',
        )}
      >
        <span className="w-6 shrink-0 text-center font-heading text-[11px] text-[#33485c]">
          {current && player.playing ? <Equalizer playing className="h-4 justify-center [&>span]:w-1" /> : track.index + 1}
        </span>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border-2 border-[#1b2a38] bg-[#3a2c5c] text-[#f65cce]">
          {track.cover ? <img src={track.cover} alt="" className="h-full w-full object-cover" /> : <NoteIcon size={16} />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-medium text-[#1a2734]">{track.title}</span>
          <span className="truncate text-[13px] text-[#33485c]">
            {broken ? copy.cannotPlay : track.artist || copy.unknownArtist}
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 rounded border-2 border-[#1b2a38] px-1.5 py-0.5 font-heading text-[9px]',
            track.kind === 'video' ? 'bg-[#60e2f6]' : 'bg-[#f6b2e4]',
          )}
        >
          {track.kind === 'video' ? copy.kindVideo : copy.kindMusic}
        </span>
      </button>
    </li>
  );
};

const Playlist: React.FC<{ player: StudioPlayer }> = ({ player }) => {
  const [filter, setFilter] = useState<Filter>('all');
  const shown = player.tracks.filter((track) => filter === 'all' || track.kind === filter);
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: copy.filterAll },
    { id: 'audio', label: copy.filterMusic },
    { id: 'video', label: copy.filterVideo },
  ];

  return (
    <section aria-label={copy.playlist} className="bas-panel flex min-h-0 flex-col gap-3 p-3 md:p-4">
      <div className="flex items-center justify-between gap-2">
        <PanelTab>{copy.playlist}</PanelTab>
        <span className="font-heading text-[11px] text-[#33485c]">
          {formatMessage(player.tracks.length === 1 ? copy.countOne : copy.count, { count: player.tracks.length })}
        </span>
      </div>
      {player.tracks.length > 0 && (
        <div role="tablist" className="grid grid-cols-3 gap-2">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={cn('bas-btn min-h-9 text-[11px]', filter === item.id && 'bg-[#f7d23d]')}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {player.tracks.length === 0 ? (
        <div className="bas-inset bas-grid-bg flex flex-col gap-2 p-4 text-[15px] leading-snug">
          <span className="font-heading text-[12px]">{copy.emptyTitle}</span>
          <span>{copy.emptyBody}</span>
          {process.env.NODE_ENV !== 'production' && (
            <span className="text-[13px] text-[#33485c]">{copy.emptyHint}</span>
          )}
        </div>
      ) : shown.length === 0 ? (
        <p className="m-0 rounded-md bg-[#f2f6fa] p-3 text-[15px]">
          {filter === 'video' ? copy.noVideo : copy.noMusic}
        </p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {shown.map((track) => (
            <Row key={track.index} track={track} player={player} />
          ))}
        </ol>
      )}
    </section>
  );
};

/** BAS Studio: the district's music and videos, played on a stage with a playlist beside it. */
export const StudioScreen: React.FC = () => {
  const player = useStudioPlayer();
  const track = player.current;

  return (
    <ScreenShell title={copy.title} subtitle={copy.subtitle}>
      <div className="grid gap-3 md:gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label={copy.stage} className="bas-panel flex flex-col gap-3 p-3 md:p-4">
          <PanelTab>{track ? copy.nowPlaying : copy.stage}</PanelTab>
          <Stage player={player} />
          <div className="flex min-w-0 flex-col items-center gap-0.5 text-center">
            <span className="max-w-full truncate font-heading text-[18px] tracking-wide">
              {(track?.title ?? copy.idleTitle).toUpperCase()}
            </span>
            <span className="max-w-full truncate text-[15px] text-[#33485c]">
              {track ? track.artist || copy.unknownArtist : copy.idleBody}
            </span>
          </div>
          <Controls player={player} />
          {PLAYLIST.skipped > 0 && process.env.NODE_ENV !== 'production' && (
            <p className="m-0 text-center text-[13px] text-[#a3432f]">
              {formatMessage(copy.skipped, { count: PLAYLIST.skipped })}
            </p>
          )}
        </section>
        <Playlist player={player} />
      </div>
    </ScreenShell>
  );
};

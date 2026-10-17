'use client';

import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useState } from 'react';
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
import { useSelectedCitizen } from '@/stores/selectors';
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

const SpeakerTower: React.FC<{ playing: boolean }> = ({ playing }) => (
  <div
    aria-hidden
    className="hidden w-14 shrink-0 flex-col items-center justify-between rounded border-2 border-[#60e2f6] bg-[#0e0b16] p-2 shadow-[0_0_12px_rgba(96,226,246,0.25)] sm:flex"
  >
    <div className="h-3 w-8 rounded-sm border border-[#3a2c5c] bg-[#221938] p-0.5">
      <div className="h-full w-full bg-[#f65cce]" />
    </div>
    <div
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#3a2c5c] bg-[#09070f] transition-transform duration-150',
        playing && 'scale-110',
      )}
    >
      <div className="h-3 w-3 rounded-full bg-[#60e2f6]" />
    </div>
    <div
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#3a2c5c] bg-[#09070f] transition-transform duration-150',
        playing && 'scale-110',
      )}
    >
      <div className="h-4 w-4 rounded-full bg-[#f65cce]" />
    </div>
    <Equalizer playing={playing} className="h-6 [&>span]:w-1" />
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
      <div className="relative aspect-video w-full overflow-hidden rounded-md border-2 border-[#f65cce] bg-black shadow-[0_0_24px_rgba(246,92,206,0.35)]">
        <video ref={attach} playsInline className="h-full w-full cursor-pointer" onClick={player.toggle} />
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

/**
 * Inside the BAS Studio building: overhead stage rig, speaker stacks, raised stage,
 * walkable studio floor with the player's citizen, and active automatic sliding glass doors.
 */
const StudioHallInterior: React.FC<{ player: StudioPlayer }> = ({ player }) => {
  const router = useRouter();
  const citizen = useSelectedCitizen();
  const [pos, setPos] = useState<{ x: number; y: number; flip: boolean }>({ x: 50, y: 82, flip: false });
  const [doorOpen, setDoorOpen] = useState(true);
  const [doorHover, setDoorHover] = useState(false);

  // When entering the studio room, the citizen steps in from the automatic doors to the stage carpet, and the doors close behind them.
  useEffect(() => {
    const enterTimer = window.setTimeout(() => setPos({ x: 50, y: 38, flip: false }), 60);
    const closeTimer = window.setTimeout(() => setDoorOpen(false), 780);
    return () => {
      window.clearTimeout(enterTimer);
      window.clearTimeout(closeTimer);
    };
  }, []);

  const nearDoor = pos.y >= 62 && Math.abs(pos.x - 50) <= 22;
  const activeDoorOpen = doorOpen || doorHover || nearDoor;

  const handleFloorClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const nx = Math.min(88, Math.max(12, ((event.clientX - rect.left) / rect.width) * 100));
    const ny = Math.min(78, Math.max(20, ((event.clientY - rect.top) / rect.height) * 100));
    setPos((prev) => ({ x: nx, y: ny, flip: nx < prev.x }));
  };

  const handleExitDoor = (event: React.MouseEvent) => {
    event.stopPropagation();
    setDoorOpen(true);
    setPos((prev) => ({ x: 50, y: 84, flip: prev.flip }));
    window.setTimeout(() => router.push('/'), 420);
  };

  return (
    <div className="relative flex flex-col overflow-hidden rounded-md border-2 border-[#05090e] bg-[#161028] shadow-[inset_0_0_40px_rgba(5,9,14,0.8)]">
      {/* Ceiling lighting truss & spotlights */}
      <div aria-hidden className="relative flex h-6 items-center justify-around border-b-2 border-[#f65cce] bg-[#241a3d] px-6">
        {[0, 1, 2, 3].map((spot) => (
          <div key={spot} className="relative flex flex-col items-center">
            <div className="h-2.5 w-4 rounded-b border border-[#05090e] bg-[#0e0b16]" />
            <div className={cn('h-1 w-2 bg-[#f7d23d]', player.playing && 'animate-pulse')} />
          </div>
        ))}
      </div>

      {/* Back stage wall with left/right speaker stacks and center 16:9 stage screen */}
      <div className="relative flex items-stretch gap-2.5 bg-[linear-gradient(90deg,#161028_0%,#1f1738_50%,#161028_100%)] p-2.5 sm:p-3.5">
        <SpeakerTower playing={player.playing} />
        <div className="min-w-0 flex-1">
          <Stage player={player} />
        </div>
        <SpeakerTower playing={player.playing} />
      </div>

      {/* Raised wooden concert stage lip & footlights */}
      <div aria-hidden className="relative flex h-5 items-center justify-around border-y-2 border-[#60e2f6] bg-[#5c3a2e] px-8">
        {[0, 1, 2, 3, 4, 5].map((light) => (
          <span key={light} className="h-1.5 w-3 rounded-full bg-[#f7d23d] shadow-[0_0_6px_#f7d23d]" />
        ))}
        <div className="absolute -bottom-2 left-1/2 h-3 w-20 -translate-x-1/2 border-x-2 border-b-2 border-[#f7d23d] bg-[#825642]" />
      </div>

      {/* Interactive walkable studio floor & automatic entrance/exit doors */}
      <div
        onClick={handleFloorClick}
        className="relative h-36 cursor-pointer select-none overflow-hidden bg-[#1e1633] sm:h-40"
        style={{
          backgroundImage:
            'linear-gradient(45deg, rgba(37,27,61,0.75) 25%, transparent 25%, transparent 75%, rgba(37,27,61,0.75) 75%), linear-gradient(45deg, rgba(37,27,61,0.75) 25%, transparent 25%, transparent 75%, rgba(37,27,61,0.75) 75%)',
          backgroundSize: '28px 28px',
          backgroundPosition: '0 0, 14px 14px',
        }}
      >
        {/* VIP crimson & gold carpet runner from the automatic doors to the stage steps */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 w-24 -translate-x-1/2 border-x-2 border-[#f7d23d] bg-[linear-gradient(90deg,#7a1c4b_0%,#9e2462_50%,#7a1c4b_100%)]"
        />

        {/* Left VIP velvet lounge booth */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-3 top-4 hidden h-16 w-20 rounded border-2 border-[#60e2f6] bg-[#4a1d52] p-1.5 sm:block"
        >
          <div className="h-full w-full rounded-sm bg-[#6e2b7a]" />
        </div>

        {/* Right sound mixing desk */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-3 top-4 hidden h-16 w-24 flex-col justify-between rounded border-2 border-[#60e2f6] bg-[#162030] p-2 sm:flex"
        >
          <div className="flex justify-between gap-1">
            {[0, 1, 2, 3, 4].map((ch) => (
              <span key={ch} className="h-2 w-2 rounded-full bg-[#f65cce]" />
            ))}
          </div>
          <div className="flex h-6 items-end justify-between gap-1">
            {[0, 1, 2, 3, 4].map((fader) => (
              <span key={fader} className="h-full w-1.5 rounded-sm bg-[#33485c]">
                <span className="block h-2 w-full bg-[#60e2f6]" />
              </span>
            ))}
          </div>
        </div>

        {/* Selected citizen standing/walking inside the studio hall */}
        {citizen && (
          <div
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            className="pointer-events-none absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center transition-all duration-500 ease-out"
          >
            <span className="mb-0.5 whitespace-nowrap rounded border border-[#05090e] bg-[#1a2734] px-1.5 py-0.5 font-heading text-[8px] text-[#f7d23d]">
              {citizen.name.toUpperCase()}
            </span>
            <img
              src={citizen.sprite}
              alt={citizen.name}
              className={cn(
                'h-12 w-12 object-contain drop-shadow-[0_3px_0_rgba(0,0,0,0.45)]',
                pos.flip && '-scale-x-100',
                player.playing && 'animate-bounce',
              )}
            />
            <span className="h-2.5 w-9 rounded-full border-2 border-[#f7d23d] bg-[rgba(247,210,61,0.2)]" />
          </div>
        )}

        <span className="pointer-events-none absolute bottom-10 left-3 hidden text-[12px] text-[#9fb2c4] md:inline">
          {copy.floorHint}
        </span>

        {/* Front studio wall sill & Active Automatic Sliding Glass Doors */}
        <div className="
          absolute inset-x-0 bottom-0 z-20 flex h-9 items-end justify-center
          border-t-2 border-[#60e2f6] bg-[#241a3d]
        ">
          <button
            type="button"
            onClick={handleExitDoor}
            onMouseEnter={() => setDoorHover(true)}
            onMouseLeave={() => setDoorHover(false)}
            className="group relative flex h-9 w-44 items-center justify-center overflow-hidden border-x-2 border-t-2 border-[#05090e] bg-[#120d1e]"
          >
            {/* Motion sensor LED bar at top of doorway */}
            <span
              aria-hidden
              className={cn(
                'absolute top-0.5 z-30 h-1.5 w-6 rounded-full border border-[#05090e] transition-colors',
                activeDoorOpen ? 'bg-[#3df79c] shadow-[0_0_6px_#3df79c]' : 'bg-[#60e2f6]',
              )}
            />
            <span className="relative z-10 font-heading text-[9px] tracking-wider text-[#f7d23d]">
              {copy.exitDoor}
            </span>
            {/* Left automatic sliding glass door leaf */}
            <span
              aria-hidden
              className={cn(
                ' absolute inset-y-0 left-0 z-20 w-1/2 border-r border-[#1e1828] bg-[rgba(159,232,245,0.82)] transition-transform duration-300 ease-out',
                activeDoorOpen ? '-translate-x-[76%]' : 'translate-x-0',
              )}
            >
              <span className="absolute right-1.5 top-2.5 h-3.5 w-1 rounded-sm bg-[#f7d23d]" />
            </span>
            {/* Right automatic sliding glass door leaf */}
            <span
              aria-hidden
              className={cn(
                'absolute inset-y-0 right-0 z-20 w-1/2 border-l border-[#1e1828] bg-[rgba(159,232,245,0.82)] transition-transform duration-300 ease-out',
                activeDoorOpen ? 'translate-x-[76%]' : 'translate-x-0',
              )}
            >
              <span className="absolute left-1.5 top-2.5 h-3.5 w-1 rounded-sm bg-[#f7d23d]" />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
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

/** BAS Studio: the district's music and videos, played inside the studio hall with a playlist beside it. */
export const StudioScreen: React.FC = () => {
  const player = useStudioPlayer();
  const track = player.current;

  return (
    <ScreenShell title={copy.title} subtitle={copy.subtitle}>
      <div className="grid gap-3 md:gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label={copy.stage} className="bas-panel flex flex-col gap-3 p-3 md:p-4">
          <PanelTab>{track ? copy.nowPlaying : copy.stage}</PanelTab>
          <StudioHallInterior player={player} />
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

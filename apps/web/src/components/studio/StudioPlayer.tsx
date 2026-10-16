'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NoteIcon, PauseIcon, PlayIcon, SkipIcon } from '@/components/ui/icons';
import studioConfig from '@/config/studio.json';
import { parsePlaylist, type Track } from '@/lib/studio/playlist';
import { MESSAGES } from '@/messages';

export type RepeatMode = 'off' | 'all' | 'one';

export interface StudioPlayer {
  readonly tracks: readonly Track[];
  readonly current: Track | null;
  readonly playing: boolean;
  /** Seconds into the current track, and its length once known. */
  readonly time: number;
  readonly duration: number;
  readonly volume: number;
  readonly muted: boolean;
  readonly repeat: RepeatMode;
  readonly shuffle: boolean;
  /** Tracks the browser could not open, by index. */
  readonly failed: ReadonlySet<number>;
  play: (index: number) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  stop: () => void;
  /** The studio page hands over its video element; `null` when it leaves. */
  attachVideo: (element: HTMLVideoElement | null) => void;
}

/** The playlist in `src/config/studio.json`, read once at build time. */
export const PLAYLIST = parsePlaylist(studioConfig);

const PlayerContext = createContext<StudioPlayer | null>(null);
const VOLUME_KEY = 'bas.studio.volume';
const REPEAT_ORDER: readonly RepeatMode[] = ['all', 'one', 'off'];
/** Past this many seconds, "previous" starts the track again instead of going back one. */
const RESTART_AFTER = 3;

function readVolume(): number {
  try {
    const stored = Number(window.localStorage.getItem(VOLUME_KEY));
    return stored > 0 && stored <= 1 ? stored : 0.8;
  } catch {
    return 0.8;
  }
}

/**
 * Plays the BAS Studio playlist. Music keeps playing while the player walks
 * around the rest of the app; videos only play on the studio page, which lends
 * its video element.
 */
export const StudioPlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const tracks = PLAYLIST.tracks;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(Number.NaN);
  const [volume, setVolumeState] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('all');
  const [shuffle, setShuffle] = useState(false);
  const [failed, setFailed] = useState<ReadonlySet<number>>(new Set());
  /** Set when a track is chosen, so it starts as soon as its element has it. */
  const startRef = useRef(false);

  const current = index === null ? null : (tracks[index] ?? null);
  const media = useCallback(
    (): HTMLMediaElement | null => (current?.kind === 'video' ? video : audioRef.current),
    [current, video],
  );

  useEffect(() => setVolumeState(readVolume()), []);

  const pick = useCallback(
    (from: number | null, step: 1 | -1, wrap: boolean): number | null => {
      if (tracks.length === 0) return null;
      if (shuffle && tracks.length > 1) {
        let choice = from ?? 0;
        while (choice === from) choice = Math.floor(Math.random() * tracks.length);
        return choice;
      }
      const target = (from ?? -1) + step;
      if (target >= 0 && target < tracks.length) return target;
      return wrap ? (target + tracks.length) % tracks.length : null;
    },
    [tracks.length, shuffle],
  );

  const play = useCallback((target: number) => {
    startRef.current = true;
    setIndex(target);
    setTime(0);
    setDuration(Number.NaN);
  }, []);

  const stop = useCallback(() => {
    media()?.pause();
    startRef.current = false;
    setIndex(null);
    setPlaying(false);
    setTime(0);
  }, [media]);

  const next = useCallback(() => {
    const target = pick(index, 1, true);
    if (target === null) stop();
    else play(target);
  }, [index, pick, play, stop]);

  const previous = useCallback(() => {
    const element = media();
    if (element && element.currentTime > RESTART_AFTER) {
      element.currentTime = 0;
      return;
    }
    const target = pick(index, -1, true);
    if (target !== null) play(target);
  }, [index, media, pick, play]);

  // Load the chosen track into its element and empty the other one.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!current || current.kind === 'video') {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    if (current?.kind === 'video' && !video) {
      // The studio page is not open, so there is nowhere to show the video.
      setPlaying(false);
      return;
    }
    const element = current?.kind === 'video' ? video : audio;
    if (!current || !element) return;
    if (element.getAttribute('src') !== current.src) {
      element.src = current.src;
      element.load();
    }
    if (startRef.current) {
      startRef.current = false;
      element.play().catch(() => setPlaying(false));
    }
  }, [current, video]);

  // Follow whichever element is playing.
  useEffect(() => {
    const element = media();
    if (!element || index === null) return undefined;
    const update = () => setTime(element.currentTime);
    const length = () => setDuration(element.duration);
    const started = () => setPlaying(true);
    const paused = () => setPlaying(false);
    const ended = () => {
      if (repeat === 'one') {
        element.currentTime = 0;
        void element.play();
        return;
      }
      const target = pick(index, 1, repeat === 'all');
      if (target === null) {
        setPlaying(false);
        return;
      }
      play(target);
    };
    const broken = () => {
      const lost = new Set(failed).add(index);
      setFailed(lost);
      setPlaying(false);
      // Move on, unless nothing in the list plays at all.
      if (lost.size < tracks.length) {
        const target = pick(index, 1, true);
        if (target !== null) play(target);
      }
    };
    element.addEventListener('timeupdate', update);
    element.addEventListener('durationchange', length);
    element.addEventListener('loadedmetadata', length);
    element.addEventListener('play', started);
    element.addEventListener('pause', paused);
    element.addEventListener('ended', ended);
    element.addEventListener('error', broken);
    return () => {
      element.removeEventListener('timeupdate', update);
      element.removeEventListener('durationchange', length);
      element.removeEventListener('loadedmetadata', length);
      element.removeEventListener('play', started);
      element.removeEventListener('pause', paused);
      element.removeEventListener('ended', ended);
      element.removeEventListener('error', broken);
    };
  }, [media, index, repeat, pick, play, failed, tracks.length]);

  useEffect(() => {
    for (const element of [audioRef.current, video]) {
      if (!element) continue;
      element.volume = volume;
      element.muted = muted;
    }
    try {
      window.localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      // Private windows may refuse storage; the volume just is not remembered.
    }
  }, [volume, muted, video]);

  // Lock screens and headphone buttons control the studio too.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    session.metadata = current
      ? new MediaMetadata({
          title: current.title,
          artist: current.artist || MESSAGES.studio.name,
          album: MESSAGES.studio.name,
          ...(current.cover ? { artwork: [{ src: current.cover }] } : {}),
        })
      : null;
    session.setActionHandler('nexttrack', current ? next : null);
    session.setActionHandler('previoustrack', current ? previous : null);
  }, [current, next, previous]);

  const value = useMemo<StudioPlayer>(
    () => ({
      tracks,
      current,
      playing,
      time,
      duration,
      volume,
      muted,
      repeat,
      shuffle,
      failed,
      play,
      toggle: () => {
        const element = media();
        if (!current) {
          const first = pick(null, 1, false);
          if (first !== null) play(first);
          return;
        }
        if (!element) return;
        if (element.paused) element.play().catch(() => setPlaying(false));
        else element.pause();
      },
      next,
      previous,
      seek: (seconds) => {
        const element = media();
        if (element && Number.isFinite(seconds)) element.currentTime = seconds;
        setTime(seconds);
      },
      setVolume: (level) => {
        setVolumeState(Math.min(1, Math.max(0, level)));
        if (level > 0) setMuted(false);
      },
      toggleMute: () => setMuted((value) => !value),
      cycleRepeat: () => setRepeat((mode) => REPEAT_ORDER[(REPEAT_ORDER.indexOf(mode) + 1) % REPEAT_ORDER.length] ?? 'all'),
      toggleShuffle: () => setShuffle((value) => !value),
      stop,
      attachVideo: setVideo,
    }),
    [tracks, current, playing, time, duration, volume, muted, repeat, shuffle, failed, play, media, pick, next, previous, stop],
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio ref={audioRef} preload="metadata" className="hidden" />
      <NowPlaying variant="float" />
    </PlayerContext.Provider>
  );
};

export function useStudioPlayer(): StudioPlayer {
  const player = useContext(PlayerContext);
  if (!player) throw new Error('useStudioPlayer needs a StudioPlayerProvider above it');
  return player;
}

const copy = MESSAGES.studio;

/**
 * What is playing, shown on the other screens while music from the studio
 * goes on: floating in a corner from tablet width up, and as a strip above the
 * tab bar on phones, where a floating box would cover the panels.
 */
export const NowPlaying: React.FC<{ variant: 'float' | 'bar' }> = ({ variant }) => {
  const player = useStudioPlayer();
  const pathname = usePathname();
  const track = player.current;
  if (!track || track.kind !== 'audio' || pathname === '/studio') return null;

  return (
    <div
      role="region"
      aria-label={copy.nowPlaying}
      className={
        variant === 'float'
          ? 'bas-plate pointer-events-auto fixed bottom-4 right-4 z-40 hidden max-w-[360px] items-center gap-2 p-1.5 pr-2 shadow-[0_3px_0_#05090e] md:flex'
          : 'pointer-events-auto flex items-center gap-2 border-t-2 border-[#05090e] bg-[#241c38] px-2 py-1.5 font-heading text-[12px] tracking-wide text-[#f2f6fa] md:hidden'
      }
    >
      <Link
        href="/studio"
        className="flex min-w-0 flex-1 items-center gap-2 text-[#f2f6fa] no-underline"
        title={copy.openStudio}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[#3a2c5c] text-[#f65cce]">
          <NoteIcon size={14} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[11px]">{track.title}</span>
          <span className="truncate font-pixel text-[12px] text-[#9fb2c4]">{track.artist || copy.unknownArtist}</span>
        </span>
      </Link>
      <button
        type="button"
        onClick={player.toggle}
        aria-label={player.playing ? copy.pause : copy.play}
        className="flex h-8 w-8 items-center justify-center rounded bg-[#f7d23d] text-[#1a2734]"
      >
        {player.playing ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
      </button>
      <button
        type="button"
        onClick={player.next}
        aria-label={copy.next}
        className="flex h-8 w-8 items-center justify-center rounded text-[#c9d5e0] hover:text-[#f2f6fa]"
      >
        <SkipIcon size={13} />
      </button>
      <button
        type="button"
        onClick={player.stop}
        aria-label={copy.stop}
        className="flex h-8 w-6 items-center justify-center text-[16px] text-[#9fb2c4] hover:text-[#f2f6fa]"
      >
        ×
      </button>
    </div>
  );
};

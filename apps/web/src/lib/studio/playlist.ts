/**
 * The BAS Studio playlist. Entries are listed in `src/config/studio.json`;
 * their files sit in `public/studio/` (written `/studio/<file>`) or on any
 * https address, which suits long videos better than the repository does.
 */

export type TrackKind = 'audio' | 'video';

export interface Track {
  /** Position in the playlist, also the key of the row. */
  readonly index: number;
  readonly title: string;
  readonly artist: string;
  readonly src: string;
  readonly kind: TrackKind;
  /** Square picture shown while an audio track plays. */
  readonly cover?: string;
}

const AUDIO = ['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac'];
const VIDEO = ['.mp4', '.m4v', '.webm', '.mov', '.ogv'];

/** Audio or video from the file name, ignoring any query string; `undefined` when it is neither. */
export function kindOf(src: string): TrackKind | undefined {
  const path = src.split(/[?#]/)[0]?.toLowerCase() ?? '';
  if (AUDIO.some((extension) => path.endsWith(extension))) return 'audio';
  if (VIDEO.some((extension) => path.endsWith(extension))) return 'video';
  return undefined;
}

function isAddress(value: unknown): value is string {
  return typeof value === 'string' && (value.startsWith('/') || value.startsWith('https://'));
}

/** "02_night-market.mp3" reads as "Night Market" when an entry has no title. */
export function titleFromSrc(src: string): string {
  const name = decodeURIComponent(src.split(/[?#]/)[0]?.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
  const words = name.replace(/^\d+[\s._-]*/, '').split(/[\s._-]+/).filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || name;
}

/**
 * Reads the playlist, keeping the entries that can be played. An entry is
 * `{ "src", "title"?, "artist"?, "cover"?, "kind"? }`; `kind` is only needed
 * when the address does not end in a known extension.
 */
export function parsePlaylist(raw: unknown): { tracks: Track[]; skipped: number } {
  const entries = Array.isArray((raw as { tracks?: unknown })?.tracks) ? (raw as { tracks: unknown[] }).tracks : [];
  const tracks: Track[] = [];
  let skipped = 0;
  for (const entry of entries) {
    const item = (entry ?? {}) as Record<string, unknown>;
    const kind = item.kind === 'audio' || item.kind === 'video' ? item.kind : isAddress(item.src) ? kindOf(item.src) : undefined;
    if (!isAddress(item.src) || !kind) {
      skipped += 1;
      continue;
    }
    tracks.push({
      index: tracks.length,
      title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : titleFromSrc(item.src),
      artist: typeof item.artist === 'string' ? item.artist.trim() : '',
      src: item.src,
      kind,
      ...(isAddress(item.cover) ? { cover: item.cover } : {}),
    });
  }
  return { tracks, skipped };
}

/** "3:07", or "1:02:44" past an hour; "--:--" before the length is known. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const whole = Math.floor(seconds);
  const s = String(whole % 60).padStart(2, '0');
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

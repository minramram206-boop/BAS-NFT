import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { formatTime, kindOf, parsePlaylist, titleFromSrc } from '@/lib/studio/playlist';

const config = JSON.parse(readFileSync(new URL('../src/config/studio.json', import.meta.url), 'utf8')) as unknown;

describe('studio playlist', () => {
  it('tells audio from video by the file name', () => {
    assert.equal(kindOf('/studio/song.MP3'), 'audio');
    assert.equal(kindOf('https://cdn.example.com/a.m4a?v=2'), 'audio');
    assert.equal(kindOf('/studio/clip.webm'), 'video');
    assert.equal(kindOf('/studio/cover.png'), undefined);
  });

  it('names an untitled entry after its file', () => {
    assert.equal(titleFromSrc('/studio/02_night-market.mp3'), 'Night Market');
    assert.equal(titleFromSrc('/studio/Bas%20Anthem.mp4'), 'Bas Anthem');
  });

  it('keeps playable entries and counts the rest', () => {
    const { tracks, skipped } = parsePlaylist({
      tracks: [
        { src: '/studio/one.mp3', title: ' One ', artist: 'Ivy', cover: '/studio/one.png' },
        { src: 'https://example.com/stream', kind: 'video' },
        { src: '/studio/notes.txt' },
        { src: 'ftp://old/two.mp3' },
        { title: 'missing' },
      ],
    });
    assert.equal(skipped, 3);
    assert.deepEqual(tracks, [
      { index: 0, title: 'One', artist: 'Ivy', src: '/studio/one.mp3', kind: 'audio', cover: '/studio/one.png' },
      { index: 1, title: 'Stream', artist: '', src: 'https://example.com/stream', kind: 'video' },
    ]);
    assert.deepEqual(parsePlaylist(null), { tracks: [], skipped: 0 });
  });

  it('formats play time', () => {
    assert.equal(formatTime(0), '0:00');
    assert.equal(formatTime(187.9), '3:07');
    assert.equal(formatTime(3764), '1:02:44');
    assert.equal(formatTime(Number.NaN), '--:--');
  });

  it('lists only files that are in public/ and plays every entry', () => {
    const { tracks, skipped } = parsePlaylist(config);
    assert.equal(skipped, 0, 'every entry in src/config/studio.json must be playable');
    for (const track of tracks) {
      for (const path of [track.src, track.cover]) {
        if (!path?.startsWith('/')) continue;
        const file = new URL(`../public${decodeURI(path)}`, import.meta.url);
        assert.ok(existsSync(file), `${path} is listed in studio.json but is not in apps/web/public`);
      }
    }
  });
});

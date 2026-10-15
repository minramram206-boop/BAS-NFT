import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { FileStore, type ClaimRecord, type Session } from '../dist/index.js';

const session: Session = {
  asset: 'asset-1',
  wallet: 'wallet-1',
  missionId: 'streetLamp',
  stat: 'compute',
  done: 1,
  startedAt: 10,
  lastStepAt: 20,
};

const claim: ClaimRecord = {
  asset: 'asset-1',
  missionId: 'lightsOut',
  stat: 'intelligence',
  seasonId: 1,
  day: 2,
  points: 100,
  confirmedAt: 30,
};

describe('file store', () => {
  it('keeps sessions and claims across a restart and leaves no temporary file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bas-store-'));
    try {
      const path = join(directory, 'nested', 'missions.json');
      const first = new FileStore(path);
      await first.saveSession(session);
      await first.addClaim(claim);

      const second = new FileStore(path);
      assert.deepEqual(await second.getSession('asset-1'), session);
      assert.deepEqual(await second.claimsOf('asset-1'), [claim]);
      assert.deepEqual(await second.claimsOf('other'), []);

      await second.deleteSession('asset-1');
      assert.equal(await new FileStore(path).getSession('asset-1'), undefined);
      assert.deepEqual(readdirSync(join(directory, 'nested')), ['missions.json']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('starts empty when the file does not exist and refuses a corrupt one', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bas-store-'));
    try {
      assert.deepEqual(await new FileStore(join(directory, 'none.json')).allClaims(), []);
      const { writeFileSync } = await import('node:fs');
      writeFileSync(join(directory, 'bad.json'), '{not json');
      assert.throws(() => new FileStore(join(directory, 'bad.json')));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

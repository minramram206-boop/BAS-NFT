import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCitizenDirectory } from '../dist/index.js';
import { FakeChain, ROSTER, wallet } from './fixtures.ts';

describe('citizen directory', () => {
  it('finds the roster entry by the metadata number, not by the registration count', async () => {
    const chain = new FakeChain();
    const asset = wallet();
    const owner = wallet();
    chain.register(asset, owner);
    const found = await createCitizenDirectory(chain, ROSTER).resolve(asset);
    assert.equal(found?.owner, owner);
    assert.deepEqual(found?.citizen, {
      asset,
      name: 'Ivy',
      roleKey: 'steward',
      role: 'Steward',
      lore: 'Keeps the hearth lamps lit in Hearth Row.',
      scores: { intelligence: 1, alignment: 2, compute: 0 },
    });
  });

  it('knows nothing about an asset that is unregistered, foreign or missing from the roster', async () => {
    const chain = new FakeChain();
    const directory = createCitizenDirectory(chain, ROSTER);
    const asset = wallet();
    assert.equal(await directory.resolve(asset), null);
    chain.owners.set(asset, wallet());
    assert.equal(await directory.resolve(asset), null);
    const scores = { intelligence: 0, alignment: 0, compute: 0 };
    chain.citizens.set(asset, { citizenId: 1, role: 1, scores });
    // No roster number in the file name.
    assert.equal(await directory.resolve(asset), null);
    // A roster number nobody wrote a citizen for.
    chain.serials.set(asset, 999);
    assert.equal(await directory.resolve(asset), null);
    // A role index the program does not have.
    chain.serials.set(asset, 19);
    chain.citizens.set(asset, { citizenId: 1, role: 9, scores });
    assert.equal(await directory.resolve(asset), null);
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '../src');

/** Relative modules imported by `file`, and every bare or built-in specifier it uses. */
function importsOf(file: string): { local: string[]; other: string[] } {
  const text = readFileSync(join(src, file), 'utf8');
  const specifiers = [...text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!);
  return {
    local: specifiers.filter((name) => name.startsWith('./')).map((name) => name.replace(/^\.\//, '').replace(/\.js$/, '.ts')),
    other: specifiers.filter((name) => !name.startsWith('./')),
  };
}

describe('browser entry', () => {
  it('reaches no Node built-in and no @bas/config, however deep', () => {
    const seen = new Set<string>();
    const queue = ['browser.ts'];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const { local, other } = importsOf(file);
      for (const name of other) {
        assert.ok(!name.startsWith('node:'), `${file} imports ${name}`);
        assert.ok(name !== '@bas/config', `${file} imports @bas/config`);
        assert.ok(name === '@solana/kit', `${file} imports ${name}, which the browser entry has not been checked for`);
      }
      queue.push(...local);
    }
    assert.ok(seen.has('instructions.ts') && seen.has('accounts.ts') && seen.has('stats.ts'));
    assert.ok(!seen.has('DistrictChainClient.ts'));
  });
});

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve as resolvePath } from 'node:path';

/**
 * Directory of this module. Works when the package is consumed as TypeScript
 * source (`<pkg>/src`) and when it is compiled (`<pkg>/dist`).
 */
function currentDir(): string {
  const metaUrl = (import.meta as { url?: string }).url;
  if (metaUrl) {
    return dirname(new URL(metaUrl).pathname);
  }
  return __dirname;
}

/**
 * Repository root, found by walking up from this module.
 * Derived from the module location instead of `process.cwd()` so the loader
 * also works in scripts and tests launched from inside a workspace package.
 */
export function findRepoRoot(): string {
  let dir = currentDir();

  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error('[@bas/config] cannot locate the repository root (pnpm-workspace.yaml not found)');
}

/**
 * Load a JSON file that lives inside the repository.
 *
 * `config/*.json` and `content/en/*.json` are the canonical data sources
 * mandated by `docs/id/TECH_STACK_ID.md` section 11, so packages read them
 * instead of re-typing the same values in TypeScript.
 */
export function loadRepoJson<T>(relativePath: string): T {
  const requireFromModule = createRequire(join(currentDir(), 'loader.cjs'));
  const candidates = [
    resolvePath(findRepoRoot(), relativePath),
    resolvePath(process.cwd(), relativePath),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return requireFromModule(candidate) as T;
    }
  }

  throw new Error(
    `[@bas/config] cannot resolve repository JSON file "${relativePath}". Looked in: ${candidates.join(', ')}`,
  );
}

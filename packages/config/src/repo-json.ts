import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKSPACE_MARKER = 'pnpm-workspace.yaml';
const MAX_WALK_DEPTH = 8;

/**
 * Directory of this module, in `<pkg>/src` or `<pkg>/dist`.
 *
 * `fileURLToPath` rather than `URL#pathname`: on Windows the pathname is
 * `/C:/...`, which no file system call accepts.
 */
function currentDir(): string {
  const metaUrl = (import.meta as { url?: string }).url;
  if (metaUrl?.startsWith('file:')) {
    return dirname(fileURLToPath(metaUrl));
  }
  return typeof __dirname === 'string' ? __dirname : process.cwd();
}

function walkUpToWorkspace(start: string): string | undefined {
  let dir = start;
  for (let depth = 0; depth < MAX_WALK_DEPTH; depth += 1) {
    if (existsSync(join(dir, WORKSPACE_MARKER))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Repository root, found by walking up from this module and, failing that,
 * from the working directory. The module location comes first so scripts and
 * tests launched from inside a workspace package still resolve the same root.
 */
export function findRepoRoot(): string {
  const root = walkUpToWorkspace(currentDir()) ?? walkUpToWorkspace(process.cwd());
  if (!root) {
    throw new Error(`[@bas/config] cannot locate the repository root (${WORKSPACE_MARKER} not found)`);
  }
  return root;
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

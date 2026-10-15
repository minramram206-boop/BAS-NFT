// Resolves the extensionless and `@/` imports the web sources use, so a plain
// `node --test` run can load them without a bundler.
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const srcRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), '../src');

function withExtension(base) {
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let base = null;
  if (specifier.startsWith('@/')) base = join(srcRoot, specifier.slice(2));
  else if (specifier.startsWith('.') && context.parentURL?.startsWith(pathToFileURL(srcRoot).href)) {
    base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
  }
  const file = base && withExtension(base);
  return file ? nextResolve(pathToFileURL(file).href, context) : nextResolve(specifier, context);
}

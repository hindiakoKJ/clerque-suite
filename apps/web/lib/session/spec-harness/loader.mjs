/**
 * Node resolve hook for the web specs that run real app modules (not just
 * pure helpers): sign-out.spec.mjs and lib/pos/sync.spec.mjs.
 *
 *   - "@/x" resolves to apps/web/x, as tsconfig "paths" does for Next.
 *   - An import with no extension finds its .ts / .tsx / index.ts file.
 *   - The offline database (Dexie needs IndexedDB), the API client (it
 *     imports .tsx modals) and 'sonner' (it injects CSS into a DOM) are
 *     swapped for the stand-ins next to this file.
 *
 * Registered by the spec itself (module.register), so the spec still runs
 * with a plain `node --test <file>`.
 */
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB = new URL('../../../', import.meta.url);

const STUBS = new Map([
  [fileURLToPath(new URL('lib/pos/db.ts', WEB)), new URL('./fake-db.mjs', import.meta.url).href],
  [fileURLToPath(new URL('lib/api.ts', WEB)),    new URL('./fake-api.mjs', import.meta.url).href],
]);

function withExtension(path) {
  if (existsSync(path) && statSync(path).isFile()) return path;
  for (const ext of ['.ts', '.tsx', '/index.ts']) {
    if (existsSync(path + ext)) return path + ext;
  }
  return null;
}

const PACKAGE_STUBS = new Map([
  ['sonner', new URL('./fake-sonner.mjs', import.meta.url).href],
]);

export async function resolve(specifier, context, next) {
  const pkg = PACKAGE_STUBS.get(specifier);
  if (pkg) return { url: pkg, shortCircuit: true };
  let target = null;
  if (specifier.startsWith('@/')) {
    target = fileURLToPath(new URL(specifier.slice(2), WEB));
  } else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    target = fileURLToPath(new URL(specifier, context.parentURL));
  }
  if (target !== null) {
    const file = withExtension(target);
    if (file) {
      const stub = STUBS.get(file);
      return { url: stub ?? pathToFileURL(file).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}

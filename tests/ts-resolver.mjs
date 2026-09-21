/**
 * Minimal resolver hook so `node --test` can run the TypeScript sources
 * directly (Node strips types natively). It adds the two things Node's ESM
 * resolver will not do on its own: the `@/` path alias, and extensionless
 * relative specifiers. No build step, no test-runner dependency.
 */
import { existsSync } from 'node:fs';

const SRC = new URL('../src/', import.meta.url);
const EXTENSIONS = ['.ts', '.tsx', '/index.ts'];

export async function resolve(specifier, context, nextResolve) {
  let spec = specifier;

  if (spec.startsWith('@/')) {
    spec = new URL(spec.slice(2), SRC).href;
  }

  const relative = spec.startsWith('./') || spec.startsWith('../');
  const absolute = spec.startsWith('file:');

  if ((relative || absolute) && !/\.[mc]?[jt]sx?$/.test(spec)) {
    const base = absolute ? new URL(spec) : new URL(spec, context.parentURL);
    for (const extension of EXTENSIONS) {
      const candidate = new URL(base.href + extension);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
  }

  return nextResolve(spec, context);
}

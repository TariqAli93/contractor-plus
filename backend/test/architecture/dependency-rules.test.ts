import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Self-contained architecture test — the dependency rule enforced without any
 * external tool, so the boundary holds even if dependency-cruiser is not
 * installed. It complements `.dependency-cruiser.cjs` (the CI enforcement) by
 * running inside the normal test gate (ARCHITECTURE.md §2).
 */

const SRC = join(fileURLToPath(new URL('../../src', import.meta.url)));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function imports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const patterns = [
    /import[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /import\s*['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
    /export[^'"]*?from\s*['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) specifiers.push(m[1]!);
  }
  return specifiers;
}

const crossesInto = (spec: string, ring: string): boolean =>
  spec.includes(`/${ring}/`) || spec.startsWith(`src/${ring}/`);

test('domain (ring 1) does not import a framework or an outer ring', () => {
  for (const file of tsFiles(join(SRC, 'domain'))) {
    for (const spec of imports(file)) {
      assert.ok(
        !/^(fastify|zod|pino)$/.test(spec) && !spec.startsWith('@fastify/'),
        `${file} imports framework "${spec}"`,
      );
      for (const ring of ['application', 'infrastructure', 'interface', 'composition', 'modules', 'plugins']) {
        assert.ok(!crossesInto(spec, ring), `${file} (domain) imports outer ring "${spec}"`);
      }
    }
  }
});

test('application (ring 2) does not import Prisma, a framework, or an outer ring', () => {
  for (const file of tsFiles(join(SRC, 'application'))) {
    for (const spec of imports(file)) {
      assert.ok(
        !/^(@prisma\/client|fastify|zod|pino)$/.test(spec) && !spec.startsWith('@fastify/'),
        `${file} (application) imports forbidden dependency "${spec}"`,
      );
      for (const ring of ['infrastructure', 'interface', 'modules', 'plugins']) {
        assert.ok(!crossesInto(spec, ring), `${file} (application) imports outer ring "${spec}"`);
      }
    }
  }
});

test('domain may use @prisma/client only for the Decimal engine', () => {
  // The one documented exception (domain/README.md): Money wraps Prisma.Decimal.
  // Assert it is confined to the money value object and imported nowhere else in
  // the domain.
  const offenders = tsFiles(join(SRC, 'domain'))
    .filter((f) => imports(f).includes('@prisma/client'))
    .filter((f) => !f.replace(/\\/g, '/').endsWith('domain/shared/money.ts'));
  assert.deepEqual(offenders, [], `@prisma/client used in domain outside money.ts: ${offenders.join(', ')}`);
});

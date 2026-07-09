import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { routes } from '@/router/routes';

// These specs read source files off disk. `import.meta.url` cannot anchor them:
// under `environment: 'jsdom'` it is an http:// URL, and `fileURLToPath` rejects
// any non-file scheme. Vitest runs with cwd set to the config root (frontend/),
// so resolve from there instead.
const fromFrontend = (relative: string) => resolve(process.cwd(), relative);

// Proves the three AI surfaces collapsed into ONE entry point — the crux of the
// unification. Pure route-config + source assertions (no component runtime).
describe('unified AI assistant — single entry point', () => {
  it('exposes exactly one AI assistant page (/ai)', () => {
    const ai = routes.filter((r) => r.path === '/ai');
    expect(ai).toHaveLength(1);
    expect(ai[0]?.name).toBe('ai-console');
  });

  it('retires the standalone estimation "build" AI route', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).not.toContain('/estimation-templates/build');
    expect(routes.some((r) => r.name === 'estimation-template-builder')).toBe(false);
  });

  it('keeps the estimation records views (list + detail) reachable', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toContain('/estimation-templates');
    expect(paths).toContain('/estimation-templates/:id');
  });

  it('adds the unified AI audit page', () => {
    expect(routes.some((r) => r.path === '/ai-audit' && r.name === 'ai-audit')).toBe(true);
  });

  it('removes the duplicate global command FAB', () => {
    const appLayout = readFileSync(fromFrontend('src/components/layout/AppLayout.vue'), 'utf8');
    expect(appLayout).not.toContain('AiCommandConsole');
    expect(existsSync(fromFrontend('src/components/ai-command/AiCommandConsole.vue'))).toBe(false);
  });

  it('gates the estimation "generate" CTA on BOTH generation AND assistant access', () => {
    const src = readFileSync(
      fromFrontend('src/views/estimation-templates/EstimationTemplatesListView.vue'),
      'utf8',
    );
    // The CTA deep-links to /ai, so it must require ai.session.use (what /ai needs)
    // in addition to estimation_templates.ai_generate — combined with AND — so it
    // can never appear while /ai is inaccessible.
    expect(src).toContain('estimation_templates.ai_generate');
    expect(src).toContain('ai.session.use');
    expect(src).toMatch(/match="all"/);
  });
});

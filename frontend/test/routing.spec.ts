import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { routes } from '@/router/routes';

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
    const appLayout = readFileSync(
      fileURLToPath(new URL('../src/components/layout/AppLayout.vue', import.meta.url)),
      'utf8',
    );
    expect(appLayout).not.toContain('AiCommandConsole');
    expect(
      existsSync(fileURLToPath(new URL('../src/components/ai-command/AiCommandConsole.vue', import.meta.url))),
    ).toBe(false);
  });
});

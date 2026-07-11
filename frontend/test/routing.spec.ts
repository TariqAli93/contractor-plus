import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { routes } from '@/router/routes';

// Vitest runs with cwd set to the config root (frontend/), so resolve from there:
// `import.meta.url` is an http:// URL under `environment: 'jsdom'`.
const fromFrontend = (relative: string) => resolve(process.cwd(), relative);

// The AI subsystem (assistant, command workflow, AI-generated estimation
// templates, OpenRouter settings) was removed wholesale. These specs are the
// regression guard: they fail if any AI surface is reintroduced by accident.
describe('AI subsystem is fully removed', () => {
  it('exposes no AI routes', () => {
    const paths = routes.map((r) => r.path);
    for (const path of ['/ai', '/ai-audit', '/estimation-templates', '/estimation-templates/:id']) {
      expect(paths).not.toContain(path);
    }
  });

  it('exposes no AI route names', () => {
    const names = routes.map((r) => r.name);
    for (const name of ['ai-console', 'ai-audit', 'estimation-templates', 'estimation-template-detail']) {
      expect(names).not.toContain(name);
    }
  });

  it('declares no AI permission in any route guard', () => {
    const guarded = routes.flatMap((r) => {
      const permissions = (r.meta as { access?: { permissions?: string[] } } | undefined)?.access
        ?.permissions;
      return permissions ?? [];
    });
    expect(guarded.filter((p) => p.startsWith('ai.') || p.startsWith('estimation_templates.'))).toEqual(
      [],
    );
  });

  it('ships no AI source directories or modules', () => {
    const gone = [
      'src/components/ai',
      'src/views/ai',
      'src/views/estimation-templates',
      'src/stores/aiSession.store.ts',
      'src/services/api/aiCommand.api.ts',
      'src/services/api/aiSession.api.ts',
      'src/services/api/estimationTemplates.api.ts',
      'src/services/llmErrorMessages.ts',
      'src/components/features/settings/AiCommandSettingsTab.vue',
    ];
    for (const relative of gone) {
      expect(existsSync(fromFrontend(relative)), `${relative} should not exist`).toBe(false);
    }
  });
});

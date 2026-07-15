import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { ApiError } from '@/types/api';

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (!('visualViewport' in window)) {
    (window as unknown as { visualViewport: unknown }).visualViewport = {
      width: 1024,
      height: 768,
      offsetLeft: 0,
      offsetTop: 0,
      scale: 1,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }
});

const h = vi.hoisted(() => ({
  get: vi.fn(),
  costSummary: vi.fn(),
  paySummary: vi.fn(),
  handle: vi.fn(),
}));
vi.mock('@/services/api/projects.api', () => ({ projectsApi: { get: h.get } }));
vi.mock('@/services/api/costs.api', () => ({
  costsApi: { getProjectSummary: h.costSummary },
}));
vi.mock('@/services/api/payments.api', () => ({
  paymentsApi: { getProjectSummary: h.paySummary },
}));
vi.mock('@/composables/useApiError', () => ({ useApiError: () => ({ handle: h.handle }) }));

import ProjectDetailPanel from '@/components/features/project/ProjectDetailPanel.vue';

const vuetify = createVuetify({ components, directives });
const project = (id: string) => ({ id, status: 'ACTIVE', name: `مشروع ${id}` });

function mountPanel(projectId: string | undefined) {
  return mount(ProjectDetailPanel, {
    props: { projectId },
    global: {
      plugins: [vuetify],
      stubs: {
        // The toolbar echoes the loaded project's id so tests can see which
        // load won; the rest are inert.
        ProjectActionToolbar: {
          props: ['project'],
          template: '<div class="stub-toolbar">{{ project?.id }}</div>',
        },
        ProjectHeaderCard: true,
        ProjectProgressCard: true,
        ProjectSummaryPanel: true,
        ProjectGeneralTab: true,
        ProjectCostsTab: true,
        ProjectPaymentsTab: true,
        ProjectProgressTab: true,
      },
    },
    attachTo: document.body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.costSummary.mockResolvedValue(null);
  h.paySummary.mockResolvedValue(null);
});

describe('ProjectDetailPanel hardening', () => {
  it('shows a loading skeleton while the initial load is in flight', async () => {
    h.get.mockReturnValue(new Promise(() => {})); // never resolves
    const w = mountPanel('p1');
    await flushPromises();
    const status = w.find('[role="status"]');
    expect(status.exists()).toBe(true);
    expect(status.attributes('aria-busy')).toBe('true');
    expect(w.find('.v-skeleton-loader').exists()).toBe(true);
  });

  it('renders the project content after a successful load', async () => {
    h.get.mockResolvedValue(project('p1'));
    const w = mountPanel('p1');
    await flushPromises();
    expect(w.find('[role="status"]').exists()).toBe(false);
    expect(w.find('.stub-toolbar').text()).toBe('p1');
  });

  it('shows a distinct not-found state (no retry, no toast) on a 404', async () => {
    h.get.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'missing'));
    const w = mountPanel('gone');
    await flushPromises();
    expect(w.text()).toContain('المشروع غير موجود');
    // Not the retriable error card, and no error toast for a not-found.
    expect(w.find('.cp-error').exists()).toBe(false);
    expect(h.handle).not.toHaveBeenCalled();
    // Offers a recovery action back to the list.
    expect(w.text()).toContain('العودة إلى المشاريع');
  });

  it('shows the retriable error card (and toasts) on a non-404 failure', async () => {
    h.get.mockRejectedValue(new ApiError(500, 'SERVER', 'boom'));
    const w = mountPanel('p1');
    await flushPromises();
    expect(w.find('.cp-error').exists()).toBe(true);
    expect(h.handle).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale load that resolves after a newer project was selected', async () => {
    let resolveA: (() => void) | undefined;
    let resolveB: (() => void) | undefined;
    h.get.mockImplementation((id: string) => {
      if (id === 'a') return new Promise((r) => (resolveA = () => r(project('a'))));
      return new Promise((r) => (resolveB = () => r(project('b'))));
    });

    const w = mountPanel('a');
    await flushPromises(); // load 'a' pending
    await w.setProps({ projectId: 'b' });
    await flushPromises(); // load 'b' pending

    resolveB!();
    await flushPromises();
    expect(w.find('.stub-toolbar').text()).toBe('b');

    // The older 'a' response arrives late and must NOT clobber 'b'.
    resolveA!();
    await flushPromises();
    expect(w.find('.stub-toolbar').text()).toBe('b');
  });

  it('treats a missing projectId as the unsaved "new" case (locked tabs, no fetch)', async () => {
    const w = mountPanel(undefined);
    await flushPromises();
    expect(h.get).not.toHaveBeenCalled();
    expect(w.find('[role="status"]').exists()).toBe(false);
    expect(w.text()).toContain('احفظ المشروع أولاً');
  });
});

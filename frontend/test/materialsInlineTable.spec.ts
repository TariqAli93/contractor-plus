import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

// --- jsdom shims Vuetify needs ---------------------------------------------
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

// --- mocks (hoisted so the vi.mock factories can reference them) ------------
const h = vi.hoisted(() => ({
  api: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  confirmFn: vi.fn<[], Promise<boolean>>(),
  toast: { success: vi.fn(), error: vi.fn() },
  handle: vi.fn(),
  push: vi.fn(),
  state: { allowed: true },
}));
const api = h.api;
const confirmFn = h.confirmFn;
const handle = h.handle;
const push = h.push;

vi.mock('@/services/api/materials.api', () => ({ materialsApi: h.api }));
vi.mock('@/composables/useAccess', () => ({
  useAccess: () => ({ canAccess: () => h.state.allowed }),
}));
vi.mock('@/composables/useConfirm', () => ({ useConfirm: () => ({ confirm: h.confirmFn }) }));
vi.mock('@/composables/useToast', () => ({ useToast: () => h.toast }));
vi.mock('@/composables/useApiError', () => ({ useApiError: () => ({ handle: h.handle }) }));
vi.mock('@/composables/useCurrencyFormat', () => ({
  useCurrencyFormat: () => ({ format: (n: unknown) => `${n} ر.س` }),
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: h.push }) }));

// Stub the heavy shells so the test focuses on the table; they just pass slots.
const passthrough = { template: '<div><slot /></div>' };
const empty = { template: '<div />' };

import MaterialsListView from '@/views/materials/MaterialsListView.vue';

const vuetify = createVuetify({ components, directives });

function mountView() {
  return mount(MaterialsListView, {
    global: {
      plugins: [vuetify],
      // RoleGate stays real so it gates the Add button through the mocked
      // useAccess; only the unrelated shells are stubbed.
      stubs: {
        PageHeader: passthrough,
        SearchBar: empty,
        ErrorState: empty,
      },
    },
    attachTo: document.body,
  });
}

const mat = (over: Record<string, unknown> = {}) => ({
  id: '1',
  name: 'إسمنت',
  unit: 'كيس',
  defaultPrice: 25,
  isActive: true,
  notes: '',
  ...over,
});

async function ready(items: unknown[]) {
  api.list.mockResolvedValue({ items, total: items.length });
  const w = mountView();
  await flushPromises();
  return w;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.allowed = true;
  h.confirmFn.mockResolvedValue(true);
});

const addButton = (w: ReturnType<typeof mountView>) =>
  w.findAll('button').find((b) => b.text().includes('مادة جديدة'));

describe('MaterialsListView inline table', () => {
  it('renders fetched rows', async () => {
    const w = await ready([mat(), mat({ id: '2', name: 'حديد' })]);
    expect(w.text()).toContain('إسمنت');
    expect(w.text()).toContain('حديد');
  });

  it('opens an inline create row, validates required fields, then creates', async () => {
    api.create.mockResolvedValue({});
    const w = await ready([mat()]);

    await addButton(w)!.trigger('click');
    await flushPromises();
    expect(w.find('.cp-inline-add').exists()).toBe(true);

    // Save with the required name empty: no API call.
    await w.find('.cp-inline-add [data-field="name"] input').setValue('');
    const saveBtn = w.find('.cp-inline-add [aria-label="حفظ"]');
    await saveBtn.trigger('click');
    await flushPromises();
    expect(api.create).not.toHaveBeenCalled();

    // Fill name + unit, save: create called and the draft row closes.
    await w.find('.cp-inline-add [data-field="name"] input').setValue('رمل');
    await w.find('.cp-inline-add [data-field="unit"] input').setValue('م³');
    await w.find('.cp-inline-add [aria-label="حفظ"]').trigger('click');
    await flushPromises();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create.mock.calls[0][0]).toMatchObject({ name: 'رمل', unit: 'م³' });
  });

  it('cancels an inline create row without calling the API', async () => {
    const w = await ready([mat()]);
    await addButton(w)!.trigger('click');
    await flushPromises();
    await w.find('.cp-inline-add [aria-label="إلغاء"]').trigger('click');
    await flushPromises();
    expect(w.find('.cp-inline-add').exists()).toBe(false);
    expect(api.create).not.toHaveBeenCalled();
  });

  it('edits one row in place and sends the update', async () => {
    api.update.mockResolvedValue({});
    const w = await ready([mat(), mat({ id: '2', name: 'حديد' })]);

    await w.findAll('[aria-label="تعديل"]')[0]!.trigger('click');
    await flushPromises();
    const editing = w.find('tr.cp-inline-editing');
    expect(editing.exists()).toBe(true);

    await editing.find('[data-field="name"] input').setValue('إسمنت مقاوم');
    await editing.find('[aria-label="حفظ"]').trigger('click');
    await flushPromises();
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update.mock.calls[0][0]).toBe('1');
    expect(api.update.mock.calls[0][1]).toMatchObject({ name: 'إسمنت مقاوم' });
  });

  it('keeps the row in edit mode when the update fails', async () => {
    api.update.mockRejectedValue(new Error('500'));
    const w = await ready([mat()]);
    await w.findAll('[aria-label="تعديل"]')[0]!.trigger('click');
    await flushPromises();
    await w.find('tr.cp-inline-editing [data-field="name"] input').setValue('س');
    await w.find('tr.cp-inline-editing [aria-label="حفظ"]').trigger('click');
    await flushPromises();
    expect(handle).toHaveBeenCalled();
    expect(w.find('tr.cp-inline-editing').exists()).toBe(true); // still editing
  });

  it('confirms deletion, then removes', async () => {
    api.remove.mockResolvedValue({});
    const w = await ready([mat()]);
    await w.findAll('[aria-label="حذف"]')[0]!.trigger('click');
    await flushPromises();
    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(api.remove).toHaveBeenCalledWith('1');
  });

  it('does not delete when the confirmation is declined', async () => {
    h.confirmFn.mockResolvedValue(false);
    const w = await ready([mat()]);
    await w.findAll('[aria-label="حذف"]')[0]!.trigger('click');
    await flushPromises();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('renders no create/edit/delete affordances without permission', async () => {
    h.state.allowed = false;
    const w = await ready([mat()]);
    expect(addButton(w)).toBeUndefined();
    expect(w.findAll('[aria-label="تعديل"]')).toHaveLength(0);
    expect(w.findAll('[aria-label="حذف"]')).toHaveLength(0);
  });

  it('shows the empty state when there are no records', async () => {
    const w = await ready([]);
    expect(w.text()).toContain('لا توجد مواد بعد.');
  });

  it('offers the custom open-detail action', async () => {
    const w = await ready([mat()]);
    const open = w.find('[aria-label="فتح التفاصيل"]');
    expect(open.exists()).toBe(true);
    await open.trigger('click');
    expect(push).toHaveBeenCalledWith('/materials/1');
  });
});

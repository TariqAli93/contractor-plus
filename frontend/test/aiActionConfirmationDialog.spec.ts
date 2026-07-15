import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import AiActionConfirmationDialog from '@/components/features/ai/AiActionConfirmationDialog.vue';
import type { PendingAction } from '@/types/aiActions';

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

const vuetify = createVuetify({ components, directives });

function action(over: Partial<PendingAction> = {}): PendingAction {
  return {
    actionId: 'a1',
    toolName: 'create_customer',
    title: 'إنشاء عميل جديد',
    normalizedArguments: { name: 'خلدون' },
    preview: {
      title: 'إنشاء عميل جديد',
      summary: 'سيتم إنشاء العميل «خلدون».',
      fields: [
        { label: 'الاسم', value: 'خلدون' },
        { label: 'الهاتف', value: '07700000000' },
      ],
      warnings: [],
    },
    warnings: [],
    requiredSecrets: [],
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    ...over,
  };
}

let current: VueWrapper | null = null;
function mountDialog(props: Record<string, unknown>) {
  current = mount(AiActionConfirmationDialog, {
    props: { modelValue: true, action: action(), ...props },
    global: { plugins: [vuetify] },
    attachTo: document.body,
  });
  return current;
}

// Vuetify overlays teleport to a shared container; unmount + clear between tests
// so each test sees only its own dialog.
afterEach(() => {
  current?.unmount();
  current = null;
  document.body.innerHTML = '';
});

const findByText = (text: string): HTMLElement | undefined =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as
    | HTMLElement
    | undefined;

describe('AiActionConfirmationDialog', () => {
  it('renders the Arabic title, summary, and fields (RTL content)', async () => {
    mountDialog({});
    await flushPromises();
    const text = document.body.textContent ?? '';
    expect(text).toContain('إنشاء عميل جديد');
    expect(text).toContain('سيتم إنشاء العميل «خلدون».');
    expect(text).toContain('07700000000');
  });

  it('confirms with no secrets when none are required', async () => {
    const w = mountDialog({});
    await flushPromises();
    findByText('تأكيد وتنفيذ')!.click();
    await flushPromises();
    expect(w.emitted('confirm')).toBeTruthy();
    expect(w.emitted('confirm')![0]).toEqual([undefined]);
  });

  it('blocks confirm until a required password (>=8) is entered, then emits it', async () => {
    const w = mountDialog({ action: action({ requiredSecrets: ['password'] }) });
    await flushPromises();
    const confirm = findByText('تأكيد وتنفيذ')!;
    expect(confirm.hasAttribute('disabled')).toBe(true);

    const input = document.body.querySelector('input[type="password"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = 'S3cret-Pass';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    const confirm2 = findByText('تأكيد وتنفيذ')!;
    expect(confirm2.hasAttribute('disabled')).toBe(false);
    confirm2.click();
    await flushPromises();
    expect(w.emitted('confirm')![0]).toEqual([{ password: 'S3cret-Pass' }]);
  });

  it('disables the confirm button while executing (no double submit)', async () => {
    mountDialog({ executing: true });
    await flushPromises();
    expect(findByText('تأكيد وتنفيذ')!.hasAttribute('disabled')).toBe(true);
  });

  it('emits cancel/close without confirming', async () => {
    const w = mountDialog({});
    await flushPromises();
    findByText('إلغاء')!.click();
    await flushPromises();
    expect(w.emitted('cancel')).toBeTruthy();
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual([false]);
    expect(w.emitted('confirm')).toBeFalsy();
  });
});

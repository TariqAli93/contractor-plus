import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiError } from '@/types/api';

// useProjectForm pulls in a router, toast and the api client; mock them so the
// composable can run outside a component.
const h = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  push: vi.fn(),
  toastSuccess: vi.fn(),
  handle: vi.fn(),
  clear: vi.fn(),
}));

vi.mock('@/services/api/projects.api', () => ({
  projectsApi: { get: h.get, create: h.create, update: h.update },
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ success: h.toastSuccess }) }));
vi.mock('@/composables/useApiError', () => ({
  useApiError: () => ({ fieldErrors: { value: {} }, handle: h.handle, clear: h.clear }),
}));

import { useProjectForm } from '@/composables/useProjectForm';

beforeEach(() => vi.clearAllMocks());

describe('useProjectForm.submit', () => {
  it('returns true and toasts on a successful update', async () => {
    h.update.mockResolvedValue({});
    const f = useProjectForm('p1');
    f.form.value.name = 'مشروع';
    const ok = await f.submit();
    expect(ok).toBe(true);
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.toastSuccess).toHaveBeenCalled();
    expect(f.submitting.value).toBe(false);
  });

  it('returns false and does not toast when the API rejects', async () => {
    h.update.mockRejectedValue(new ApiError(400, 'VALIDATION_ERROR', 'bad'));
    const f = useProjectForm('p1');
    const ok = await f.submit();
    expect(ok).toBe(false);
    expect(h.handle).toHaveBeenCalledTimes(1);
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(f.submitting.value).toBe(false);
  });

  it('drops a re-entrant submit while the first is still in flight', async () => {
    let resolve: (() => void) | undefined;
    h.update.mockReturnValue(new Promise<void>((r) => (resolve = () => r())));
    const f = useProjectForm('p1');

    const first = f.submit();
    const second = await f.submit(); // rejected by the in-flight guard
    expect(second).toBe(false);
    expect(h.update).toHaveBeenCalledTimes(1);

    resolve!();
    expect(await first).toBe(true);
  });

  it('creates and redirects to the new project on success', async () => {
    h.create.mockResolvedValue({ id: 'new-id' });
    const f = useProjectForm(); // no id => create
    f.form.value.name = 'جديد';
    const ok = await f.submit();
    expect(ok).toBe(true);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith('/projects/new-id');
  });
});

import { reactive } from 'vue';

export type ToastKind = 'success' | 'info' | 'warning' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  reqId?: string;
  timeout: number;
}

const state = reactive({
  toasts: [] as Toast[],
});

let seq = 0;

function push(kind: ToastKind, message: string, opts: { reqId?: string; timeout?: number } = {}) {
  const id = ++seq;
  state.toasts.push({ id, kind, message, reqId: opts.reqId, timeout: opts.timeout ?? 4000 });
  setTimeout(() => dismiss(id), opts.timeout ?? 4000);
}

function dismiss(id: number) {
  const idx = state.toasts.findIndex((t) => t.id === id);
  if (idx !== -1) state.toasts.splice(idx, 1);
}

export function useToast() {
  return {
    toasts: state.toasts,
    success: (msg: string, reqId?: string) => push('success', msg, { reqId }),
    info: (msg: string, reqId?: string) => push('info', msg, { reqId }),
    warning: (msg: string, reqId?: string) => push('warning', msg, { reqId }),
    error: (msg: string, reqId?: string) => push('error', msg, { reqId }),
    dismiss,
  };
}

import { reactive } from 'vue';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

// Module-singleton state so any caller and the global ConfirmDialog share it.
const state = reactive<{
  active: boolean;
  options: ConfirmOptions;
  resolver: ((v: boolean) => void) | null;
}>({
  active: false,
  options: { title: '', message: '' },
  resolver: null,
});

export function useConfirm() {
  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      state.options = options;
      state.active = true;
      state.resolver = resolve;
    });
  }

  function resolve(value: boolean) {
    state.resolver?.(value);
    state.active = false;
    state.resolver = null;
  }

  return { confirm, resolve, state };
}

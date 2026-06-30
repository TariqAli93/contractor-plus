import { onBeforeUnmount, onMounted, toValue, type MaybeRefOrGetter } from 'vue';

/**
 * Registers a Ctrl+S (and ⌘+S) handler that saves the current form and
 * suppresses the browser's native "save page" dialog.
 *
 * Opt-in per form/dialog so only the *active* one responds: pass `enabled`
 * (e.g. `() => dialogOpen && !submitting`) to gate it — closed or mid-submit
 * forms then ignore the shortcut, so several mounted forms don't all fire.
 */
export function useSaveShortcut(
  save: () => void,
  options: { enabled?: MaybeRefOrGetter<boolean> } = {},
): void {
  function onKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
    const enabled = options.enabled === undefined ? true : toValue(options.enabled);
    if (!enabled) return;
    event.preventDefault();
    save();
  }

  onMounted(() => window.addEventListener('keydown', onKeydown));
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
}

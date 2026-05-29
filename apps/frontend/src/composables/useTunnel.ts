import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { tunnelApi } from '@/services/api/tunnel.api';
import { useTunnelStore } from '@/stores/tunnel.store';
import { useApiError } from './useApiError';
import { useConfirm } from './useConfirm';
import { useToast } from './useToast';

// Single entrypoint every tunnel UI shares. Owns the fetch/enable/disable
// calls, in-flight flags, derived labels, and the disable confirmation.
// Optimistic state changes are intentionally avoided — every transition
// comes from the response of the call that caused it.

export type TunnelFailureKind =
  | 'binary_missing'
  | 'management_offline'
  | 'config_missing'
  | 'runtime_stopped'
  | 'generic_error'
  | null;

export function useTunnel() {
  const store = useTunnelStore();
  const { handle } = useApiError();
  const { confirm } = useConfirm();
  const toast = useToast();
  const { t } = useI18n();

  async function refresh(options: { silent?: boolean } = {}): Promise<void> {
    if (store.refreshing) return;
    store.refreshing = true;
    try {
      const res = await tunnelApi.getStatus();
      store.setStatus(res);
    } catch (e) {
      if (!options.silent) handle(e);
    } finally {
      store.refreshing = false;
    }
  }

  async function enable(): Promise<void> {
    if (store.acting) return;
    store.acting = true;
    try {
      const res = await tunnelApi.enable();
      store.setStatus(res);
      toast.success(t('tunnel.toast.enabled'));
    } catch (e) {
      handle(e);
      // Best-effort refresh so the panel reflects any partial state the
      // server persisted (e.g. lastError set).
      void refresh({ silent: true });
    } finally {
      store.acting = false;
    }
  }

  async function disable(): Promise<void> {
    if (store.acting) return;
    const ok = await confirm({
      title: t('tunnel.confirm.disableTitle'),
      message: t('tunnel.confirm.disableMessage'),
      confirmText: t('tunnel.actions.disable'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;

    store.acting = true;
    try {
      const res = await tunnelApi.disable();
      store.setStatus(res);
      if (res.warning === 'remote_api_disable_failed') {
        toast.warning(t('tunnel.toast.disabledLocalOnly'));
      } else {
        toast.success(t('tunnel.toast.disabled'));
      }
    } catch (e) {
      handle(e);
      void refresh({ silent: true });
    } finally {
      store.acting = false;
    }
  }

  async function copyPublicUrl(): Promise<void> {
    const url = store.publicUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('tunnel.toast.copied'));
    } catch {
      toast.error(t('tunnel.toast.copyFailed'));
    }
  }

  function openPublicUrl(): void {
    const url = store.publicUrl;
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // What failure mode should we surface to the user? At most one — picked
  // by severity (broken before transient) so the guidance panel doesn't
  // flood the page with messages that all point at the same root cause.
  const failureKind = computed<TunnelFailureKind>(() => {
    const s = store.status;
    if (!s) return null;
    if (!s.cloudflaredAvailable) return 'binary_missing';
    if (s.enabled && !s.configExists) return 'config_missing';
    if (s.enabled && !s.running && s.lastError) return 'runtime_stopped';
    if (s.lastError) {
      // Heuristic: client throws ManagementApiError with a "management API"
      // prefix; otherwise treat as generic.
      return /management api/i.test(s.lastError) ? 'management_offline' : 'generic_error';
    }
    return null;
  });

  const toneLabel = computed(() => {
    switch (store.tone) {
      case 'green':
        return t('tunnel.status.on');
      case 'yellow':
        return store.enabled ? t('tunnel.status.starting') : t('tunnel.status.warning');
      case 'red':
        return t('tunnel.status.error');
      default:
        return t('tunnel.status.off');
    }
  });

  return {
    store,
    refresh,
    enable,
    disable,
    copyPublicUrl,
    openPublicUrl,
    failureKind,
    toneLabel,
  };
}

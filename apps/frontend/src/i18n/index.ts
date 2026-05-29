// Arabic-only string lookup. This intentionally replaces vue-i18n: there is no
// runtime locale switching, no fallback locale, and no missing-key warnings —
// the app ships a single Arabic dictionary (./locales/ar.json).
//
// Usage mirrors the old vue-i18n surface so call sites stayed unchanged:
//   t('templates.items.title')                      -> "المواد"
//   t('projects.delayedBy', { days: 3 })            -> "متأخر 3 يوم"
//   t(`contracts.status.${status}`)                 -> dynamic key lookup
//   te('some.optional.key')                          -> key-exists check
import ar from './locales/ar.json';

type Messages = { [key: string]: string | Messages };

const messages = ar as Messages;

function lookup(key: string): string | Messages | undefined {
  return key.split('.').reduce<string | Messages | undefined>((node, segment) => {
    if (node && typeof node === 'object') return node[segment];
    return undefined;
  }, messages);
}

export function t(key: string, params?: Record<string, string | number>): string {
  const found = lookup(key);
  // Fall back to the key itself (same behavior vue-i18n had for missing keys)
  // so a typo surfaces visibly instead of throwing.
  let out = typeof found === 'string' ? found : key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      out = out.replaceAll(`{${name}}`, String(value));
    }
  }
  return out;
}

export function te(key: string): boolean {
  return typeof lookup(key) === 'string';
}

import { useEventListener } from '@vueuse/core';
import { useRouter } from 'vue-router';

// Gmail-style "g then key" quick navigation: press `g`, then a letter within
// ~1.2s, to jump to a section. Ignored while typing in a field or when a
// modifier is held (so it never fights Ctrl+K or browser shortcuts). Route
// guards still enforce access - an unauthorized destination just redirects.
const DESTINATIONS: Record<string, string> = {
  d: '/', // Dashboard
  p: '/projects',
  c: '/contracts',
  m: '/materials',
  t: '/templates',
  l: '/customers', // cLients
  r: '/reports',
  s: '/settings',
};

const ARM_WINDOW_MS = 1200;

export function useQuickNav() {
  const router = useRouter();
  let armedAt = 0;

  useEventListener(window, 'keydown', (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    if (el?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const now = Date.now();
    if (e.key === 'g' || e.key === 'G') {
      armedAt = now;
      return;
    }
    if (!armedAt || now - armedAt > ARM_WINDOW_MS) {
      armedAt = 0;
      return;
    }
    armedAt = 0;
    const dest = DESTINATIONS[e.key.toLowerCase()];
    if (dest && router.currentRoute.value.path !== dest) {
      e.preventDefault();
      void router.push(dest);
    }
  });
}

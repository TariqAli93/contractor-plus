import { ref } from 'vue';

// Recently-opened entities, persisted to localStorage so "آخر ما فُتح" survives
// reloads. A module-level ref makes the list shared/reactive across every
// caller (the command palette reads and writes it).

export type RecentType = 'project' | 'contract' | 'customer' | 'material';

export interface RecentEntry {
  type: RecentType;
  id: string;
  label: string;
  to: string;
}

const KEY = 'contractor-plus.recent';
const MAX = 8;

function read(): RecentEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const recent = ref<RecentEntry[]>(read());

export function useRecent() {
  function pushRecent(entry: RecentEntry) {
    const next = [entry, ...recent.value.filter((r) => !(r.type === entry.type && r.id === entry.id))].slice(0, MAX);
    recent.value = next;
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  }
  function clearRecent() {
    recent.value = [];
    globalThis.localStorage?.removeItem(KEY);
  }
  return { recent, pushRecent, clearRecent };
}

<script setup lang="ts">
// A two-pane workspace: the record list on one side, the selected record's
// properties on the inline-end side, with a draggable splitter between them.
//
// This is a *split pane*, not a responsive grid. The divider is grabbable, the
// width persists per workspace, and the pane obeys the global F4 toggle. Below
// `collapseAt` the window is too narrow to hold two panes, so the details pane
// stands down and the host view is expected to navigate instead of select.
//
// RTL: the pane sits at the inline-end edge, which is the *left* under Arabic -
// the same place Windows RTL builds put a property sheet. The drag maths is done
// against the container rect rather than a delta, so it needs no sign flip.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useUiStore } from '@/stores/ui.store';

const emit = defineEmits<{ (e: 'update:showDetails', value: boolean): void }>();

const props = withDefaults(
  defineProps<{
    /** Persists this workspace's pane width. Omit to use the shared default. */
    storageKey?: string;
    /** Starting pane width, before the user has dragged it. */
    defaultWidth?: number;
    minDetails?: number;
    minMaster?: number;
    collapseAt?: number;
  }>(),
  { storageKey: 'default', defaultWidth: 360, minDetails: 260, minMaster: 320, collapseAt: 1024 },
);

const ui = useUiStore();

const root = ref<HTMLElement | null>(null);
const width = ref(props.defaultWidth);
const dragging = ref(false);
const wide = ref(true);

const key = computed(() => `contractor-plus.split.${props.storageKey}`);

/** Two panes only fit when the window is wide *and* the user wants the pane. */
const showDetails = computed(() => wide.value && ui.detailsOpen);

// The host view decides select-vs-navigate from this, rather than re-deriving
// the breakpoint and drifting from the splitter.
watch(showDetails, (v) => emit('update:showDetails', v), { immediate: true });

function clamp(px: number): number {
  const total = root.value?.clientWidth ?? 0;
  const max = Math.max(props.minDetails, total - props.minMaster);
  return Math.min(Math.max(px, props.minDetails), max);
}

function resize(clientX: number) {
  const el = root.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const rtl = getComputedStyle(el).direction === 'rtl';
  width.value = clamp(rtl ? clientX - rect.left : rect.right - clientX);
}

function onPointerDown(e: PointerEvent) {
  dragging.value = true;
  (e.target as Element).setPointerCapture(e.pointerId);
}
function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return;
  e.preventDefault();
  resize(e.clientX);
}
function onPointerUp(e: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  (e.target as Element).releasePointerCapture(e.pointerId);
  globalThis.localStorage?.setItem(key.value, String(Math.round(width.value)));
}

// The splitter is a real control: focusable, and nudged with the arrow keys.
function onKeydown(e: KeyboardEvent) {
  const step = e.shiftKey ? 32 : 8;
  if (e.key === 'ArrowLeft') width.value = clamp(width.value - step);
  else if (e.key === 'ArrowRight') width.value = clamp(width.value + step);
  else return;
  e.preventDefault();
  globalThis.localStorage?.setItem(key.value, String(Math.round(width.value)));
}

function measure() {
  wide.value = (root.value?.clientWidth ?? window.innerWidth) >= props.collapseAt;
  if (root.value) width.value = clamp(width.value);
}

let ro: ResizeObserver | undefined;
onMounted(() => {
  const stored = Number(globalThis.localStorage?.getItem(key.value));
  if (Number.isFinite(stored) && stored > 0) width.value = stored;
  measure();
  ro = new ResizeObserver(measure);
  if (root.value) ro.observe(root.value);
});
onBeforeUnmount(() => ro?.disconnect());

defineExpose({ showDetails });
</script>

<template>
  <div ref="root" class="cp-split" :class="{ 'cp-split--dragging': dragging }">
    <section class="cp-split__master">
      <slot />
    </section>

    <template v-if="showDetails">
      <div
        class="cp-split__gutter"
        role="separator"
        aria-orientation="vertical"
        tabindex="0"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @keydown="onKeydown"
      />
      <aside class="cp-split__details" :style="{ width: `${width}px` }">
        <slot name="details" />
      </aside>
    </template>
  </div>
</template>

<style scoped>
.cp-split {
  display: flex;
  align-items: stretch;
  min-height: 0;
  height: 100%;
}
.cp-split__master {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.cp-split__details {
  flex: none;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* A 4px hit target over a 1px rule: the divider reads as a hairline but is
   grabbable, the way a real splitter is. */
.cp-split__gutter {
  flex: none;
  width: 4px;
  margin-inline: -1px;
  cursor: col-resize;
  background: transparent;
  border-inline-start: 1px solid var(--cp-border);
  z-index: 1;
}
.cp-split__gutter:hover,
.cp-split--dragging .cp-split__gutter {
  border-inline-start-color: var(--cp-primary);
}
.cp-split__gutter:focus-visible {
  outline: 2px solid var(--cp-primary);
  outline-offset: -1px;
}
/* While dragging, don't let the pointer select text across the panes. */
.cp-split--dragging {
  user-select: none;
  cursor: col-resize;
}
</style>

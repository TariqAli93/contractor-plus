import type { Component } from 'vue';
import GenericPreview from './GenericPreview.vue';
import EstimationPreview from './tools/EstimationPreview.vue';

// Per-tool preview renderer registry, keyed on a preview result's `renderKind`.
// Each renderer takes a `{ preview }` prop and emits `confirm` / `cancel`. New
// tools register here; anything unmapped falls back to GenericPreview so the
// console degrades gracefully as the backend adds capabilities.
export const toolRenderers: Record<string, Component> = {
  estimation: EstimationPreview,
};

/** Resolve the renderer for a `renderKind`, falling back to GenericPreview. */
export function resolveRenderer(renderKind: string): Component {
  return toolRenderers[renderKind] ?? GenericPreview;
}

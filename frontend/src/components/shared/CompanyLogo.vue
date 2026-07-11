<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings.store';
import { resolveAssetUrl } from '@/lib/asset-url';

// Reusable company-logo component. Reads the uploaded logo URL from the
// settings store; renders a clean fallback when:
//   - no logo has been uploaded yet
//   - the image fails to load (broken file, network error, signed-out)
//
// Three visual variants:
//   - "sidebar": brand row inside the navigation drawer (small, with text)
//   - "login":   centred above the login form (large, optional caption)
//   - "compact": inline header use (e.g. settings page header)
//
// The fallback is a Material icon inside a coloured tile, NEVER an <img>
// requesting an unknown URL - that's what causes the console image spam
// the spec calls out.

type Variant = 'sidebar' | 'login' | 'compact';

const props = withDefaults(
  defineProps<{
    variant?: Variant;
    /** Force a specific pixel size; otherwise variant defaults apply. */
    size?: number;
    /** When true, suppress the inline text label next to the mark. */
    iconOnly?: boolean;
    /** Optional override; defaults to the app name. */
    label?: string;
    /** Optional caption (login variant only). */
    caption?: string;
  }>(),
  {
    variant: 'sidebar',
    iconOnly: false,
  },
);

const settings = useSettingsStore();
const failed = ref(false);

onMounted(() => {
  // Hydrate on first mount - safe to call repeatedly thanks to in-flight
  // dedup inside the store. Skipped silently for unauthenticated mounts;
  // the login variant explicitly skips this.
  if (props.variant !== 'login') {
    void settings.ensureCompanyAssetsLoaded();
  }
});

// Reset the failure flag whenever the URL changes so a fresh upload after
// a previous broken-image incident gets a real attempt.
watch(
  () => settings.logoUrl,
  () => {
    failed.value = false;
  },
);

const resolvedUrl = computed(() => resolveAssetUrl(settings.logoUrl));
const showImage = computed(() => Boolean(resolvedUrl.value) && !failed.value);

const pixelSize = computed(() => {
  if (props.size) return props.size;
  switch (props.variant) {
    case 'login':
      return 72;
    case 'compact':
      return 28;
    default:
      return 36;
  }
});

const markStyle = computed(() => ({
  width: `${pixelSize.value}px`,
  height: `${pixelSize.value}px`,
}));

function onImageError() {
  // Hard-flip to the fallback. The <img> is removed from the DOM by v-if,
  // so the browser will NOT retry - that's the loop guard the spec asks for.
  failed.value = true;
}
</script>

<template>
  <div class="cp-logo" :class="`cp-logo--${variant}`">
    <div class="cp-logo__mark" :style="markStyle">
      <img
        v-if="showImage"
        :src="resolvedUrl ?? ''"
        :alt="label ?? 'logo'"
        class="cp-logo__img"
        loading="lazy"
        decoding="async"
        @error="onImageError"
      />
      <template v-else>
        <slot name="fallback">
          <!-- Default brand mark: app initial. Lightweight, no asset load. -->
          <span class="cp-logo__initials">C+</span>
        </slot>
      </template>
    </div>
    <div v-if="!iconOnly" class="cp-logo__text">
      <span class="cp-logo__label">{{ label ?? 'Contractor+' }}</span>
      <span v-if="caption" class="cp-logo__caption">{{ caption }}</span>
    </div>
  </div>
</template>

<style scoped>
.cp-logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.cp-logo--login {
  flex-direction: column;
  gap: 12px;
  text-align: center;
}
.cp-logo--compact {
  gap: 8px;
}
.cp-logo__mark {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--cp-radius-md, 5px);
  background: var(--cp-primary-soft, #D9EAF7);
  color: var(--cp-primary, #234E70);
  overflow: hidden;
  position: relative;
}
.cp-logo__img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  /* Subtle padding so a square uploaded logo isn't flush against the tile
     edges - works for both transparent PNGs and rectangular JPGs. */
  padding: 4px;
  background: white;
}
.cp-logo__initials {
  font-weight: 700;
  font-size: 0.85em;
  line-height: 1;
  letter-spacing: -0.02em;
}
.cp-logo__text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  line-height: 1.2;
}
.cp-logo--login .cp-logo__text {
  align-items: center;
}
.cp-logo__label {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--cp-text, #1A202C);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cp-logo--login .cp-logo__label {
  font-size: 1.15rem;
}
.cp-logo__caption {
  font-size: 0.78rem;
  color: var(--cp-text-muted, #4A5568);
}
</style>

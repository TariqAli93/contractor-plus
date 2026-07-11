<script setup lang="ts">
// Collapsible "advanced options" section for forms. Keeps the essential
// fields visible by default and tucks secondary/optional fields behind a
// single toggle, so a non-technical user isn't overwhelmed by a wall of
// inputs. Pass `default-open` (e.g. when editing a record that already has
// values in the hidden fields) to reveal it on load; the user can still
// toggle it by hand. Fields stay mounted while collapsed (v-show), so their
// values and validation remain active and are always submitted.
import { ref, watch } from 'vue';
import { t } from '@/i18n';

const props = withDefaults(defineProps<{ label?: string; defaultOpen?: boolean }>(), {
  defaultOpen: false,
});

const open = ref(props.defaultOpen);

// Data loads asynchronously on edit, so `default-open` may flip to true after
// mount. Only ever auto-open - never override a user's manual choice to close.
watch(
  () => props.defaultOpen,
  (v) => {
    if (v) open.value = true;
  },
);
</script>

<template>
  <div class="md:col-span-2">
    <v-divider class="mb-1" />
    <v-btn
      variant="text"
      size="small"
      color="medium-emphasis"
      class="px-2 font-weight-regular"
      :append-icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'"
      @click="open = !open"
    >
      {{ label ?? t('common.advancedOptions') }}
    </v-btn>
    <v-expand-transition>
      <div v-show="open" class="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 pb-1">
        <slot />
      </div>
    </v-expand-transition>
  </div>
</template>

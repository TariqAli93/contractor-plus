<script setup lang="ts">
// The actions cell for an inline-CRUD table row. Shows Edit/Delete (plus any
// page-supplied actions in the default slot) at rest, and Save/Cancel while the
// row is being edited or created. Icon buttons with tooltips, in the app's
// `.cp-row-actions` idiom.
import { t } from '@/i18n';

withDefaults(
  defineProps<{
    /** The row (or the create draft) is in an editable state. */
    editing?: boolean;
    saving?: boolean;
    canEdit?: boolean;
    canDelete?: boolean;
  }>(),
  { editing: false, saving: false, canEdit: false, canDelete: false },
);

const emit = defineEmits<{
  (e: 'edit'): void;
  (e: 'save'): void;
  (e: 'cancel'): void;
  (e: 'delete'): void;
}>();
</script>

<template>
  <div class="cp-row-actions" @click.stop>
    <template v-if="editing">
      <v-tooltip :text="t('common.save')" location="top" theme="dark">
        <template #activator="{ props: tip }">
          <v-btn
            v-bind="tip"
            icon="mdi-check"
            size="x-small"
            variant="text"
            color="primary"
            :loading="saving"
            :aria-label="t('common.save')"
            @click="emit('save')"
          />
        </template>
      </v-tooltip>
      <v-tooltip :text="t('common.cancel')" location="top" theme="dark">
        <template #activator="{ props: tip }">
          <v-btn
            v-bind="tip"
            icon="mdi-close"
            size="x-small"
            variant="text"
            :disabled="saving"
            :aria-label="t('common.cancel')"
            @click="emit('cancel')"
          />
        </template>
      </v-tooltip>
    </template>

    <template v-else>
      <!-- Page-supplied secondary actions (e.g. open detail); a page with many
           should pass a menu here rather than a row of buttons. -->
      <slot />
      <v-tooltip v-if="canEdit" :text="t('common.edit')" location="top" theme="dark">
        <template #activator="{ props: tip }">
          <v-btn
            v-bind="tip"
            icon="mdi-pencil-outline"
            size="x-small"
            variant="text"
            theme="dark"
            :aria-label="t('common.edit')"
            @click="emit('edit')"
          />
        </template>
      </v-tooltip>
      <v-tooltip v-if="canDelete" :text="t('common.delete')" location="top" theme="dark">
        <template #activator="{ props: tip }">
          <v-btn
            v-bind="tip"
            icon="mdi-delete-outline"
            size="x-small"
            variant="text"
            color="error"
            theme="dark"
            :aria-label="t('common.delete')"
            @click="emit('delete')"
          />
        </template>
      </v-tooltip>
    </template>
  </div>
</template>

<style scoped>
.cp-row-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 2px;
}
</style>

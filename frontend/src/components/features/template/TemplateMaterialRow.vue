<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '@/i18n';
import { templatesApi } from '@/services/api/templates.api';
import { useConfirm } from '@/composables/useConfirm';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import type { CreateTemplateItemInput, TemplateItem } from '@/types/template';
import type { Material } from '@/types/material';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';

const props = defineProps<{
  templateId: string;
  materials: Material[];
  item?: TemplateItem;
}>();

const emit = defineEmits<{
  saved: [];
  cancelled: [];
  removed: [];
}>();

const { confirm } = useConfirm();
const { fieldErrors, handle, clear } = useApiError();
const toast = useToast();

const editing = ref(!props.item); // new rows start in edit mode
const submitting = ref(false);

const form = ref<CreateTemplateItemInput>(blankForm());
if (props.item) form.value = formFromItem(props.item);
watch(
  () => props.item,
  (v) => {
    if (v) form.value = formFromItem(v);
  },
);

function blankForm(): CreateTemplateItemInput {
  return {
    materialId: '',
    estimatedQuantity: 0,
    estimatedPrice: 0,
    notes: null,
  };
}

function formFromItem(item: TemplateItem): CreateTemplateItemInput {
  return {
    materialId: item.materialId,
    estimatedQuantity: Number(item.estimatedQuantity),
    estimatedPrice: Number(item.estimatedPrice),
    notes: item.notes,
  };
}

function startEdit() {
  if (props.item) form.value = formFromItem(props.item);
  editing.value = true;
  clear();
}

function cancelEdit() {
  clear();
  if (props.item) {
    form.value = formFromItem(props.item);
    editing.value = false;
  } else {
    emit('cancelled');
  }
}

async function save() {
  clear();
  submitting.value = true;
  try {
    if (props.item) {
      await templatesApi.updateItem(props.templateId, props.item.id, form.value);
    } else {
      await templatesApi.createItem(props.templateId, form.value);
    }
    toast.success(t('common.saved'));
    editing.value = false;
    emit('saved');
  } catch (e) {
    handle(e);
  } finally {
    submitting.value = false;
  }
}

async function remove() {
  if (!props.item) return;
  const ok = await confirm({
    title: t('templates.items.deleteConfirmTitle'),
    message: t('templates.items.deleteConfirmMessage'),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await templatesApi.removeItem(props.templateId, props.item.id);
    toast.success(t('common.deleted'));
    emit('removed');
  } catch (e) {
    handle(e);
  }
}
</script>

<template>
  <tr>
    <template v-if="!editing && item">
      <td>{{ item.material.name }}</td>
      <td>{{ item.material.unit }}</td>
      <td class="text-end">{{ Number(item.estimatedQuantity) }}</td>
      <td class="text-end"><MoneyDisplay :amount="item.estimatedPrice" /></td>
      <td>{{ item.notes ?? '—' }}</td>
      <td class="text-end">
        <v-btn icon="mdi-pencil" size="small" variant="text" @click="startEdit" />
        <v-btn icon="mdi-delete-outline" size="small" variant="text" color="error" @click="remove" />
      </td>
    </template>

    <template v-else>
      <td>
        <v-autocomplete
          v-model="form.materialId"
          :items="materials"
          item-title="name"
          item-value="id"
          :placeholder="t('templates.items.fields.material')"
          :error-messages="fieldErrors.materialId"
          density="compact"
          hide-details="auto"
          variant="outlined"
        />
      </td>
      <td>
        <span class="text-medium-emphasis text-sm">
          {{ materials.find((m) => m.id === form.materialId)?.unit ?? '—' }}
        </span>
      </td>
      <td>
        <v-text-field
          v-model.number="form.estimatedQuantity"
          type="number"
          min="0"
          step="0.001"
          :error-messages="fieldErrors.estimatedQuantity"
          :hint="t('templates.items.fields.quantityPer100m2Hint')"
          persistent-hint
          density="compact"
          variant="outlined"
          class="text-end"
        />
      </td>
      <td>
        <v-text-field
          v-model.number="form.estimatedPrice"
          type="number"
          min="0"
          step="0.01"
          :error-messages="fieldErrors.estimatedPrice"
          density="compact"
          hide-details="auto"
          variant="outlined"
          class="text-end"
        />
      </td>
      <td>
        <v-text-field
          v-model="form.notes"
          density="compact"
          hide-details="auto"
          variant="outlined"
        />
      </td>
      <td class="text-end whitespace-nowrap">
        <v-btn icon="mdi-check" size="small" variant="text" color="success" :loading="submitting" @click="save" />
        <v-btn icon="mdi-close" size="small" variant="text" @click="cancelEdit" />
      </td>
    </template>
  </tr>
</template>

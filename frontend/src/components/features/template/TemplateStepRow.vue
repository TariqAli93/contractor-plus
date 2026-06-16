<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '@/i18n';
import { templatesApi } from '@/services/api/templates.api';
import { useConfirm } from '@/composables/useConfirm';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import type { CreateTemplateStepInput, TemplateStep } from '@/types/template';

const props = defineProps<{
  templateId: string;
  step?: TemplateStep;
  suggestedSortOrder?: number;
}>();

const emit = defineEmits<{
  saved: [];
  cancelled: [];
  removed: [];
}>();

const { confirm } = useConfirm();
const { fieldErrors, handle, clear } = useApiError();
const toast = useToast();

const editing = ref(!props.step);
const submitting = ref(false);

const form = ref<CreateTemplateStepInput>(blankForm());
if (props.step) form.value = formFromStep(props.step);
watch(
  () => props.step,
  (v) => {
    if (v) form.value = formFromStep(v);
  },
);

function blankForm(): CreateTemplateStepInput {
  return {
    name: '',
    percentage: 0,
    sortOrder: props.suggestedSortOrder ?? 0,
    estimatedDays: null,
  };
}

function formFromStep(s: TemplateStep): CreateTemplateStepInput {
  return {
    name: s.name,
    percentage: Number(s.percentage),
    sortOrder: s.sortOrder,
    estimatedDays: s.estimatedDays,
  };
}

function startEdit() {
  if (props.step) form.value = formFromStep(props.step);
  editing.value = true;
  clear();
}

function cancelEdit() {
  clear();
  if (props.step) {
    form.value = formFromStep(props.step);
    editing.value = false;
  } else {
    emit('cancelled');
  }
}

async function save() {
  clear();
  submitting.value = true;
  try {
    if (props.step) {
      await templatesApi.updateStep(props.templateId, props.step.id, form.value);
    } else {
      await templatesApi.createStep(props.templateId, form.value);
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
  if (!props.step) return;
  const ok = await confirm({
    title: t('templates.steps.deleteConfirmTitle'),
    message: t('templates.steps.deleteConfirmMessage'),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await templatesApi.removeStep(props.templateId, props.step.id);
    toast.success(t('common.deleted'));
    emit('removed');
  } catch (e) {
    handle(e);
  }
}
</script>

<template>
  <tr>
    <template v-if="!editing && step">
      <td class="text-end">{{ step.sortOrder }}</td>
      <td>{{ step.name }}</td>
      <td class="text-end">{{ Number(step.percentage) }}%</td>
      <td class="text-end">{{ step.estimatedDays ?? '—' }}</td>
      <td class="text-end">
        <v-btn icon="mdi-pencil" size="small" variant="text" @click="startEdit" />
        <v-btn icon="mdi-delete-outline" size="small" variant="text" color="error" @click="remove" />
      </td>
    </template>

    <template v-else>
      <td>
        <v-text-field
          v-model.number="form.sortOrder"
          type="number"
          min="0"
          step="1"
          :error-messages="fieldErrors.sortOrder"
          density="compact"
          hide-details="auto"
          variant="outlined"
          class="text-end"
        />
      </td>
      <td>
        <v-text-field
          v-model="form.name"
          :placeholder="t('templates.steps.fields.name')"
          :error-messages="fieldErrors.name"
          density="compact"
          hide-details="auto"
          variant="outlined"
        />
      </td>
      <td>
        <v-text-field
          v-model.number="form.percentage"
          type="number"
          min="0"
          max="100"
          step="0.01"
          suffix="%"
          :error-messages="fieldErrors.percentage"
          density="compact"
          hide-details="auto"
          variant="outlined"
          class="text-end"
        />
      </td>
      <td>
        <v-text-field
          v-model.number="form.estimatedDays"
          type="number"
          min="1"
          step="1"
          :error-messages="fieldErrors.estimatedDays"
          density="compact"
          hide-details="auto"
          variant="outlined"
          class="text-end"
        />
      </td>
      <td class="text-end whitespace-nowrap">
        <v-btn icon="mdi-check" size="small" variant="text" color="success" :loading="submitting" @click="save" />
        <v-btn icon="mdi-close" size="small" variant="text" @click="cancelEdit" />
      </td>
    </template>
  </tr>
</template>

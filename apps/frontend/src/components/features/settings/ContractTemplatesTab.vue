<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { documentTemplatesApi } from '@/services/api/document-templates.api';
import { useApiError } from '@/composables/useApiError';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { useFileUpload } from '@/composables/useFileUpload';
import type { DocumentCategory, DocumentTemplate } from '@/types/document-template';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import SettingsCard from './SettingsCard.vue';
import PlaceholderReferenceCard from './PlaceholderReferenceCard.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import EmptyState from '@/components/shared/EmptyState.vue';

// Settings → Contract Printing tab. The MVP scope (per Phase 3 spec) is
// CONTRACT-only template management; the underlying API supports the other
// three categories so future tabs can reuse the same component with a
// different `category` prop.

const { t } = useI18n();
const { handle } = useApiError();
const { confirm } = useConfirm();
const toast = useToast();

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_BYTES = 5 * 1024 * 1024;

const items = ref<DocumentTemplate[]>([]);
const loading = ref(false);
const error = ref<unknown>(null);
const busyId = ref<string | null>(null);

const dialogOpen = ref(false);
const formName = ref('');
const formSlug = ref('');
const formDescription = ref('');
const pendingFile = ref<File | null>(null);
const slugTouched = ref(false);

const fileInput = ref<HTMLInputElement | null>(null);
const dragOver = ref(false);

const { uploading, progress, error: uploadError, reset, start } = useFileUpload<DocumentTemplate>({
  maxBytes: MAX_BYTES,
  acceptedMimeTypes: [DOCX_MIME],
  upload: (file, opts) =>
    documentTemplatesApi.create(
      {
        name: formName.value.trim(),
        slug: formSlug.value.trim(),
        category: 'CONTRACT' satisfies DocumentCategory,
        description: formDescription.value.trim() || null,
        isActive: true,
      },
      file,
      opts,
    ),
});

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const res = await documentTemplatesApi.list({
      category: 'CONTRACT',
      includeInactive: true,
    });
    items.value = res.items;
  } catch (e) {
    error.value = e;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function onNameInput(v: string) {
  formName.value = v;
  if (!slugTouched.value) {
    formSlug.value = slugify(v);
  }
}

function onSlugInput(v: string) {
  formSlug.value = v;
  slugTouched.value = true;
}

function openUploadDialog() {
  formName.value = '';
  formSlug.value = '';
  formDescription.value = '';
  slugTouched.value = false;
  pendingFile.value = null;
  reset();
  dialogOpen.value = true;
}

function pickFile() {
  if (uploading.value) return;
  fileInput.value?.click();
}

function onFileSelected(files: FileList | null) {
  const file = files?.[0];
  if (!file) return;
  pendingFile.value = file;
  // Pre-fill name from filename if the user hasn't typed one yet.
  if (!formName.value) {
    const base = file.name.replace(/\.docx$/i, '');
    onNameInput(base);
  }
}

function onDrop(ev: DragEvent) {
  ev.preventDefault();
  dragOver.value = false;
  if (uploading.value) return;
  onFileSelected(ev.dataTransfer?.files ?? null);
}

function onDragOver(ev: DragEvent) {
  ev.preventDefault();
  if (uploading.value) return;
  dragOver.value = true;
}

function onDragLeave() {
  dragOver.value = false;
}

const canSubmit = computed(
  () =>
    !uploading.value &&
    pendingFile.value !== null &&
    formName.value.trim().length > 0 &&
    formSlug.value.trim().length >= 2,
);

async function submitUpload() {
  if (!canSubmit.value || !pendingFile.value) return;
  const result = await start(pendingFile.value);
  if (result) {
    toast.success(t('documentTemplates.toast.uploaded'));
    dialogOpen.value = false;
    await load();
  }
}

async function setDefault(t1: DocumentTemplate) {
  if (t1.isDefault || busyId.value) return;
  busyId.value = t1.id;
  try {
    await documentTemplatesApi.setDefault(t1.id);
    toast.success(t('documentTemplates.toast.defaultSet'));
    await load();
  } catch (e) {
    handle(e);
  } finally {
    busyId.value = null;
  }
}

async function toggleActive(t1: DocumentTemplate) {
  if (busyId.value) return;
  busyId.value = t1.id;
  try {
    await documentTemplatesApi.update(t1.id, { isActive: !t1.isActive });
    await load();
  } catch (e) {
    handle(e);
  } finally {
    busyId.value = null;
  }
}

async function remove(t1: DocumentTemplate) {
  if (t1.isDefault) {
    toast.error(t('documentTemplates.errors.cannotDeleteDefault'));
    return;
  }
  const ok = await confirm({
    title: t('documentTemplates.deleteConfirmTitle'),
    message: t('documentTemplates.deleteConfirmMessage', { name: t1.name }),
    destructive: true,
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
  });
  if (!ok) return;
  busyId.value = t1.id;
  try {
    await documentTemplatesApi.remove(t1.id);
    toast.success(t('common.deleted'));
    await load();
  } catch (e) {
    handle(e);
  } finally {
    busyId.value = null;
  }
}

async function download(t1: DocumentTemplate) {
  try {
    await documentTemplatesApi.downloadTemplate(t1.id, `${t1.slug}.docx`);
  } catch (e) {
    handle(e);
  }
}

const hasItems = computed(() => items.value.length > 0);
</script>

<template>
  <div class="cp-templates space-y-4">
    <SettingsCard
      :title="t('documentTemplates.title')"
      :description="t('documentTemplates.description')"
      icon="mdi-file-document-outline"
    >
      <template #action>
        <v-btn color="primary" prepend-icon="mdi-upload" @click="openUploadDialog">
          {{ t('documentTemplates.upload') }}
        </v-btn>
      </template>

      <ErrorState v-if="error" :error="error" @retry="load" />

      <div v-else-if="loading && !hasItems" class="space-y-2">
        <v-skeleton-loader v-for="i in 2" :key="i" type="list-item-avatar-two-line" />
      </div>

      <EmptyState
        v-else-if="!hasItems"
        :title="t('documentTemplates.empty')"
        icon="mdi-file-document-outline"
        compact
      >
        <v-btn class="mt-2" color="primary" prepend-icon="mdi-upload" @click="openUploadDialog">
          {{ t('documentTemplates.upload') }}
        </v-btn>
      </EmptyState>

      <ul v-else class="cp-templates__list">
        <li
          v-for="tpl in items"
          :key="tpl.id"
          class="cp-templates__row"
          :class="{ 'cp-templates__row--inactive': !tpl.isActive }"
        >
          <div class="cp-templates__main">
            <div class="cp-templates__icon">
              <v-icon icon="mdi-file-word-box-outline" size="22" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium">{{ tpl.name }}</span>
                <v-chip
                  v-if="tpl.isDefault"
                  size="x-small"
                  color="primary"
                  variant="tonal"
                  prepend-icon="mdi-star"
                >
                  {{ t('documentTemplates.defaultBadge') }}
                </v-chip>
                <v-chip
                  v-if="!tpl.isActive"
                  size="x-small"
                  color="warning"
                  variant="tonal"
                >
                  {{ t('documentTemplates.inactiveBadge') }}
                </v-chip>
                <v-chip size="x-small" variant="tonal">{{ tpl.category }}</v-chip>
              </div>
              <div class="text-caption text-medium-emphasis mt-0.5">
                <span class="font-mono">{{ tpl.slug }}</span>
                <span class="mx-1">·</span>
                <DateDisplay :value="tpl.createdAt" />
                <span class="mx-1">·</span>
                <span>
                  {{
                    t('documentTemplates.placeholdersFound', {
                      count: tpl.placeholders.length,
                    })
                  }}
                </span>
              </div>
              <div v-if="tpl.description" class="text-caption text-medium-emphasis mt-0.5">
                {{ tpl.description }}
              </div>
            </div>
          </div>

          <div class="cp-templates__actions">
            <v-btn
              v-if="!tpl.isDefault && tpl.isActive"
              size="small"
              variant="text"
              prepend-icon="mdi-star-outline"
              :loading="busyId === tpl.id"
              @click="setDefault(tpl)"
            >
              {{ t('documentTemplates.setDefault') }}
            </v-btn>
            <v-btn
              size="small"
              variant="text"
              :prepend-icon="tpl.isActive ? 'mdi-pause' : 'mdi-play'"
              :disabled="tpl.isDefault && tpl.isActive"
              :loading="busyId === tpl.id"
              @click="toggleActive(tpl)"
            >
              {{ tpl.isActive ? t('documentTemplates.deactivate') : t('documentTemplates.activate') }}
            </v-btn>
            <v-btn
              icon="mdi-download"
              size="small"
              variant="text"
              :aria-label="t('common.download')"
              @click="download(tpl)"
            />
            <v-btn
              icon="mdi-delete-outline"
              size="small"
              variant="text"
              color="error"
              :disabled="tpl.isDefault"
              :aria-label="t('common.delete')"
              @click="remove(tpl)"
            />
          </div>
        </li>
      </ul>
    </SettingsCard>

    <PlaceholderReferenceCard />

    <!-- Upload dialog -->
    <v-dialog v-model="dialogOpen" max-width="640" :persistent="uploading" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon icon="mdi-upload" class="me-2" />
          {{ t('documentTemplates.uploadTitle') }}
          <v-spacer />
          <v-btn
            icon="mdi-close"
            variant="text"
            :disabled="uploading"
            @click="dialogOpen = false"
          />
        </v-card-title>
        <v-divider />
        <v-card-text class="py-4 grid grid-cols-1 gap-3">
          <input
            ref="fileInput"
            type="file"
            accept=".docx"
            class="sr-only"
            @change="(e) => onFileSelected((e.target as HTMLInputElement).files)"
          />

          <div
            class="cp-templates__drop"
            :class="{
              'cp-templates__drop--drag': dragOver,
              'cp-templates__drop--busy': uploading,
            }"
            role="button"
            tabindex="0"
            @click="pickFile"
            @keydown.enter.prevent="pickFile"
            @keydown.space.prevent="pickFile"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
          >
            <v-icon icon="mdi-file-word-box-outline" size="32" />
            <div class="text-sm mt-2">
              <strong v-if="pendingFile">{{ pendingFile.name }}</strong>
              <span v-else>{{ t('documentTemplates.dropOrClick') }}</span>
            </div>
            <div class="text-caption text-medium-emphasis mt-1">
              {{ t('documentTemplates.acceptHint') }}
            </div>
            <v-progress-linear
              v-if="uploading"
              :model-value="progress"
              color="primary"
              height="4"
              class="mt-3"
            />
          </div>

          <div v-if="uploadError" class="text-error text-caption">
            <v-icon icon="mdi-alert-circle-outline" size="16" />
            {{ uploadError.message }}
          </div>

          <v-text-field
            :model-value="formName"
            :label="t('documentTemplates.fields.name')"
            density="comfortable"
            variant="outlined"
            :disabled="uploading"
            required
            @update:model-value="onNameInput"
          />
          <v-text-field
            :model-value="formSlug"
            :label="t('documentTemplates.fields.slug')"
            density="comfortable"
            variant="outlined"
            :disabled="uploading"
            :hint="t('documentTemplates.fields.slugHint')"
            persistent-hint
            @update:model-value="onSlugInput"
          />
          <v-textarea
            v-model="formDescription"
            :label="t('documentTemplates.fields.description')"
            density="comfortable"
            variant="outlined"
            rows="2"
            :disabled="uploading"
          />
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-4 py-2">
          <v-spacer />
          <v-btn variant="text" :disabled="uploading" @click="dialogOpen = false">
            {{ t('common.cancel') }}
          </v-btn>
          <v-btn
            color="primary"
            :loading="uploading"
            :disabled="!canSubmit"
            prepend-icon="mdi-content-save-outline"
            @click="submitUpload"
          >
            {{ t('documentTemplates.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.cp-templates__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.cp-templates__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-md);
  background: var(--cp-surface);
  flex-wrap: wrap;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.cp-templates__row:hover {
  border-color: var(--cp-border-strong);
  box-shadow: var(--cp-shadow-sm);
}
.cp-templates__row--inactive {
  opacity: 0.7;
}
.cp-templates__main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}
.cp-templates__icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--cp-primary-soft);
  color: var(--cp-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.cp-templates__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.cp-templates__drop {
  border: 1.5px dashed var(--cp-border-strong);
  background: var(--cp-surface-2);
  border-radius: var(--cp-radius-md);
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
  text-align: center;
}
.cp-templates__drop:hover,
.cp-templates__drop:focus-visible {
  border-color: var(--cp-primary);
  background: var(--cp-primary-soft);
  outline: none;
}
.cp-templates__drop--drag {
  border-color: var(--cp-primary);
  background: var(--cp-primary-soft);
}
.cp-templates__drop--busy {
  cursor: progress;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>

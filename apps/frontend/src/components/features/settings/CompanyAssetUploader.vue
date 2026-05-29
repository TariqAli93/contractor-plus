<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { uploadsApi, type UploadedAssetResponse } from '@/services/api/uploads.api';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { useFileUpload } from '@/composables/useFileUpload';

// Reusable single-asset uploader for the company profile. Renders one of
// three states:
//
//   - empty:   dashed drop-zone with "click to upload" affordance
//   - preview: existing asset thumbnail + Replace/Delete actions
//   - uploading: blocked drop-zone with progress indicator
//
// Server is the source of truth for the saved URL; the local object-URL
// preview shown mid-upload is replaced by `currentUrl` once `uploaded` fires.

const props = defineProps<{
  kind: 'logo' | 'stamp';
  /** URL of the currently-stored asset, or null when nothing is uploaded. */
  currentUrl: string | null;
  /** Visual hint — square box for logos, rectangular for stamps. */
  shape?: 'square' | 'rect';
  /** Sub-label shown beneath the title (e.g. "PNG or JPG, up to 5 MB"). */
  hint?: string;
}>();

const emit = defineEmits<{
  (e: 'uploaded', asset: UploadedAssetResponse): void;
  (e: 'deleted'): void;
}>();

const { t } = useI18n();
const { confirm } = useConfirm();
const toast = useToast();

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

const fileInput = ref<HTMLInputElement | null>(null);
const dragOver = ref(false);
const deleting = ref(false);

const { uploading, progress, error, previewUrl, start, reset } = useFileUpload({
  maxBytes: MAX_BYTES,
  acceptedMimeTypes: ACCEPTED,
  upload: (file, opts) => uploadsApi.uploadCompanyAsset(props.kind, file, opts),
});

const displayedUrl = computed(() => previewUrl.value ?? props.currentUrl);
const hasAsset = computed(() => Boolean(displayedUrl.value));
const shapeClass = computed(() =>
  props.shape === 'rect' ? 'cp-uploader__frame--rect' : 'cp-uploader__frame--square',
);

function openPicker() {
  if (uploading.value || deleting.value) return;
  fileInput.value?.click();
}

async function handleFiles(list: FileList | null) {
  const file = list?.[0];
  if (!file) return;
  const result = await start(file);
  if (result) {
    emit('uploaded', result);
    toast.success(t('settings.company.assets.uploaded'));
    // Server-authoritative URL takes over once parent re-renders with
    // currentUrl set; release the object-URL preview to free memory.
    reset();
  }
  // Reset the <input> so selecting the same file twice still triggers
  // the change event.
  if (fileInput.value) fileInput.value.value = '';
}

function onDrop(ev: DragEvent) {
  ev.preventDefault();
  dragOver.value = false;
  if (uploading.value || deleting.value) return;
  handleFiles(ev.dataTransfer?.files ?? null);
}

function onDragOver(ev: DragEvent) {
  ev.preventDefault();
  if (uploading.value || deleting.value) return;
  dragOver.value = true;
}

function onDragLeave() {
  dragOver.value = false;
}

async function handleRemove() {
  if (!props.currentUrl) return;
  const ok = await confirm({
    title: t('settings.company.assets.deleteConfirmTitle'),
    message: t('settings.company.assets.deleteConfirmMessage'),
    destructive: true,
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
  });
  if (!ok) return;
  deleting.value = true;
  try {
    await uploadsApi.deleteCompanyAsset(props.kind);
    emit('deleted');
    toast.success(t('common.deleted'));
  } catch (err) {
    const message = err instanceof Error ? err.message : t('common.error');
    toast.error(message);
  } finally {
    deleting.value = false;
  }
}

const acceptedAttr = ACCEPTED.join(',');
</script>

<template>
  <div class="cp-uploader">
    <input
      ref="fileInput"
      type="file"
      :accept="acceptedAttr"
      class="sr-only"
      @change="(e) => handleFiles((e.target as HTMLInputElement).files)"
    />

    <div
      class="cp-uploader__frame"
      :class="[
        shapeClass,
        {
          'cp-uploader__frame--drag': dragOver,
          'cp-uploader__frame--busy': uploading || deleting,
        },
      ]"
      role="button"
      tabindex="0"
      @click="openPicker"
      @keydown.enter.prevent="openPicker"
      @keydown.space.prevent="openPicker"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <img
        v-if="hasAsset"
        :src="displayedUrl ?? ''"
        :alt="kind"
        class="cp-uploader__img"
      />
      <div v-else class="cp-uploader__empty">
        <v-icon icon="mdi-image-plus-outline" size="32" />
        <span class="cp-uploader__empty-label">
          {{ t('settings.company.assets.dropOrClick') }}
        </span>
      </div>

      <div v-if="uploading" class="cp-uploader__progress">
        <v-progress-circular indeterminate size="36" width="3" color="primary" />
        <span class="text-caption mt-2">{{ progress }}%</span>
      </div>
    </div>

    <div v-if="hint" class="cp-uploader__hint">{{ hint }}</div>

    <div v-if="error" class="cp-uploader__error">
      <v-icon icon="mdi-alert-circle-outline" size="16" />
      <span>{{ error.message }}</span>
    </div>

    <div class="cp-uploader__actions">
      <v-btn
        size="small"
        variant="text"
        prepend-icon="mdi-upload"
        :loading="uploading"
        :disabled="uploading || deleting"
        @click="openPicker"
      >
        {{ hasAsset ? t('settings.company.assets.replace') : t('settings.company.assets.upload') }}
      </v-btn>
      <v-btn
        v-if="props.currentUrl"
        size="small"
        variant="text"
        color="error"
        prepend-icon="mdi-delete-outline"
        :loading="deleting"
        :disabled="uploading || deleting"
        @click="handleRemove"
      >
        {{ t('common.delete') }}
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.cp-uploader {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cp-uploader__frame {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px dashed var(--cp-border-strong);
  border-radius: var(--cp-radius-md);
  background: var(--cp-surface-2);
  overflow: hidden;
  cursor: pointer;
  transition: border-color var(--cp-dur-base) var(--cp-ease),
    background-color var(--cp-dur-base) var(--cp-ease);
}
.cp-uploader__frame:hover,
.cp-uploader__frame:focus-visible {
  border-color: var(--cp-primary);
  background: var(--cp-primary-soft);
  outline: none;
}
.cp-uploader__frame--drag {
  border-color: var(--cp-primary);
  background: var(--cp-primary-soft);
}
.cp-uploader__frame--busy {
  cursor: progress;
  opacity: 0.85;
}
.cp-uploader__frame--square {
  width: 160px;
  height: 160px;
}
.cp-uploader__frame--rect {
  width: 220px;
  height: 130px;
}
.cp-uploader__img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  /* Checkerboard background for transparent stamps. Generated with two
     45° gradients — no asset dependency. */
  background-image:
    linear-gradient(45deg, #e5e7eb 25%, transparent 25%),
    linear-gradient(-45deg, #e5e7eb 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e5e7eb 75%),
    linear-gradient(-45deg, transparent 75%, #e5e7eb 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
.cp-uploader__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: var(--cp-text-muted);
  text-align: center;
  padding: 12px;
}
.cp-uploader__empty-label {
  font-size: 0.8rem;
}
.cp-uploader__progress {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(2px);
}
.cp-uploader__hint {
  font-size: 0.75rem;
  color: var(--cp-text-muted);
}
.cp-uploader__error {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--cp-error);
}
.cp-uploader__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
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

import { computed, onBeforeUnmount, ref } from 'vue';
import { ApiError } from '@/types/api';

// Generic single-file upload composable. The caller supplies an `upload`
// function (it can be uploadsApi.uploadCompanyAsset bound to a kind, or
// any other endpoint) and a list of constraints; the composable owns:
//
//   - selection / drop handlers
//   - client-side validation (size, mime)
//   - object-URL preview lifecycle (always revoked on reset/unmount)
//   - in-flight progress + abort
//   - structured error state the UI can render inline
//
// It does NOT mutate any persistent state on its own — the host component
// decides what to do with the result (typically refresh the parent record).

export interface UseFileUploadOptions<TResult> {
  /** Maximum file size in bytes. Rejected pre-flight if exceeded. */
  maxBytes: number;
  /** Allowed mime types (lowercased). */
  acceptedMimeTypes: ReadonlyArray<string>;
  /** Performs the actual upload. Receives the same File and an AbortSignal. */
  upload: (
    file: File,
    opts: { onProgress?: (percent: number) => void; signal?: AbortSignal },
  ) => Promise<TResult>;
}

export type UploadErrorKind = 'invalid_type' | 'too_large' | 'empty' | 'failed' | 'aborted';

export interface UploadError {
  kind: UploadErrorKind;
  message: string;
}

export function useFileUpload<TResult>(opts: UseFileUploadOptions<TResult>) {
  const uploading = ref(false);
  const progress = ref(0);
  const error = ref<UploadError | null>(null);
  const previewUrl = ref<string | null>(null);
  let currentPreviewObjectUrl: string | null = null;
  let abortController: AbortController | null = null;

  function disposePreview() {
    if (currentPreviewObjectUrl) {
      URL.revokeObjectURL(currentPreviewObjectUrl);
      currentPreviewObjectUrl = null;
    }
    previewUrl.value = null;
  }

  function validate(file: File): UploadError | null {
    if (file.size === 0) {
      return { kind: 'empty', message: 'File is empty.' };
    }
    if (!opts.acceptedMimeTypes.includes(file.type)) {
      return {
        kind: 'invalid_type',
        message: `Unsupported file type "${file.type || 'unknown'}".`,
      };
    }
    if (file.size > opts.maxBytes) {
      const mb = (opts.maxBytes / 1024 / 1024).toFixed(1);
      return { kind: 'too_large', message: `File exceeds the ${mb} MB limit.` };
    }
    return null;
  }

  async function start(file: File): Promise<TResult | null> {
    error.value = null;
    progress.value = 0;
    const v = validate(file);
    if (v) {
      error.value = v;
      return null;
    }

    // Local preview is shown immediately so the user sees what they
    // selected even before the server confirms.
    disposePreview();
    currentPreviewObjectUrl = URL.createObjectURL(file);
    previewUrl.value = currentPreviewObjectUrl;

    abortController = new AbortController();
    uploading.value = true;
    try {
      const result = await opts.upload(file, {
        onProgress: (p) => {
          progress.value = p;
        },
        signal: abortController.signal,
      });
      return result;
    } catch (err) {
      if (isAbortError(err)) {
        error.value = { kind: 'aborted', message: 'Upload cancelled.' };
      } else if (err instanceof ApiError) {
        error.value = { kind: 'failed', message: err.message };
      } else if (err instanceof Error) {
        error.value = { kind: 'failed', message: err.message };
      } else {
        error.value = { kind: 'failed', message: 'Upload failed.' };
      }
      // Drop the optimistic preview on failure so the UI returns to the
      // pre-upload state (the parent's existing asset URL, if any).
      disposePreview();
      return null;
    } finally {
      uploading.value = false;
      abortController = null;
    }
  }

  function abort() {
    abortController?.abort();
  }

  function reset() {
    abort();
    disposePreview();
    error.value = null;
    progress.value = 0;
    uploading.value = false;
  }

  onBeforeUnmount(reset);

  return {
    uploading,
    progress,
    error,
    previewUrl,
    canSubmit: computed(() => !uploading.value),
    start,
    abort,
    reset,
    validate,
  };
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'CanceledError') return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  return false;
}

// Backend kept the name `ApiErrorResponse`. The canonical shape now lives in
// @contractor-plus/shared as `ApiErrorPayload`; this file re-exports it under
// the legacy name so existing imports compile unchanged.
import type { ApiErrorPayload } from '@contractor-plus/shared';

export type ApiErrorResponse = ApiErrorPayload;
export type { ApiErrorPayload } from '@contractor-plus/shared';

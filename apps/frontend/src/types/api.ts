import type { ApiErrorPayload } from '@contractor-plus/shared';

export type { ApiErrorPayload } from '@contractor-plus/shared';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly reqId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static fromPayload(payload: ApiErrorPayload): ApiError {
    return new ApiError(
      payload.statusCode,
      payload.code,
      payload.message,
      payload.details,
      payload.reqId,
    );
  }

  isValidation(): boolean {
    return this.code === 'VALIDATION_ERROR';
  }

  fieldErrors(): Record<string, string[]> {
    if (
      this.isValidation() &&
      this.details &&
      typeof this.details === 'object' &&
      !Array.isArray(this.details)
    ) {
      return this.details as Record<string, string[]>;
    }
    return {};
  }
}

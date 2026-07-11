export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    /**
     * Whether retrying the identical request could succeed. A 409/timeout/429 is
     * retryable; a validation error or a domain-rule violation is not
     * (BACKEND.md §14.1). Defaults to `false`, so existing errors are unchanged.
     */
    public readonly retryable: boolean = false,
    /** Underlying cause, carried for logging only; never serialized to the wire. */
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
  }
}

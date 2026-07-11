import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped context, propagated through the async call chain of a single
 * request via {@link AsyncLocalStorage}.
 *
 * WHY THIS IS A STANDALONE MODULE (not inside the Fastify plugin): both the
 * plugin AND the logger need it, and the logger must not depend on a Fastify
 * plugin. Extracting the store here breaks that cycle — the plugin establishes
 * the context, the logger reads it (BACKEND.md §15.3).
 *
 * THIS CARRIES LOGGING PROVENANCE ONLY. It is never read to make an
 * authorization decision — that is the `Principal`'s job, passed explicitly
 * (BACKEND.md §12.2, §15.3). Storing `userId` here lets every log line be
 * attributable; it does not grant anything.
 */
export interface RequestContext {
  /** The request id, which is also the trace id (BACKEND.md §15.3). */
  readonly reqId: string;
  readonly ipAddress: string;
  readonly userAgent: string;
  /** Populated by the auth plugin AFTER the token is verified (fixes B2). */
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Run `callback` with `context` established for the remainder of the async
 * chain. Used by the request-context plugin's `onRequest` hook; `callback` is
 * Fastify's `done`, so everything downstream in the request sees this context.
 */
export function runWithRequestContext(context: RequestContext, callback: () => void): void {
  storage.run(context, callback);
}

/** The current request's context, or `undefined` outside a request. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Attach the authenticated user id to the current context (fixes B2, where
 * `userId` was declared but never set because the context was built before
 * authentication ran). No-op outside a request.
 */
export function setRequestUser(userId: string): void {
  const context = storage.getStore();
  if (context) context.userId = userId;
}

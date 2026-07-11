import { pino, type LoggerOptions } from 'pino';
import { env } from '../config/env.js';
import { redactSecrets } from './log-redaction.js';
import { getRequestContext } from './request-context-store.js';

const isDev = env.NODE_ENV === 'development';

/**
 * Shared pino options, used both to construct the standalone {@link logger} and
 * as Fastify's logger configuration (so the app has ONE logging policy).
 *
 * Three things every line gets (BACKEND.md §15.2, §15.3):
 *  - a level of `info` in production (raised from `warn`: a machine with no
 *    operator whose logs say nothing is a support call that starts blind);
 *  - deep secret redaction, covering nested secrets at any depth (§15.2);
 *  - request provenance (`reqId`/`traceId`/`userId`) via the async-local context.
 */
export const loggerOptions: LoggerOptions = {
  level: isDev ? 'debug' : 'info',
  base: { service: 'contractor-plus-api' },
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      }
    : undefined,
  // Deep, key-name-based redaction applied to every emitted object. Runs after
  // pino's req/res/err serializers, so it also scrubs serialized headers.
  formatters: {
    log(object: Record<string, unknown>): Record<string, unknown> {
      return redactSecrets(object) as Record<string, unknown>;
    },
  },
  // Attach request provenance to every line emitted during a request.
  mixin() {
    const ctx = getRequestContext();
    if (!ctx) return {};
    return {
      reqId: ctx.reqId,
      traceId: ctx.reqId,
      ...(ctx.userId ? { userId: ctx.userId } : {}),
    };
  },
};

export const logger = pino(loggerOptions);

export type Logger = typeof logger;

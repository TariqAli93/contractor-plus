/**
 * Logger — the narrow logging port the application depends on.
 *
 * WHY A PORT: the application ring must not depend on pino directly (that is an
 * infrastructure choice). Depending on this minimal structural interface means
 * both the real pino logger and Fastify's request logger satisfy it, and the
 * logging engine is swappable without touching a use case (Dependency Inversion).
 */
export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  /** A child logger with additional bindings on every line. */
  child(bindings: Record<string, unknown>): Logger;
}

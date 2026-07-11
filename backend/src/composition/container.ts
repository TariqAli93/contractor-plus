import type { Clock } from '../application/ports/clock.js';
import type { Logger } from '../application/ports/logger.js';
import { SystemClock } from '../infrastructure/time/system-clock.js';
import { loadFoundationConfig, type FoundationConfig } from './config.js';

/**
 * Container — the single composition root (fixes B4: dependency construction was
 * scattered across route plugins).
 *
 * WHY HAND-WRITTEN AND NOT A DI FRAMEWORK: at this module count a plain function
 * is ~all a container needs — no decorators, no reflection, no startup-order
 * surprises, and no class of runtime error a framework introduces (BACKEND.md
 * §9.3). Later phases extend {@link Container} with repositories and use cases
 * and register them here; nothing else constructs its own dependencies.
 */
export interface Container {
  readonly config: FoundationConfig;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface ContainerDeps {
  /** The application logger, supplied by the entrypoint (never imported here, so
   * the container carries no env-validation side effect and stays unit-testable). */
  readonly logger: Logger;
  readonly config?: FoundationConfig;
  readonly clock?: Clock;
}

export function buildContainer(deps: ContainerDeps): Container {
  const config = deps.config ?? loadFoundationConfig();
  const clock = deps.clock ?? new SystemClock(config.timezone);
  return {
    config,
    clock,
    logger: deps.logger,
  };
}

import type { DomainEvent } from '../../domain/shared/domain-event.js';
import type { Principal } from '../../domain/shared/principal.js';

/**
 * TxHandle — an OPAQUE transaction handle.
 *
 * The application ring must not import Prisma (that is a forbidden edge enforced
 * in CI — BACKEND.md §2). But a repository needs the transaction client to run
 * its query. The resolution: the port exposes an opaque brand; the Prisma
 * repository, which lives in infrastructure, casts it back to a
 * `Prisma.TransactionClient` at the boundary. Application code can hold and pass
 * a `TxHandle` but can do nothing else with it, so Prisma never leaks inward.
 */
declare const txBrand: unique symbol;
export type TxHandle = { readonly [txBrand]: 'TxHandle' };

/**
 * TxContext — everything a use case's callback receives inside a transaction:
 * the transaction handle, the calling principal, the trace id, and the buffer of
 * domain events to be flushed to the outbox at commit.
 */
export interface TxContext {
  readonly tx: TxHandle;
  readonly principal: Principal;
  readonly traceId: string;
  /** Events raised during the transaction; the UoW appends them at commit. */
  readonly events: DomainEvent[];
}

/**
 * UnitOfWork — the ONLY place a database transaction begins (BACKEND.md §7.2).
 *
 * One use case = one `run()` = one transaction = one authorization decision. The
 * implementation opens the transaction, builds the {@link TxContext}, invokes
 * `fn`, then — still inside the transaction — writes the buffered events to the
 * outbox and the audit rows, and commits. An event is published if and only if
 * the write committed.
 */
export interface UnitOfWork {
  run<T>(fn: (ctx: TxContext) => Promise<T>): Promise<T>;
}

/**
 * EventPublisher — appends domain events to the transactional outbox, in the
 * caller's transaction (ARCHITECTURE.md §6, step 5). It never dispatches; the
 * background dispatcher does that after commit. Appending and dispatching being
 * separate is the entire point of the outbox.
 */
export interface EventPublisher {
  append(ctx: TxContext, events: readonly DomainEvent[]): void;
}

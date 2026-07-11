/**
 * DomainEvent — the base for every fact the domain publishes.
 *
 * An aggregate records events as it changes state and hands them to the
 * application layer, which appends them to the transactional outbox in the SAME
 * transaction as the write (ARCHITECTURE.md §6, "the whole trick of the outbox").
 * An event is therefore published if and only if the write committed — no dual
 * write, no lost notification, no broker.
 *
 * TWO RULES a concrete event must honour:
 *  1. `payload()` is SELF-CONTAINED. A projector must never re-read the write
 *     model to interpret an event — by the time it runs the row may have changed
 *     again, and the projector would apply the latest state under an older
 *     event's identity (BACKEND.md §17.2). Everything a consumer needs is in the
 *     payload.
 *  2. `occurredAt` is INJECTED, not read from a clock. The domain stays pure and
 *     testable; the application supplies the time via the {@link Clock} port.
 */
export abstract class DomainEvent {
  constructor(readonly occurredAt: Date) {}

  /** The aggregate type this event concerns, e.g. `"Contract"`. */
  abstract readonly aggregateType: string;

  /** The id of the aggregate instance. */
  abstract readonly aggregateId: string;

  /** The event name, e.g. `"ContractApproved"`. */
  abstract readonly eventType: string;

  /** A self-contained, serializable snapshot of everything a consumer needs. */
  abstract payload(): Readonly<Record<string, unknown>>;
}

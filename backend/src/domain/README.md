# Domain layer (ring 1)

The innermost ring of the Clean Architecture (ARCHITECTURE.md §2). It holds the
rules that are true regardless of how the application is delivered — by mouse, by
REST, by the AI assistant, or by a scheduled job.

## The dependency rule

**Dependencies point inward, always.** This directory may import:

- itself,
- `@prisma/client` **for `Prisma.Decimal` only** (the decimal engine, never the client),
- `../shared/errors/*` (pure `AppError` subclasses — no infrastructure).

It must **never** import Prisma's client, Fastify, zod, the LLM, a repository, or
anything in `infrastructure/` or `interface/`. This is enforced in CI by
`dependency-cruiser`; a forbidden import fails the build.

If you find yourself needing a database or an HTTP type here, the logic belongs
in the **application** ring, not the domain.

## What lives here

| File | What | Why it is domain, not infrastructure |
|---|---|---|
| `shared/money.ts` | `Money` value object | Money arithmetic is a rule (`total = qty × price`), not a storage concern |
| `shared/local-date.ts` | `LocalDate` value object | A business day is a domain concept distinct from an instant (DATABASE.md §3) |
| `shared/domain-event.ts` | `DomainEvent` base | Events are facts the domain publishes; the outbox is how, not what |
| `shared/errors.ts` | `DomainRuleViolation` | An illegal state transition is a domain rule, surfaced as HTTP 422 |
| `shared/identity.ts` | Branded `EntityId` types | Type-level id safety, erased at runtime |
| `shared/principal.ts` | `Principal` — "who is asking" | Authorization is a domain decision, checked in the use case |

## Two decisions worth knowing

**Exceptions, not `Result`.** The codebase throws `AppError` and the error-handler
plugin serializes it to the wire envelope the SPA expects. Introducing a
railway-oriented `Result` type would create a second error vocabulary. The domain
throws `DomainRuleViolation`; the application throws `NotFoundError` /
`ConflictError`; the interface catches nothing and lets the plugin translate.

**No `toNumber()` on `Money`.** Converting money to a float is the one operation
that reintroduces IEEE-754 drift. The value object refuses to offer it; money
leaves the domain only as a fixed-precision string, at the DTO boundary.

## Testing

Pure ring, pure unit tests — no database, no mocks, no infrastructure. Run:

```
pnpm --filter backend test
```

Domain tests live under `test/domain/`.

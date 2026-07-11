# Application layer (ring 2)

Use cases and the port interfaces they depend on (ARCHITECTURE.md §2). One use
case = one transaction = one authorization decision (BACKEND.md §7.1).

## The dependency rule

May import: the **domain** ring, `shared/`, and its own `ports/`. Must **never**
import `@prisma/client`, Fastify, zod, or anything in `infrastructure/` or
`interface/`. Enforced by `.dependency-cruiser.cjs` (`pnpm depcruise`) and by the
self-contained architecture test (`test/architecture/dependency-rules.test.ts`).

## `ports/`

The interfaces this ring declares and infrastructure implements — the seam that
keeps Prisma, pino, and OpenRouter out of the use cases:

| Port | Implemented by (infrastructure) |
|---|---|
| `Clock` | `SystemClock` |
| `Logger` | the pino logger / Fastify's request logger |
| `UnitOfWork`, `EventPublisher` | `PrismaUnitOfWork`, `OutboxPublisher` (later phases) |

`TxContext` carries an **opaque** `TxHandle`, so a use case can pass the
transaction to a repository without Prisma ever leaking inward.

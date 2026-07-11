# Infrastructure layer (ring 4)

The adapters that implement the application's ports (ARCHITECTURE.md §2, §8). The
**only** ring where Prisma, pino, the filesystem, and outbound HTTP appear.

May import everything inward. Nothing inward may import it.

## Contents (Phase 0)

| Path | Implements | Note |
|---|---|---|
| `time/system-clock.ts` | `Clock` | Business day via built-in `Intl` — no dependency added |
| `persistence/prisma-error-mapper.ts` | — | The sole boundary that inspects Prisma error types and maps them to `AppError`, leaking neither Prisma nor SQL detail to the wire |

Later phases add `persistence/prisma/*` repositories, `events/*` (outbox +
projectors), `jobs/*`, `search/*`, `llm/*`, `storage/*`, and `secrets/*`.

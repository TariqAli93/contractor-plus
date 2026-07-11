# Composition root

The single place dependencies are constructed and wired (BACKEND.md §9.3, fixes
B4). A hand-written container — no DI framework, no decorators, no reflection.

May import everything; nothing imports it except the entrypoint (`app.ts`).

## Contents

| File | Purpose |
|---|---|
| `config.ts` | `FoundationConfig` — the typed subset the container assembles from `process.env` (no env-validation side effect at import) |
| `container.ts` | `buildContainer(deps)` → `Container`. Phase 0 wires `config`, `clock`, `logger`; later phases extend it with repositories and use cases |

`app.ts` builds the container once and decorates it onto the Fastify instance as
`app.container`; routes in later phases resolve their use cases from there instead
of constructing their own.

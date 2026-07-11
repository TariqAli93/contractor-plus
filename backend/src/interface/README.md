# Interface layer (ring 3)

Translates transport (HTTP) into a use-case call and back (ARCHITECTURE.md §2).
Owns routes, controllers, zod request/response schemas, and DTOs.

May import: the **application** ring and `shared/`. Must **never** import a
repository, `infrastructure/persistence/*`, or domain internals — it goes through
the application layer, always (enforced: `interface-no-direct-persistence` in
`.dependency-cruiser.cjs`).

The controller is deliberately boring: transport in → command out, DTO in →
status out. No business logic, no transactions, no `try/catch` around domain
errors (the error-handler plugin translates them). See BACKEND.md §5.3, §9.

_No code yet — HTTP surfaces are built starting Phase 1 (per the phase plan).
This ring is established here so the boundary exists before the first route._

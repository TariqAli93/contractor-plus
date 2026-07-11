/**
 * Architecture enforcement — the dependency rule made mechanical (ARCHITECTURE.md
 * §2, BACKEND.md §2, §25). "An architecture that is not mechanically enforced
 * degrades to a big ball of mud within two quarters."
 *
 * SCOPE (Phase 0 decision): rules are scoped to the NEW rings only —
 * `domain`, `application`, `infrastructure`, `interface`, `composition`. Legacy
 * `src/modules/**` and `src/plugins/**` are intentionally not validated yet; the
 * `depcruise` script points only at the new-ring directories, and enforcement
 * widens as each legacy module is migrated in later phases.
 *
 * The allowed inward edges:
 *   domain         → itself, shared/errors, @prisma/client (Decimal ONLY)
 *   application    → domain, shared, ports
 *   infrastructure → everything (it implements the ports)
 *   interface      → application, shared (never a repository or domain internals)
 *   composition    → everything (it is the wiring)
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-no-framework',
      comment: 'Domain (ring 1) must not depend on a web/validation framework.',
      severity: 'error',
      from: { path: '^src/domain' },
      to: { path: 'node_modules/(fastify|@fastify|zod|pino)' },
    },
    {
      name: 'domain-stays-innermost',
      comment: 'Domain must not depend on any outer ring.',
      severity: 'error',
      from: { path: '^src/domain' },
      to: { path: '^src/(application|infrastructure|interface|composition|modules|plugins)' },
    },
    {
      name: 'application-no-orm-or-framework',
      comment: 'Application (ring 2) must not touch Prisma, Fastify, or zod directly.',
      severity: 'error',
      from: { path: '^src/application' },
      to: { path: 'node_modules/(@prisma/client|\\.prisma|fastify|@fastify|zod)' },
    },
    {
      name: 'application-no-outer-rings',
      comment: 'Application must not depend on infrastructure or interface.',
      severity: 'error',
      from: { path: '^src/application' },
      to: { path: '^src/(infrastructure|interface|modules|plugins)' },
    },
    {
      name: 'interface-no-direct-persistence',
      comment: 'Interface (ring 3) must go through the application layer, never a repository.',
      severity: 'error',
      from: { path: '^src/interface' },
      to: { path: '^src/infrastructure/persistence' },
    },
    {
      name: 'no-circular',
      comment: 'No circular dependencies within the new rings.',
      severity: 'error',
      from: { path: '^src/(domain|application|infrastructure|interface|composition)' },
      to: { circular: true },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    // Do not descend into legacy rings or tests when cruising the new rings.
    exclude: { path: '(^src/modules|^src/plugins|\\.test\\.ts$)' },
  },
};

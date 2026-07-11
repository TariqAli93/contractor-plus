# Contractor Plus — Backend Implementation Design

**Status:** Design. No implementation.
**Continues:** `docs/ARCHITECTURE.md` (approved), `docs/DATABASE.md` (approved).
References: §A*n* → ARCHITECTURE.md, §D*n* → DATABASE.md, §*n* → this document.

---

## 0. What "enterprise scale" means here — and what it must not mean

The brief says *optimize for enterprise scale*. §A0 says the deployment is **one Windows PC in one
contractor's office, 1–10 concurrent humans**, and that *"every new infrastructure dependency is a
liability, not an asset."*

These are not in conflict, but only if the word is used precisely. Taken as a volume target it would
justify Redis, a broker, a worker fleet, and horizontal partitioning — every one of which §A0 rejects
by name, and rightly: each is another Windows service that can fail to install on a machine with no IT
department.

So this document reads *enterprise* as a statement about **rigor, not throughput**:

| Enterprise-grade means | Enterprise-scale would mean | This design |
|---|---|---|
| One transaction per use case; no dual writes | Distributed sagas | ✅ Unit of Work + outbox |
| Every mutation attributable and replayable | Event sourcing | ✅ audit + outbox, not ES |
| Authorization decided once, in one place, provably | Policy engine service (OPA) | ✅ in-process `Principal` + catalog |
| Failures typed, retryable-or-not, never silent | Chaos engineering | ✅ error taxonomy + DLQ |
| Boundaries enforced by a machine, not by memory | Microservices | ✅ `dependency-cruiser` in CI |
| Idempotent writes; a retry cannot double-charge | Exactly-once delivery | ✅ idempotency keys |
| Observable: trace a number back to the row and the human | APM cluster | ✅ `trace_id` end-to-end |
| Swappable adapters (Prisma, OpenRouter, disk) | Service mesh | ✅ ports & adapters |

**The load-bearing sentence:** the thing that must scale is *the codebase absorbing ten more features
and four more engineers without collapsing*, and *the database absorbing ten years of one contractor's
ledgers without the dashboard slowing down*. Not requests per second. Where this document proposes
something that costs runtime complexity for throughput we will never need, it is wrong and should be
cut.

Everything below is therefore optimized for **correctness under audit, and change under pressure.**

---

## 1. Findings in the current backend

Reading the tree before designing surfaced ten things. The first is a security defect, not a design
preference.

### B1 — 🔴 The legacy role fallback silently grants every permission it was meant to gate

`backend/src/plugins/rbac.plugin.ts:40-63`. `requireAccess` evaluates permissions, and *then*:

```ts
// 4. Legacy role fallback.
if (opts.roles && opts.roles.length > 0 && opts.roles.includes(request.user.role)) return;
```

Routes pass both (`backend/src/modules/contracts/contracts.routes.ts:26-28`):

```ts
const g = (permission: string) => ({
  preHandler: [fastify.authenticate,
    fastify.requireAccess({ permissions: [permission], roles: WRITE_ROLES })],
});
fastify.post('/:id/approve', g('contracts.approve'), controller.approve);
```

`WRITE_ROLES` includes `ACCOUNTANT`. So an `ACCOUNTANT` **passes `contracts.approve` whether or not
the permission is granted**, and revoking `contracts.approve` from the role changes nothing. The
fallback is a union, not a fallback — it only ever *adds* access.

**31 route registrations** across **16 modules** pass both `permissions` and `roles`. The RBAC catalog
those permissions live in is, for any user holding a legacy role, decorative.

This matters far beyond RBAC hygiene: §A5.1 invariant 1 promises the AI's writes are permission-gated
against the live principal, using this same catalog. An AI tool that checks `contracts.approve` is
checking a permission the HTTP path does not actually enforce. The two paths already disagree.

**Fix (§12):** delete the `roles` branch. Migrate the ~7 legacy role constants into permission grants
on those roles (a seed, not a code change), then make `requireAccess` permission-only. `OWNER` stays a
super-admin short-circuit. This is a one-release deprecation with a loud log line in between.

### B2 — `request-context` declares `userId` and never sets it

`backend/src/plugins/request-context.plugin.ts:9,19-26`. The `AsyncLocalStorage` store is populated in
`onRequest`, which runs *before* `authenticate`. `RequestContext.userId` is therefore permanently
`undefined`, and every log line is unattributable. It also explains why `AuditActor` is threaded by
hand through every controller (`contracts.controller.ts:76-83`) and every service signature.

### B3 — Zod runs in controllers, so Fastify's schema pipeline is unused

`contracts.controller.ts:19` — `listContractsQuerySchema.parse(request.query)`. Consequences: no
OpenAPI document can be generated, no `fast-json-stringify` response serialization (the single
cheapest performance win Fastify offers), and response shapes are enforced nowhere.

### B4 — No composition root

`contracts.routes.ts:21-22` — `new ContractsService(fastify.prisma)` inside the route plugin. Every
module constructs its own dependencies. Cross-module calls therefore mean importing and re-newing
another module's service, which is exactly the edge §A12 forbids and cannot be enforced while
construction is scattered.

### B5 — Permission set is re-queried per request

`rbac.plugin.ts:18-24` memoizes per *request*, then hits the database again on the next one. With
§A5.2's live-role re-check requirement this looks unavoidable; §13 shows it is not (epoch-versioned
cache).

### B6 — No outbox, no jobs, no search, no notifications, no cache, no domain layer

`ls backend/src/plugins` → `auth, error-handler, prisma, rbac, request-context, tunnel`. Every
platform module in §A4.2 is unbuilt. Services currently hold domain rules, orchestration, and Prisma
calls together (`contracts.service.ts`, 565 lines).

### B7 — Interactive `$transaction` with the default 5 s timeout

`contracts.service.ts:86,139,201,224,371,416,465`. `generateEstimate` and DOCX-adjacent paths run
inside them. A slow disk or a cold Prisma engine turns a business operation into `P2028`.

### B8 — Money rounds to 2dp by default; the database is moving to `NUMERIC(18,4)`

`lib/money.ts` — `round(value, dp = 2)`, `toMoneyString(value, dp = 2)`. §D1.2 and §D3 specify 4
decimal places for storage and a currency-driven precision for display. The default is a silent
truncation waiting for a unit price of `12.3456`.

### B9 — No idempotency on any `POST`

A retried "record payment" creates a second payment. On a desktop app over a flaky tunnel this is not
theoretical.

### B10 — Global rate limit keyed by IP, on a single-machine deployment

`app.ts:92-102` — `max: 1000` per IP per minute. Every request originates from `127.0.0.1` (or the
tunnel's loopback), so this is one shared bucket for all users, and §A5.2's *per-user* AI rate limit
cannot be expressed with it.

---

## 2. Layering, and the directory that enforces it

§A2's four rings, made physical. **Dependencies point inward, always.**

```
backend/src/
├── domain/                     ← ring 1. Imports nothing but itself + Decimal
│   ├── shared/                    Money, Result, DomainEvent, EntityId, Clock (type)
│   ├── contract/                  Contract.ts, ContractItem.ts, ChangeOrder.ts, invariants
│   ├── project/                   Project.ts, ConstructionStep.ts, progress rules
│   ├── payment/                   Payment.ts (scheduled vs paid, §D8.3)
│   ├── cost/                      ProjectCost.ts, OverheadExpense.ts
│   ├── catalog/                   Material.ts, Supplier.ts, BuildingTemplate.ts, Unit.ts
│   └── identity/                  Principal.ts, Role.ts, PermissionKey.ts
│
├── application/                ← ring 2. Imports domain + ports. NEVER Prisma, NEVER Fastify
│   ├── ports/                     Repository, UnitOfWork, EventPublisher, Clock,
│   │                              LlmClient, SearchIndex, VectorStore, FileStorage,
│   │                              DocumentRenderer, JobQueue, Notifier, Cache, SecretStore
│   ├── contracts/                 ApproveContract.ts, CreateContract.ts, …  (one file = one use case)
│   ├── projects/  payments/  costs/  catalog/  identity/
│   ├── search/    notifications/   recommendations/   reports/
│   └── ai/                        the six rings of §A5
│
├── infrastructure/             ← ring 4. Implements ports. The only place Prisma types exist
│   ├── persistence/prisma/        *.repository.ts, PrismaUnitOfWork.ts, mappers/
│   ├── events/                    OutboxPublisher.ts, OutboxDispatcher.ts, projectors/
│   ├── jobs/                      PgJobQueue.ts, JobRunner.ts, handlers/
│   ├── search/                    PgSearchIndex.ts, ar-normalize.sql
│   ├── llm/                       OpenRouterClient.ts
│   ├── storage/                   LocalFileStorage.ts
│   ├── documents/                 DocxRenderer.ts
│   ├── cache/                     InProcessCache.ts
│   └── secrets/                   DpapiSecretStore.ts
│
├── interface/http/             ← ring 3. Fastify. Translates transport → use case
│   ├── plugins/                   auth, rbac, error-handler, request-context, idempotency, sse
│   ├── modules/<name>/            <name>.routes.ts, .controller.ts, .schemas.ts, .dto.ts
│   └── openapi.ts
│
├── composition/                ← the ONE place `new` appears for a dependency
│   ├── container.ts               builds every adapter, wires every use case
│   └── register-modules.ts
│
└── shared/                     ← errors, pagination, result, ids. Imported by everyone
```

**Why `interface/http/modules/<name>` and not the current `modules/<name>`.** Today a module folder
holds routes, controller, service, repository, schemas, types — four rings in one directory
(`backend/src/modules/contracts/`). That is why nothing prevents the controller from touching Prisma:
they are neighbors. Splitting by ring first and by feature second makes the forbidden import *look*
wrong before the linter says so.

**The cost, stated honestly.** This is a large refactor of a working codebase, and it buys nothing on
day one. It is worth doing only because §A2 already committed to it and because the AI platform (§A5)
depends on the Application ring existing as a callable surface — the assistant's "one door" (§A1) is
literally the set of use-case classes. Without ring 2, the AI has no door and will grow its own.
Sequencing in §26.

**Enforcement (§25).** `dependency-cruiser`, `.dependency-cruiser.cjs`, run in CI. The forbidden edges
of §A12 become `forbidden:` rules. An architecture not enforced by a machine degrades to a big ball of
mud within two quarters, and this one has already started: `contracts.service.ts` imports
`AuditService` and `@prisma/client` and holds business invariants.

---

## 3. Ports — the interfaces ring 2 declares and ring 4 implements

A port is named for what the **application** needs, never for what the technology provides. `LlmClient`,
not `OpenRouterGateway`. `Clock`, not `SystemTime`.

| Port | Shape (abridged) | Adapter | Why it is a port |
|---|---|---|---|
| `UnitOfWork` | `run<T>(fn: (ctx: TxContext) => Promise<T>): Promise<T>` | `PrismaUnitOfWork` | The **only** place `BEGIN` starts. §7 |
| `<Aggregate>Repository` | `findById`, `save`, `nextNumber`, … — takes `TxContext` | `Prisma*Repository` | Swappable; enables real-DB or in-memory tests |
| `EventPublisher` | `append(ctx, events: DomainEvent[]): void` | `OutboxPublisher` | Appends **in the caller's transaction**. §A6 step 5 |
| `Clock` | `now(): Date`, `today(): LocalDate` | `SystemClock` | Makes "overdue" testable without waiting |
| `IdGenerator` | `uuid()`, `bigintSeq()` | `CryptoIdGenerator` | Deterministic ids in tests |
| `Cache` | `get`, `set`, `invalidateTag`, `epoch(tag)` | `InProcessCache` | §13 |
| `JobQueue` | `enqueue(kind, payload, opts)`, `claim(n)`, `complete`, `fail` | `PgJobQueue` | `SKIP LOCKED`; extractable (§A12 step 1) |
| `SearchIndex` | `upsert(doc)`, `delete(type,id)`, `query(q, principal)` | `PgSearchIndex` | One index, three consumers (§A10.3) |
| `VectorStore` | `upsert(entity, vec)`, `knn(vec, k, filter)` | `PgVectorStore` | HNSW, not ivfflat (§D-D2) |
| `Notifier` | `dispatch(notification)` | `MultiChannelNotifier` | in-app + SSE + Windows toast |
| `FileStorage` | `put(bucket, stream)`, `get`, `delete`, `stat` | `LocalFileStorage` | §A13: "documents grow → disk, not latency" |
| `DocumentRenderer` | `render(template, data): Stream` | `DocxRenderer` | docxtemplater |
| `LlmClient` | `complete(prompt, schema): Result<T>` | `OpenRouterClient` | Faked in tests. The reason the old AI tests worked |
| `SecretStore` | `seal`, `open` | `DpapiSecretStore` | The API key never sits in plaintext |

**`TxContext` is the thread of the whole design.** It carries the Prisma transaction client, the
`Principal`, the `trace_id`, and the event buffer. It is passed explicitly, never read from ambient
storage — see §15.3 for why `AsyncLocalStorage` is used for *logging* and never for *correctness*.

---

## 4. Module catalog

### 4.1 Business modules (exist; to be re-layered)

| Module | Aggregate(s) | HTTP prefix | Notes |
|---|---|---|---|
| `identity` | User, Role, Permission | `/auth`, `/users`, `/profile`, `/rbac` | §12 |
| `customers` | Customer | `/customers` | "Clients" is a synonym, never a table (§A3.1) |
| `catalog` | Material, Unit | `/materials`, `/units` | `/units` NEW |
| `suppliers` | Supplier, SupplierMaterial | `/suppliers` | **NEW** |
| `price-history` | — (read model) | `/materials/:id/price-history` | **NEW** |
| `templates` | BuildingTemplate | `/templates` | Versioned (§D5.1) |
| `contracts` | Contract, ContractItem, ChangeOrder | `/contracts`, `/change-orders` | |
| `projects` | Project, ConstructionStep | `/projects` | |
| `costs` | ProjectCost, OverheadExpense | `/costs`, `/overhead-expenses` | overhead **NEW, optional** |
| `payments` | Payment | `/payments` | `scheduled`/`paid` split (§D-D4) |
| `documents` | DocumentTemplate, GeneratedDocument | `/document-templates`, `/generated-documents` | |
| `reports` | — (read model) | `/reports` | Reads matviews **only** |

### 4.2 Platform modules (all new)

| Module | Responsibility | HTTP |
|---|---|---|
| `platform/events` | Domain event bus + transactional outbox + dispatcher + projectors | — |
| `platform/jobs` | Durable queue + scheduler (`SKIP LOCKED`) + reaper + DLQ | `/jobs` (admin) |
| `platform/search` | Unified index; palette, global search, AI entity resolution | `/search` |
| `platform/notifications` | Rules → fan-out → channels | `/notifications`, `/notifications/stream` (SSE) |
| `platform/analytics` | Matview refresh, snapshot facts | — (feeds `/reports`) |
| `platform/recommendations` | Tier 0/1/2, each with evidence | `/recommendations` |
| `platform/cache` | Epoch-versioned in-process cache | — |
| `platform/storage` | Buckets, streaming, hashing, quarantine | `/uploads` |

### 4.3 AI modules (§A5's six rings)

| Module | Ring | HTTP |
|---|---|---|
| `ai/transport` | 1 | `/ai/sessions/*` |
| `ai/governance` | 2 | — |
| `ai/conversation` | 3 | — |
| `ai/reasoning` | 4 | — |
| `ai/capability` | 5 | — |
| `ai/effect` | 6 | — |
| `ai/reports` | — | `/ai/reports` |

---

## 5. Anatomy of a module — the canonical slice

Every module has the same shape, so a reviewer who has read one has read all of them. Using
`contracts` and the `approveContract` use case.

```
domain/contract/
  Contract.ts                 aggregate root: state + invariants + event emission
  ChangeOrder.ts
  ContractStatus.ts           the legal transition graph
  events.ts                   ContractApproved, ContractCancelled, …

application/ports/
  ContractRepository.ts       interface, in terms of the DOMAIN type

application/contracts/
  ApproveContract.ts          the use case. ~30 lines
  CreateContract.ts
  GenerateEstimate.ts
  dto.ts                      ContractDto — the shape ring 3 is allowed to see

infrastructure/persistence/prisma/
  PrismaContractRepository.ts implements the port; the ONLY file with `prisma.contract`
  mappers/contract.mapper.ts  Prisma row ⇄ domain aggregate

interface/http/modules/contracts/
  contracts.routes.ts         path + method + permission + zod schema
  contracts.controller.ts     transport → command; no logic
  contracts.schemas.ts        zod request/response schemas (also the OpenAPI source)
```

### 5.1 The domain object holds the rule

```ts
// domain/contract/Contract.ts
export class Contract {
  private constructor(private props: ContractProps, private events: DomainEvent[] = []) {}

  /** §A3.3 — only an APPROVED contract may spawn a project; only a DRAFT may be edited. */
  approve(at: Date, by: PrincipalId): void {
    if (this.props.status !== ContractStatus.DRAFT) {
      throw new DomainRuleViolation('CONTRACT_NOT_DRAFT');
    }
    if (this.props.items.length === 0) {
      throw new DomainRuleViolation('CONTRACT_HAS_NO_ITEMS');
    }
    this.props.status = ContractStatus.APPROVED;
    this.props.signedAt = at;
    this.props.approvedBy = by;
    this.events.push(new ContractApproved(this.id, this.revisedTotal(), at));
  }

  /** §D6.2 — derived, never stored. */
  revisedTotal(): Money {
    return sumMoney([this.props.totalPrice,
      ...this.props.changeOrders.filter(c => c.isApproved()).map(c => c.amount)]);
  }
  pullEvents(): DomainEvent[] { const e = this.events; this.events = []; return e; }
}
```

No Prisma. No Fastify. No `async`. It is testable with `new Contract(...)` and zero infrastructure —
which is the entire return on the layering.

### 5.2 The use case owns the transaction, the authorization, and the events

```ts
// application/contracts/ApproveContract.ts
export class ApproveContract {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly contracts: ContractRepository,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(cmd: { contractId: string }, principal: Principal): Promise<ContractDto> {
    principal.require(PermissionKey.ContractsApprove);          // 1. one decision, one place

    return this.uow.run(async (ctx) => {
      const contract = await this.contracts.findById(cmd.contractId, ctx);  // 2. load
      if (!contract) throw new NotFoundError('Contract', cmd.contractId);

      contract.approve(this.clock.now(), principal.userId);      // 3. invariants live HERE

      await this.contracts.save(contract, ctx);                  // 4. inside the tx
      this.events.append(ctx, contract.pullEvents());            // 5. SAME tx  → outbox

      return toContractDto(contract);                            // 6. money as string
    });
  }
}
```

Steps 4 and 5 sharing a transaction is the whole trick of the outbox (§A6): an event is published
**iff** the write committed. No dual write, no lost notification, no broker.

### 5.3 The controller is boring on purpose

```ts
// interface/http/modules/contracts/contracts.controller.ts
approve = async (req, reply) => {
  const { id } = req.params;                       // already validated by the type provider (§9)
  const dto = await this.approveContract.execute({ contractId: id }, req.principal);
  return reply.code(200).send(dto);
};
```

No zod call, no `try/catch`, no `this.actor(request)`. Compare `contracts.controller.ts:55-67` today.

---

## 6. Business rules — the invariant catalog

Rules live in exactly one of three places, and the placement rule is mechanical:

| If the rule … | It lives in | Enforced by |
|---|---|---|
| constrains **one row** | the database | `CHECK` (§D) |
| constrains **one aggregate** | the domain object | a guard clause that throws `DomainRuleViolation` |
| constrains **several aggregates** | a use case, or an eventual-consistency projector | explicit code, or a reconciliation job |

Anything that cannot be placed by that rule is a design smell, not an exception.

### 6.1 Contract

| # | Rule | Where | Failure code |
|---|---|---|---|
| C1 | `revisedTotal = totalPrice + Σ approved change orders` | `Contract.revisedTotal()` — derived, never stored (§D6.2) | — |
| C2 | Only `DRAFT` may be edited | domain | `CONTRACT_NOT_DRAFT` |
| C3 | Only `APPROVED` may spawn a project | domain | `CONTRACT_NOT_APPROVED` |
| C4 | An approved contract has a `signedAt` and an `approvedBy` | DB `CHECK` **and** domain | `ck_contracts_signed` |
| C5 | Contract cannot be amended into negative value | `Contract` aggregate (spans change orders) | `CONTRACT_VALUE_NEGATIVE` |
| C6 | A contract with no items cannot be approved | domain | `CONTRACT_HAS_NO_ITEMS` |
| C7 | `contract_number` unique among live rows | DB partial unique (§D-D6) | `CONTRACT_NUMBER_TAKEN` |
| C8 | Template lines are **snapshotted**, never referenced | `CreateContract` use case | — |

### 6.2 Change order

| # | Rule | Where |
|---|---|---|
| O1 | `amount <> 0` | DB `CHECK` |
| O2 | `DRAFT → APPROVED \| REJECTED`, both terminal | domain |
| O3 | Reversal is a **new negative order**, never an edit | `ChangeOrder` aggregate |
| O4 | Only an `APPROVED` contract may receive a change order | `CreateChangeOrder` use case |
| O5 | `number` sequential per contract | repository `nextNumber(ctx)` inside the tx |

O5 is the one that bites. `SELECT max(number)+1` under concurrency yields duplicates. Two humans will
never race here, but a retried request will. Use the partial unique `uq_change_orders_number` as the
arbiter and let the second insert fail with `23505` → mapped to `409 CONFLICT` → the client retries
with a fresh number. **Do not** take an advisory lock; do not `SELECT … FOR UPDATE` the parent. The
unique constraint is the concurrency control, and letting it be so is what keeps the write path free
of coordination.

### 6.3 Project

| # | Rule | Where |
|---|---|---|
| P1 | `progress` is **derived** from steps, never set directly (§A3.3) | `Project.recomputeProgress()`, called only by step transitions |
| P2 | `PLANNED → IN_PROGRESS → {PAUSED, COMPLETED, CANCELLED}` | `ProjectStatus` transition table in domain |
| P3 | `COMPLETED` requires `actualEndDate` | DB `CHECK` + domain |
| P4 | Steps' percentages sum to 100 per project | `Project` aggregate on save |
| P5 | **`SKIPPED` steps do not count toward progress** — so a project with one can never reach 100% | ⚠ **Unresolved.** §D18 #4 |

P5 is a product decision masquerading as a schema detail. Until it is answered, `Project.recomputeProgress()`
cannot be written correctly. Two candidate rules: `SKIPPED` counts as complete, or the aggregate
redistributes a skipped step's percentage across the remaining ones. Pick one.

### 6.4 Payment

| # | Rule | Where |
|---|---|---|
| Y1 | `0 ≤ paidAmount ≤ scheduledAmount` | DB `CHECK` + domain (§D-D4) |
| Y2 | `PAID ⇔ paidAmount = scheduledAmount ∧ paymentDate ≠ null` | DB `CHECK` + domain |
| Y3 | `PARTIAL ⇔ 0 < paidAmount < scheduledAmount` | DB `CHECK` |
| Y4 | A settled payment is immutable except by reversal (`CANCELLED` + compensating entry) | domain |
| Y5 | `LATE` is **derived** (`dueDate < today ∧ paidAmount < scheduledAmount`) | read model / DTO, not stored (§D18 #3) |

Y5 is why `PaymentStatus.LATE` should leave the enum. A stored `LATE` is wrong every night between
midnight and the sweep.

### 6.5 Cost & catalog

| # | Rule | Where |
|---|---|---|
| K1 | `totalAmount = quantity × unitPrice`, computed in the domain, **never accepted from the caller** | `ProjectCost.create()` + DB `ck_pc_line_math` |
| K2 | `category = MATERIAL ⇒ materialId ≠ null` | DB `CHECK` |
| K3 | Money arithmetic only via `lib/money.ts` (`Prisma.Decimal`) | lint rule: ban `+`/`*` on `Decimal` outside `domain/shared/money.ts` |
| K4 | Recording a material cost emits `ProjectCostRecorded` → the **only** writer of `material_price_history` (§D4.5) | projector |
| K5 | Supplier prices normalize to the material's unit via `conversionToMaterialUnit` at **write** time | `SupplierMaterial` domain |

K3 deserves a linter. `money.ts` exists (`backend/src/lib/money.ts`) and is well-designed; nothing
stops a service from writing `a.plus(b).toNumber()` and losing the discipline at the last step. A
custom ESLint rule banning `.toNumber()` outside the DTO layer costs an hour and closes the class.

### 6.6 The rules the database cannot hold

Named so their absence reads as a decision, not an oversight:

- `SUM(percentage) = 100` per template / per project — a row-set invariant; Postgres has no multi-row `CHECK`. Enforced in the aggregate; **not** by a `CONSTRAINT TRIGGER`, which would put business logic in PL/pgSQL where no test suite looks.
- `totalPrice + Σ approved ≥ 0` — spans rows.
- "a paid payment is immutable" — constrains a *transition*, not a row.
- "a `QUESTION` AI turn may only bind `READ` tools" — a type-level guarantee (§A5.4), auditable after the fact by the query in §D11.5.

---

## 7. Application layer — use cases, Unit of Work, and the transaction boundary

### 7.1 One use case = one file = one transaction = one authorization decision

```ts
interface UseCase<Cmd, Res> {
  execute(cmd: Cmd, principal: Principal): Promise<Res>;
}
```

A use case may **not** call another use case. If two need the same logic, it descends into the domain
or into a shared `application/<ctx>/policies/` function. Chaining use cases produces nested
transactions, doubled permission checks, and a call graph nobody can hold in their head.

**The one sanctioned exception**, already present and correct in this codebase: *approve contract →
create project → link*. It is one atomic business fact and is allowed to span two aggregates in one
transaction (§A3.3). It is implemented as **one** use case, `ApproveContractAndOpenProject`, not two
chained ones.

### 7.2 `UnitOfWork` and `TxContext`

```ts
interface TxContext {
  readonly tx: PrismaTransactionClient;   // ring 4 detail, opaque to ring 2 via branded type
  readonly principal: Principal;
  readonly traceId: string;
  readonly events: DomainEvent[];         // buffer, flushed to outbox at commit
}

interface UnitOfWork {
  run<T>(fn: (ctx: TxContext) => Promise<T>): Promise<T>;
}
```

`PrismaUnitOfWork.run` opens `prisma.$transaction`, builds the `TxContext`, invokes `fn`, then —
**still inside the transaction** — writes the buffered events to `outbox_events` and the audit rows to
`audit_logs`, and commits. On commit it signals the dispatcher (§17.1) to wake immediately rather than
wait for its next tick.

**Fixing B7 (the 5 s timeout).** `prisma.$transaction(fn, { timeout, maxWait })` must be configured
per *class* of use case, not globally:

| Class | `timeout` | Rationale |
|---|---|---|
| Ordinary write (`ApproveContract`) | 5 s (default) | If it takes longer, something is wrong |
| Bulk import, estimate regeneration | 30 s | Legitimately long, still bounded |
| DOCX render, LLM call, HTTP egress | **must not be in a transaction at all** | §7.3 |

### 7.3 What must never be inside a transaction

Anything slow, anything non-transactional, anything that can fail independently:

- **File writes.** Render the DOCX to a temp path, commit the `generated_documents` row referencing the final path, then `rename()`. A crash between commit and rename leaves a row pointing at a missing file — which is why `file_hash` exists (§D5.5) and why a reconciliation job repairs it. The reverse order leaves an orphan file, which is worse: it is invisible.
- **LLM calls.** §A5.2 already puts the model outside the write path: the planner proposes, the human confirms, and only then does `ai/effect` open a transaction.
- **Outbound HTTP.** Never.
- **The outbox *dispatch***. Appending to the outbox is transactional; delivering from it is not. That is the entire point.

### 7.4 Idempotency (fixes B9)

Every mutating endpoint accepts an optional `Idempotency-Key` header. Enterprise-grade means a retried
"record payment" cannot create a second payment.

```
POST /api/v1/payments
Idempotency-Key: 0f9c2b1e-...        (client-generated UUID, stable across retries)
```

Implementation: a small `idempotency_keys` table — `(key, user_id, endpoint, request_hash,
response_status, response_body, created_at)`, PK `(key, user_id)`.

- Miss → execute the use case **inside the same transaction** that inserts the key row, store the serialized response.
- Hit with the same `request_hash` → replay the stored response. Same status, same body.
- Hit with a **different** `request_hash` → `422 IDEMPOTENCY_KEY_REUSED`. A key bound to one payload cannot be reused for another; silently executing it is how a retry becomes a second transfer.
- Rows expire after 24 h (a `jobs` sweep).

Writing the key row in the business transaction is what makes this exactly-once *for the database*.
The response body is a cache; the guarantee is the unique constraint on `(key, user_id)`.

`GET`/`DELETE` are idempotent by definition and skip this. `POST /:id/approve` is the interesting case:
it is naturally idempotent at the domain level (approving an approved contract throws
`CONTRACT_NOT_DRAFT`), and that is a *better* answer than a key — the domain already refuses. The key
protects **creates**.

### 7.5 Domain events

```ts
abstract class DomainEvent {
  readonly occurredAt: Date;
  abstract readonly aggregateType: string;
  abstract readonly aggregateId: string;
  abstract readonly eventType: string;
  abstract payload(): Record<string, unknown>;   // SELF-CONTAINED. §17.2
}
```

The catalog, and who consumes each:

| Event | search | notify | analytics | price history | embeddings |
|---|---|---|---|---|---|
| `ContractApproved` | ✅ | ✅ | ✅ | | |
| `ContractCancelled` | ✅ | ✅ | ✅ | | |
| `ChangeOrderApproved` | | ✅ | ✅ | | |
| `ProjectCreated` / `ProjectStatusChanged` | ✅ | ✅ | ✅ | | ✅ |
| `ConstructionStepCompleted` | | ✅ | ✅ | | |
| `ProjectCostRecorded` | | | ✅ | ✅ | |
| `PaymentScheduled` / `PaymentSettled` | | ✅ | ✅ | | |
| `PaymentOverdue` *(emitted by the sweep job)* | | ✅ | | | |
| `MaterialPriceChanged` | ✅ | | | ✅ | |
| `SupplierMaterialPriceChanged` | | | | ✅ | |
| `CustomerCreated` / `CustomerUpdated` | ✅ | | | | ✅ |
| `AiExecutionFailed` | | ✅ | | | |
| `JobDeadLettered` | | ✅ | | | |
| `*Deleted` / `*Restored` | ✅ **(delete!)** | | ✅ | | ✅ |

The last row is §D-D10: the projector must **delete** the search document, or the assistant resolves a
name to a deleted project and the executor writes to it.

---

## 8. Repositories

### 8.1 The contract

```ts
interface ContractRepository {
  findById(id: string, ctx?: TxContext): Promise<Contract | null>;
  findByNumber(n: string, ctx?: TxContext): Promise<Contract | null>;
  save(contract: Contract, ctx: TxContext): Promise<void>;   // insert or update, aggregate-wide
  nextNumber(year: number, ctx: TxContext): Promise<string>;
  // reads for lists live on a separate QUERY interface — see §8.3
}
```

Three rules:

1. **The repository speaks the domain type**, not the Prisma row. `save(contract: Contract)`, not `update(id, Prisma.ContractUpdateInput)`. Mapping happens in `mappers/contract.mapper.ts`. Today `contracts.repository.ts:70` takes `Prisma.ContractUpdateInput` — that leaks the ORM into every caller and is why the service knows about Prisma.
2. **Aggregate-granular.** `save(contract)` persists the root *and* its items *and* its change orders. There is no `ContractItemRepository`; a contract item has no life outside its contract (§D6.3, cascade C1). One repository per **aggregate root**, never per table.
3. **`ctx` is explicit.** The current pattern — `client: DbClient = this.prisma` (`contracts.repository.ts:25`) — is good and should survive the refactor, tightened so writes *require* a `ctx`.

### 8.2 Reads are not writes — CQRS-lite, without the ceremony

Loading a full `Contract` aggregate to render a paginated list is waste: you hydrate change orders,
items, and materials to display a number and a status. So the design splits:

| | Purpose | Returns | Touches |
|---|---|---|---|
| `ContractRepository` | Load an aggregate to **change** it | `Contract` domain object | write model |
| `ContractQueryService` | Answer a **question** | `ContractListItemDto` | write model, or a read model |
| `ReportQueryService` | Analytics | DTOs | **matviews only** (§A10.4) |

This is CQRS as a *reading* discipline, not as an architecture. No separate write database, no
eventual consistency between the two — both read the same Postgres. The value is that the query side
may write hand-tuned SQL and `SELECT` only the columns the grid shows, and the command side never has
to think about pagination.

**`reports` reads only read models.** That is an enforced edge in `dependency-cruiser`: no import from
`reports/*` to any write-model repository.

### 8.3 Listing, filtering, pagination

The existing `buildWhere` (`contracts.repository.ts:117-129`) is the right instinct, wrong location:
it constructs a `Prisma.ContractWhereInput` and lives in the repository, so the filter vocabulary is
Prisma's. Replace with a small, typed **specification** the query service translates:

```ts
type ContractFilter = {
  status?: ContractStatus[];
  customerId?: string;
  signedBetween?: [LocalDate, LocalDate];
  search?: string;            // → the search index (§20), NOT ILIKE
};
```

**Pagination is keyset, not offset, on every list that can grow.** `OFFSET 20000` makes Postgres read
and discard 20,000 rows. The existing `toSkipTake` (`shared/utils/pagination.ts`) is fine for
`customers` (hundreds of rows) and wrong for `audit_logs` and `project_costs`.

```
GET /api/v1/costs?projectId=…&limit=50&cursor=eyJkIjoiMjAyNi0wNy0wMSIsImkiOiI5YjEuLi4ifQ
```

The cursor is base64 of the **sort key tuple**, matching the index exactly: for
`ix_pc_project_date (project_id, date DESC)` the cursor is `{date, id}` and the predicate is
`(date, id) < (:date, :id)`. Row-value comparison, one index seek, constant cost at any depth.

Offset pagination stays available (`?page=`) for grids that need a page count, and only on tables §D
proves are bounded.

**N+1 is a lint-able mistake.** Every `findMany` that is followed by a `.map(await …)` is a bug. The
repository exposes batch loads (`findManyByIds`) and the query services use a single joined
`SELECT`. Prisma's `include` is permitted in query services and **forbidden** in aggregate repositories
(where the include set is fixed by the aggregate boundary anyway).

---

## 9. Controllers, routes, and HTTP

### 9.1 Fix B3: zod becomes the schema, not a function call

Adopt `fastify-type-provider-zod`. The same zod object then serves four purposes:

```ts
fastify.withTypeProvider<ZodTypeProvider>().route({
  method: 'POST',
  url: '/:id/approve',
  schema: {
    tags: ['contracts'],
    summary: 'Approve a draft contract',
    params: contractIdParamSchema,
    body: approveContractBodySchema,
    response: { 200: contractDtoSchema, 409: errorSchema },
  },
  preHandler: [fastify.authenticate, fastify.requirePermission('contracts.approve')],
  handler: controller.approve,
});
```

1. **Validation** happens in Fastify's pipeline, before the handler. A `ZodError` never reaches the controller.
2. **Response serialization** via `fast-json-stringify` — Fastify's largest single throughput win, currently unused.
3. **Types** — `request.body` is inferred. No `as` casts.
4. **OpenAPI** — `@fastify/swagger` emits `/openapi.json` from these schemas. The frontend generates its API client from it, and the document is *provably* in sync because it is the same object that validates.

The response schema is not decoration. It is a **contract** — declaring `response: { 200: contractDtoSchema }` means a field the DTO forgot to strip (a `passwordHash`, an internal `deletedAt`) is dropped by the serializer rather than shipped.

### 9.2 The controller's only job

Transport in, command out; DTO in, status out. It may read `request.principal`, `request.params`,
`request.body`, `request.query`. It may not: construct services, open transactions, call repositories,
catch domain errors, or format money.

`this.actor(request)` (`contracts.controller.ts:76-83`) disappears — the `Principal` is on the request,
put there by the auth plugin, and carries `userId`, `roleId`, `permissions`, `ipAddress`, `userAgent`,
`traceId`.

### 9.3 Route registration and the composition root (fixes B4)

```ts
// composition/container.ts — the ONE place adapters are constructed
export function buildContainer(prisma: PrismaClient, config: Config): Container {
  const uow      = new PrismaUnitOfWork(prisma);
  const clock    = new SystemClock();
  const cache    = new InProcessCache();
  const events   = new OutboxPublisher();
  const contracts = new PrismaContractRepository(prisma);
  return {
    useCases: {
      approveContract: new ApproveContract(uow, contracts, events, clock),
      // …
    },
    ports: { uow, clock, cache, events, /* … */ },
  };
}
```

Routes receive the container; they never `new` a service. Cross-module orchestration becomes an
injected use case, and `dependency-cruiser` can then forbid `modules/*/**` → `modules/*/**` entirely.

No DI framework. A hand-written container is ~150 lines, has no magic, no decorators, no reflection,
and no startup-order surprises. `tsyringe`/`inversify` buy nothing at this module count and cost a
class of runtime errors that a plain function cannot produce.

---

## 10. Validators

Zod, one schema file per module, colocated with the routes (ring 3). Validation is a **transport**
concern; the domain re-checks what it cares about because a use case invoked by the AI executor (§A5)
never passed through Fastify.

### 10.1 Conventions

| Concern | Rule |
|---|---|
| Money in | `z.string().regex(/^-?\d{1,14}(\.\d{1,4})?$/)` → `money()`. **Never `z.number()`** — JSON numbers are doubles; `0.1 + 0.2 ≠ 0.3` |
| Money out | fixed-precision string (§11) |
| Quantity in | string, same treatment, 6 dp |
| Business date | `z.string().date()` → `LocalDate`. Not `z.coerce.date()`, which silently applies the server's timezone |
| Instant | `z.string().datetime({ offset: true })` |
| Ids | `z.string().uuid()` |
| Enums | `z.nativeEnum(ContractStatus)` — one source, shared with Prisma |
| Text | `.trim().min(1)`. Arabic text is **not** length-validated in code units (a composed Arabic grapheme is several) — use `.max(n)` generously or count graphemes |
| Unknown keys | `.strict()` on every body. A typo'd field name must 400, not be ignored |
| Pagination | shared `cursorPageSchema` / `offsetPageSchema` |

`.strict()` is the one people skip. Without it `{ "totlaPrice": 500 }` is accepted, ignored, and the
contract is created for zero.

### 10.2 What validators must not do

They must not check uniqueness, existence, or state ("contract is DRAFT"). Those are database
constraints (`C7`) and domain rules (`C2`) respectively. A validator that queries the database is a
use case wearing a costume, and it introduces a TOCTOU gap: the row it found can be deleted before the
transaction opens.

The rule: **validators check shape; the domain checks truth.**

---

## 11. DTOs

### 11.1 Money leaves as a string. Always.

> JSON numbers are IEEE-754 doubles. A contracting ledger that serialises `Decimal` as a JSON number
> has already lost. (§A6)

```jsonc
{
  "id": "9b1c…",
  "totalPrice": "125000.0000",       // fixed-precision string, 4 dp (§D1.2)
  "revisedTotal": "131500.0000",     // derived, not stored (§D6.2)
  "currency": { "code": "IQD", "symbol": "د.ع", "position": "AFTER", "precision": 0 }
}
```

The DTO boundary converts **once**. The client formats, never computes.

**B8 must be fixed here.** `toMoneyString(value, dp = 2)` defaults to 2 decimal places while the
database moves to `NUMERIC(18,4)`. A unit price of `12.3456` serializes as `"12.35"`, and a client that
echoes it back on `PATCH` has silently rewritten the number. The default becomes `4`; *display*
precision comes from `currency.precision` and is applied by the frontend, never by the serializer.

### 11.2 Dates

Business days as `"2026-07-10"` (no time, no zone). Instants as RFC 3339 with offset. The DTO type
system should make these different types (`LocalDate` vs `Instant`), because §D-D3 exists precisely
because they were conflated.

### 11.3 Envelope

Lists are envelopes; single resources are bare.

```jsonc
// GET /api/v1/contracts?limit=50
{
  "data": [ /* ContractListItemDto */ ],
  "page": { "limit": 50, "nextCursor": "eyJkIjoi…", "hasMore": true }
}
```

`total` is **omitted** on keyset-paginated lists. A `COUNT(*)` over a filtered million-row table costs
more than the page it accompanies, and no user reads "1 of 24,318". Offset-paginated lists (bounded
tables only) carry `{ page, perPage, total, totalPages }`.

### 11.4 Three DTOs per aggregate, not one

| DTO | Used by | Contains |
|---|---|---|
| `ContractListItemDto` | grids | id, number, customer name, status, total, dates |
| `ContractDto` | detail view | + items, change orders, revised total, project link |
| `ContractSummaryDto` | embeds in other DTOs, AI previews | id, number, customer name |

One fat DTO forces the list endpoint to hydrate the aggregate (§8.2) and leaks fields the grid never
shows. Three narrow ones are declared in `application/contracts/dto.ts` and mirrored as zod response
schemas so the serializer enforces them (§9.1).

### 11.5 Never expose

`passwordHash`, `tokenHash`, `deletedAt`, raw `filePath`, `Prisma.*` types, internal `bigint` ids where
a stable public id exists. The zod `response` schema is the enforcement mechanism, not developer
discipline.

---

## 12. Authorization

### 12.1 Close B1 first

Everything in this section is downstream of one change: **delete the `roles` branch from
`requireAccess`.**

```ts
// plugins/rbac.plugin.ts:59 — DELETE THIS
if (opts.roles && opts.roles.length > 0 && opts.roles.includes(request.user.role)) return;
```

Today it is evaluated *after* the permission check fails, so it can only widen access. `ACCOUNTANT` is
in `WRITE_ROLES` and therefore passes `contracts.approve`, `contracts.cancel`, and
`contracts.delete` regardless of the catalog. Thirty-one route registrations are affected.

Migration, in order, one release apart:

1. **Seed grants.** For each legacy constant (`WRITE_ROLES`, `READ_ROLES`, `SETTINGS_ROLES`, …), grant the permissions those routes name to those roles in `role_permissions`. Idempotent seed; no code change. After this, every currently-working call still works *through the permission path*.
2. **Warn.** Keep the branch but log `WARN rbac.legacy_role_fallback { route, role, permission }` whenever it is the branch that granted. Ship. If the log is silent for a release, step 1 was complete.
3. **Delete.** Remove `roles` from `RequireAccessOptions` and from all 31 call sites. `requireAccess({ permissions })` becomes `requirePermission(key)`.

Step 2 is what makes step 3 safe. Deleting the branch without it will lock someone out of production
on a Sunday.

### 12.2 The `Principal`

The Shared Kernel of §A3.2. Built once per request by the auth plugin, attached to `request.principal`,
and passed **explicitly** into every use case.

```ts
class Principal {
  readonly userId: string;
  readonly roleId: string;
  readonly roleName: string;
  private readonly permissions: ReadonlySet<PermissionKey>;
  readonly isOwner: boolean;
  readonly traceId: string;
  readonly ipAddress: string;
  readonly userAgent: string;

  can(key: PermissionKey): boolean {
    return this.isOwner || this.permissions.has(key);
  }
  require(key: PermissionKey): void {
    if (!this.can(key)) throw new ForbiddenError(key);
  }
  static system(reason: string): Principal;   // for jobs and projectors
}
```

**Explicit, not ambient.** It would be easy to read the principal from `AsyncLocalStorage` and shorten
every signature. Don't: a use case whose authorization depends on invisible ambient state cannot be
unit-tested without a request, cannot be called by the job runner, and cannot be called by the AI
executor — which is exactly the "one door" §A1 depends on. `AsyncLocalStorage` carries `traceId` for
*logging* and nothing that affects a decision (§15.3).

`Principal.system()` exists because the overdue sweep and the projectors write rows. Their audit entries
carry `actor_type = 'SYSTEM'` (§D12.5) and `user_id = NULL`, which the `ck_al_human_actor` check
permits and `ck_al_ai_actor` does not confuse with an AI turn.

### 12.3 Where the check happens — exactly once

| Layer | Checks | Why |
|---|---|---|
| Route `preHandler` | **Coarse**: does this principal hold the permission this endpoint requires? | Cheap rejection before a body is parsed or a transaction opened |
| Use case, line 1 | `principal.require(key)` — **the authoritative decision** | The AI executor and the job runner never pass through a `preHandler` |
| Query service | Filters rows by `permission_key` (search) or by scope | §20.4: hiding *existence*, not just contents |

The route guard is a fast path, not the decision. The use case's `require()` is the decision, and it is
the one the AI path also executes. Deleting the route guard would leave the system correct but slow;
deleting the use-case guard would leave it exploitable.

### 12.4 Live-role re-check

§A5.2: *"a revoked role must not survive a cached JWT."* The JWT carries `userId` and `roleId`; it does
**not** carry permissions. The auth plugin loads the role's permission set on every request. B5 says
that is a database round trip per request; §13.2 makes it an in-process cache read with a correctness
guarantee.

Revocation therefore takes effect on the **next request**, not on the next token refresh. That is the
requirement.

### 12.5 Resource-scoped authorization

Permission keys answer "may this role approve contracts". They do not answer "may this engineer see
*this* project". Today the product has no per-row scoping and does not need one — a contractor's staff
see the whole office.

The design keeps the seam without paying for it: `Principal.scope()` returns a `Scope` object which is
today `Scope.All`. Query services accept it and, when it is `Scope.All`, add no predicate. The day a
"subcontractor" role must see only its own projects, one class changes and every query service already
threads it. Adding the parameter later means touching forty call sites.

### 12.6 Permission catalog additions

The AI platform and the new modules need keys that do not exist. Each new tool in the Capability
Registry (§A5.4) names a permission; a CI check asserts every named key exists in `rbac.catalog.ts`.
Without it a tool referencing a missing key fails **open** in any code path that treats "no permission
required" as "allowed".

```
suppliers.read | .create | .update | .delete
units.read | .manage
price-history.read
overhead-expenses.read | .create | .update | .delete
notifications.read
search.query
jobs.read | jobs.retry
recommendations.read | .dismiss
reports.export
ai.chat | ai.execute | ai.reports.generate | ai.usage.read
```

### 12.7 The AI's authorization is the same authorization

§A5.4's tool contract names `permissions: ['contracts.approve']`, checked against the **live**
principal at plan-preview time *and again* inside the use case at execution time. The double check is
deliberate: the preview may be rendered minutes before the human confirms, and a role can be revoked in
between. The plan claim (`ai_plans` CAS, §D11.3) verifies `user_id`; the use case verifies the
permission.

---

## 13. Caching

### 13.1 What may be cached, and what may never be

Postgres holds this entire database in shared buffers after a decade (§D16.5). **There is no read
cache for business data**, and adding one would trade a correctness risk for a latency improvement
nobody can perceive.

| Cached | TTL / invalidation | Why |
|---|---|---|
| Role → permission set | **Epoch**, not TTL (§13.2) | Read on every request; changes ~never |
| Permission catalog, `units_of_measure`, `currencies`, `company_profile`, `system_settings` | Epoch | Effectively compile-time constants |
| Search results | ❌ never | Stale results resolve the AI to deleted entities |
| Any aggregate | ❌ never | Two sources of truth for money |
| Report / dashboard data | ✅ — but as a **materialized view**, not a cache (§A10.4) | A matview is a cache with a refresh contract and a name |
| LLM embeddings | ✅ — `embeddings.content_hash` (§D10.2) | The only *paid* per-row operation |
| Rendered DOCX | ✅ — on disk, keyed by `file_hash` | |

The pattern: **cache configuration, not data.** A matview is the sanctioned way to cache data, because
it is refreshed by a job, it is `REFRESH … CONCURRENTLY`, and it appears in the schema where a reviewer
will see it. An in-memory `Map` of contracts appears nowhere.

### 13.2 Epoch-versioned invalidation (fixes B5, preserves §12.4)

TTL caching and live-role re-check are incompatible: any TTL > 0 is a window in which a revoked
permission still works.

```ts
interface Cache {
  get<T>(tag: CacheTag, key: string, load: () => Promise<T>): Promise<T>;
  bump(tag: CacheTag): void;      // invalidate an entire tag, O(1)
}
```

Each tag holds a monotonic integer. The cache key is `${tag}:${epoch}:${key}`. Writing a
`role_permissions` row calls `cache.bump('rbac')`; every previously cached entry becomes unreachable
instantly and is garbage-collected lazily. No key enumeration, no TTL, no window.

Because there is exactly **one** backend process (§A0), the epoch lives in memory and this is sound. The
day the job worker is extracted (§A12 step 1), the epoch must move to a `LISTEN/NOTIFY` channel or a
`system_settings` row — a change of about twenty lines, and the reason `Cache` is a port.

Cache is **in-process only**. Not Redis. `Map` + epoch. §A0.

### 13.3 HTTP caching

`GET /uploads/public/*` already sets `Cache-Control: public, max-age=3600, immutable` (`app.ts:158`) —
correct, because replacing an asset writes a new UUID. Extend the idea: `/api/v1/units`,
`/api/v1/rbac/permissions` get `ETag` + `304`. Business endpoints get `Cache-Control: no-store`; an
Electron renderer caching a contract list is a bug report waiting to be filed.

---

## 14. Error handling

### 14.1 Taxonomy

`AppError` (`shared/errors/app-error.ts`) is the right base and stays. What is missing is a class
between "domain rule violated" and "HTTP 409", and a `retryable` bit.

```
Error
└── AppError (statusCode, code, message, details, retryable)
    ├── ValidationError        400  VALIDATION_ERROR          retryable: false
    ├── UnauthorizedError      401  TOKEN_MISSING | TOKEN_EXPIRED
    ├── ForbiddenError         403  INSUFFICIENT_PERMISSION
    ├── NotFoundError          404  NOT_FOUND
    ├── ConflictError          409  CONTRACT_NUMBER_TAKEN | STALE_WRITE
    ├── DomainRuleViolation    422  CONTRACT_NOT_DRAFT | PAYMENT_EXCEEDS_SCHEDULED …
    ├── IdempotencyError       422  IDEMPOTENCY_KEY_REUSED
    ├── RateLimitedError       429  RATE_LIMITED              retryable: true
    ├── UpstreamError          502  PROVIDER_DOWN             retryable: true
    ├── TimeoutError           504  UPSTREAM_TIMEOUT          retryable: true
    └── InternalError          500  INTERNAL_ERROR            retryable: true
```

**422 vs 409.** A `ConflictError` means *the state of the world changed under you* — retry with fresh
data and it may succeed. A `DomainRuleViolation` means *what you asked for is not a legal thing to ask*
— retrying is pointless. The client renders them differently (a toast that says "try again" versus one
that says "this contract is already approved"), so the server must distinguish them. Today both would
surface as whatever status the service happened to throw.

`retryable` is machine-readable and drives the frontend's retry logic and the job runner's backoff
decision.

### 14.2 The wire envelope

Already established by `error-handler.plugin.ts` and preserved verbatim — the SPA's axios normalizer
depends on it:

```jsonc
{
  "statusCode": 422,
  "code": "CONTRACT_NOT_DRAFT",
  "message": "Only a draft contract can be approved.",
  "details": { "contractId": "9b1c…", "currentStatus": "APPROVED" },
  "reqId": "req-a1b2c3",
  "retryable": false            // ← added
}
```

`code` is the **contract**. It is stable, screaming-snake, and never localized. `message` is a
developer-facing English sentence. **Arabic user-facing text is the frontend's job**, keyed off `code` —
because the same `code` must render in a toast, in the AI's Arabic preview, and in a Windows toast, and
three translations of one server string will drift.

`details` is typed per `code` and never contains a raw exception, a SQL fragment, or a stack.

### 14.3 Mapping infrastructure errors

The domain never sees a Prisma error. `PrismaContractRepository` catches and translates, because the
translation requires knowing which constraint was violated:

| Prisma / PG | Becomes | Note |
|---|---|---|
| `P2002` on `uq_contracts_number` | `ConflictError('CONTRACT_NUMBER_TAKEN')` | Map **per constraint name**, not per error code |
| `P2002` on `uq_change_orders_number` | `ConflictError('CHANGE_ORDER_NUMBER_TAKEN')` | The client retries with `nextNumber` |
| `P2025` (record not found) | `NotFoundError` | |
| `P2003` (FK violation) | `ConflictError('REFERENCED_ENTITY_MISSING')` | |
| `23514` (`CHECK` violation) | `InternalError` — **500, not 400** | A `CHECK` fired means the domain failed to enforce its own rule. It is a bug in *our* code, not bad input. Log it loudly |
| `P2028` (tx timeout) | `TimeoutError`, retryable | |
| `40001` (serialization failure) | `ConflictError('STALE_WRITE')`, retryable | |

The `23514` row is the important one. Every `CHECK` in `docs/DATABASE.md` is a *backstop for a domain
rule*. If it ever fires, the domain guard was missing or wrong. Returning `400 Bad Request` would blame
the user for our defect and hide it forever.

### 14.4 Errors at the edges

- **Jobs** (§16): a thrown error increments `attempts` and reschedules with backoff; a `retryable: false` error goes **straight to the dead-letter table** without burning five attempts. This is why the bit exists.
- **Projectors** (§17): a poisoned event must not block the outbox. After N failures the event is marked dispatched and copied to a dead-letter, with a `CRITICAL` notification. A stuck outbox silently freezes search, notifications, and price history simultaneously.
- **AI** (§A5.6): the `rejected` / `error` distinction is exactly the 422 / 502 distinction. "I understood you and the answer is no" versus "I could not serve you."

---

## 15. Logging & observability

### 15.1 Three streams, deliberately separate

| Stream | Table / sink | Answers | Retention |
|---|---|---|---|
| **Application log** | pino → rotating file | "what did the process do" | 14 days |
| **Audit log** | `audit_logs` | "what happened to the data, and who did it" | 7–10 years |
| **AI execution log** | `ai_executions` | "who let the model act, what did it cost" | forever |

They are not interchangeable and must never be merged. A log line can be lost, sampled, or rotated; an
audit row is written in the business transaction and is a compliance artifact. `AuditService.log()`
(`modules/audit/audit.service.ts`) already takes the transaction client — that is the correct design and
survives the refactor, moved behind an `AuditPort`.

### 15.2 pino configuration

Currently `level: 'warn'` in production (`app.ts:69`). That is too quiet for a machine with no
operator: a support call begins with "nothing in the logs". Set `info` in production, `debug` in dev,
and rotate.

Mandatory bindings on every line: `reqId`, `traceId`, `userId`, `route`, `durationMs`, `statusCode`.

**Redaction is not optional.** pino's `redact` paths, applied at the transport:

```
req.headers.authorization, req.headers.cookie, req.headers['x-xsrf-token'],
*.passwordHash, *.password, *.tokenHash, *.refreshToken,
*.apiKey, *.OPENROUTER_API_KEY, *.plan.args.*      ← AI args may carry customer PII
```

§A5.2 requires PII redaction *before the prompt is stored* (§D11.2). Log redaction is a second net, not
the first one.

### 15.3 `trace_id` — the single thread

Fixes B2. One id, generated at `onRequest`, that appears in:

`request.id` → every log line → `audit_logs.trace_id` → `outbox_events.trace_id` → the projector's log
lines → `ai_executions.trace_id` → the notification it produced.

Given a number on a dashboard the user disputes, you can walk backwards to the row, the request, the
human, and — if the assistant did it — the prompt. That is what §A5.1 invariant 4 means operationally,
and it costs one column and one `AsyncLocalStorage` field.

**The B2 fix:** `RequestContext.userId` is populated by the **auth plugin**, not `request-context`,
because `onRequest` runs before authentication. Add `traceId`. Use the store for *logging only* —
never for authorization, never for the audit actor (§12.2).

### 15.4 Metrics

No Prometheus. One `/health` (exists) and one authenticated `/api/v1/admin/metrics` returning a small
JSON snapshot the desktop app can render on a diagnostics screen:

```jsonc
{
  "outbox": { "pending": 0, "oldestPendingAgeSeconds": null },
  "jobs":   { "pending": 2, "running": 0, "deadLettered": 0, "oldestStaleLockSeconds": null },
  "ai":     { "openEnvelopes": 0, "spendUsdToday": "0.148000" },
  "search": { "documents": 4213, "driftVsEntities": 0 },
  "db":     { "connections": 3 }
}
```

Four of these are the alarms that matter, and each maps to a query §D already designed:
`ix_outbox_pending`, `ix_jobs_stale`, `ix_aie_open` (unclosed audit envelopes — *should always be
zero*), and the search reconciliation count. An unread dead-letter queue and a stuck outbox are the two
failures that are silent by construction; these are how they become loud.

---

## 16. Scheduling

### 16.1 The runner

An in-process worker inside the Fastify service, ticking every 5 s, claiming rows from `jobs` with
`SELECT … FOR UPDATE SKIP LOCKED` (§D9.2).

```
tick (5s) ─▶ pg_try_advisory_lock(JOB_TICK_LOCK)
              │ (not acquired → another instance is ticking; return)
              ▼
            claim ≤ N due jobs (SKIP LOCKED)
              │
              ├─ handler ok  ─▶ mark SUCCEEDED, enqueue next occurrence from job_schedules
              ├─ handler err (retryable)     ─▶ attempts++, run_at = now + backoff(attempts)
              ├─ handler err (NOT retryable) ─▶ dead-letter immediately        (§14.4)
              └─ attempts > max_attempts     ─▶ dead-letter + JobDeadLettered event
```

`backoff(n) = min(2^n × 30s, 1h) × jitter(0.5…1.5)`. Jitter matters even with one worker: without it,
five jobs that failed together retry together forever.

**Why not `node-cron`.** In-memory. A service restart at 02:59 silently skips the 03:00 sweep, and
nothing tells you. **Why not BullMQ/Redis.** A second Windows service to install, repair, and
version-gate on a machine with no IT department (§A0). Durability is the requirement; Postgres already
provides it.

### 16.2 The crashed-worker reaper

`SKIP LOCKED` holds a *row lock* for the claiming transaction. Commit `status = 'RUNNING'`, then have
the process killed mid-job — the lock is released, the row stays `RUNNING` forever, and the job never
runs again. Silent loss.

```
reaper (every 60s):
  UPDATE jobs
     SET status='PENDING', locked_by=NULL, locked_at=NULL, attempts=attempts+1
   WHERE status='RUNNING' AND locked_at < now() - interval '15 minutes'
```

Every durable-queue-on-Postgres design that omits this has a job-loss bug. It is why `locked_at` is a
column (§D9.2) and why **every handler must be idempotent** — at-least-once is the only delivery this
or any queue provides.

### 16.3 The schedule

| Job kind | Cron (local tz) | What it does | Idempotency |
|---|---|---|---|
| `payments.overdue-sweep` | `*/15 * * * *` | Emits `PaymentOverdue` for newly-late payments | notification key `(rule, paymentId, date, userId)` |
| `projects.delay-detection` | `0 6 * * *` | Emits `ProjectDelayed` | same shape |
| `analytics.refresh-matviews` | `0 2 * * *` | `REFRESH … CONCURRENTLY` ×4 | `uq_jobs_idempotency` on `(kind, date)` |
| `analytics.snapshot-facts` | `30 2 * * *` | Appends `fact_project_daily` for **active** projects only | `ON CONFLICT DO NOTHING` on the PK |
| `recommendations.generate` | `0 5 * * *` | Tier 0/1/2 → `recommendations` + evidence | `uq_rec_dedupe` partial unique |
| `search.reconcile` | `0 3 * * *` | Asserts `count(search_documents) = count(live entities)`; repairs drift | inherently |
| `embeddings.backfill` | `0 4 * * *` | Embeds rows whose `content_hash` changed | the hash |
| `outbox.purge` | `0 1 * * *` | Deletes dispatched rows > 7 days, in 10k batches | inherently |
| `jobs.purge` | `0 1 * * *` | Deletes `SUCCEEDED` > 7 days | inherently |
| `auth.token-sweep` | `0 0 * * *` | Deletes `refresh_tokens` expired > 30 days | inherently |
| `idempotency.purge` | `0 * * * *` | Deletes keys > 24 h | inherently |
| `projects.progress-reconcile` | `0 3 * * *` | Recomputes `progress_percentage` from steps; notifies on divergence | inherently |
| `ai.usage-reconcile` | `0 3 * * *` | Recomputes `ai_usage_counters` from `ai_executions` | inherently |
| `ai.plan-expiry` | `*/10 * * * *` | `PENDING` plans past `expires_at` → `EXPIRED` | inherently |
| `documents.cleanup` | `0 4 * * 0` | Removes orphaned files; repairs `file_hash` mismatches | inherently |
| `backup.verify` | `0 5 * * 0` | Restores the latest dump into a temp schema and counts rows | inherently |

The last three "reconcile" jobs exist because §D deliberately keeps three caches
(`projects.progress_percentage`, `ai_usage_counters`, `ai_sessions.message_count`). **A cache without a
reconciliation job is a bug with a longer fuse.** Divergence raises a `CRITICAL` notification rather
than silently self-healing, because silent self-healing hides the write path that caused it.

### 16.4 Timezone

`job_schedules.timezone` defaults to `Asia/Baghdad`, not UTC (§D9.3). "3am" means the contractor's 3am.
A UTC cron drifts against the user's day and runs the nightly sweep during business hours.

### 16.5 The advisory lock

One service ⇒ no leader election. The tick still takes `pg_try_advisory_lock` so a developer running a
second `tsx watch` backend against the same database cannot double-fire the nightly sweep. Cheap
insurance — and it is precisely the seam along which the worker process is extracted (§A12 step 1),
at which point the lock stops being insurance and starts being the mechanism.

---

## 17. Background workers

Two long-running loops, both in-process, both extractable.

### 17.1 The outbox dispatcher

```
loop (1s tick, or woken immediately by UnitOfWork on commit):
  SELECT * FROM outbox_events
   WHERE dispatched_at IS NULL
   ORDER BY id
   LIMIT 100
   FOR UPDATE SKIP LOCKED
  → group by (aggregate_type, aggregate_id)
  → for each group, sequentially: fan out to subscribed projectors
  → mark dispatched_at = now()
```

**Ordering.** `SKIP LOCKED` deliberately breaks global order. Consumers that need per-aggregate order
get it from the grouping; consumers that don't (search reindex — last write wins) run fully parallel.
`material_price_history` needs order (a `PURCHASE` after a `CATALOG_EDIT` on the same day);
`search_documents` does not. Which one a consumer is, is a property of the consumer, and is declared:

```ts
interface Projector {
  readonly name: string;
  readonly ordered: boolean;
  readonly subscribes: EventType[];
  handle(event: DomainEvent): Promise<void>;   // MUST be idempotent
}
```

**Woken on commit.** Polling every second when the backlog is almost always empty is fine (the partial
index `ix_outbox_pending` makes the poll an index-only scan of an empty index, costing microseconds),
but latency to a notification would be up to 1 s. `PrismaUnitOfWork` signals the dispatcher after
`COMMIT`; the poll is the safety net, not the mechanism.

**Poison events.** After N projector failures for one event, mark it dispatched, copy to
`outbox_dead_letters`, and raise a `CRITICAL` notification. **Never** let one bad event block the
queue: a stuck outbox freezes search, notifications, analytics, and price history *simultaneously*, and
the symptom the user reports is "the app stopped updating" — four subsystems, one cause, no error.

### 17.2 Projectors

| Projector | Ordered | Writes | Idempotency |
|---|---|---|---|
| `SearchProjector` | no | `search_documents` | upsert on `(entity_type, entity_id)`; **deletes on `*Deleted`** (§D-D10) |
| `PriceHistoryProjector` | **yes** | `material_price_history` | `uq_mph_purchase (source_cost_id)` |
| `NotificationProjector` | no | `notifications` | `uq_notifications_idem` |
| `EmbeddingProjector` | no | `jobs` (enqueues backfill) | `content_hash` |
| `AnalyticsProjector` | no | invalidates matview freshness | inherently |

**Events are self-contained.** A projector must not re-read the write model to interpret an event —
by the time it runs, the row may have changed again, and the projector would apply the *latest* state
under an *older* event's identity. `payload()` carries everything (§7.5). This is the single most
common outbox mistake.

### 17.3 The extraction path

Both loops sit behind ports (`JobQueue`, `EventPublisher`). Moving them into a separate Windows service
requires: a new `main`, and moving the cache epoch to `LISTEN/NOTIFY` (§13.2). No schema change, no
handler change. `jobs` already claims with `SKIP LOCKED`, already has `locked_at` + a reaper, and the
tick already takes an advisory lock. That was the point of paying for those three columns now.

---

## 18. File storage

`lib/storage/` exists and is well-shaped (`getPublicRoot`, `getPublicPrefix`, `checkHealth`). The design
formalizes it behind a port.

### 18.1 Buckets

```
<storage-root>/
├── public/                 ← statically served at /uploads/public/**  (app.ts:148)
│   ├── company/            logo, stamp
│   └── avatars/
└── private/                ← NEVER served statically. Streamed through an authorized route
    ├── templates/          uploaded .docx
    ├── contracts/          generated .docx
    ├── reports/            generated report artefacts
    ├── quarantine/         uploads awaiting validation
    └── backups/
```

The public/private split is a **filesystem** guarantee, not a routing one: `fastify-static` is mounted
on `getPublicRoot()`, so no URL — however crafted — reaches `private/`. That is already correct
(`app.ts:145-151`) and must not be "simplified" into mounting the storage root with a path filter.

### 18.2 The upload pipeline

```
multipart stream
  → size limit (Fastify, app.ts:132)
  → write to private/quarantine/<uuid>.part      (streamed; never buffered in memory)
  → hash while streaming (SHA-256, single pass)
  → sniff magic bytes; assert against declared mime AND extension
  → virus scan hook (no-op adapter today; a port so it can become Defender/ClamAV)
  → atomic rename into the destination bucket
  → row written referencing the FINAL path + hash
```

Order matters. The row is written **after** the file is in place, in a transaction that can be rolled
back — leaving an orphan file, which `documents.cleanup` reaps. The reverse (row first) leaves a row
pointing at nothing, which is a 500 for a user and invisible to a sweep.

**Magic-byte sniffing, not extension trust.** A `.docx` is a ZIP; a renamed `.exe` is not. The declared
`mimeType` from the browser is an assertion by the client and is worth exactly nothing.

**Path traversal.** `ck_dt_path_private` (§D5.4) rejects `..` and leading `/` at the database. The
storage adapter additionally resolves and asserts `resolved.startsWith(bucketRoot)`. Two independent
checks, because this is the class of bug that ends a product.

### 18.3 Serving private files

```
GET /api/v1/generated-documents/:id/download
  → authorize (documents.read) + resource scope
  → stat + verify file_hash (a mismatch is tampering or corruption → 500 + CRITICAL notification)
  → stream with Content-Disposition: attachment; filename*=UTF-8''<urlencoded arabic name>
```

Arabic filenames require RFC 5987 `filename*`, not `filename`. Getting this wrong produces mojibake in
every download, and it is the kind of thing nobody notices until a customer does.

### 18.4 Retention

`documents.cleanup` (weekly) archives artefacts older than N years and **nulls `file_path` while keeping
the row** — history stays queryable after the bytes are gone (§D5.5). This requires `file_path` to
become nullable, one column, when the time comes. §A13: *"documents grow → disk, not latency."*

---

## 19. Document processing

### 19.1 The pipeline

```
DocumentTemplate (.docx, private/templates/)
       │
       ▼
  extract {{placeholders}}       ← at upload; cached in placeholders_json (informational)
       │
       ▼
  build the data model  ← from DTOs. Money already fixed-precision STRINGS
       │
       ▼
  docxtemplater render (sandboxed)  ← OUTSIDE any transaction (§7.3)
       │
       ▼
  write to private/contracts/<uuid>.docx + hash
       │
       ▼
  INSERT generated_documents (path, hash, size, subject ids, generated_by)
```

### 19.2 Three rules

1. **The renderer never computes.** It receives `revisedTotal` as `"131500.0000"` and a pre-formatted
   `"١٣١٬٥٠٠"` if the template wants Arabic numerals. A docxtemplater angular-expression that does
   `total * 1.15` is arithmetic in a template, in a float, in a contract. Ban expressions; pass values.
2. **The renderer re-reads tokens from the file each run.** `placeholders_json` is a cache and is
   explicitly allowed to be stale (§D5.4). A stale cache costs a wrong hint in the UI; a stale render
   costs a wrong contract.
3. **Sandbox the template.** docxtemplater's expression parser is a code-execution surface, and templates
   are **user-uploaded**. Use the null/strict parser, no `angular-expressions` with prototype access, and
   render in a worker thread with a timeout — a malicious or malformed template must not hang the
   Fastify event loop. This is the single highest-risk input in the product: an uploaded file that the
   server parses and evaluates.

### 19.3 Missing placeholders

Rendering with an unresolved `{{customerTaxNumber}}` must **fail loudly** (`422 TEMPLATE_PLACEHOLDER_UNRESOLVED`,
`details: { missing: [...] }`), never emit an empty string. A contract with a silently blank tax number
is a legal document with a hole in it.

---

## 20. Search engine

### 20.1 One index, three consumers

The command palette, global search, and **the AI's entity resolver** (§A5.5) query the same
`search_documents` table with the same ranking. Three rankers would eventually disagree, and a
disagreement between the palette and the assistant is experienced as *"the AI can't find my project."*

### 20.2 Indexing

`SearchProjector` (§17.2) consumes the outbox. Upsert on `(entity_type, entity_id)`; **delete** on
`*Deleted`. `search.reconcile` (§16.3) repairs drift nightly.

### 20.3 Querying

```sql
WITH q AS (SELECT ar_normalize($1) AS n)
SELECT entity_type, entity_id, title, subtitle,
       ts_rank(search_vector, websearch_to_tsquery('simple', (SELECT n FROM q))) AS lex,
       similarity(title_norm, (SELECT n FROM q))                                  AS fuzz,
       exp(-extract(epoch FROM now() - updated_at) / 2592000.0)                   AS recency
FROM search_documents
WHERE permission_key = ANY($2)                              -- §20.4
  AND (search_vector @@ websearch_to_tsquery('simple', (SELECT n FROM q))
       OR title_norm % (SELECT n FROM q))
ORDER BY (lex * 1.0 + fuzz * 0.8 + recency * 0.3) DESC
LIMIT $3;
```

`ar_normalize` must be the **same function** at index time and query time, and must be genuinely
`IMMUTABLE` — see §D-D1, which is the detail that makes or breaks this subsystem. `'simple'`, not
`'arabic'`: Postgres ships no Arabic stemmer, and `pg_trgm` carries the morphology.

### 20.4 Authorization inside the index

`WHERE permission_key = ANY($principal.permissions)`. Without it, global search leaks the **existence**
of entities a role cannot read: an engineer typing "دفعة" learns how many payments exist. Filtering at
the index rather than post-filtering also keeps `LIMIT` meaningful — post-filtering a page of 20 down
to 3 gives the user a short page and no way to ask for more.

### 20.5 Entity resolution for the AI

The resolver returns **entity candidates with ids**, which is how *"add a cost to the Riyadh villa"*
becomes an unambiguous `project_id` — or a `clarification` turn when two projects match. Entity
resolution is a **search** problem, not a language problem (§A5.5).

```ts
interface SearchIndex {
  query(q: string, principal: Principal, opts): Promise<SearchHit[]>;
  resolve(q: string, type: EntityType, principal: Principal): Promise<
    | { kind: 'unique'; id: string }
    | { kind: 'ambiguous'; candidates: SearchHit[] }
    | { kind: 'none' }>;
}
```

`resolve` is a *different* method, not a `query` with `limit: 1`. Taking the top hit when two projects
match is how an assistant writes a cost to the wrong project. The ambiguity must reach the human.

---

## 21. Notification engine

### 21.1 Pipeline

```
domain event (PaymentOverdue, ProjectDelayed, ContractApproved, JobDeadLettered, AiExecutionFailed)
      │
      ▼
[rule engine]  who cares about this, given their ROLE?
      │        → resolve the permission the subject requires (payments.read)
      │        → every active user whose role grants it
      ▼
notification rows (one per user — fan-out is materialized, §D9.5)
      │
      ├──▶ in-app bell        GET /notifications  (partial index → O(unread))
      ├──▶ SSE                GET /notifications/stream
      └──▶ Windows toast      via Electron IPC
```

### 21.2 Role scoping without a preference model

§A10.2 mandates reusing the RBAC catalog. The rule declares the permission its subject requires; the
engine fans out to every active user whose role grants it. An accountant sees overdue payments; an
engineer sees delays; **nobody configures anything.** There is no `notification_preferences` table, and
that is a decision, not an omission — preferences can arrive later as an opt-out overlay without
restructuring.

### 21.3 Idempotency

`idempotency_key = <rule>:<entity_id>:<period>:<user_id>`.

The `user_id` term is not optional. Omit it and the **first** recipient's row suppresses everyone
else's — a fan-out bug that presents as "only the owner gets notified" and is maddening to diagnose.
The `period` term (a date, or an ISO week) is what stops the 15-minute overdue sweep from re-notifying
the same invoice forever.

### 21.4 SSE, not WebSocket

Traffic is server→client only. SSE is one HTTP response, survives the reverse proxy and the Cloudflare
tunnel, reconnects itself with `Last-Event-ID`, and needs no new protocol. Choosing WebSocket here
would be ceremony (§A10.2).

```
GET /api/v1/notifications/stream
Accept: text/event-stream

: heartbeat every 20s (keeps the tunnel from idling the connection out)

id: 8412
event: notification
data: {"id":"8412","kind":"payment.overdue","severity":"WARNING","title":"…","entityType":"payment","entityId":"…"}
```

On reconnect the client sends `Last-Event-ID: 8412`; the server replays `notifications` with
`id > 8412` for that user. That replay is possible **only because notifications are durable rows** —
which is why the table exists rather than an in-memory pub/sub.

**Backpressure.** Each connection holds one Postgres-free, in-memory subscriber. Cap at ~20 connections
(1–10 users × 2 windows); reject beyond with `503`. The renderer must not open one per route.

---

## 22. REST API

Base: `/api/v1`. The version is in the path because the Electron client and the backend are
version-gated at boot (`GET /version`, `app.ts:204`) — a breaking change ships a `/api/v2` alongside
`/api/v1` for exactly one release.

### 22.1 Conventions, declared once

Everything in §22.4 obeys these unless it says otherwise. This is why the endpoint tables are terse:
the shapes are not per-endpoint inventions.

**Headers**

| Header | Direction | Notes |
|---|---|---|
| `Authorization: Bearer <jwt>` | → | Access token. Short-lived |
| `Cookie: refreshToken=…` | → | `HttpOnly`, path `/api/v1/auth`. Never in a body |
| `X-XSRF-TOKEN` | → | Required on cookie-authenticated routes only (`app.ts:114-127`) |
| `Idempotency-Key: <uuid>` | → | Optional on `POST`; required on money-creating `POST`s (§7.4) |
| `X-Request-Id` | ← | Echoed as `reqId` in every error |

**Status codes**

`200` read/update · `201` create (with `Location`) · `204` delete · `400` malformed ·
`401` unauthenticated · `403` unauthorized · `404` absent or invisible · `409` state changed under you ·
`422` legal request, illegal in this state · `429` rate limited · `502/504` upstream.

**Money** — request and response, always a fixed-precision string: `"125000.0000"`. Never a JSON number.
**Business dates** — `"2026-07-10"`. **Instants** — `"2026-07-10T09:31:22.145+03:00"`.

**Canonical list envelope** (keyset):

```jsonc
{ "data": [ … ], "page": { "limit": 50, "nextCursor": "eyJk…" | null, "hasMore": true } }
```

Bounded tables (`customers`, `materials`, `suppliers`, `templates`, `units`) additionally support
`?page=&perPage=` and then return `{ "data": [...], "page": { "page":1,"perPage":50,"total":214,"totalPages":5 } }`.

**Canonical error** — §14.2.

**Canonical query parameters**

```
?limit=50&cursor=…            keyset
?page=1&perPage=50            offset (bounded tables only)
?sort=-createdAt              '-' = DESC. Whitelisted per endpoint; must match an index
?q=…                          full-text; routed to the search index (§20), never ILIKE
?includeDeleted=true          requires <module>.admin
```

**Canonical CRUD shape** — for every business resource `R` at `/r`:

| Method | Path | Permission | Body → Response |
|---|---|---|---|
| `GET` | `/r` | `r.read` | — → `{data: RListItemDto[], page}` |
| `GET` | `/r/:id` | `r.read` | — → `RDto` |
| `POST` | `/r` | `r.create` | `CreateRDto` → `201 RDto` |
| `PATCH` | `/r/:id` | `r.update` | `Partial<UpdateRDto>` → `RDto` |
| `DELETE` | `/r/:id` | `r.delete` | — → `204` (soft) |

Only **deviations and non-CRUD actions** are spelled out below.

### 22.2 The action-endpoint rule

State transitions are `POST /r/:id/<verb>`, never `PATCH { status }`. `PATCH /contracts/:id {status:"APPROVED"}`
would make the transition graph (§6.1 C2/C3) a validation concern of a generic update, and would let a
client approve a contract by editing a field. The verb endpoint names the use case, carries its own
permission, and maps 1:1 to an `application/` file.

### 22.3 Rate limiting (fixes B10)

Global per-IP (`app.ts:92`) is one shared bucket, because every request originates from loopback.
Replace with **per-principal** buckets keyed on `principal.userId`, falling back to IP for unauthenticated
routes:

| Bucket | Limit |
|---|---|
| `/auth/login`, `/auth/refresh` | 10 / 15 min per IP **and** per username |
| `POST /ai/sessions/:id/messages` | 20 / min per user (§A5.2 — *per-user*, never shared) |
| `POST /ai/reports` | 5 / hour per user |
| Everything else | 600 / min per user |

A shared circuit breaker is a cross-user denial of service (§A5.3); so is a shared rate-limit bucket.

---

### 22.4 The endpoint catalog

#### Identity — `/auth`, `/users`, `/profile`, `/rbac`

| Method | Path | Permission | Notes |
|---|---|---|---|
| `POST` | `/auth/login` | — | `{username, password}` → `{accessToken, user}` + `Set-Cookie: refreshToken` |
| `POST` | `/auth/refresh` | — | cookie + CSRF → new `accessToken`. **Rotates** the refresh token; reuse of a rotated token revokes the whole chain (§D3.5 `replaced_by_id`) |
| `POST` | `/auth/logout` | — | Revokes the presented token |
| `POST` | `/auth/change-password` | — | `{currentPassword, newPassword}`. Revokes all other sessions |
| `GET` | `/profile` | — | The caller's own user + effective permissions |
| `PATCH` | `/profile` | — | `{fullName, phone, email}` |
| CRUD | `/users` | `users.*` | `POST` returns a one-time temp password; `mustChangePassword: true` |
| `POST` | `/users/:id/deactivate` | `users.update` | Also revokes sessions |
| `GET` | `/rbac/permissions` | `rbac.read` | The catalog. `ETag` + `304` (§13.3) |
| `GET` | `/rbac/roles` | `rbac.read` | |
| `POST`/`PATCH`/`DELETE` | `/rbac/roles/:id` | `rbac.manage` | `DELETE` → `409` if users hold it (C4) |
| `PUT` | `/rbac/roles/:id/permissions` | `rbac.manage` | `{permissionKeys: string[]}` — full replace. Calls `cache.bump('rbac')` (§13.2) |

`POST /auth/login` response:

```jsonc
{
  "accessToken": "eyJhbGci…",
  "expiresIn": 900,
  "user": { "id":"…", "username":"tariq", "fullName":"…",
            "role": { "id":"…", "name":"OWNER", "displayName":"المالك" },
            "permissions": ["contracts.read", "…"],
            "mustChangePassword": false }
}
```

`permissions` is sent so the SPA can hide what it cannot do. It is **not** the authorization decision —
the server re-checks every call (§12.3).

#### Customers — `/customers`

Canonical CRUD, `customers.*`. Deviations:

| Method | Path | Notes |
|---|---|---|
| `GET` | `/customers?q=…` | Routed to the search index (§20), not `ILIKE` |
| `GET` | `/customers/:id/contracts` | Nested read |
| `DELETE` | `/customers/:id` | `409 CUSTOMER_HAS_CONTRACTS` — referential dignity (§A3.3), refused in the domain before the FK sees it |
| `GET` | `/customers/duplicates?name=…` | Trigram-backed **warning**, not a constraint (§D6.1) |

#### Catalog — `/materials`, `/units`

| Method | Path | Permission | Notes |
|---|---|---|---|
| CRUD | `/materials` | `materials.*` | `unitCode` replaces free-text `unit` (§D4.1) |
| `GET` | `/materials/:id/price-history` | `price-history.read` | Keyset by `observedOn`. **NEW** |
| `GET` | `/materials/:id/price-baseline` | `price-history.read` | From `mv_material_price_baseline`. **NEW** |
| `GET` | `/materials/:id/suppliers` | `suppliers.read` | Offers, cheapest first |
| `GET` | `/units` | `units.read` | Cacheable, `ETag`. **NEW** |
| `POST`/`PATCH` | `/units` | `units.manage` | `code` immutable after create (§D4.1) |

`GET /materials/:id/price-baseline`:

```jsonc
{
  "materialId": "…", "unitCode": "TON",
  "latestPrice": "342.0000", "latestObservedOn": "2026-07-08",
  "mean3m": "310.5000", "mean6m": "301.2000", "mean12m": "300.0000",
  "stddev12m": "18.4000",
  "driftPct12m": "14.000",
  "observationCount12m": 47,
  "asOf": "2026-07-10T02:00:00+03:00"       // matview refresh time — freshness is explicit
}
```

`asOf` is not decoration. A number from a matview is stale by construction, and a financial UI must be
able to say how stale.

#### Suppliers — `/suppliers` **(NEW)**

| Method | Path | Permission | Notes |
|---|---|---|---|
| CRUD | `/suppliers` | `suppliers.*` | Mirrors `customers` exactly |
| `GET` | `/suppliers/:id/materials` | `suppliers.read` | Their price list |
| `PUT` | `/suppliers/:id/materials/:materialId` | `suppliers.update` | Upsert an offer. Emits `SupplierMaterialPriceChanged` |
| `DELETE` | `/suppliers/:id/materials/:materialId` | `suppliers.update` | |
| `POST` | `/suppliers/:id/materials/:materialId/prefer` | `suppliers.update` | Partial unique enforces one preferred per material (§D4.4) |
| `GET` | `/suppliers/:id/performance` | `suppliers.read` | From `mv_supplier_performance`; carries `asOf` |

`PUT /suppliers/:id/materials/:materialId` request:

```jsonc
{
  "supplierSku": "CEM-42.5N",
  "currentPrice": "12.5000",
  "unitCode": "BAG",                        // they sell by bag…
  "conversionToMaterialUnit": "0.0500",     // …you cost by ton. 1 bag = 0.05 ton
  "minOrderQuantity": "100.000000",
  "leadTimeDays": 3,
  "priceValidUntil": "2026-09-30"
}
```

The server normalizes to the material's unit at write time (§6.5 K5). Comparing `12.50/bag` against
`340/ton` at read time is how a "cheapest supplier" feature silently produces nonsense.

#### Templates — `/templates`

| Method | Path | Permission | Notes |
|---|---|---|---|
| CRUD | `/templates` | `templates.*` | |
| `POST` | `/templates/:id/versions` | `templates.update` | Editing a referenced template **forks** to version N+1 (§D5.1); the old version stays |
| `GET` | `/templates/:id/items` · `PUT` | `templates.*` | Full replace of the item set |
| `GET` | `/templates/:id/steps` · `PUT` | `templates.*` | `422 TEMPLATE_STEPS_NOT_100` if percentages ≠ 100 (§6.6) |

#### Contracts — `/contracts`, `/change-orders`

| Method | Path | Permission | Notes |
|---|---|---|---|
| CRUD | `/contracts` | `contracts.*` | `PATCH` → `422 CONTRACT_NOT_DRAFT` unless draft (C2) |
| `POST` | `/contracts/:id/generate-estimate` | `contracts.update` | Snapshots template lines by value (C8) |
| `POST` | `/contracts/:id/approve` | `contracts.approve` | `422 CONTRACT_HAS_NO_ITEMS` (C6) |
| `POST` | `/contracts/:id/cancel` | `contracts.cancel` | `{reason}` |
| `POST` | `/contracts/:id/create-project` | `projects.create` | `422 CONTRACT_NOT_APPROVED` (C3) |
| `GET` | `/contracts/:id/change-orders` | `contracts.read` | |
| `POST` | `/contracts/:id/change-orders` | `change-orders.create` | `409 CHANGE_ORDER_NUMBER_TAKEN` on race (§6.2 O5) |
| `POST` | `/change-orders/:id/approve` \| `/reject` | `change-orders.approve` | Terminal (O2) |
| `POST` | `/change-orders/:id/reverse` | `change-orders.create` | Creates a **new negative** order (O3) |
| `POST` | `/contracts/:id/documents` | `documents.generate` | `{templateId}` → `202` + a `jobs` row; poll `/generated-documents/:id` |

`GET /contracts/:id` response (abridged):

```jsonc
{
  "id": "9b1c…",
  "contractNumber": "CP-2026-0041",
  "customer": { "id":"…", "name":"شركة البناء الحديث" },       // ContractSummary-style embed
  "template": { "id":"…", "name":"فيلا طابقين", "version": 3 },
  "buildingArea": "420.00", "floors": 2,
  "meterPrice": "310.0000",
  "totalPrice": "130200.0000",
  "revisedTotal": "136700.0000",            // derived (§D6.2), never stored
  "expectedProfitMargin": "18.500",
  "status": "APPROVED",
  "signedAt": "2026-06-02T11:04:00+03:00",
  "approvedBy": { "id":"…", "fullName":"…" },
  "items": [
    { "id":"…", "materialId":"…", "materialName":"أسمنت مقاوم",   // SNAPSHOT (§D6.3)
      "unitCode":"TON", "quantity":"85.000000",
      "estimatedPrice":"300.0000", "lineTotal":"25500.0000", "sortOrder":0 }
  ],
  "changeOrders": [
    { "id":"…","number":1,"title":"إضافة مصعد","amount":"6500.0000",
      "status":"APPROVED","approvedAt":"2026-06-20T…" }
  ],
  "project": { "id":"…", "name":"…", "status":"IN_PROGRESS" },
  "createdAt":"…", "updatedAt":"…"
}
```

`materialName` is a snapshot, not a join — a later catalog rename must not restate a signed contract.
`revisedTotal` is computed from `changeOrders`, so the DTO is self-consistent by construction.

`POST /contracts/:id/approve` → `422`:

```jsonc
{ "statusCode":422, "code":"CONTRACT_NOT_DRAFT",
  "message":"Only a draft contract can be approved.",
  "details":{ "contractId":"9b1c…", "currentStatus":"APPROVED" },
  "reqId":"req-a1b2", "retryable":false }
```

#### Projects — `/projects`

| Method | Path | Permission | Notes |
|---|---|---|---|
| CRUD | `/projects` | `projects.*` | `progressPercentage` is **read-only** in every DTO (P1) |
| `POST` | `/projects/:id/status` | `projects.update` | `{status, reason?}`. `422 ILLEGAL_STATUS_TRANSITION` (P2) |
| `GET` | `/projects/:id/steps` | `projects.read` | |
| `POST` | `/projects/:id/steps/:stepId/start` \| `/complete` \| `/skip` | `projects.update` | The **only** writers of progress |
| `GET` | `/projects/:id/summary` | `projects.read` | Cost, billed, collected, margin. From read models |
| `GET` | `/projects/:id/timeline` | `projects.read` | `fact_project_daily`, keyset by date |

Note there is no `PATCH /projects/:id { progressPercentage }`. It is derived (§A3.3), and the API
surface must not offer a door the domain has locked.

#### Costs — `/costs`, `/projects/:id/costs`, `/overhead-expenses`

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/projects/:id/costs` | `costs.read` | Keyset on `(date DESC, id)` — matches `ix_pc_project_date` |
| `POST` | `/projects/:id/costs` | `costs.create` | **`Idempotency-Key` required.** Emits `ProjectCostRecorded` |
| `POST` | `/projects/:id/costs/bulk` | `costs.create` | Excel paste. `{rows: [...]}`, ≤500. All-or-nothing in one tx |
| `PATCH`/`DELETE` | `/costs/:id` | `costs.update`/`.delete` | |
| CRUD | `/overhead-expenses` | `overhead-expenses.*` | **NEW, optional** (§D8.2) |

`POST /projects/:id/costs` request:

```jsonc
{
  "category": "MATERIAL",
  "materialId": "…",                 // required when category=MATERIAL (K2)
  "supplierId": "…",
  "description": "أسمنت — دفعة ثانية",
  "quantity": "12.500000",
  "unitCode": "TON",
  "unitPrice": "342.0000",
  "date": "2026-07-08",
  "invoiceReference": "INV-9921",
  "isBillable": true
}
```

**`totalAmount` is not accepted.** The domain computes `quantity × unitPrice` (K1) and the database
refuses a different answer (`ck_pc_line_math`). Accepting it from the client would make the ledger a
function of the client's float arithmetic.

Response `201` includes `"totalAmount": "4275.0000"`.

#### Payments — `/payments`, `/projects/:id/payments`

The `scheduled`/`paid` split (§D-D4) changes this surface materially.

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/projects/:id/payments` | `payments.read` | The schedule |
| `POST` | `/projects/:id/payments` | `payments.create` | Schedules an installment. `Idempotency-Key` required |
| `POST` | `/payments/:id/settle` | `payments.settle` | Records a receipt — **partial or full** |
| `POST` | `/payments/:id/cancel` | `payments.update` | `{reason}`. The only legal way to undo a settled payment (Y4) |
| `GET` | `/payments/overdue` | `payments.read` | Derived; served by `ix_pay_overdue` |

`POST /payments/:id/settle` request / response:

```jsonc
// request  (Idempotency-Key: <uuid>)
{ "amount": "5000.0000", "paymentDate": "2026-07-09", "method": "BANK_TRANSFER", "reference": "TRF-771" }

// 200
{ "id":"…", "projectId":"…", "installmentNumber": 3,
  "scheduledAmount":"12000.0000", "paidAmount":"5000.0000",
  "remainingAmount":"7000.0000",              // derived in the DTO
  "status":"PARTIAL",                         // derived from the two amounts (Y3)
  "isLate": false,                            // derived, NOT stored (Y5)
  "dueDate":"2026-07-15", "paymentDate":"2026-07-09",
  "method":"BANK_TRANSFER", "reference":"TRF-771" }
```

`422 PAYMENT_EXCEEDS_SCHEDULED` when `paidAmount + amount > scheduledAmount` (Y1). The domain refuses;
`ck_pay_paid_bounds` is the backstop, and if it ever fires it is a `500` (§14.3), not a `400`.

#### Documents — `/document-templates`, `/generated-documents`

| Method | Path | Permission | Notes |
|---|---|---|---|
| CRUD | `/document-templates` | `document-templates.*` | `POST` is multipart; magic-byte sniffed (§18.2) |
| `POST` | `/document-templates/:id/default` | `document-templates.update` | One default **per category** (§D5.4) |
| `GET` | `/generated-documents` | `documents.read` | Filter by `contractId`/`projectId`/`customerId` |
| `GET` | `/generated-documents/:id/download` | `documents.read` | Streams; verifies `file_hash`; RFC 5987 filename (§18.3) |

#### Reports — `/reports`

Reads **matviews only** (§8.2). Every response carries `asOf`.

| Method | Path | Permission |
|---|---|---|
| `GET` | `/reports/cash-flow?from=&to=&granularity=month` | `reports.read` |
| `GET` | `/reports/profitability?projectId=` | `reports.read` |
| `GET` | `/reports/overdue` | `reports.read` |
| `GET` | `/reports/delays` | `reports.read` |
| `POST` | `/reports/:kind/export` | `reports.export` | `{format:"xlsx"\|"pdf"}` → `202` + job id |

#### Search — `/search` **(NEW)**

```
GET /api/v1/search?q=فيلا&types=project,contract&limit=10
```

```jsonc
{ "data": [
    { "entityType":"project", "entityId":"…", "title":"فيلا الرياض",
      "subtitle":"عقد CP-2026-0041 · قيد التنفيذ", "score": 0.87 }
  ],
  "took": 4 }
```

Results are filtered by `permission_key` inside the query (§20.4). `types` is a hint, not a filter the
client can use to escape scoping.

#### Notifications — `/notifications` **(NEW)**

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/notifications?unread=true` | `notifications.read` | Own rows only. `ix_notif_unread` → O(unread) |
| `GET` | `/notifications/unread-count` | `notifications.read` | The bell |
| `GET` | `/notifications/stream` | `notifications.read` | **SSE**, `Last-Event-ID` replay (§21.4) |
| `POST` | `/notifications/:id/read` \| `/read-all` | `notifications.read` | |
| `POST` | `/notifications/:id/dismiss` | `notifications.read` | |

#### Recommendations — `/recommendations` **(NEW)**

| Method | Path | Permission |
|---|---|---|
| `GET` | `/recommendations?status=NEW` | `recommendations.read` |
| `POST` | `/recommendations/:id/acknowledge` | `recommendations.read` |
| `POST` | `/recommendations/:id/dismiss` | `recommendations.dismiss` — `{reason}` **required** |
| `POST` | `/recommendations/:id/act` | `ai.execute` — pre-fills an `ai_plans` row; walks the ordinary confirm gate |

```jsonc
{ "id":"…", "tier":"STATISTICAL", "kind":"material.price_drift",
  "severity":"WARNING",
  "title":"سعر الأسمنت أعلى من المعدل",
  "body":"سعر الأسمنت الحالي أعلى بنسبة 14% من متوسط 12 شهراً.",
  "explanation":"آخر سعر 342.00 مقابل متوسط 300.00 على 47 ملاحظة خلال 12 شهراً.",
  "score": 0.82,
  "evidence": [
    { "entityType":"material_price_history", "entityId":"88214",
      "label":"شراء 2026-07-08 من مورد أ", "value":"342.0000" }
  ],
  "status":"NEW", "validFrom":"2026-07-10" }
```

`explanation` and `evidence[]` are `NOT NULL` by schema (§D11.7). Decision #9: an unexplained
recommendation in a financial tool is worse than none. `dismiss` requires a `reason` so a rule with a
95% dismissal rate can be found and deleted.

#### Jobs (admin) — `/jobs` **(NEW)**

| Method | Path | Permission |
|---|---|---|
| `GET` | `/jobs?status=` | `jobs.read` |
| `GET` | `/jobs/dead-letters` | `jobs.read` |
| `POST` | `/jobs/dead-letters/:id/retry` | `jobs.retry` |
| `POST` | `/jobs/dead-letters/:id/resolve` | `jobs.retry` |
| `GET` | `/jobs/schedules` · `PATCH /jobs/schedules/:id` | `jobs.read` / `jobs.retry` |

#### AI — `/ai`

The transport ring (§A5.3). One **discriminated union** as the response, so the client renders by `kind`
and a new tool cannot break the UI.

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET`/`POST` | `/ai/sessions` | `ai.chat` | |
| `GET` | `/ai/sessions/:id/messages` | `ai.chat` | |
| `POST` | `/ai/sessions/:id/messages` | `ai.chat` | SSE token stream; terminates in one result union |
| `POST` | `/ai/plans/:id/confirm` | `ai.execute` | The **atomic claim** (§D11.3). `409 PLAN_ALREADY_CLAIMED` |
| `POST` | `/ai/plans/:id/reject` | `ai.chat` | |
| `GET` | `/ai/usage` | `ai.usage.read` | From `ai_usage_counters` |
| `GET` | `/ai/executions` | `ai.usage.read` | The audit trail (§D11.4) |
| `GET`/`POST` | `/ai/reports` | `ai.reports.generate` | `202` + job; poll for `READY` |

`POST /ai/sessions/:id/messages` → the closed union:

```jsonc
{ "kind": "answer",        "text":"…", "citations":[{"entityType":"project","entityId":"…"}] }
{ "kind": "clarification", "question":"…", "candidates":[{"entityId":"…","title":"…"}] }
{ "kind": "preview",       "planId":"…", "preview":"سيتم اعتماد العقد CP-2026-0041.",
                           "expiresAt":"…", "actions":[{"tool":"contract.approve"}] }
{ "kind": "execution",     "planId":"…", "results":[{"entityType":"contract","entityId":"…"}] }
{ "kind": "rejected",      "reason":"OUT_OF_SCOPE", "message":"…" }
{ "kind": "error",         "code":"PROVIDER_DOWN", "retryable": true, "message":"…" }
```

`preview` carries **Arabic sentences — no ids, no JSON, no tool names** (§A5.4). `rejected` ("I
understood you and the answer is no") and `error` ("I could not serve you") are distinct kinds because
they are distinct to a human, and conflating them makes the assistant feel broken when it is merely
offline (§A5.6).

`POST /ai/plans/:id/confirm` is the CAS:

```
UPDATE ai_plans SET status='CLAIMED', claimed_at=now()
 WHERE id=$1 AND status='PENDING' AND expires_at>now() AND user_id=$2
RETURNING *
```

Zero rows → `409 PLAN_ALREADY_CLAIMED | PLAN_EXPIRED | PLAN_NOT_YOURS`. A double-click cannot execute
the same plan twice — the defect class §A5.2 names explicitly.

#### Platform — `/settings`, `/uploads`, `/audit`, `/tunnel`, `/admin`

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET`/`PUT` | `/settings/general` \| `/currencies` \| `/company-profile` | `settings.*` | `PUT` bumps the config cache epoch |
| `POST` | `/uploads/company/logo` \| `/stamp` | `uploads.manage` | multipart |
| `GET` | `/audit?entity=&entityId=&userId=&from=&to=` | `audit.read` | Keyset. **Append-only; no write endpoint exists** |
| `GET` | `/audit/entity/:entity/:id` | `audit.read` | A record's history tab |
| `GET`/`POST` | `/tunnel` | `tunnel.manage` | |
| `GET` | `/admin/metrics` | `settings.manage` | §15.4 |
| `GET` | `/health`, `/version` | — | Public. Already implemented |

---

## 23. Testing strategy

The layering has one payoff and this is it: **the rules can be tested without a database, and the
adapters can be tested without the rules.**

| Level | What | Infrastructure | Count |
|---|---|---|---|
| **Domain** | Invariants of §6. `contract.approve()` on a cancelled contract throws | none — `new Contract(...)` | Hundreds. Milliseconds |
| **Use case** | Authorization, transaction shape, events emitted | in-memory repositories + fake `Clock` + fake `LlmClient` | Dozens per module |
| **Adapter** | `PrismaContractRepository` round-trips an aggregate; `P2002` maps to `ConflictError` | **real Postgres** (testcontainers or a scratch schema) | One per repository |
| **Contract (HTTP)** | zod schema ⇄ OpenAPI ⇄ response serializer agree | Fastify `inject()` | One per endpoint |
| **Integration** | Approve a contract → outbox row → projector → search doc → notification | real Postgres, dispatcher run synchronously | A handful. The ones that matter |

**The tests that must exist because the schema promises something:**

- `ai_executions`: no row may have `pre_routed = true` and `cost_usd > 0` — asserted by `ck_aie_prerouted_free`, *and* by a test, because the constraint only fires if the code tries.
- `ai_tool_invocations`: `SELECT … WHERE e.mode='QUESTION' AND i.tool_mode='WRITE'` returns zero rows, forever (§D11.5). A question can never park a mutation.
- `search_documents`: after soft-deleting a project, the search index contains no row for it (§D-D10). This is the test that stops the assistant writing to deleted entities.
- Every `CHECK` in `docs/DATABASE.md` has a domain guard that fires **first**. A test that provokes the `CHECK` directly is a test that the domain is missing a rule (§14.3).
- RBAC: for each of the 31 routes, a user holding the legacy role but **not** the permission is `403`. This test fails today (B1). It should be written first, red, and then made green by §12.1.

Fixtures build **domain objects**, not database rows. A test that starts with `prisma.contract.create({...})`
is testing Prisma.

---

## 24. Enforcement — the architecture is a lint rule, not a wish

> An architecture that is not mechanically enforced degrades to a big ball of mud within two quarters.
> (§A2)

`.dependency-cruiser.cjs`, in CI, blocking:

```
forbidden:
  domain      →  anything outward           (prisma, fastify, zod, node:*)
  application →  @prisma/client, fastify
  interface   →  domain/**/internals, infrastructure/persistence/**
  modules/*   →  another module's repository or Prisma model
  ai/*        →  any repository directly     (must go via capability registry)
  reports/*   →  any write-model repository  (read models only, §A10.4)
  anything    →  lib/money internals except via money.ts
```

Additional CI gates, each closing a specific failure this document names:

| Gate | Closes |
|---|---|
| Every tool in the Capability Registry names a permission that exists in `rbac.catalog.ts` | A tool failing **open** (§12.6) |
| Every `PermissionKey` referenced in a route exists in the catalog | Typo'd guard silently granting |
| No `.toNumber()` outside `interface/http/**/dto.ts` | Money discipline (§6.5 K3) |
| No `z.number()` in a schema field named `*[Pp]rice*`, `*[Aa]mount*`, `*[Tt]otal*` | Float money (§10.1) |
| Every zod body schema calls `.strict()` | Silently-ignored typo'd fields |
| OpenAPI document diffs against a committed snapshot | Accidental API break |
| `grep -r 'roles:' interface/http/modules` returns nothing | B1, after §12.1 step 3 |

The last one is worth the ugliness. B1 is the kind of defect that reappears the moment someone
copy-pastes a route file.

---

## 25. Sequencing

Nothing here is a big-bang rewrite, and none of it blocks the AI platform except where noted.

**Phase 0 — stop the bleeding (days).** No refactor.
1. B1 §12.1 step 1 (seed grants) + step 2 (warn). Ship.
2. B2: populate `userId` + `traceId` in the auth plugin.
3. B8: `toMoneyString` default → 4 dp.
4. B10: per-principal rate-limit buckets.
5. Write the red RBAC test from §23.

**Phase 1 — the platform substrate (weeks).** Additive; no existing module changes.
6. `outbox_events` + `PrismaUnitOfWork` + dispatcher. Wire **one** event (`ProjectCostRecorded`) end-to-end.
7. `jobs` + runner + reaper + `job_schedules`. Move nothing to it yet except `auth.token-sweep`.
8. `Cache` port + epoch (fixes B5).
9. `search_documents` + `ar_normalize` (§D-D1) + `SearchProjector` + `/search`.
10. `notifications` + rule engine + SSE.

**Phase 2 — the rings (weeks, per module).** One module at a time, `contracts` last because it is the
largest. Per module: extract `domain/`, extract use cases, invert the repository to the domain type,
move the route into `interface/http`, adopt `fastify-type-provider-zod`. The module is done when
`dependency-cruiser` passes for it and its old service file is deleted.

11. `composition/container.ts` first (fixes B4) — without it, phase 2 has nowhere to put the wiring.
12. `customers` → `materials` → `suppliers` (new, greenfield: build it *in* the target shape as the reference implementation) → `payments` → `costs` → `projects` → `contracts`.

**Phase 3 — schema deltas.** `docs/DATABASE.md` §18's nine decisions, in migration order: widen money →
backfill → add constraints → drop old indexes. D4 (`payments` split) and D-D7 (partial indexes) first;
they are the two with user-visible effects.

**Phase 4 — the AI platform.** Requires phase 2 complete for the modules its tools touch, because the
Capability Registry's `execute()` calls **use cases**, and until they exist the assistant has no door
(§A1) and will grow its own — which is the exact failure the previous implementation embodied.

**Phase 5 — recommendations, AI reports, analytics matviews.**

The dependency worth naming: **phase 4 cannot start before phase 2**, and phase 2 cannot start before
phase 1's `UnitOfWork` exists. Everything else can be reordered.

---

## 26. Decisions I need from you

The first is not a preference.

| # | Decision | My call | Reverse it if |
|---|---|---|---|
| 1 | **B1 — the role fallback grants 31 gated routes** | Fix it: seed → warn → delete (§12.1) | Never. The only choice is the migration's pace. But note the AI platform's permission checks are meaningless until this lands |
| 2 | **Full four-ring refactor (§2)** vs. keeping `modules/<name>/` and enforcing boundaries by review | Do it, module by module (§25 phase 2) | You accept that the AI executor will call services that also hold Prisma calls, and that §A2's dependency rule stays aspirational. Cost is real: ~12 modules × ~2 days |
| 3 | **`fastify-type-provider-zod`** (§9.1) | Adopt — it buys OpenAPI, response serialization, and inferred types from schemas you already wrote | You don't want a generated frontend client |
| 4 | **Keyset pagination** on `audit_logs`, `project_costs`, `notifications`, `material_price_history` | Adopt; keep offset for bounded tables | The grid needs a total row count more than it needs constant-time deep pages |
| 5 | **`Idempotency-Key` required on money-creating POSTs** (§7.4) | Required on `/costs`, `/payments`, `/payments/:id/settle` | You'd rather not add a table and a header contract |
| 6 | **Hand-written container** (§9.3) vs a DI framework | Hand-written, ~150 lines | Team preference for `tsyringe`. I'd push back |
| 7 | **`Principal` passed explicitly** into every use case, not read from `AsyncLocalStorage` | Explicit (§12.2) | You value shorter signatures more than testable use cases and a callable AI door |
| 8 | **Production log level `info`** (currently `warn`) | Raise it, with rotation | Disk on the office PC is genuinely scarce |
| 9 | **`23514` (CHECK violation) → 500, not 400** (§14.3) | 500. A fired `CHECK` means our domain guard was missing | You'd rather blame the request than surface the bug |

**And one that is a product question, not an engineering one — it blocks code.** §6.3 P5 / §D18 #4:
does a `SKIPPED` construction step count toward project progress, or does the aggregate redistribute
its percentage? `Project.recomputeProgress()` cannot be written until someone answers. Today a project
with one skipped step can never reach 100%.

---

## 27. What this document does not do

- **No code.** No files created, no `schema.prisma` touched, no migrations — by instruction.
- **No `ar_normalize` body.** §D-D1 specifies its contract and why every word of `IMMUTABLE STRICT PARALLEL SAFE` matters. The implementation is a short SQL function.
- **No prompt design.** §A5's reasoning ring is specified as a boundary here, not as prompts.
- **No frontend contract client.** It falls out of §9.1's OpenAPI document, generated, not written.
- **No estimate.** Phase 2 is twelve modules of real refactoring on a working system; a number invented here would be fiction. Phase 0 is days.






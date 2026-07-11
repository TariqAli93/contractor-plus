# Contractor Plus — Architecture of the Embedded AI Platform

**Status:** Design. No implementation.
**Author:** Lead Software Architect
**Scope:** The whole system, with the Embedded AI Platform as the centrepiece.

---

## 0. The constraint that decides everything

Before a single box is drawn, the deployment must be named, because it invalidates most of the
architecture patterns that would otherwise be reflexive here.

```
   ONE Windows machine, inside one contractor's office.

   ┌──────────────────────────────────────────────────────────────┐
   │  Windows 11 Pro                                              │
   │                                                              │
   │   Electron desktop client  ──http──▶  ContractorPlusBackend  │
   │   (Vue 3 SPA, Arabic/RTL)             (WinSW service, :31734)│
   │                                            │                 │
   │                                            ▼                 │
   │                                    PostgreSQL (local)        │
   │                                                              │
   │   cloudflared tunnel (OPTIONAL, off by default)              │
   └──────────────────────────────────────────────────────────────┘
                                │
                                ▼ (only outbound dependency)
                        OpenRouter (LLM gateway)
```

Concurrency is **one to ten humans**, not ten thousand. The machine is an office PC, not a cluster.
The product is installed by an NSIS installer and self-heals a Windows Service; every additional
process is another thing that can fail to install, fail to start, fail a version gate, and generate a
support call at a construction company with no IT department.

Therefore:

- **"Scalability" here means vertical and structural, not horizontal.** It means the codebase absorbs
  ten more features without collapsing, and the database absorbs ten years of one contractor's
  ledgers without the dashboard slowing down. It does **not** mean Kubernetes.
- **Every new infrastructure dependency is a liability, not an asset.** Redis, Kafka, Elasticsearch,
  and a separate worker process each cost more in operational failure than they return in throughput
  at this scale.
- The architecture is therefore a **modular monolith on a Postgres substrate**, with bounded contexts
  enforced in code, and seams cut precisely where a future extraction would happen — so the option is
  preserved without paying for it now.

This is the single most important decision in the document. Everything below follows from it.

### 0.1 What exists today (verified against the tree, not assumed)

| Area | Reality |
|---|---|
| Backend | Fastify + Prisma + Postgres, zod, pino. Modules: `auth, rbac, users, profile, customers, materials, templates, contracts, change-orders, projects, costs, payments, reports, document-templates, uploads, settings, audit, tunnel` |
| Money | `lib/money.ts` — all arithmetic via `Prisma.Decimal` (decimal.js). Serialized as fixed-precision strings |
| AuthZ | `rbac.catalog.ts`, ~60 permission keys, OWNER is super-admin. `rbac.plugin.ts` gates routes |
| Cross-cutting | Fastify plugins: `auth, rbac, prisma, request-context, error-handler, tunnel` |
| AI subsystem | **Does not exist.** 96 files (`ai-assistant`, `ai-platform`, `ai-command-workflow`, `estimation-templates`, `lib/llm`, frontend AI surfaces, shared protocol, tests) are **staged for deletion**. `app.ts` registers no AI routes; the Prisma schema has no `Ai*` or `Estimation*` models |
| Infra absent | No Redis, no message broker, no search engine, no cron library, no WebSocket, no job queue, no Postgres extensions enabled |

So this is a **genuine clean slate for the AI platform**, layered onto a healthy, already-modular
business application. The design below is the target state, and it explicitly reuses the two ideas
the deleted implementation got right (a deterministic pre-router, and an LLM that may only propose a
plan) while discarding the three stacks that had grown in parallel.

---

## 1. Overall architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PRESENTATION                                                                │
│   Electron shell ── Vue 3 SPA (Arabic/RTL, dense desktop chrome)            │
│   Assistant console · Command palette · Workspaces · Reports                │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ HTTP/JSON  +  SSE (server→client events)
┌───────────────────────────────▼─────────────────────────────────────────────┐
│ INTERFACE — Fastify                                                         │
│   Routes · zod schemas · auth plugin · rbac plugin · error handler          │
│   /api/v1/{customers,contracts,projects,costs,payments,…}                   │
│   /api/v1/ai/*      /api/v1/search      /api/v1/notifications (SSE)         │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │  (both HTTP and AI enter HERE — one door)
┌───────────────────────────────▼─────────────────────────────────────────────┐
│ APPLICATION — use cases / orchestration                                     │
│   ContractApplicationService · ProjectApplicationService · …                │
│   Transaction boundary · permission check · domain event emission           │
└──────┬─────────────────────────────────────────────┬────────────────────────┘
       │                                             │
┌──────▼──────────────────────┐          ┌───────────▼────────────────────────┐
│ DOMAIN (pure)               │          │ INTELLIGENCE (AI Platform)         │
│  Aggregates · invariants    │◀─────────│  Reads domain, proposes Plans,     │
│  Money · policies           │  never   │  calls Application services only   │
│  Domain events              │  writes  │  through the Capability Registry   │
└──────┬──────────────────────┘  direct  └───────────┬────────────────────────┘
       │                                             │
┌──────▼─────────────────────────────────────────────▼────────────────────────┐
│ INFRASTRUCTURE                                                              │
│  Prisma repos · Outbox · Job runner · Search index · Vector store           │
│  LLM gateway · DOCX renderer · File storage · DPAPI secrets · Tunnel        │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
                     ┌──────────▼──────────┐        ┌──────────────┐
                     │ PostgreSQL          │        │ OpenRouter   │
                     │ tables · outbox     │        │ (only        │
                     │ jobs · fts · vector │        │  egress)     │
                     │ matviews            │        └──────────────┘
                     └─────────────────────┘
```

**Why one door.** The AI platform is a *client of the same application services the HTTP controllers
use*. It gets no privileged path to the database. This is the highest-leverage rule in the system: it
means every invariant, permission check, audit row, and money rule written for the human UI is
automatically true for the assistant, and can never drift.

---

## 2. Layered architecture and the dependency rule

Four rings. **Dependencies point inward, always.**

```
        ┌────────────────────────────────────────────┐
        │  Infrastructure  (Prisma, LLM, FS, HTTP)   │   ← knows everything
        │  ┌──────────────────────────────────────┐  │
        │  │  Interface  (routes, schemas, DTOs)  │  │
        │  │  ┌────────────────────────────────┐  │  │
        │  │  │  Application  (use cases)      │  │  │
        │  │  │  ┌──────────────────────────┐  │  │  │
        │  │  │  │  Domain  (entities,      │  │  │  │   ← knows nothing
        │  │  │  │  value objects, events)  │  │  │  │
        │  │  │  └──────────────────────────┘  │  │  │
        │  │  └────────────────────────────────┘  │  │
        │  └──────────────────────────────────────┘  │
        └────────────────────────────────────────────┘
```

| Ring | May import | Must never import | Why it exists |
|---|---|---|---|
| **Domain** | nothing but itself + `Decimal` | Prisma, Fastify, zod, LLM | The rules that are true regardless of how the app is delivered. A contract's revised total is original + Σ approved change orders whether it arrives by mouse, by REST, or by assistant |
| **Application** | Domain, port interfaces | Prisma client, Fastify `req/res` | One use case = one transaction = one authorization decision. The only place a `BEGIN` starts |
| **Interface** | Application, DTO schemas | Domain internals, repositories | Translates transport into a use-case call. Owns zod validation and HTTP status |
| **Infrastructure** | everything | — | Implements the ports the Application declared. Swappable: Prisma → anything; OpenRouter → anything |

**Ports and adapters.** The Application ring declares interfaces (`ContractRepository`,
`LlmClient`, `Clock`, `EventPublisher`, `SearchIndex`, `VectorStore`). Infrastructure implements them.
This is what made the previous AI tests possible with a fake `LlmClient` and a real database, and it
is retained deliberately.

**Enforcement, or it will rot.** The dependency rule is a lint rule, not a wish:
`dependency-cruiser` (or `eslint-plugin-boundaries`) with a forbidden-edge config, run in CI. An
architecture that is not mechanically enforced degrades to a big ball of mud within two quarters.

---

## 3. Domain-Driven Design

### 3.1 Ubiquitous language — resolve the naming split first

The request says *Clients* and *Expenses*; the code says `Customer` and `ProjectCost`. The old AI
registry papered over this with a translation table (`client → customers`, `expense → costs`). That
table is a smell: it means the system has two vocabularies and the AI is the interpreter.

**Decision: the code keeps `Customer` and `ProjectCost`; the *language layer* maps synonyms.** The
domain term is singular and canonical; the Arabic UI string and the AI's synonym list are both
presentation concerns. Synonyms live in one place (the Capability Registry's `aliases`), never in
business logic. A second vocabulary in the domain is how a codebase gets two of everything.

### 3.2 Bounded contexts

```
                  ┌──────────────────────────────────────────┐
                  │           IDENTITY & ACCESS              │
                  │   User · Role · Permission · Session      │
                  └──────────────────┬───────────────────────┘
                                     │ (upstream to all)
   ┌─────────────────┐   ┌───────────▼──────────┐   ┌──────────────────┐
   │  CATALOG        │   │  SALES & CONTRACTING │   │  CASH            │
   │  BuildingTemplate│──▶│  Customer            │──▶│  Payment         │
   │  DocumentTemplate│   │  Contract            │   │  (schedule,      │
   │  Material        │   │  ContractItem        │   │   settlement)    │
   └────────┬─────────┘   │  ChangeOrder         │   └──────────────────┘
            │             └───────────┬──────────┘
            │                         │ approved contract
            │             ┌───────────▼──────────┐
            └────────────▶│  DELIVERY            │
              consumed by │  Project             │
                          │  ConstructionStep    │
                          └───────────┬──────────┘
                                      │
                          ┌───────────▼──────────┐
                          │  COST & PROCUREMENT  │
                          │  ProjectCost         │
                          └──────────────────────┘

   ┌──────────────────────────────────────────────────────────────────┐
   │  PLATFORM (generic): Settings · Currency · CompanyProfile ·      │
   │                      Audit · Tunnel · Storage                    │
   └──────────────────────────────────────────────────────────────────┘

   ┌──────────────────────────────────────────────────────────────────┐
   │  INTELLIGENCE (supporting): the AI Platform.                     │
   │  DOWNSTREAM of every context. Conformist. Talks to them only     │
   │  through the Capability Registry (an Anti-Corruption Layer).     │
   └──────────────────────────────────────────────────────────────────┘
```

**Context map relationships**

| Upstream → Downstream | Pattern | Why |
|---|---|---|
| Identity → all | Shared Kernel (the `Principal`) | Every use case needs "who is asking" |
| Sales → Delivery | Customer/Supplier | An approved contract *causes* a project; delivery cannot change contract terms |
| Sales → Cash | Customer/Supplier | The payment schedule is derived from the contract |
| Catalog → Sales, Delivery | Published Language | Templates and materials are copied *by value* into contracts/costs at the moment of use, so a later price edit never rewrites history |
| all → Intelligence | **Conformist + ACL** | The AI adapts to the domain, never the reverse. The Capability Registry is the only translation surface |

The Catalog→Sales rule deserves emphasis: when a `BuildingTemplate` is turned into a `Contract`, the
line items are **snapshotted**, not referenced. Otherwise editing a material price silently restates
a signed contract. In a financial system this is not a preference; it is correctness.

### 3.3 Aggregates and their invariants

| Aggregate root | Contains | Invariant it defends |
|---|---|---|
| `Contract` | `ContractItem[]`, `ChangeOrder[]` | `revisedTotal = originalTotal + Σ(approved change orders)`. Only a `DRAFT` may be edited. Only an `APPROVED` contract may spawn a project |
| `Project` | `ConstructionStep[]` | `progress` is *derived* from steps, never set directly. Status transitions form a legal graph (`PLANNED→IN_PROGRESS→{PAUSED,COMPLETED,CANCELLED}`) |
| `Payment` | — | A payment belongs to exactly one contract/project; `paidAmount ≤ scheduledAmount`; a paid payment is immutable except by reversal |
| `ProjectCost` | — | Money is `Decimal`. `total = quantity × unitPrice` computed in the domain, never accepted from a caller |
| `Customer` | — | Identity + contact. Deletion is refused when contracts exist (referential dignity, not just FK) |
| `BuildingTemplate` | items, steps | A reusable recipe. Immutable once referenced? No — versioned. Snapshots protect history |

**Transactional rule:** one use case mutates **one aggregate**. Cross-aggregate consistency is
reached by domain events, not by a fat transaction. The single exception, already present and correct
in this codebase, is "approve contract → create project → link", which is genuinely one atomic
business fact and is allowed to span two aggregates in one transaction.

---

## 4. Module catalog and responsibilities

Every module is a vertical slice with the same internal shape (`routes → controller → service →
repository`, plus `schemas` and `types`). This is the shape the codebase already has; the design
formalizes it and adds the missing platform modules.

### 4.1 Business modules (exist today)

| Module | Owns | Responsibility | Why it exists |
|---|---|---|---|
| `customers` | Customer | CRUD, search, delete-guard | The counterparty of every contract |
| `contracts` | Contract, ContractItem | Draft → approve → cancel; totals; item lines | The commercial agreement. The source of truth for money owed |
| `change-orders` | ChangeOrder | Signed-delta amendments; approval workflow | Real construction changes scope after signing; restating the contract would destroy the audit trail |
| `projects` | Project, ConstructionStep | Execution, progress, delays | Where the work and the calendar live |
| `costs` | ProjectCost | Expense capture (Excel-fast) | The other half of profitability |
| `payments` | Payment | Schedule, settle, overdue | Cash flow — the owner's first question |
| `materials` | Material | Catalog + unit prices | Inputs to templates, estimates, and costs |
| `templates` | BuildingTemplate | Reusable cost/step recipes | Turns tacit estimating knowledge into an asset |
| `document-templates` | DocumentTemplate, GeneratedDocument | DOCX generation from placeholders | The contract must leave the building as paper |
| `reports` | — (read model) | Cash flow, profitability, overdue, delays | The owner's dashboard |
| `auth`,`users`,`rbac`,`profile` | Identity | AuthN, ~60-key AuthZ | A mixed team with very different powers |
| `settings`,`uploads`,`audit`,`tunnel` | Platform | Config, files, trail, remote access | Generic subdomains |

### 4.2 New platform modules (this design)

| Module | Responsibility | Why it must exist |
|---|---|---|
| `platform/events` | Domain event bus + **transactional outbox** | The one mechanism that lets search, notifications, and analytics react to writes *without* the write path knowing they exist |
| `platform/jobs` | Durable job queue + scheduler (Postgres `SKIP LOCKED`) | Recurring work (overdue sweep, matview refresh, embedding backfill) must survive a service restart |
| `platform/notifications` | Rules → notification → channels (in-app, SSE, Windows toast) | "Nothing slips through" is the product's first emotional goal |
| `platform/search` | Unified `search_document` index (FTS + trigram) | One resolver for the palette, global search, **and the AI's entity resolution** |
| `platform/analytics` | Read models: materialized views + snapshot facts | Keeps the dashboard fast and the write model clean |
| `platform/recommendations` | Rules → statistics → embeddings, all explainable | Turns the ledger into advice without turning it into a black box |
| `ai/*` | The Embedded AI Platform (§5) | The reason for this document |

---

## 5. The Embedded AI Platform

This is the centrepiece. It is designed as **six concentric rings**, each of which may only call
inward. The outer rings are about *safety*; the inner rings are about *capability*.

```
┌── 1. TRANSPORT ─────────────────────────────────────────────────────────┐
│    POST /api/v1/ai/sessions/:id/messages   ·  SSE token stream          │
│    zod request/response schemas · one discriminated result union        │
│                                                                         │
│  ┌── 2. GOVERNANCE ──────────────────────────────────────────────────┐  │
│  │   Principal (live role re-check) · per-user rate limit            │  │
│  │   usage quota · per-user circuit breaker · PII redaction          │  │
│  │   audit envelope (open before, close after — always)              │  │
│  │                                                                   │  │
│  │  ┌── 3. CONVERSATION ─────────────────────────────────────────┐   │  │
│  │  │   Session store · rolling memory · mode classifier         │   │  │
│  │  │   modes: GENERAL | QUESTION | WORKFLOW | COMMAND           │   │  │
│  │  │                                                            │   │  │
│  │  │  ┌── 4. REASONING ─────────────────────────────────────┐   │   │  │
│  │  │  │   a) Pre-router   (deterministic, NO LLM)          │   │   │  │
│  │  │  │   b) Retriever    (RAG: search + vector)           │   │   │  │
│  │  │  │   c) Planner      (LLM → typed Plan JSON)          │   │   │  │
│  │  │  │                                                     │   │   │  │
│  │  │  │  ┌── 5. CAPABILITY ────────────────────────────┐   │   │   │  │
│  │  │  │  │   Tool Registry (allow-list, ~30 actions)   │   │   │   │  │
│  │  │  │  │   Arg resolution · permission gate per act  │   │   │   │  │
│  │  │  │  │   Preview builder (human-readable Arabic)   │   │   │   │  │
│  │  │  │  │                                              │   │   │  │  │
│  │  │  │  │  ┌── 6. EFFECT ──────────────────────────┐  │   │   │  │  │
│  │  │  │  │  │  Executor → Application Services      │  │   │   │  │  │
│  │  │  │  │  │  ONE transaction · outbox · audit     │  │   │   │  │  │
│  │  │  │  │  └───────────────────────────────────────┘  │   │   │  │  │
│  │  │  │  └──────────────────────────────────────────────┘   │   │  │  │
│  │  │  └─────────────────────────────────────────────────────┘   │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.1 The four invariants

These are not guidelines. They are the reason the platform is safe to embed in a financial system.

1. **The LLM never touches the database.**
   It emits a `Plan` — a typed JSON value object. The Plan is validated with zod, its entity
   references are *resolved against real rows*, each action is permission-checked against the live
   principal, rendered as a human preview, confirmed by a person, and only then executed by
   deterministic code inside one transaction. A model that hallucinates an action name gets a
   rejection, not a write.

2. **Determinism before inference.**
   The **Pre-router** answers greetings, capability questions ("what can you do?"), and status
   restatements with zero LLM calls: zero latency, zero cost, zero quota, no provider dependency. A
   surprisingly large share of real assistant traffic is this. It is also the reason the assistant
   still works when OpenRouter is down.

3. **The model never emits money or quantities.**
   For estimation it may emit *ratios* and *line descriptions*; the backend computes `quantity =
   ratio × area`, applies waste as its own line, and totals in `Decimal`. Arithmetic is not a language
   task. This preserves `money.ts` discipline through the AI path.

4. **Every AI turn is auditable and attributable.**
   One `AiExecution` row per turn, opened before the model is called and closed on every exit path
   (success, rejection, timeout, quota, breaker). It records: principal, mode, tools invoked, tokens,
   cost, latency, the plan, the confirmation, and the resulting entity ids. An assistant that can move
   money and cannot be audited is not shippable.

### 5.2 The turn, end to end

```
 user text
    │
    ▼
[Governance] authN → live role fetch → rate limit → quota → breaker → open audit
    │
    ▼
[Conversation] load session + rolling memory → classify mode
    │
    ├── mode = GENERAL / capability / status ───▶ [Pre-router] ──▶ answer  (no LLM, no quota)
    │
    ├── mode = QUESTION ──▶ [Retriever] ──▶ [Planner: read-only tools] ──▶ answer + citations
    │                        (FTS + vector over read models)                  (never mutates)
    │
    └── mode = COMMAND / WORKFLOW
             │
             ▼
        [Retriever] resolve entities ("فيلا الرياض" → project id) via the SAME
             │      search index the command palette uses
             ▼
        [Planner]  LLM → Plan { actions: [ {tool, args, refs} ] }
             │
             ▼
        [Capability] zod-validate → allow-list check → resolve refs to rows
             │       → permission-gate EACH action against live principal
             │       → build Arabic preview  (no ids, no JSON, no tool names)
             ▼
        ┌────────────────┐   reject       ┌──────────────────────────┐
        │  human confirm │ ─────────────▶ │ cancelled · audit closed │
        └───────┬────────┘                └──────────────────────────┘
                │ approve
                ▼
        [Effect] BEGIN
                   ApplicationService.execute(action) ×N   ← same code path as HTTP
                   outbox.append(domain events)
                 COMMIT
                │
                ▼
        audit closed · outbox dispatched → notifications · search · analytics
```

Note the confirmation gate is **atomic**: the pending plan is *claimed* (compare-and-set on its
status) before execution, so a double-click or a duplicated request cannot execute the same plan
twice. This was a real defect class in the previous implementation and the design names it explicitly.

### 5.3 Ring-by-ring responsibilities

| Ring | Module | Responsibility | Why it is its own ring |
|---|---|---|---|
| 1 Transport | `ai/transport` | Routes, schemas, SSE streaming, one discriminated result union (`answer` \| `clarification` \| `preview` \| `execution` \| `rejected` \| `error`) | The client renders by `kind`. A closed union means a new tool cannot break the UI |
| 2 Governance | `ai/governance` | Live-role re-check (a revoked role must not survive a cached JWT), **per-user** rate limit and circuit breaker, quota, redaction, audit envelope | Safety must not be a concern of the reasoning code, and a shared breaker is a cross-user denial of service |
| 3 Conversation | `ai/conversation` | Session, rolling summary memory, mode classifier | Memory is a storage concern, not a prompt concern. The classifier keeps the expensive rings unentered |
| 4 Reasoning | `ai/reasoning` | Pre-router, retriever (RAG), planner, prompt assembly | The only ring that talks to a model. Isolated so it can be faked in tests |
| 5 Capability | `ai/capability` | Tool registry, tool contract, arg resolution, per-action permission gate, preview rendering | **This is the Anti-Corruption Layer.** The domain's shape never leaks to the prompt; the model's vocabulary never leaks to the domain |
| 6 Effect | `ai/effect` | Executor calling Application services in one transaction | The AI's write path *is* the human write path |

### 5.4 The Tool Contract

A tool is the unit of capability. It is declared, not discovered.

```
Tool {
  name            'contract.approve'
  aliases         ['اعتماد العقد', 'approve contract']   ← the ONLY synonym home
  mode            READ | WRITE
  permissions     ['contracts.approve']                  ← checked against LIVE principal
  argsSchema      zod schema                             ← model output validated here
  resolve(args)   → entity refs → real rows (or Clarification)
  preview(rows)   → Arabic sentences (no ids, no JSON, no internal names)
  execute(rows)   → calls ContractApplicationService.approve(...)
  renderKind      'generic' | 'estimation' | …           ← picks the client renderer
}
```

**Why an allow-list and not function-calling over the whole API surface:** a registry is a
*capability budget*. Adding power is a deliberate, reviewable act. The blast radius of a prompt
injection is bounded by what is in the registry, intersected with what the signed-in role may do.

**Read tools vs write tools.** A `QUESTION` turn may only bind `READ` tools, enforced structurally —
a question can never park a mutation. That is a type-level guarantee, not a prompt instruction.

### 5.5 Grounding (RAG), and why it is not optional

The model must not "remember" the contractor's data; it must **retrieve** it.

```
   Domain write ──▶ outbox ──▶ projector ──┬──▶ search_document  (tsvector + trigram)
                                            └──▶ embedding        (pgvector)

   AI question ──▶ Retriever ──┬── lexical: FTS + fuzzy (Arabic-safe, see §10.3)
                                └── semantic: vector kNN
                                       │
                                       ▼
                          top-k passages + entity candidates
                                       │
                                       ▼
                          Planner prompt (grounded, cited)
```

The retriever returns **entity candidates with ids**, which is how "add a cost to the Riyadh villa"
becomes an unambiguous project id — or a `clarification` turn when two projects match. Entity
resolution is a *search* problem, not a *language* problem, and it reuses the same index the command
palette queries. One index, one ranking, one truth.

### 5.6 Failure semantics

| Failure | Result kind | Quota consumed | Why |
|---|---|---|---|
| Not understood / out of scope | `rejected` | yes | The model was called |
| Permission denied | `rejected` | no | Refused before the model |
| Provider down / breaker open | `error` | no | Not the user's fault |
| Timeout | `error` | no | Not the user's fault |
| Quota exhausted | `error` | — | Honest and specific |
| Ambiguous entity | `clarification` | yes | Progress, not failure |

`rejected` ("I understood you and the answer is no") and `error` ("I could not serve you") are
distinct kinds because they are distinct to a human, and conflating them makes the assistant feel
broken when it is merely offline.

---

## 6. Business layer

The Application ring is thin and boring by design. Each use case:

```
execute(command, principal):
    1. authorize(principal, requiredPermission)      ← one decision, one place
    2. load aggregate(s) via repository port
    3. aggregate.doTheThing(...)                     ← invariants live HERE
    4. repository.save(aggregate)                    ← inside the transaction
    5. outbox.append(aggregate.pullEvents())         ← SAME transaction
    6. return DTO (money as fixed-precision string)
```

Steps 4 and 5 sharing a transaction is the whole trick of the outbox: an event is published **iff**
the write committed. No dual-write, no lost notification, no phantom search entry, no broker.

**Why money leaves as a string.** JSON numbers are IEEE-754 doubles. `0.1 + 0.2 ≠ 0.3`. A contracting
ledger that serialises `Decimal` as a JSON number has already lost. The DTO boundary converts once,
to a fixed-precision string; the client formats, never computes.

---

## 7. Database layer

Postgres is not merely the persistence store. **It is the platform**: relational store, job queue,
event outbox, full-text index, vector index, and analytics engine. This is the direct consequence of
§0 — every one of those roles would otherwise be a separate Windows service.

```
┌──────────────────── PostgreSQL ─────────────────────────────────────────┐
│                                                                         │
│  WRITE MODEL (normalized, Decimal money, FK-enforced)                   │
│    customer, contract, contract_item, change_order, project,            │
│    construction_step, project_cost, payment, material,                  │
│    building_template(+item,+step), document_template, generated_document│
│    user, role, permission, role_permission, audit_log, system_setting   │
│                                                                         │
│  AI                                                                     │
│    ai_session, ai_message, ai_execution (audit), ai_plan (pending)      │
│                                                                         │
│  PLATFORM MECHANICS                                                     │
│    outbox_event      (id, aggregate, type, payload, occurred_at,        │
│                       dispatched_at NULL)                               │
│    job               (id, kind, run_at, attempts, locked_by, payload)   │
│    notification      (id, user_id, kind, payload, read_at)              │
│                                                                         │
│  READ MODELS (derived, disposable, rebuildable)                         │
│    search_document   (entity, entity_id, title, body, tsv, trgm)        │
│    embedding         (entity, entity_id, vector(1024))    [pgvector]    │
│    mv_cash_flow_monthly, mv_project_profitability     [materialized]    │
│    fact_project_daily  (snapshot time series)                           │
└─────────────────────────────────────────────────────────────────────────┘
```

**Rules**

- **Money:** `NUMERIC(18,4)` in the DB, `Prisma.Decimal` in code, string over the wire. Never `float`.
- **Read models are disposable.** Every derived table can be dropped and rebuilt from the write model.
  This is what makes it safe to change the search or analytics design later.
- **Migrations are forward-only and applied on service boot** (already the case). A migration that
  drops a column ships one release *after* the code that stopped reading it.
- **Extensions required:** `pg_trgm`, `unaccent`, `pgvector`. All ship with a standard Postgres and
  need no extra process — which is precisely why they were chosen.

---

## 8. Infrastructure layer

| Adapter | Port it implements | Note |
|---|---|---|
| `PrismaRepositories` | `*Repository` | Only place Prisma types appear |
| `OutboxPublisher` | `EventPublisher` | Appends in the caller's transaction |
| `PgJobQueue` | `JobQueue` | `SELECT … FOR UPDATE SKIP LOCKED` |
| `OpenRouterClient` | `LlmClient` | Timeout, retry with jitter, breaker, token accounting |
| `PgSearchIndex` | `SearchIndex` | tsvector + trigram |
| `PgVectorStore` | `VectorStore` | kNN with `ivfflat` |
| `DocxRenderer` | `DocumentRenderer` | docxtemplater |
| `DpapiSecretStore` | `SecretStore` | Windows DPAPI; the LLM API key never sits in plaintext |
| `LocalFileStorage` | `FileStorage` | Under `%ProgramData%` |

**Secrets.** The OpenRouter key is encrypted with a dedicated key via DPAPI, machine-bound. It is
never logged, never returned by an API, and redacted from every prompt trace.

---

## 9. External services

There is exactly **one** required egress, and the product must degrade gracefully without it.

| Service | Purpose | Failure mode | Degradation |
|---|---|---|---|
| **OpenRouter** | Single LLM gateway (model chosen from a discovery list) | Breaker opens after N consecutive failures, per user | Pre-router still answers; the rest of the app is unaffected. The assistant says so in plain Arabic |
| **cloudflared** | Optional remote access tunnel | Off by default | Status orb reports it; nothing depends on it |
| **Windows DPAPI** | Secret sealing | Local, always available | Fatal for AI config only |

A single gateway (rather than per-provider adapters) is a deliberate simplification: OpenRouter *is*
the abstraction over providers. Re-implementing that abstraction in-process was the mistake the
previous multi-provider transport made, and it was correctly collapsed.

---

## 10. Cross-cutting subsystems

All four are driven by the **same outbox**. That is the point: one mechanism, four consumers.

```
   Application ──(same tx)──▶ outbox_event
                                   │
                    ┌──────────────┼──────────────┬─────────────────┐
                    ▼              ▼              ▼                 ▼
             notifications    search index    analytics       embeddings
```

### 10.1 Scheduling

**Design:** a `job` table plus an in-process worker inside the Fastify service, ticking every few
seconds, claiming rows with `SELECT … FOR UPDATE SKIP LOCKED`. Recurring work is expressed as a
`schedule` row that enqueues the next `job` after each run.

```
 tick (5s) ─▶ claim due jobs (SKIP LOCKED, limit N)
                │
                ├─ run handler ── ok  ─▶ delete job, enqueue next occurrence
                └─ run handler ── err ─▶ attempts++, run_at = now + backoff(attempts)
                                          attempts > max ─▶ dead_letter
```

Jobs: overdue-payment sweep, delay detection, matview refresh, embedding backfill, DOCX cleanup,
backup verification.

**Why not `node-cron`:** it is in-memory. A service restart at 02:59 silently skips the 03:00 sweep,
and nothing tells you. **Why not BullMQ/Redis:** a second service to install, repair, and version-gate
on a contractor's office PC (§0). Durability is the requirement; Postgres already provides it.

**Single-instance guard.** With one service there is no leader election problem, but the design still
takes an advisory lock (`pg_advisory_lock`) so that a developer running a second instance cannot
double-fire jobs. Cheap insurance, and it is the seam along which a second worker process would later
be extracted.

### 10.2 Notification system

```
  domain event (PaymentOverdue, ProjectDelayed, ContractApproved, AiExecutionFailed)
        │
        ▼
  [rule engine]  who cares about this, given their role and preferences?
        │
        ▼
  notification row  (durable, per-user, idempotency_key)
        │
        ├──▶ in-app store (bell)  ← polled/pushed
        ├──▶ SSE stream           ← live, to the open Electron renderer
        └──▶ Windows toast        ← via Electron IPC, for "nothing slips through"
```

- **Delivery is at-least-once**; an `idempotency_key` per (rule, entity, period) makes it effectively
  once. The overdue sweep must not notify the same invoice every five seconds.
- **SSE, not WebSocket.** The traffic is server→client only. SSE is one HTTP response, survives the
  reverse proxy, reconnects itself, and needs no new protocol. Choosing WebSocket here would be
  ceremony.
- Notifications are **role-scoped**: an accountant sees overdue payments; an engineer sees delays.
  Reusing the RBAC catalog rather than inventing a preference model.

### 10.3 Search system

One index serves three consumers: the **command palette**, **global search**, and the **AI's entity
resolver**. Three rankers would eventually disagree, and a disagreement between the palette and the
assistant is a bug the user experiences as "the AI can't find my project."

```
  search_document(entity, entity_id, title, body, tsv, updated_at)
        ▲                       │
        │ projector             │
     outbox               ┌─────┴────────────────────────────┐
                          │ lexical:  tsv @@ websearch_to_tsquery │
                          │ fuzzy:    title % query  (pg_trgm)    │
                          │ rank:     ts_rank + similarity + recency│
                          └───────────────────────────────────────┘
```

**The Arabic problem, stated plainly.** Postgres ships **no Arabic stemmer**. Using
`to_tsvector('arabic', …)` is not an option; using `'english'` would mangle the text. The design
therefore uses:

- `to_tsvector('simple', unaccent(normalize(text)))` — no stemming, exact token matching;
- **`pg_trgm` trigram similarity** as the primary fuzzy mechanism, which is script-agnostic and
  handles Arabic morphology (prefixed ال, suffixed pronouns) far better than a wrong stemmer;
- a normalization step folding أ/إ/آ→ا, ة→ه, ى→ي and stripping diacritics — the standard Arabic IR
  normalization, applied identically at index time and query time.

This is the kind of decision that is invisible when right and infuriating when wrong.

### 10.4 Analytics

Today `reports` runs live aggregate SQL. That is correct for now and will not stay correct as the
ledger grows, because a dashboard that recomputes five years of `Decimal` sums on every page load has
a p95 that degrades with tenure — the worst possible failure curve, since it punishes your most loyal
user.

```
   write model ──▶ [matview: mv_cash_flow_monthly]      refreshed by job (CONCURRENTLY)
              └──▶ [snapshot: fact_project_daily]       appended by job, immutable

   reports module reads ONLY read models, never the write model.
```

- **Materialized views** for aggregates that can be recomputed (profitability by project).
- **Snapshot fact tables** for anything time-dependent that must not be retroactively restated
  (project progress on a given day). You cannot recompute "what did we think last March"; you can only
  have recorded it.
- Refresh is a scheduled job (§10.1), so freshness is a tunable knob, and the dashboard's cost is
  bounded by the size of the read model rather than the size of history.

### 10.5 Recommendation engine

Three tiers, in ascending order of cost and descending order of trust. **Ship tier 0 first.**

| Tier | Mechanism | Example | Explainable? |
|---|---|---|---|
| **0 — Rules** | Deterministic SQL over read models | "3 payments overdue > 30 days", "Project X is 12 days late", "Costs exceed contract value by 8%" | Trivially. Cites the rows |
| **1 — Statistical** | Similarity over cost profiles, price drift, seasonality | "Cement is 14% above your 12-month average" | Yes. Shows the baseline |
| **2 — Semantic** | pgvector kNN over embeddings | "Projects like this one used template T" | Partially. Shows the neighbours |

**The non-negotiable requirement:** every recommendation carries an `explanation` and an `evidence[]`
of record ids the user can open. This app's brand personality is *"solid, precise, quiet — numbers you
can trust at a glance."* An unexplained recommendation in a financial tool is worse than no
recommendation: it either gets blindly trusted or permanently ignored, and both outcomes are bad.

Recommendations are **surfaced, never executed.** A recommendation may *pre-fill an AI plan* — which
then walks the ordinary preview-and-confirm gate of §5.2. There is no autonomous write path anywhere
in this architecture.

---

## 11. Data flow — three canonical paths

**A. Human write**

```
UI ─▶ route ─▶ zod ─▶ rbac ─▶ ApplicationService ─┬─▶ Domain (invariants)
                                                   ├─▶ Repository (tx)
                                                   └─▶ Outbox (tx)
                                                          │
                                          COMMIT ─────────┘
                                                          │
                                    dispatcher ──▶ notify · index · analytics
```

**B. AI write** — identical from `ApplicationService` onward. That is the design.

```
assistant ─▶ governance ─▶ plan ─▶ preview ─▶ HUMAN CONFIRM ─▶ ApplicationService ─▶ (as above)
```

**C. Read / question**

```
UI or assistant ─▶ search index + read models ─▶ DTO (money as string) ─▶ render
                              ▲
                   never the write model for analytics
```

---

## 12. Service boundaries, and the extraction path

Boundaries are **logical now, physical later, and never accidental.**

```
   allowed:   module ──▶ its own service ──▶ its own repository
   allowed:   module ──▶ ANOTHER module's Application Service (public port)
   allowed:   any module ──▶ platform/* ports
   FORBIDDEN: module ──▶ another module's repository       (reaching into the DB)
   FORBIDDEN: module ──▶ another module's Prisma models     (shared mutable state)
   FORBIDDEN: domain  ──▶ anything outward
   FORBIDDEN: ai/*    ──▶ any repository directly           (must go via capability)
```

Enforced by `dependency-cruiser` in CI. The forbidden edges are the entire value of the boundary.

**If this ever needs to scale out** — a second office, a hosted multi-tenant edition — the seams are
already cut, in this order of least pain:

1. **Extract the job worker** into its own process (it already claims work with `SKIP LOCKED` and an
   advisory lock; nothing changes but the `main`).
2. **Extract the AI platform** into its own service (it already talks to the business layer through a
   registry of typed capabilities — that registry becomes an RPC contract, unchanged).
3. **Replace the outbox dispatcher** with a broker (the outbox table becomes the broker's source).
4. Only then consider splitting bounded contexts into services, one at a time, along the context map
   in §3.2 — and note that Sales/Delivery/Cash share a transaction today and would need sagas.

Steps 1 and 2 are cheap because the boundary was designed. Step 4 is expensive because the domain
genuinely is coupled — and pretending otherwise on day one would have bought nothing and cost a great
deal.

---

## 13. Scalability and maintainability — an honest accounting

**What this design makes fast**
Reads scale with read models, not history. Writes are one aggregate, one transaction. The AI's
expensive path is guarded by a free deterministic path. Search and analytics never touch the write
model. Nothing polls the database in a loop except one 5-second job tick.

**What it deliberately does not do**
It does not shard, replicate, or distribute. At the stated deployment (§0) those are costs with no
benefit.

**Where it will hurt first, and the answer**

| Pressure | First symptom | Response |
|---|---|---|
| Ledger grows to years | Reports slow | Already answered: matviews + snapshots |
| Many AI users | Provider cost, not CPU | Per-user quota + pre-router + caching of embeddings |
| Documents grow | Disk, not latency | Storage port already abstracted |
| Second office | Everything | Extraction path §12, in order |
| Team grows | Merge conflicts, drift | The dependency rule in CI is the answer, and it only works if it is enforced from day one |

**Maintainability is a mechanical property, not a moral one.** It comes from: one shape per module,
one door into the domain, one event mechanism, one search index, one money type, one result union —
and a linter that fails the build when someone draws a new arrow.

---

## 14. Decision log

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| 1 | Modular monolith | Microservices | 1–10 users on one Windows box; distribution buys nothing and costs an installer |
| 2 | Postgres as queue/search/vector/analytics | Redis + Elasticsearch + broker | Each is another Windows service to install, repair, and version-gate |
| 3 | LLM proposes a Plan; program executes | Direct function-calling with DB access | The blast radius of prompt injection must be bounded by a reviewed allow-list |
| 4 | Deterministic pre-router before the LLM | Always call the model | Zero-cost, zero-latency, works offline, and most traffic is trivial |
| 5 | Transactional outbox | Publish-after-commit | Dual writes lose events; the outbox makes publication atomic with the write |
| 6 | SSE for push | WebSocket | Traffic is one-directional; SSE reconnects itself and needs no new protocol |
| 7 | trigram + normalized `simple` FTS | `to_tsvector('arabic')` | Postgres has no Arabic stemmer. Pretending otherwise silently ruins recall |
| 8 | Snapshot facts for time series | Recompute from history | "What did we believe last March" is not recomputable |
| 9 | Every recommendation cites evidence | Score-only ranking | In a financial tool, an unexplained number is either blindly trusted or ignored |
| 10 | Single LLM gateway (OpenRouter) | Per-provider adapters | OpenRouter *is* that abstraction; re-implementing it was the prior mistake |
| 11 | Domain keeps `Customer`/`ProjectCost` | Rename to Client/Expense | One canonical vocabulary; synonyms live in the AI's alias table only |
| 12 | Template lines snapshotted into contracts | Reference by id | A later price edit must never restate a signed contract |

---

## 15. Deliberately deferred

Named so they are choices, not oversights: multi-tenancy; horizontal scale; a broker; streaming
partial tool execution; autonomous (unconfirmed) AI writes — **permanently rejected**, not deferred;
fine-tuning (retrieval solves the actual problem); a second locale (the search normalizer is
Arabic-specific and would need a strategy per script).

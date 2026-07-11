# Contractor Plus — Database Design

**Status:** Design. No migrations. No `schema.prisma` edits.
**Continues:** `docs/ARCHITECTURE.md` (approved). Section references below (§n) point there.
**Target:** PostgreSQL 16+, single local instance, one Windows machine, 1–10 concurrent humans.

Index notation in this document (`ix_… (cols) WHERE …`) is *design notation*, not DDL. Nothing here is
executable, by instruction.

---

## 0. Deltas from the approved architecture

The architecture is the contract; these are the places where designing the actual tables exposed
something the architecture either got wrong, left implicit, or where the live schema already
disagrees with it. Each is a decision to accept or reject before any migration is written.

| # | Delta | Why it matters |
|---|---|---|
| **D1** | §10.3's `to_tsvector('simple', unaccent(normalize(text)))` **will not compile** in a generated column or index expression | `unaccent()` is `STABLE`, not `IMMUTABLE` (it reads a dictionary). Postgres refuses `STABLE` functions in index expressions and generated columns. Also `normalize()` is a **built-in** since PG13 (Unicode NFC/NFD) — the name collides. Fix: one `IMMUTABLE` wrapper, `ar_normalize(text)`, that folds أ/إ/آ→ا, ة→ه, ى→ي, strips diacritics and tatweel, and inlines the unaccent call. Index and query must call the *same* function or recall silently drops |
| **D2** | §8 specifies `ivfflat` for pgvector. Use **HNSW** instead | `ivfflat` builds its lists from the rows present *at build time*. Built on an empty table — which is exactly what a fresh install has, with embeddings backfilled later by a job — recall collapses and never recovers without a manual `REINDEX`. HNSW needs no training. Below ~10k embeddings, build **no index at all**: a sequential scan over a few thousand vectors is faster than either |
| **D3** | Money is `Decimal(14,2)` in the live schema; §7 mandates `NUMERIC(18,4)` | Real change to every money column. Also: Prisma's bare `DateTime` maps to `timestamp(3) **without** time zone`, not `timestamptz`. And business dates (`payments.dueDate`, `project_costs.date`, `projects.startDate`) are days, not instants — storing them as timestamps produces off-by-one-day bugs at midnight boundaries |
| **D4** | §3.3 states the invariant `paidAmount ≤ scheduledAmount`. The `payments` table has **one** `amount` column | The invariant is unrepresentable. Partial payments — universal in construction — cannot be recorded. Split into `scheduled_amount` + `paid_amount` |
| **D5** | Five new tables, none in §7's census: `units_of_measure`, `suppliers`, `supplier_materials`, `material_price_history`, `overhead_expenses` | Suppliers and price history are the substrate §10.5 tier-1 assumes ("Cement is 14% above your 12-month average") — that sentence is not computable against the current schema. `units_of_measure` kills a free-text `unit` column duplicated across four tables. `overhead_expenses` is **flagged optional** — see §8.2 |
| **D6** | `contracts.contract_number` is `@unique`, unconditionally | A soft-deleted contract squats its number forever. Must be `UNIQUE … WHERE deleted_at IS NULL` |
| **D7** | Every soft-deleted table carries `@@index([deletedAt])` | Near-useless: the column is `NULL` for ~100% of rows, so the index is one giant equal key and the planner ignores it. Replace with **partial** indexes `WHERE deleted_at IS NULL` on the columns actually filtered |
| **D8** | All PKs are random UUIDv4 | Fine for business entities (stable, in URLs). Wrong for append-only high-volume tables (`audit_logs`, `outbox_events`, `ai_messages`, `search_documents`, `material_price_history`, `fact_project_daily`): random keys scatter B-tree inserts across pages, causing page splits and WAL amplification on the hottest write paths. Use `bigint GENERATED ALWAYS AS IDENTITY` — these ids are internal and single-tenant, so there is no enumeration concern |
| **D9** | `AuditAction` is `{CREATE, UPDATE, DELETE}` | Cannot express the events §5.1 promises to audit. Extend: `APPROVE, REJECT, EXECUTE, LOGIN, LOGOUT, EXPORT` |
| **D10** | §10.3's search index has no deletion story | The projector must **delete** the `search_documents` row on soft-delete, or the assistant resolves "الفيلا" to a deleted project and the executor writes to it. Entity resolution over a stale index is a correctness bug, not a UX one |

Everything below assumes D1–D10 are accepted. D5's `overhead_expenses` is the only one you can drop
without touching another table.

---

## 1. Conventions

These are applied uniformly. Where a table deviates, the deviation is stated and justified.

### 1.1 Identity

| Class | PK type | Rationale |
|---|---|---|
| Business entities (customer, contract, project, material, user, …) | `uuid` `DEFAULT gen_random_uuid()` | Stable, opaque, safe in URLs and DOCX placeholders, generatable client-side |
| Append-only internal (audit, outbox, ai_messages, price history, search, facts) | `bigint GENERATED ALWAYS AS IDENTITY` | Insert locality (D8). Also gives a free total order — `outbox_events.id` **is** the causal sequence |
| Singletons (`company_profile`, `tunnel_state`) | `text` PK pinned to `'default'` | Row count is an invariant, enforced by a `CHECK (id = 'default')` |
| Junctions (`role_permissions`, `supplier_materials`) | Composite natural PK | A surrogate id on a pure junction buys nothing and permits duplicates |

`ON UPDATE NO ACTION` everywhere: primary keys are immutable by policy.

### 1.2 Types

| Concept | Type | Notes |
|---|---|---|
| Money | `numeric(18,4)` | §7. Never `float`. `Prisma.Decimal` in code, fixed-precision **string** over the wire (§6) |
| Quantity | `numeric(18,6)` | Widened from `(14,3)`: waste factors and template ratios need >3dp before rounding |
| Percentage / ratio | `numeric(6,3)` | `-999.999 … 999.999`. Signed: profit margin can be negative |
| LLM cost | `numeric(12,6)` | Per-turn costs are fractions of a cent; `(18,4)` truncates them to zero |
| Instant | `timestamptz(3)` | D3. Millisecond precision matches Prisma's default |
| Business day | `date` | D3. `due_date`, `cost.date`, `start_date`, `delivery_date`, `snapshot_date` |
| Free text | `text` | Never `varchar(n)` — no performance difference in Postgres, and a length change becomes a migration |
| Structured blob | `jsonb` | Only where the shape is genuinely open (audit diffs, plan payloads, job args) |
| Vector | `vector(1024)` | pgvector |

### 1.3 Soft delete, and what it does to foreign keys

Business tables carry `deleted_at timestamptz NULL`. Rows are **never** physically deleted in normal
operation. This has a consequence that most schema reviews miss:

> **Cascade rules almost never fire.** They are not the deletion mechanism. They are a backstop that
> turns a bug into a loud error instead of a silent orphan.

The real deletion mechanism is the domain's delete-guard (§3.3, "referential dignity"). The FK action
is chosen to describe *what would be correct if a physical delete ever happened* — during a data
repair, a test teardown, or a GDPR-style purge. Choosing `CASCADE` where `RESTRICT` belongs means a
future `DELETE FROM customers WHERE …` in a psql session silently destroys a signed contract.

### 1.4 Cascade taxonomy

Four classes. Every FK in this document is labelled with one.

| Class | Action | Meaning | Example |
|---|---|---|---|
| **C1 — Composition** | `ON DELETE CASCADE` | The child has no identity outside the parent. It is part of the aggregate root | `contract_items` → `contracts` |
| **C2 — Reference** | `ON DELETE RESTRICT` | The child is a ledger fact; the parent is a catalog entry. History outranks convenience | `contract_items` → `materials` |
| **C3 — Attribution** | `ON DELETE SET NULL` | The reference is *who/what caused this*, and losing it must not destroy the fact | `audit_logs.user_id` → `users` |
| **C4 — Guarded** | `ON DELETE RESTRICT` | Same action as C2, different reason: the domain already refuses the delete. The FK exists so a raw SQL mistake fails loudly | `contracts` → `customers` |

C3 is used sparingly. An attribution that may become `NULL` cannot be `NOT NULL`, which weakens the
audit story — so it is reserved for cases where the fact genuinely outlives the actor.

### 1.5 Naming

`snake_case`, tables plural, junctions `<a>_<b>`, indexes `ix_<table>_<purpose>`, uniques
`uq_<table>_<cols>`, checks `ck_<table>_<rule>`, FKs `fk_<table>_<target>`. Enum types PascalCase,
values SCREAMING_SNAKE. Prisma `@map`/`@@map` bridges to camelCase in code.

### 1.6 Extensions

`pgcrypto` (or PG13+ builtin `gen_random_uuid`), `pg_trgm`, `unaccent`, `vector`. All ship with a
standard Postgres distribution and start no new process — which per §0 is the entire reason they were
chosen over Elasticsearch and a vector database.

### 1.7 Enum vs lookup table

Enums for **closed** sets whose members are load-bearing in code (`ContractStatus` — the domain has a
transition graph over it). Lookup tables for **open** sets the user may extend (`units_of_measure`).
`CostCategory` is a judgment call: it has five stable members today, and the roadmap wants template
categories. It stays an enum; if users ever need custom cost categories it becomes a lookup table, and
that migration is mechanical because nothing branches on individual members.

The cost of an enum is asymmetric: `ALTER TYPE … ADD VALUE` is cheap, *removing* a value requires
rewriting the type. So enums are for sets that grow, never for sets that churn.

---

## 2. Census — 46 tables, 4 materialized views

Grouped by the bounded contexts of §3.2. `NEW` = does not exist today.

| Context | Tables |
|---|---|
| **Identity & Access** | `roles`, `permissions`, `role_permissions`, `users`, `refresh_tokens` |
| **Catalog & Procurement** | `units_of_measure` ᴺ, `materials`, `suppliers` ᴺ, `supplier_materials` ᴺ, `material_price_history` ᴺ |
| **Templates** | `building_templates`, `building_template_items`, `building_template_steps`, `document_templates`, `generated_documents` |
| **Sales & Contracting** | `customers`, `contracts`, `contract_items`, `change_orders` |
| **Delivery** | `projects`, `construction_steps` |
| **Cost** | `project_costs`, `overhead_expenses` ᴺ⁽ᵒᵖᵗ⁾ |
| **Cash** | `payments` |
| **Platform mechanics** | `outbox_events` ᴺ, `jobs` ᴺ, `job_schedules` ᴺ, `job_dead_letters` ᴺ, `notifications` ᴺ |
| **Read models** | `search_documents` ᴺ, `embeddings` ᴺ, `fact_project_daily` ᴺ + `mv_cash_flow_monthly` ᴺ, `mv_project_profitability` ᴺ, `mv_material_price_baseline` ᴺ, `mv_supplier_performance` ᴺ |
| **Intelligence** | `ai_sessions` ᴺ, `ai_messages` ᴺ, `ai_plans` ᴺ, `ai_executions` ᴺ, `ai_tool_invocations` ᴺ, `ai_usage_counters` ᴺ, `recommendations` ᴺ, `recommendation_evidence` ᴺ, `ai_reports` ᴺ |
| **Platform config** | `system_settings`, `currencies`, `company_profile`, `tunnel_state`, `audit_logs` |

Mapping to the seventeen entities you named:

| You asked for | Tables |
|---|---|
| Projects | `projects`, `construction_steps` |
| Clients | `customers` *(decision #11 — the domain term stays `Customer`; "client" is a UI/AI synonym, never a table)* |
| Contracts | `contracts`, `contract_items`, `change_orders` |
| Templates | `building_templates` (+items, +steps), `document_templates`, `generated_documents` |
| Materials | `materials`, `units_of_measure` |
| Suppliers | `suppliers`, `supplier_materials` |
| Expenses | `project_costs` *(decision #11)*, `overhead_expenses` *(optional, §8.2)* |
| Payments | `payments` |
| Users | `users`, `refresh_tokens` |
| Permissions | `roles`, `permissions`, `role_permissions` |
| AI Logs | `ai_executions`, `ai_tool_invocations`, `ai_sessions`, `ai_messages`, `ai_plans` |
| AI Recommendations | `recommendations`, `recommendation_evidence` |
| AI Reports | `ai_reports` |
| Price History | `material_price_history` |
| Notifications | `notifications` |
| Automation Jobs | `jobs`, `job_schedules`, `job_dead_letters`, `outbox_events` |
| Audit Logs | `audit_logs` |

---

## 3. Identity & Access

Upstream of every other context (§3.2). Shared Kernel: the `Principal`.

### 3.1 `roles`

**Purpose.** A named bundle of permissions. System roles (`OWNER`, `ADMIN`, …) ship with the product;
custom roles are user-created. `OWNER` can never lose effective full access.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | |
| `name` | `text` | no | | Canonical key. System names match `@contractor-plus/shared` `RoleName` |
| `display_name` | `text` | yes | | Arabic label |
| `description` | `text` | yes | | |
| `sort_order` | `int` | no | `0` | UI ordering |
| `is_system` | `boolean` | no | `true` | Shipped, not user-created |
| `is_protected` | `boolean` | no | `false` | Undeletable |
| `is_active` | `boolean` | no | `true` | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | `now()` | |

**Constraints.** `PK (id)` · `uq_roles_name (name)` · `ck_roles_system_protected CHECK (NOT is_system OR is_protected)` — a system role that can be deleted is a support call waiting to happen.

**Indexes.** The unique on `name` is the only one needed. Fewer than 20 rows; the planner will seq-scan and be right to.

**Relationships.** `users.role_id` → **C4** (a role with users cannot be dropped). `role_permissions.role_id` → **C1**.

**Performance.** Read on every request via the auth plugin. Cache in-process with an invalidation hook on write; at ≤20 rows the cache exists to avoid a round trip, not to avoid a scan. §5.2's *live-role re-check* means a revoked role must not survive a cached JWT — so the cache key is the role id and the eviction is on `roles`/`role_permissions` write, never TTL-only.

**Scalability.** None required. This table does not grow with tenure.

---

### 3.2 `permissions`

**Purpose.** The static capability catalog — `~60` keys today, e.g. `contracts.approve`. Never
generated at runtime; seeded from `rbac.catalog.ts` so code and database cannot drift.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | |
| `key` | `text` | no | | `<module>.<action>` |
| `module` | `text` | no | | Derived from `key`, stored for grouping |
| `action` | `text` | no | | |
| `display_name` | `text` | no | | |
| `description` | `text` | yes | | |
| `sort_order` | `int` | no | `0` | |
| `is_system` | `boolean` | no | `true` | |
| `is_active` | `boolean` | no | `true` | Soft-retire a key without breaking `role_permissions` FKs |
| `created_at` / `updated_at` | `timestamptz(3)` | no | `now()` | |

**Constraints.** `PK (id)` · `uq_permissions_key (key)` · `ck_permissions_key_shape CHECK (key = module || '.' || action)` — makes the denormalization self-enforcing.

**Indexes.** `ix_permissions_module (module, sort_order)` for the role-editor UI.

**Relationships.** `role_permissions.permission_id` → **C1**.

**New keys this design requires.** `suppliers.*`, `price_history.read`, `notifications.read`, `jobs.read`/`jobs.retry`, `recommendations.read`/`recommendations.dismiss`, `ai.chat`/`ai.execute`/`ai.reports.generate`. Each new tool in the Capability Registry (§5.4) must name a permission that exists here, checked in CI — an AI tool referencing a non-existent permission key would otherwise fail **open** in any code path that treats "no permission required" as "allowed".

**Performance / scalability.** Static. Seeded on boot, idempotently.

---

### 3.3 `role_permissions`

**Purpose.** Grant-only junction. There are no deny rules: `OWNER` is a super-admin short-circuit in code, and every other role is the union of its grants. Deny semantics in an RBAC table produce precedence questions nobody can answer at 2am.

| Column | Type | Null | Notes |
|---|---|---|---|
| `role_id` | `uuid` | no | |
| `permission_id` | `uuid` | no | |
| `granted_at` | `timestamptz(3)` | no | `now()` |
| `granted_by` | `uuid` | yes | → `users.id`, **C3** |

**Constraints.** `PK (role_id, permission_id)` — composite natural key (§1.1); no surrogate id, which structurally prevents duplicate grants.

**Indexes.** PK covers `role_id`-leading lookups (the hot path: "what may this role do"). Add `ix_role_permissions_permission (permission_id)` for the reverse question ("who can approve contracts?") and because Postgres does **not** index the referencing side of an FK automatically — without it, deleting a permission triggers a seq scan.

**Cascade.** `role_id` → **C1 CASCADE**. `permission_id` → **C1 CASCADE**. Both are compositional: a grant has no meaning without either end.

**Performance.** Loaded once per session into the `Principal`. ≤ (roles × permissions) ≈ 1,200 rows at the ceiling.

---

### 3.4 `users`

**Purpose.** A human operator. Login identity, role assignment, audit attribution.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | |
| `username` | `text` | no | | Login identifier, lowercase-normalized on write |
| `email` | `text` | yes | | Contact only. NULLs distinct → many users may have none |
| `password_hash` | `text` | no | | argon2id |
| `full_name` | `text` | no | | |
| `phone` | `text` | yes | | |
| `is_active` | `boolean` | no | `true` | |
| `last_login_at` | `timestamptz(3)` | yes | | |
| `failed_login_attempts` | `int` | no | `0` | *Optional* — pairs with the existing `/auth` rate limit |
| `locked_until` | `timestamptz(3)` | yes | | *Optional* — lockout survives a service restart; an in-memory counter does not |
| `must_change_password` | `boolean` | no | `false` | *Optional* — for admin-provisioned accounts |
| `role_id` | `uuid` | no | | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | `now()` | |
| `deleted_at` | `timestamptz(3)` | yes | | Soft delete |

**Constraints.**
- `PK (id)`
- `uq_users_username (username) WHERE deleted_at IS NULL` — **partial** (D6's rule, applied here too): a deleted user must not squat a username forever.
- `uq_users_email (email) WHERE deleted_at IS NULL AND email IS NOT NULL`
- `ck_users_username_lower CHECK (username = lower(username))` — normalization enforced by the database, not by remembering to call `.toLowerCase()` at four call sites.
- `ck_users_failed_attempts CHECK (failed_login_attempts >= 0)`

**Indexes.**
- `ix_users_role (role_id)` — FK referencing side.
- `ix_users_active (role_id) WHERE is_active AND deleted_at IS NULL` — the user-list screen.
- **Dropped:** `@@index([deletedAt])`, `@@index([isActive])` (D7). Both are two-value columns over a table of tens of rows; neither will ever be chosen by the planner.

**Relationships & cascade.**
| FK | Target | Class | Why |
|---|---|---|---|
| `role_id` | `roles` | **C4 RESTRICT** | Domain refuses deleting a role in use |
| ← `refresh_tokens.user_id` | | **C1 CASCADE** | Sessions die with the user |
| ← `audit_logs.user_id` | | **C3 SET NULL** | The audit fact outlives the actor |
| ← `ai_executions.user_id` | | **C2 RESTRICT** | §5.1 invariant 4: every AI turn is *attributable*. `SET NULL` would silently break the promise. A user with AI history is soft-deleted, never purged |
| ← `generated_documents.generated_by` | | **C3 SET NULL** | |
| ← `document_templates.created_by` | | **C3 SET NULL** | |
| ← `notifications.user_id` | | **C1 CASCADE** | A notification for nobody is garbage |

Note the deliberate split between `audit_logs` (**C3**) and `ai_executions` (**C2**). The audit log
records *what happened to the data*; it remains meaningful with an anonymous actor. An AI execution
record exists precisely to answer *who let the model do this*, and is worthless without the actor.
The existing migration `20260708130000_ai_audit_userid_not_null` had already reached this conclusion;
this design keeps it and explains it.

**Performance.** Tens of rows, forever. Every index here is about correctness of constraint, not speed.

**Scalability.** The one growth axis is `refresh_tokens` (below). If this product ever becomes
multi-tenant (§15, deferred), `users` gains a `tenant_id` and every partial unique becomes
`(tenant_id, username) WHERE deleted_at IS NULL`. That is the *only* change needed here, which is a
sign the table is shaped right.

---

### 3.5 `refresh_tokens`

**Purpose.** Durable half of the auth pair. Per the security hardening already in place, the refresh
token lives in an `HttpOnly` cookie with CSRF double-submit; only its **hash** is stored.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | no | |
| `user_id` | `uuid` | no | |
| `token_hash` | `text` | no | SHA-256 of the opaque token. The plaintext never touches the database |
| `expires_at` | `timestamptz(3)` | no | |
| `revoked_at` | `timestamptz(3)` | yes | |
| `replaced_by_id` | `uuid` | yes | *Added* — rotation chain, → `refresh_tokens.id`, **C3** |
| `created_by_ip` / `revoked_by_ip` | `inet` | yes | `inet`, not `text` — free validation |
| `user_agent` | `text` | yes | |
| `created_at` | `timestamptz(3)` | no | |

**Constraints.** `PK (id)` · `uq_refresh_tokens_hash (token_hash)` · `ck_refresh_tokens_expiry CHECK (expires_at > created_at)`.

**Indexes.**
- `ix_refresh_tokens_user_live (user_id) WHERE revoked_at IS NULL` — "log this user out everywhere".
- `ix_refresh_tokens_expired (expires_at) WHERE revoked_at IS NULL` — the reaper job's claim query.
- **Dropped:** the three plain single-column indexes on `user_id`, `expires_at`, `revoked_at`. The partial pair above answers every real query and costs a third of the writes.

**Cascade.** `user_id` → **C1 CASCADE**. `replaced_by_id` → **C3 SET NULL** (self-reference; a pruned ancestor must not delete its successor).

**Why `replaced_by_id`.** It makes refresh-token *reuse detection* possible: if a token that was
already replaced is presented, the chain has been stolen, and the correct response is to revoke the
entire chain. Without the link you can only revoke the one token the attacker already used.

**Performance.** The only table in this context with churn — one row per login, expired rows swept by
a job (§9.2). This is a delete-heavy table: set `fillfactor = 90` and a per-table aggressive
autovacuum so dead tuples do not accumulate between the daily sweep and the next.

**Scalability.** Bounded by `users × sessions × token_lifetime`. A nightly sweep job (§9.2) deletes rows with `expires_at < now() - interval '30 days'`, keeping it in the low thousands permanently.

---

## 4. Catalog & Procurement

Published Language (§3.2): templates and materials are copied **by value** into contracts and costs at
the moment of use. Nothing downstream references a catalog row for its *price*.

### 4.1 `units_of_measure` — NEW

**Purpose.** Kill the free-text `unit` column. Today `unit text` appears independently on `materials`,
`contract_items`, `project_costs`, and `building_template_items`. Nothing constrains them, so
`م٣`, `م3`, `متر مكعب`, and `m3` all coexist and no aggregate over quantity is trustworthy. This is a
straightforward 3NF violation: `unit` is an attribute of a *unit*, not of a line item.

| Column | Type | Null | Notes |
|---|---|---|---|
| `code` | `text` | no | PK. Immutable identity, e.g. `M3`, `M2`, `TON`, `BAG`, `PCS`, `HOUR`, `DAY` |
| `name_ar` | `text` | no | Display. Editable |
| `name_en` | `text` | yes | |
| `dimension` | `Dimension` | no | enum `{LENGTH, AREA, VOLUME, MASS, COUNT, TIME}` |
| `quantity_precision` | `smallint` | no | Decimal places the UI shows. `PCS`→0, `M3`→3 |
| `is_active` | `boolean` | no | `true` |
| `sort_order` | `int` | no | `0` |
| `created_at` / `updated_at` | `timestamptz(3)` | no | |

**Constraints.** `PK (code)` · `ck_uom_code_shape CHECK (code ~ '^[A-Z0-9_]{1,12}$')` · `ck_uom_precision CHECK (quantity_precision BETWEEN 0 AND 6)` · `ck_uom_count_precision CHECK (dimension <> 'COUNT' OR quantity_precision = 0)` — you cannot buy 2.5 pieces.

**Indexes.** PK only. Fewer than 40 rows.

**Relationships & cascade.** Referenced by `materials.unit_code`, `contract_items.unit_code`,
`project_costs.unit_code`, `building_template_items.unit_code`, `supplier_materials.unit_code`. **All C2 RESTRICT.**

**The snapshot question.** §3.2 says line items snapshot catalog values. Doesn't an FK to
`units_of_measure` violate that? No — and the distinction matters. What must never be restated is the
**price** and the **quantity**. The unit *code* is the line item's own identity for its number; it is
never rewritten because `code` is immutable by `CHECK` and by policy. Editing `name_ar` from
"متر مكعب" to "م٣" changes a label, not a fact. Prices are snapshotted; identities are referenced.
Conflating the two is how schemas end up with a `varchar` copy of everything.

**Performance.** Loaded once, cached forever, effectively a compile-time constant.

**Scalability.** Adding a unit is a seed row, not a migration — which is exactly why this is a table
and not the enum it superficially resembles (§1.7).

**Migration note (not written here).** Backfilling requires mapping existing free text to codes. That
mapping is *lossy and manual* — nobody can programmatically decide whether a legacy `"م"` meant metre
or hour. Expect a one-time reconciliation screen, and make `unit_code` nullable for exactly one
release while it runs.

---

### 4.2 `materials`

**Purpose.** The input catalog: what the contractor buys. Feeds templates, contract line items, and
cost capture. Its `default_price` is a *suggestion*, never a source of truth for any recorded number.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | |
| `name` | `text` | no | | |
| `sku` | `text` | yes | | *Added* — internal code, for import/export and supplier matching |
| `unit_code` | `text` | no | | → `units_of_measure` |
| `category` | `text` | yes | | Free grouping for now; a lookup table when the roadmap's "template categories" lands |
| `default_price` | `numeric(18,4)` | yes | | Advisory. Copied by value at use |
| `notes` | `text` | yes | | |
| `is_active` | `boolean` | no | `true` | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | `now()` | |
| `deleted_at` | `timestamptz(3)` | yes | | |

**Constraints.** `PK (id)` · `uq_materials_name (lower(name)) WHERE deleted_at IS NULL` — case-insensitive; two materials named "أسمنت" are a data-entry error, not a business fact · `uq_materials_sku (sku) WHERE deleted_at IS NULL AND sku IS NOT NULL` · `ck_materials_price_nonneg CHECK (default_price IS NULL OR default_price >= 0)`.

**Indexes.**
- `ix_materials_active (name) WHERE is_active AND deleted_at IS NULL` — the picker, sorted.
- `ix_materials_name_trgm` **GIN** on `ar_normalize(name) gin_trgm_ops` — fuzzy lookup in the picker and by the AI's entity resolver, sharing the §10.3 normalizer (D1).
- **Dropped:** `@@index([name])`, `@@index([isActive])`, `@@index([deletedAt])` (D7).

**Relationships & cascade.**
| FK | Class | Why |
|---|---|---|
| `unit_code` → `units_of_measure` | **C2** | |
| ← `contract_items.material_id` | **C2 RESTRICT** | A signed contract line outranks catalog hygiene |
| ← `project_costs.material_id` | **C2 RESTRICT** *(nullable)* | |
| ← `building_template_items.material_id` | **C2 RESTRICT** | |
| ← `supplier_materials.material_id` | **C1 CASCADE** | An offer is compositional with what is offered |
| ← `material_price_history.material_id` | **C2 RESTRICT** | Price history is the evidence behind a recommendation (§10.5). It must not evaporate |

**Performance.** Hundreds to low thousands of rows. The trigram GIN index is the only nontrivial one;
it is worth it because *three* consumers query it — the palette, global search, and the AI resolver —
and §10.3 insists they share one ranking.

**Scalability.** Flat. A contractor's catalog does not grow with tenure; it grows once, at adoption.

---

### 4.3 `suppliers` — NEW

**Purpose.** The counterparty of procurement, symmetric to `customers` in Sales. Required to answer
"who did we buy cement from, and at what price" — which is the precondition for §10.5 tier 1.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | |
| `name` | `text` | no | | |
| `contact_person` | `text` | yes | | |
| `phone` | `text` | yes | | |
| `email` | `text` | yes | | |
| `address` | `text` | yes | | |
| `tax_number` | `text` | yes | | |
| `payment_terms_days` | `smallint` | yes | | Net-N. Drives a future payables view |
| `rating` | `numeric(2,1)` | yes | | 0.0–5.0, human-entered |
| `notes` | `text` | yes | | |
| `is_active` | `boolean` | no | `true` | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | `now()` | |
| `deleted_at` | `timestamptz(3)` | yes | | |

**Constraints.** `PK (id)` · `uq_suppliers_name (lower(name)) WHERE deleted_at IS NULL` · `uq_suppliers_tax (tax_number) WHERE deleted_at IS NULL AND tax_number IS NOT NULL` · `ck_suppliers_rating CHECK (rating IS NULL OR rating BETWEEN 0 AND 5)` · `ck_suppliers_terms CHECK (payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 365)`.

**Indexes.** `ix_suppliers_active (name) WHERE is_active AND deleted_at IS NULL` · `ix_suppliers_name_trgm` GIN on `ar_normalize(name) gin_trgm_ops`.

**Relationships & cascade.**
| FK | Class | Why |
|---|---|---|
| ← `supplier_materials.supplier_id` | **C1 CASCADE** | Their price list dies with them |
| ← `material_price_history.supplier_id` *(nullable)* | **C3 SET NULL** | The observed price remains a true historical fact even if the supplier record is purged |
| ← `project_costs.supplier_id` *(nullable)* | **C2 RESTRICT** | A ledger row with a dangling vendor is an accounting problem |
| ← `overhead_expenses.supplier_id` *(nullable)* | **C2 RESTRICT** | |

The `SET NULL` on price history versus `RESTRICT` on costs is deliberate: history is *observational*
("cement cost 42 that day"), the cost row is *financial* ("we owe someone 42"). Only one of those is
still true without a counterparty.

**Performance / scalability.** Tens of rows. Mirrors `customers` exactly, which is the point — a
reviewer should be able to read one and predict the other.

---

### 4.4 `supplier_materials` — NEW

**Purpose.** The M:N between who sells and what is sold, carrying the **current** offer. Resolves the
many-to-many that would otherwise be encoded as a repeated `supplier_name` string on price rows.

| Column | Type | Null | Notes |
|---|---|---|---|
| `supplier_id` | `uuid` | no | |
| `material_id` | `uuid` | no | |
| `supplier_sku` | `text` | yes | Their code for it |
| `current_price` | `numeric(18,4)` | no | |
| `unit_code` | `text` | no | May differ from `materials.unit_code` (they sell by BAG, you cost by TON) |
| `conversion_to_material_unit` | `numeric(18,6)` | no | `1.0`. `material_qty = supplier_qty × conversion` |
| `min_order_quantity` | `numeric(18,6)` | yes | |
| `lead_time_days` | `smallint` | yes | |
| `price_valid_until` | `date` | yes | Quote expiry |
| `is_preferred` | `boolean` | no | `false` |
| `created_at` / `updated_at` | `timestamptz(3)` | no | |

**Constraints.**
- `PK (supplier_id, material_id)` — composite natural key. One current offer per pair, structurally.
- `uq_supplier_materials_preferred (material_id) WHERE is_preferred` — **partial unique**: at most one preferred supplier per material. Exactly the trick already used for `currencies.is_default`.
- `ck_sm_price_positive CHECK (current_price > 0)`
- `ck_sm_conversion_positive CHECK (conversion_to_material_unit > 0)`

**Indexes.** PK covers supplier-leading. `ix_supplier_materials_material (material_id, current_price)` — "cheapest supplier for cement" answered from the index alone, no heap fetch.

**Cascade.** `supplier_id` → **C1 CASCADE**. `material_id` → **C1 CASCADE**. Both compositional: an
offer is meaningless without either side. This is the one place a material delete cascades, and it is
safe precisely because the *history* lives in a different table that does not cascade.

**Why `conversion_to_material_unit`.** Without it, comparing two suppliers means comparing 12.50/bag
against 340/ton, and the comparison silently produces nonsense. Normalizing at write time — one number,
one place — is cheaper than remembering to normalize at every read site. It is the same argument as
`money.ts`.

**Performance.** `suppliers × materials` bounded by reality at a few thousand rows.

**Scalability.** When quotes need history (RFQ workflows), this table stays as the *current* projection
and gains a `supplier_quotes` sibling. The shape does not change.

---

### 4.5 `material_price_history` — NEW

**Purpose.** The append-only observation log of what materials actually cost, over time, from whom.
This is the single table that makes §10.5's tier-1 recommendation ("Cement is 14% above your 12-month
average") *computable*. It is a fact table, not an entity table.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `bigint` | no | Identity (D8) |
| `material_id` | `uuid` | no | |
| `supplier_id` | `uuid` | yes | Unknown for catalog edits |
| `unit_price` | `numeric(18,4)` | no | **Always normalized to `materials.unit_code`** |
| `quantity` | `numeric(18,6)` | yes | For volume-weighted averages |
| `observed_on` | `date` | no | Business day, not instant (D3) |
| `source` | `PriceSource` | no | enum `{CATALOG_EDIT, SUPPLIER_QUOTE, PURCHASE, IMPORT, AI_ESTIMATE}` |
| `source_cost_id` | `uuid` | yes | → `project_costs.id` when `source = PURCHASE` |
| `recorded_by` | `uuid` | yes | → `users.id` |
| `created_at` | `timestamptz(3)` | no | When we learned it (≠ `observed_on`) |

**Constraints.**
- `PK (id)`
- `ck_mph_price_positive CHECK (unit_price > 0)`
- `ck_mph_quantity_positive CHECK (quantity IS NULL OR quantity > 0)`
- `ck_mph_purchase_has_source CHECK (source <> 'PURCHASE' OR source_cost_id IS NOT NULL)` — a purchase observation that cannot cite its ledger row is not evidence.
- `uq_mph_purchase (source_cost_id) WHERE source_cost_id IS NOT NULL` — one observation per cost row; makes the projector idempotent, so a redelivered outbox event cannot double-count a purchase into the average.

**Indexes.**
- `ix_mph_material_time (material_id, observed_on DESC) INCLUDE (unit_price, quantity)` — the covering index for *every* baseline query. Rolling averages, drift detection, and the sparkline in the material drawer all read from the index without touching the heap.
- `ix_mph_supplier_time (supplier_id, observed_on DESC) WHERE supplier_id IS NOT NULL` — supplier performance.
- `ix_mph_observed_brin` **BRIN** on `observed_on` — append-only and naturally correlated with physical order, so BRIN gives range-scan pruning at ~0.1% the size of a B-tree. This is the right index type for exactly this table shape and the wrong one almost everywhere else in this schema.

**Relationships & cascade.**
| FK | Class | Why |
|---|---|---|
| `material_id` → `materials` | **C2 RESTRICT** | Evidence must survive catalog cleanup |
| `supplier_id` → `suppliers` | **C3 SET NULL** | The price was still that price |
| `source_cost_id` → `project_costs` | **C3 SET NULL** | Keep the observation, drop the citation |
| `recorded_by` → `users` | **C3 SET NULL** | |

**How rows arrive.** Never by direct write. The projector subscribes to the outbox (§10):
`ProjectCostRecorded` with a `material_id` → one `PURCHASE` row; `MaterialPriceChanged` → one
`CATALOG_EDIT` row; `SupplierMaterialPriceChanged` → one `SUPPLIER_QUOTE` row. Because the writer is a
single consumer with an idempotency key, the table needs no application-level dedupe.

**Rejected alternative: validity ranges.** A `tstzrange` + `EXCLUDE USING gist` design (one row per
price *period*, non-overlapping) is the textbook temporal-table answer, and it is wrong here. Prices
from different suppliers legitimately overlap in time; the question asked is never "what was *the*
price on date D" but "what did we *pay*, on average, over window W". An observation log answers the
second question directly and the first one by `ORDER BY observed_on DESC LIMIT 1`. The exclusion
constraint would forbid the very rows we need.

**Performance.** Highest insert rate of any business table — one row per cost line. Append-only, so no
bloat, no autovacuum pressure, and BRIN stays perfectly correlated. The covering index means the
12-month baseline for a material is a single index range scan.

**Scalability.** ~10k rows/year at a busy contractor; a decade is 100k. Partitioning is **not**
warranted and would not be until ~50M rows — a number this deployment will never approach (§0). The
honest response to growth here is the `mv_material_price_baseline` materialized view (§10.4), refreshed
nightly, so the dashboard reads a few hundred rows instead of a hundred thousand. Should this ever
become multi-tenant, `RANGE (observed_on)` monthly partitions with BRIN per partition is the path, and
nothing else in the table changes.

---

## 5. Templates & Documents

Two unrelated things share the word "template" in this product, and the schema should never let them
blur: a **BuildingTemplate** is an estimating recipe (materials + construction steps); a
**DocumentTemplate** is a `.docx` file with `{{placeholders}}`. They live in different bounded
contexts (Catalog vs Platform) and share no columns.

### 5.1 `building_templates`

**Purpose.** Turns tacit estimating knowledge into a reusable asset: "a two-storey villa needs roughly
this bill of materials and passes through these stages."

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | |
| `name` | `text` | no | | |
| `description` | `text` | yes | | |
| `version` | `int` | no | `1` | *Added* — see below |
| `parent_template_id` | `uuid` | yes | | *Added* — → `building_templates.id`, self-reference |
| `estimated_duration_days` | `int` | yes | | |
| `suggested_profit_margin` | `numeric(6,3)` | yes | | Percent, signed |
| `is_active` | `boolean` | no | `true` | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | `now()` | |
| `deleted_at` | `timestamptz(3)` | yes | | |

**Constraints.** `PK (id)` · `uq_building_templates_name_version (lower(name), version) WHERE deleted_at IS NULL` · `ck_bt_duration CHECK (estimated_duration_days IS NULL OR estimated_duration_days > 0)` · `ck_bt_version CHECK (version >= 1)` · `ck_bt_not_self_parent CHECK (parent_template_id <> id)`.

**Indexes.** `ix_building_templates_active (name) WHERE is_active AND deleted_at IS NULL` · `ix_building_templates_parent (parent_template_id) WHERE parent_template_id IS NOT NULL`.

**Versioning — resolving §3.3's open question.** The architecture's aggregate table asks *"Immutable
once referenced? No — versioned. Snapshots protect history."* and leaves it there. Concretely:
editing a template that has already produced contracts creates **version N+1** as a new row with
`parent_template_id` pointing at N. Old contracts keep referencing N. `contracts.template_id` is
therefore a pointer to *the exact recipe used*, which is what makes "re-estimate this contract with
today's template" a meaningful, explicit action rather than an accident.

This is belt-and-braces: even without versioning, the line items are snapshotted (below), so no
contract total can be restated. Versioning protects the weaker property — *provenance*. Without it,
"which recipe produced this estimate" becomes unanswerable the first time someone edits a template.

**Relationships & cascade.**
| FK | Class | Why |
|---|---|---|
| `parent_template_id` → self | **C3 SET NULL** | Pruning an ancestor must not delete its descendants |
| ← `building_template_items` | **C1 CASCADE** | Aggregate children |
| ← `building_template_steps` | **C1 CASCADE** | Aggregate children |
| ← `contracts.template_id` *(nullable)* | **C3 SET NULL** | The contract's totals are snapshotted; losing the pointer costs provenance, not correctness. `RESTRICT` here would make templates undeletable forever, which users will not accept |

The `SET NULL` on `contracts.template_id` is the one place this design trades a little provenance for
a lot of usability, and it is safe **only because** of the snapshot rule. If line items ever became
references instead of copies, this must become `RESTRICT` the same day.

**Performance / scalability.** Tens of rows. Versioning multiplies by edit frequency; a
`WHERE is_active` partial index keeps the picker reading only the current generation.

---

### 5.2 `building_template_items`

**Purpose.** One line of the recipe: which material, how much, at what assumed price. `quantity_formula`
is evaluated against project parameters (area, floors) at estimate time.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | no | |
| `template_id` | `uuid` | no | |
| `material_id` | `uuid` | no | |
| `unit_code` | `text` | no | *Added* — snapshot of the material's unit at authoring time |
| `quantity_formula` | `text` | no | e.g. `area * floors * 0.12` |
| `estimated_quantity` | `numeric(18,6)` | no | Formula evaluated at a reference size; a sanity value |
| `estimated_price` | `numeric(18,4)` | no | Advisory unit price |
| `waste_factor` | `numeric(6,3)` | no | *Added*, default `0`. Percent |
| `sort_order` | `int` | no | *Added*, default `0` |
| `notes` | `text` | yes | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | |

**Constraints.** `PK (id)` · `uq_bti_template_material (template_id, material_id)` — a recipe naming the same material twice is an authoring bug · `ck_bti_qty CHECK (estimated_quantity > 0)` · `ck_bti_price CHECK (estimated_price >= 0)` · `ck_bti_waste CHECK (waste_factor >= 0 AND waste_factor < 100)`.

**Indexes.** `ix_bti_template (template_id, sort_order)` — always fetched as an ordered set. `ix_bti_material (material_id)` — FK referencing side, and answers "which templates use cement".

**Cascade.** `template_id` → **C1 CASCADE**. `material_id` → **C2 RESTRICT**. `unit_code` → **C2 RESTRICT**.

**Why `waste_factor` is a column and not baked into `estimated_quantity`.** §5.1 invariant 3: *the
model never emits money or quantities; it may emit ratios, and the backend applies waste as its own
line*. A separate factor is what lets the estimator show "100 m³ + 5% waste = 105 m³" instead of an
unexplainable 105. Explainability is a schema property here, not a UI one.

**`quantity_formula` is `text`, and that is a real risk.** It is a user-authored expression evaluated
server-side. It must be parsed by a whitelisted arithmetic evaluator over a fixed variable set
(`area`, `floors`, `perimeter`, …) — never `eval`, never a template string interpolated into SQL. The
database cannot enforce this; the constraint lives in the Application ring. Named here because a
schema document is where the next reader will look for it.

**Performance / scalability.** Dozens of rows per template. Trivial.

---

### 5.3 `building_template_steps`

**Purpose.** The construction stages a project built from this template will pass through, with the
percentage of total progress each represents. Copied into `construction_steps` when a project is born.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | no | |
| `template_id` | `uuid` | no | |
| `name` | `text` | no | |
| `percentage` | `numeric(6,3)` | no | Share of total progress |
| `sort_order` | `int` | no | |
| `estimated_days` | `int` | yes | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | |

**Constraints.** `PK (id)` · `uq_bts_template_sort (template_id, sort_order)` · `ck_bts_pct CHECK (percentage > 0 AND percentage <= 100)` · `ck_bts_days CHECK (estimated_days IS NULL OR estimated_days > 0)`.

**The constraint the database cannot express.** `SUM(percentage) = 100` per template is a *row-set*
invariant. Postgres offers no multi-row `CHECK`. Three options, in descending order of sanity:

1. **Enforce in the aggregate** (`BuildingTemplate` is the root; §3.3 says one use case mutates one aggregate, so every write already passes through code that can total the steps). **Chosen.**
2. A `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` checking the sum at commit. Correct, but puts business logic in PL/pgSQL where no test suite looks.
3. A `total_percentage` column on the parent with a trigger. Denormalization plus a trigger — the worst of both.

Naming this explicitly matters: a reviewer who sees no `SUM = 100` constraint should be able to tell
whether it was forgotten or placed deliberately.

**Indexes.** The unique on `(template_id, sort_order)` is the access path. Nothing else.

**Cascade.** `template_id` → **C1 CASCADE**.

**Performance / scalability.** Under 20 rows per template.

---

### 5.4 `document_templates`

**Purpose.** An uploaded `.docx` whose `{{placeholders}}` the renderer fills. Files live under
`<storage-root>/private/templates/<uuid>.docx`; **binary blobs are never stored in the database.**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | |
| `name` | `text` | no | | |
| `slug` | `text` | no | | Stable key used by the generator |
| `category` | `DocumentCategory` | no | | `{CONTRACT, QUOTATION, INVOICE, REPORT}` |
| `description` | `text` | yes | | |
| `file_path` | `text` | no | | Relative, inside the private tree |
| `file_hash` | `text` | yes | | *Added* — SHA-256; detects on-disk tampering or a lost file |
| `mime_type` | `text` | no | | |
| `size_bytes` | `int` | yes | | *Added* |
| `is_active` | `boolean` | no | `true` | |
| `is_default` | `boolean` | no | `false` | |
| `placeholders_json` | `jsonb` | yes | | Cache of extracted tokens; informational only |
| `created_by` | `uuid` | yes | | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | `now()` | |
| `deleted_at` | `timestamptz(3)` | yes | | |

**Constraints.**
- `PK (id)` · `uq_document_templates_slug (slug) WHERE deleted_at IS NULL`
- `uq_document_templates_default (category) WHERE is_default AND deleted_at IS NULL` — **partial unique**: at most one default *per category*. The live schema has a plain `@@index([isDefault])` and enforces this nowhere, so two default contract templates are currently representable.
- `ck_dt_path_private CHECK (file_path NOT LIKE '%..%' AND file_path NOT LIKE '/%')` — a cheap path-traversal backstop at the storage boundary.

**Indexes.** `ix_document_templates_pick (category, name) WHERE is_active AND deleted_at IS NULL`. Replaces four single-column indexes (D7).

**Cascade.** `created_by` → **C3 SET NULL**. ← `generated_documents.template_id` → **C2 RESTRICT** (a rendered artefact must be able to name the template that produced it).

**Performance / scalability.** A handful of rows. `placeholders_json` is a cache and is explicitly
allowed to be stale — the renderer re-reads tokens from the file each run, which is the correct
trade: a stale cache costs a wrong hint in the UI, a stale render costs a wrong contract.

---

### 5.5 `generated_documents`

**Purpose.** One immutable row per render. No soft delete — a generated contract that "never existed"
is a compliance problem.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | no | Exposed in download URLs |
| `template_id` | `uuid` | no | |
| `contract_id` | `uuid` | yes | |
| `project_id` | `uuid` | yes | |
| `customer_id` | `uuid` | yes | |
| `ai_report_id` | `uuid` | yes | *Added* — → `ai_reports.id`, when a report was rendered to DOCX |
| `filename` | `text` | no | Human-facing |
| `file_path` | `text` | no | |
| `file_hash` | `text` | yes | *Added* |
| `mime_type` | `text` | no | |
| `size_bytes` | `int` | no | |
| `generated_by` | `uuid` | yes | |
| `created_at` | `timestamptz(3)` | no | |

**Constraints.**
- `PK (id)`
- `ck_gd_has_subject CHECK (num_nonnulls(contract_id, project_id, customer_id, ai_report_id) >= 1)` — a document generated *about nothing* is unreachable in every UI that lists it. The live schema permits it.
- `ck_gd_size CHECK (size_bytes > 0)`

**Indexes.** `ix_gd_contract (contract_id, created_at DESC) WHERE contract_id IS NOT NULL`, and the same shape for `project_id`, `customer_id`. Each is the "documents" tab of one entity, newest first — a partial index avoids storing a row three times over for the two NULL columns. `ix_gd_created (created_at DESC)` for the global list.

**Cascade.**
| FK | Class | Why |
|---|---|---|
| `template_id` | **C2 RESTRICT** | |
| `contract_id` / `project_id` / `customer_id` | **C3 SET NULL** | The PDF on disk still exists; orphaning it is better than deleting the record of it. And `CASCADE` here would mean "purging a customer silently destroys their signed contract PDF" |
| `ai_report_id` | **C3 SET NULL** | |
| `generated_by` | **C3 SET NULL** | |

**Performance.** Append-only, one row per render, low rate.

**Scalability.** Grows with tenure but slowly. The pressure is **disk, not latency** (§13) — the
storage port is already abstracted. A retention job archives files older than N years and nulls
`file_path` while keeping the row, so history stays queryable after the bytes are gone. That is why
`file_path` should be nullable in a future revision; today it is `NOT NULL` and that is a
one-column migration when the time comes.

---

## 6. Sales & Contracting

The source of truth for money owed. Upstream of Delivery and Cash.

### 6.1 `customers`

**Purpose.** The counterparty of every contract. *This is the "Clients" table.* Decision #11 keeps the
domain term `Customer`; "client" / "عميل" are synonyms and live **only** in the AI Capability
Registry's alias list. A second vocabulary in the schema is how a codebase gets two of everything.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | |
| `name` | `text` | no | | |
| `phone` | `text` | yes | | |
| `email` | `text` | yes | | |
| `address` | `text` | yes | | |
| `tax_number` | `text` | yes | | *Added* — symmetry with `suppliers`; invoices need it |
| `notes` | `text` | yes | | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | `now()` | |
| `deleted_at` | `timestamptz(3)` | yes | | |

**Constraints.** `PK (id)` · `uq_customers_tax (tax_number) WHERE deleted_at IS NULL AND tax_number IS NOT NULL`.

Deliberately **no** unique on `name`: two different people are genuinely called "محمد علي", and a
uniqueness error on a customer name is the kind of constraint that teaches users to type "محمد علي 2".
Duplicate detection belongs in the UI as a *warning* backed by the trigram index, not in the database
as an error. Contrast `materials`, where a duplicate is always a mistake — the difference is whether
the name is an identity or a label.

**Indexes.**
- `ix_customers_name_trgm` GIN on `ar_normalize(name) gin_trgm_ops` — powers the picker, global search, duplicate warning, and the AI's entity resolver. One index, four consumers (§10.3).
- `ix_customers_phone (phone) WHERE deleted_at IS NULL AND phone IS NOT NULL` — phone is how a contractor actually looks someone up.
- `ix_customers_list (name) WHERE deleted_at IS NULL` — the paginated list's sort key.
- **Dropped:** `@@index([name])` (superseded), `@@index([deletedAt])` (D7).

**Relationships & cascade.**
| FK | Class | Why |
|---|---|---|
| ← `contracts.customer_id` | **C4 RESTRICT** | §3.3: "Deletion is refused when contracts exist (referential dignity, not just FK)". The domain refuses first; the FK is the backstop when someone reaches for psql |
| ← `generated_documents.customer_id` | **C3 SET NULL** | |

**Performance.** Hundreds of rows. Every index here is for *human* lookup latency, which is a
perceptual budget (~100 ms), not a throughput one.

**Scalability.** Flat with tenure. If it ever isn't, the trigram index is the first thing to watch:
GIN on `pg_trgm` degrades on very short strings because trigram selectivity collapses. Not an issue
below ~10⁵ rows.

---

### 6.2 `contracts`

**Purpose.** The commercial agreement. Aggregate root over `contract_items` and `change_orders`.
Defends: `revised_total = original_total + Σ(approved change orders)`; only a `DRAFT` may be edited;
only an `APPROVED` contract may spawn a project.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | |
| `contract_number` | `text` | no | | Human-facing sequence |
| `customer_id` | `uuid` | no | | |
| `template_id` | `uuid` | yes | | Provenance only (§5.1) |
| `building_area` | `numeric(12,2)` | no | | m² |
| `floors` | `int` | no | `1` | |
| `meter_price` | `numeric(18,4)` | no | | |
| `total_price` | `numeric(18,4)` | no | | The **original** contract value |
| `expected_profit_margin` | `numeric(6,3)` | yes | | Percent, signed |
| `status` | `ContractStatus` | no | `DRAFT` | `{DRAFT, APPROVED, CANCELLED}` |
| `signed_at` | `timestamptz(3)` | yes | | An instant — the moment of signature |
| `approved_by` | `uuid` | yes | | *Added* — → `users.id` |
| `notes` | `text` | yes | | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | `now()` | |
| `deleted_at` | `timestamptz(3)` | yes | | |

**Constraints.**
- `PK (id)`
- `uq_contracts_number (contract_number) WHERE deleted_at IS NULL` — **D6.** Today a soft-deleted contract holds its number forever, and the next `CP-2026-0041` fails with a unique violation the user cannot explain.
- `ck_contracts_area CHECK (building_area > 0)` · `ck_contracts_floors CHECK (floors >= 1)`
- `ck_contracts_prices CHECK (meter_price >= 0 AND total_price >= 0)`
- `ck_contracts_signed CHECK (status <> 'APPROVED' OR signed_at IS NOT NULL)` — an approved contract with no signature date is a hole in the audit trail. The database can enforce this one, so it should.
- `ck_contracts_approver CHECK (status <> 'APPROVED' OR approved_by IS NOT NULL)`

**`revised_total` is not a column.** It is `total_price + COALESCE((SELECT SUM(amount) FROM change_orders WHERE contract_id = c.id AND status = 'APPROVED'), 0)`.

Three ways to have it, and the choice is not obvious:

| Option | Verdict |
|---|---|
| **Stored column, maintained by the aggregate** | Rejected. Two sources of truth for the number the whole product is about. A missed update path is a silently wrong contract value, and it will be found by a customer, not a test |
| **`GENERATED ALWAYS AS … STORED`** | Impossible. Postgres generated columns may only reference the *same row* |
| **Computed on read (view or DTO)** | **Chosen.** With ≤ ~20 change orders per contract and an index on `(contract_id, status)`, the subquery is a handful of index tuples. If the contract list ever feels it, `mv_project_profitability` already carries the number for the dashboard |

This is the single most important denormalization decision in the schema, and the answer is: don't.

**Indexes.**
- `ix_contracts_customer (customer_id, created_at DESC) WHERE deleted_at IS NULL` — the customer's contract tab.
- `ix_contracts_status_created (status, created_at DESC) WHERE deleted_at IS NULL` — the list view's default filter+sort. Composite, because `status` alone has three values and is worthless as a leading column on its own.
- `ix_contracts_number_trgm` GIN on `contract_number gin_trgm_ops` — users search by partial number.
- `ix_contracts_template (template_id) WHERE template_id IS NOT NULL` — FK referencing side.
- **Dropped:** `@@index([status])`, `@@index([deletedAt])` (D7).

**Relationships & cascade.**
| FK | Class | Why |
|---|---|---|
| `customer_id` → `customers` | **C4 RESTRICT** | |
| `template_id` → `building_templates` | **C3 SET NULL** | Snapshot rule makes this safe (§5.1) |
| `approved_by` → `users` | **C3 SET NULL** | |
| ← `contract_items` | **C1 CASCADE** | Aggregate children |
| ← `change_orders` | **C1 CASCADE** | Aggregate children |
| ← `projects.contract_id` | **C2 RESTRICT** | A project without its contract has no scope and no value. Delivery must not be silently decapitated |
| ← `generated_documents.contract_id` | **C3 SET NULL** | |

`contract_items` **CASCADE** and `projects` **RESTRICT** off the same parent is the aggregate boundary
made visible in DDL: items are *inside* the Contract aggregate, a Project is a peer that merely
references it.

**Performance.** Low hundreds of rows per year. Everything is an index scan.

**Scalability.** The `revised_total` subquery is the only thing that could degrade, and only if a
single contract accumulated thousands of change orders — which would be a business pathology, not a
scale problem. Watch it in `mv_project_profitability` instead.

---

### 6.3 `contract_items`

**Purpose.** A snapshotted line of the bill of materials. Copied by value from the template or the
catalog at the instant of use, so that a later price edit can never restate a signed contract
(decision #12).

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | no | |
| `contract_id` | `uuid` | no | |
| `material_id` | `uuid` | no | *Reference* — for reporting and traceability |
| `material_name` | `text` | no | *Added.* **Snapshot** — what it was called when signed |
| `unit_code` | `text` | no | |
| `quantity` | `numeric(18,6)` | no | |
| `estimated_price` | `numeric(18,4)` | no | Unit price. **Snapshot** |
| `line_total` | `numeric(18,4)` | no | *Added.* `quantity × estimated_price`, computed in the domain |
| `sort_order` | `int` | no | *Added*, default `0` |
| `notes` | `text` | yes | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | |

**Constraints.** `PK (id)` · `uq_ci_contract_material (contract_id, material_id)` · `ck_ci_qty CHECK (quantity > 0)` · `ck_ci_price CHECK (estimated_price >= 0)` · `ck_ci_line_total CHECK (line_total = round(quantity * estimated_price, 4))`.

**On `material_name` — a deliberate, documented denormalization.** It duplicates `materials.name`,
which any normalization checklist flags as a violation. It is not one. The rule of 3NF is that a
non-key attribute must depend on the key — and `material_name` here depends on *this contract line*,
because it records **what the material was called at signature time**. It is a different fact from
`materials.name`, which records what it is called *now*. Renaming "أسمنت مقاوم" in the catalog must
not silently rewrite a contract a customer signed. Temporal facts look like duplication and are not.

The same argument licenses `estimated_price` and `unit_code`, and *forbids* extending it to, say,
`customer_name` on `contracts` — the customer's identity is not a snapshotted attribute of the
agreement, it is a live reference.

**On `line_total` — a genuine, admitted denormalization.** It is derivable from
`quantity × estimated_price`. It is stored because (a) the `CHECK` makes divergence structurally
impossible, and (b) `SUM(line_total)` is an index-only aggregate whereas `SUM(quantity * price)`
cannot be. A `GENERATED ALWAYS AS (round(quantity * estimated_price, 4)) STORED` column is the better
form here — same-row reference, so Postgres permits it — and removes even the possibility of a wrong
insert. **Recommendation: make it generated.** The `CHECK` above is the fallback if Prisma's support
proves awkward.

**Indexes.** `ix_ci_contract (contract_id, sort_order) INCLUDE (line_total)` — the items grid, ordered, with the total available without a heap fetch. `ix_ci_material (material_id)` — FK side; answers "every contract that used cement", which is a real reporting question and the AI's `material.usage` tool.

**Cascade.** `contract_id` → **C1 CASCADE**. `material_id` → **C2 RESTRICT**. `unit_code` → **C2 RESTRICT**.

**Performance.** Tens of rows per contract. The `INCLUDE (line_total)` covering index makes the grid
render from index pages alone.

**Scalability.** Bounded by contract complexity, not tenure.

---

### 6.4 `change_orders`

**Purpose.** A formal amendment to an approved contract, expressed as a **signed delta**. Positive =
addition, negative = deduction. Reversing an order means issuing a new negative one, never editing the
original — which is what makes the contract's financial history reconstructible at any past instant.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | |
| `contract_id` | `uuid` | no | | |
| `number` | `int` | no | | Sequential **per contract** |
| `title` | `text` | no | | |
| `description` | `text` | yes | | |
| `amount` | `numeric(18,4)` | no | | Signed |
| `status` | `ChangeOrderStatus` | no | `DRAFT` | `{DRAFT, APPROVED, REJECTED}` — both non-draft states terminal |
| `approved_at` | `timestamptz(3)` | yes | | |
| `approved_by` | `uuid` | yes | | *Added* |
| `reversed_by_id` | `uuid` | yes | | *Added* — → self. Links a reversal to what it reverses |
| `created_at` / `updated_at` | `timestamptz(3)` | no | `now()` | |
| `deleted_at` | `timestamptz(3)` | yes | | |

**Constraints.**
- `PK (id)` · `uq_change_orders_number (contract_id, number)`
- `ck_co_amount_nonzero CHECK (amount <> 0)` — a zero-delta amendment is a note, not a change order.
- `ck_co_approved CHECK (status <> 'APPROVED' OR (approved_at IS NOT NULL AND approved_by IS NOT NULL))`
- `ck_co_not_self_reversal CHECK (reversed_by_id <> id)`

**The invariant the database cannot hold.** `total_price + Σ(approved amounts) >= 0` — a contract
cannot be amended into negative value. It spans rows, so it lives in the `Contract` aggregate (same
reasoning as §5.3). Named here so its absence reads as a decision.

**Indexes.**
- `ix_co_contract_approved (contract_id) INCLUDE (amount) WHERE status = 'APPROVED' AND deleted_at IS NULL` — **this is the index that makes `revised_total` cheap.** It is a partial covering index over exactly the rows the subquery in §6.2 touches, so the computation is one index range scan and zero heap reads. Designing the index and the derived value together is why the "don't store it" decision in §6.2 is affordable.
- `ix_co_contract_all (contract_id, number)` — the change-orders tab.
- **Dropped:** `@@index([status])` (D7 — three values).

**Cascade.** `contract_id` → **C1 CASCADE** (an amendment to a deleted contract is nothing). `approved_by` → **C3 SET NULL**. `reversed_by_id` → **C3 SET NULL**.

**Performance.** A handful per contract. The covering partial index above is the one that matters.

**Scalability.** None needed.

---

## 7. Delivery

### 7.1 `projects`

**Purpose.** Execution of an approved contract: the calendar, the progress, the delays. Aggregate root
over `construction_steps`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | |
| `contract_id` | `uuid` | yes | | 1:1. Nullable: internal projects exist |
| `name` | `text` | no | | |
| `code` | `text` | yes | | *Added* — short human handle, e.g. `PRJ-014` |
| `start_date` | `date` | yes | | D3 — a day, not an instant |
| `delivery_date` | `date` | yes | | Contractual target |
| `actual_end_date` | `date` | yes | | *Added* — delay is `actual_end_date - delivery_date`, and today it is uncomputable |
| `progress_percentage` | `numeric(6,3)` | no | `0` | **Derived cache** — see below |
| `status` | `ProjectStatus` | no | `PLANNED` | `{PLANNED, IN_PROGRESS, PAUSED, COMPLETED, CANCELLED}` |
| `notes` | `text` | yes | | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | `now()` | |
| `deleted_at` | `timestamptz(3)` | yes | | |

**Constraints.**
- `PK (id)` · `uq_projects_contract (contract_id) WHERE contract_id IS NOT NULL` — enforces 1:1 while permitting many contract-less projects. The live schema's `@unique` on a nullable column achieves the same in Postgres (NULLs distinct); the partial form states the intent.
- `uq_projects_code (code) WHERE deleted_at IS NULL AND code IS NOT NULL`
- `ck_projects_progress CHECK (progress_percentage BETWEEN 0 AND 100)`
- `ck_projects_dates CHECK (start_date IS NULL OR delivery_date IS NULL OR delivery_date >= start_date)`
- `ck_projects_completed CHECK (status <> 'COMPLETED' OR actual_end_date IS NOT NULL)`

**`progress_percentage`: a cache, and the schema should say so.** §3.3 is explicit — *"progress is
derived from steps, never set directly."* The column stores `Σ(percentage) FOR completed steps`. It is
**not** a generated column (Postgres cannot reference other rows) and it is **not** the source of
truth. It exists because the project list sorts and filters on it, and recomputing a subquery per row
across a paginated grid is the exact "recompute history on every page load" failure §10.4 warns about.

The rule: **only `ConstructionStep` transitions write it**, inside the same transaction, via the
aggregate. Nothing else — not the AI, not an import, not an admin screen. A nightly consistency job
(§9.2) recomputes it for every project and raises a notification on divergence, because a cache with
no reconciliation is just a bug with a longer fuse.

**Indexes.**
- `ix_projects_status_delivery (status, delivery_date) WHERE deleted_at IS NULL` — the dashboard's "late and running" query.
- `ix_projects_overdue (delivery_date) WHERE status IN ('PLANNED','IN_PROGRESS') AND deleted_at IS NULL` — the delay-detection job's claim query. Partial on the only statuses that can *be* late.
- `ix_projects_name_trgm` GIN on `ar_normalize(name) gin_trgm_ops` — the AI resolving "فيلا الرياض" to an id (§5.5) reads this.
- `ix_projects_contract (contract_id)` — FK side.
- **Dropped:** `@@index([status])`, `@@index([startDate])`, `@@index([deliveryDate])`, `@@index([deletedAt])` (D7). Four indexes replaced by two better ones.

**Relationships & cascade.**
| FK | Class | Why |
|---|---|---|
| `contract_id` → `contracts` | **C2 RESTRICT** | |
| ← `construction_steps` | **C1 CASCADE** | Aggregate children |
| ← `project_costs` | **C1 CASCADE** | *See the note below — this is the most questionable cascade in the schema* |
| ← `payments` | **C1 CASCADE** | Same note |
| ← `fact_project_daily` | **C1 CASCADE** | Read model, rebuildable |
| ← `generated_documents.project_id` | **C3 SET NULL** | |

**The uncomfortable cascade.** `project_costs` and `payments` currently `CASCADE` from `projects`. In
a system with real soft delete this never fires, so it is harmless in practice. But read it literally:
*deleting a project destroys its financial ledger.* If the intent is "a project's costs are part of the
project aggregate", the cascade is right and physical project deletion must be forbidden by policy. If
the intent is "the ledger is sovereign", it should be `RESTRICT`.

**Recommendation: `RESTRICT`.** Money outranks structure. §3.3 lists `Payment` and `ProjectCost` as
their *own* aggregate roots — not as children of `Project` — so `CASCADE` contradicts the architecture's
own aggregate map. Changing it costs nothing today (no physical deletes happen) and prevents a
catastrophic `DELETE` in a future data-repair session. This is exactly the class of bug §1.3 exists to
catch.

**Performance.** Hundreds of rows. Two partial indexes carry the dashboard.

**Scalability.** Flat. The read-side pressure moves to `fact_project_daily` and
`mv_project_profitability` as history accumulates (§10).

---

### 7.2 `construction_steps`

**Purpose.** The project's stages, snapshotted from the template's steps at project creation. Their
completion is what *derives* project progress.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | no | |
| `project_id` | `uuid` | no | |
| `name` | `text` | no | Snapshot |
| `percentage` | `numeric(6,3)` | no | Snapshot of the template step's share |
| `sort_order` | `int` | no | |
| `status` | `ConstructionStepStatus` | no | `{PENDING, IN_PROGRESS, COMPLETED, SKIPPED}` |
| `planned_start_date` | `date` | yes | *Added* |
| `planned_end_date` | `date` | yes | *Added* |
| `started_at` | `timestamptz(3)` | yes | |
| `completed_at` | `timestamptz(3)` | yes | |
| `notes` | `text` | yes | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | |

**Constraints.**
- `PK (id)` · `uq_cs_project_sort (project_id, sort_order)`
- `ck_cs_pct CHECK (percentage > 0 AND percentage <= 100)`
- `ck_cs_started CHECK (status = 'PENDING' OR status = 'SKIPPED' OR started_at IS NOT NULL)`
- `ck_cs_completed CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)`
- `ck_cs_order CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)`

`SUM(percentage) = 100` per project: aggregate-enforced, same reasoning as §5.3. Note `SKIPPED` steps
still carry their percentage — the aggregate must decide whether a skipped step counts as complete.
**It does not**, which means a project with a skipped step can never reach 100%. That is a real
product question hiding in a schema, and it should be answered before this ships: either `SKIPPED`
counts toward progress, or the aggregate redistributes its percentage across the remaining steps.

**Indexes.** `uq_cs_project_sort` is the access path (always fetched as an ordered set per project). `ix_cs_pending (project_id) WHERE status IN ('PENDING','IN_PROGRESS')` — the "what's next" widget. **Dropped:** `@@index([projectId])` (subsumed by the unique), `@@index([status])` (D7).

**Cascade.** `project_id` → **C1 CASCADE**. Unambiguously compositional.

**Performance / scalability.** Under 20 rows per project. Nothing to do.

---

## 8. Cost & Cash

### 8.1 `project_costs`

**Purpose.** *This is the "Expenses" table.* Decision #11 keeps the domain term `ProjectCost`. It is
the other half of profitability: what a project actually consumed. Its own aggregate root (§3.3).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | |
| `project_id` | `uuid` | no | | |
| `category` | `CostCategory` | no | | `{MATERIAL, LABOR, MACHINERY, TRANSPORT, MISC}` |
| `material_id` | `uuid` | yes | | Required when `category = MATERIAL` |
| `supplier_id` | `uuid` | yes | | *Added* — the procurement link |
| `description` | `text` | no | | |
| `quantity` | `numeric(18,6)` | yes | | |
| `unit_code` | `text` | yes | | *Added* — replaces free-text `unit` |
| `unit_price` | `numeric(18,4)` | yes | | |
| `total_amount` | `numeric(18,4)` | no | | Computed in the domain, never accepted from a caller |
| `date` | `date` | no | | D3 — the business day of the expense |
| `invoice_reference` | `text` | yes | | *Added* — supplier invoice no. |
| `is_billable` | `boolean` | no | `true` | *Added* — reimbursable vs absorbed |
| `notes` | `text` | yes | | |
| `created_by` | `uuid` | yes | | *Added* |
| `created_at` / `updated_at` | `timestamptz(3)` | no | `now()` | |
| `deleted_at` | `timestamptz(3)` | yes | | |

**Constraints.**
- `PK (id)`
- `ck_pc_total_positive CHECK (total_amount > 0)`
- `ck_pc_qty CHECK (quantity IS NULL OR quantity > 0)` · `ck_pc_unit_price CHECK (unit_price IS NULL OR unit_price >= 0)`
- `ck_pc_material_category CHECK (category <> 'MATERIAL' OR material_id IS NOT NULL)` — a material cost with no material cannot feed price history, and would silently vanish from every baseline.
- `ck_pc_line_math CHECK (quantity IS NULL OR unit_price IS NULL OR total_amount = round(quantity * unit_price, 4))` — §3.3's invariant, made structural. The domain computes it; the database refuses to store a different answer.
- `ck_pc_quantity_needs_unit CHECK (quantity IS NULL OR unit_code IS NOT NULL)` — a bare number with no unit is not a quantity.

**Indexes.**
- `ix_pc_project_date (project_id, date DESC) INCLUDE (total_amount, category) WHERE deleted_at IS NULL` — **the workhorse.** Serves the costs grid, the project cost summary, and the profitability rollup entirely from index pages.
- `ix_pc_category_date (category, date DESC) WHERE deleted_at IS NULL` — company-wide spend by category.
- `ix_pc_material (material_id, date DESC) WHERE material_id IS NOT NULL AND deleted_at IS NULL` — feeds `material_price_history` projection and "where did all the cement go".
- `ix_pc_supplier (supplier_id, date DESC) WHERE supplier_id IS NOT NULL AND deleted_at IS NULL` — payables by vendor.
- `ix_pc_date_brin` BRIN on `date` — cheap range pruning for year-scale report scans that the composite indexes can't serve.
- **Dropped:** all five single-column indexes (`projectId`, `category`, `materialId`, `date`, `deletedAt`). Each is subsumed by a composite that also answers the sort (D7).

**Relationships & cascade.**
| FK | Class | Why |
|---|---|---|
| `project_id` → `projects` | **C1 CASCADE** today → **recommend C2 RESTRICT** (§7.1) | |
| `material_id` → `materials` | **C2 RESTRICT** | |
| `supplier_id` → `suppliers` | **C2 RESTRICT** | A payable with no payee |
| `unit_code` → `units_of_measure` | **C2 RESTRICT** | |
| `created_by` → `users` | **C3 SET NULL** | |
| ← `material_price_history.source_cost_id` | **C3 SET NULL** | |

**Domain events emitted.** `ProjectCostRecorded { costId, projectId, materialId?, supplierId?, unitPrice?, quantity?, date }` → outbox → `material_price_history` projector, `search_documents`, `mv_project_profitability` invalidation. This is the only path by which price history is written (§4.5).

**Performance.** The highest-volume *business* table — Excel-fast inline entry means bursts of small
inserts. The composite covering index is chosen so the costs grid (`project_id`, newest first, with
totals) never touches the heap. Keep `fillfactor` at the default 100: this table is insert-and-read,
edits are rare, so HOT updates are not worth trading page density for.

**Scalability.** ~5–20k rows/year. A decade is well inside single-table territory. The rollups that
*would* slow down — profitability, cost-by-category-by-month — are precomputed (§10.4), which is what
"reads scale with read models, not history" means concretely.

---

### 8.2 `overhead_expenses` — NEW, **optional**

**Purpose.** Company-level costs not attributable to any project: office rent, salaries, utilities,
vehicle fuel, taxes, insurance.

**Why this exists, and why you may delete it.** `project_costs` requires a `project_id`. So today the
system can compute *project* profitability but **not company profit** — the two differ by exactly the
overhead this table would hold, and a contractor who trusts the dashboard's "profit" number without it
is being misled. Once `suppliers` exists, the gap becomes conspicuous: you can record who sold you
cement for a villa, but not who sold you diesel for the office truck.

The architecture does not mention it. It is therefore presented as an **additive proposal**, not an
inference. Nothing else in this document depends on it — deleting this subsection breaks no FK, no
index, and no read model except the `overhead` term in `mv_cash_flow_monthly`.

**The rejected alternative:** making `project_costs.project_id` nullable. That would destroy the
`ix_pc_project_date` covering index's leading column for a third of rows, break the `ProjectCost`
aggregate's identity (§3.3), and force every existing report to learn a `WHERE project_id IS NOT NULL`
it currently doesn't need. A sibling table is strictly cheaper.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | no | |
| `category` | `OverheadCategory` | no | enum `{RENT, SALARY, UTILITY, VEHICLE, ADMIN, TAX, INSURANCE, DEPRECIATION, OTHER}` |
| `supplier_id` | `uuid` | yes | |
| `description` | `text` | no | |
| `amount` | `numeric(18,4)` | no | |
| `date` | `date` | no | |
| `period_start` / `period_end` | `date` | yes | For accruals: a quarterly rent paid once |
| `invoice_reference` | `text` | yes | |
| `is_recurring` | `boolean` | no | `false` |
| `notes` | `text` | yes | |
| `created_by` | `uuid` | yes | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | |
| `deleted_at` | `timestamptz(3)` | yes | |

**Constraints.** `PK (id)` · `ck_oe_amount CHECK (amount > 0)` · `ck_oe_period CHECK (period_start IS NULL OR period_end IS NULL OR period_end >= period_start)` · `ck_oe_period_pair CHECK ((period_start IS NULL) = (period_end IS NULL))`.

**Indexes.** `ix_oe_date (date DESC) WHERE deleted_at IS NULL` · `ix_oe_category_date (category, date DESC) WHERE deleted_at IS NULL` · `ix_oe_supplier (supplier_id) WHERE supplier_id IS NOT NULL`.

**Cascade.** `supplier_id` → **C2 RESTRICT**. `created_by` → **C3 SET NULL**.

**Deliberately deferred: `overhead_allocations`.** Apportioning overhead onto projects (by revenue
share, by duration, by direct-cost share) is how you get *true* project P&L. It needs a
`(project_id, overhead_expense_id, ratio)` table with `SUM(ratio) = 1` per expense, plus a policy
choice nobody has made. Named as a choice, not an oversight (§15).

**Performance / scalability.** Hundreds of rows per year. Nothing to engineer.

---

### 8.3 `payments`

**Purpose.** Cash flow — the owner's first question. The schedule of what the customer owes and when,
and the record of what actually arrived.

**D4 — the structural fix.** §3.3 states the invariant `paidAmount ≤ scheduledAmount`. The live table
has a single `amount` column, so the invariant is *unrepresentable* and partial payments — the norm in
construction — cannot be recorded at all. A payment is not a boolean.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | |
| `project_id` | `uuid` | no | | |
| `installment_number` | `int` | yes | | *Added* — "الدفعة الثالثة" |
| `scheduled_amount` | `numeric(18,4)` | no | | **D4.** What is owed |
| `paid_amount` | `numeric(18,4)` | no | `0` | **D4.** What has arrived. `0` ⇒ nothing yet |
| `due_date` | `date` | no | | D3 |
| `payment_date` | `date` | yes | | Of the most recent receipt |
| `status` | `PaymentStatus` | no | `PENDING` | `{PENDING, PARTIAL, PAID, LATE, CANCELLED}` — **`PARTIAL` added** |
| `method` | `PaymentMethod` | yes | | `{CASH, BANK_TRANSFER, CHECK, OTHER}` |
| `reference` | `text` | yes | | Cheque no., transfer id |
| `notes` | `text` | yes | | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | `now()` | |
| `deleted_at` | `timestamptz(3)` | yes | | |

**Constraints.**
- `PK (id)` · `uq_payments_installment (project_id, installment_number) WHERE installment_number IS NOT NULL AND deleted_at IS NULL`
- `ck_pay_scheduled CHECK (scheduled_amount > 0)`
- `ck_pay_paid_bounds CHECK (paid_amount >= 0 AND paid_amount <= scheduled_amount)` — **§3.3's invariant, now enforceable.**
- `ck_pay_status_paid CHECK (status <> 'PAID' OR (paid_amount = scheduled_amount AND payment_date IS NOT NULL))`
- `ck_pay_status_partial CHECK (status <> 'PARTIAL' OR (paid_amount > 0 AND paid_amount < scheduled_amount))`
- `ck_pay_status_pending CHECK (status <> 'PENDING' OR paid_amount = 0)`
- `ck_pay_method CHECK (paid_amount = 0 OR method IS NOT NULL)`

Six `CHECK`s on one table looks heavy. It is the correct weight: this is the table the business is
about, `status` is a denormalization of `(paid_amount, scheduled_amount, due_date)`, and every one of
these constraints forbids a state the UI would otherwise render as a contradiction.

**Immutability of settled payments.** §3.3: *"a paid payment is immutable except by reversal."* Not
expressible as a `CHECK` (it constrains a *transition*, not a row). Enforced in the `Payment`
aggregate. A reversal is a new row with negative `scheduled_amount`? **No** — that breaks
`ck_pay_scheduled`. A reversal sets `status = CANCELLED` and records a compensating entry; the audit
log carries the history. Stated so the next reader does not invent the negative-row design and hit the
constraint.

**Indexes.**
- `ix_pay_overdue (due_date) WHERE status IN ('PENDING','PARTIAL') AND deleted_at IS NULL` — **the overdue sweep's claim query** (§9.2), and the dashboard's "what's late" card. Partial over exactly the collectible rows; the index is a few hundred entries no matter how many years of settled payments accumulate. This is the single highest-leverage index in the schema.
- `ix_pay_project_due (project_id, due_date) INCLUDE (scheduled_amount, paid_amount, status) WHERE deleted_at IS NULL` — the payment schedule tab, covering.
- `ix_pay_payment_date (payment_date DESC) WHERE payment_date IS NOT NULL AND deleted_at IS NULL` — cash-received-by-month, before the matview exists.
- **Dropped:** `@@index([projectId])`, `@@index([status])`, `@@index([dueDate])`, `@@index([deletedAt])` (D7).

**Relationships & cascade.**
| FK | Class | Why |
|---|---|---|
| `project_id` → `projects` | **C1 CASCADE** today → **recommend C2 RESTRICT** (§7.1) | Cash is sovereign |
| ← `notifications` (by `entity_id`) | polymorphic, no FK | See §9.5 |

**`LATE` is not a status the user sets.** It is a function of `due_date < today AND paid_amount < scheduled_amount`. Storing it means a row that is *silently wrong* every night at midnight until a job wakes up. Two defensible designs: (a) drop `LATE` from the enum and derive it on read — cleanest; (b) keep it and let the overdue sweep own the transition, which is what makes the notification idempotency key in §9.5 necessary. **Recommendation: (a).** `LATE` is a *view* of `PENDING`. Keeping it in the enum guarantees a permanent, unfixable window where the database disagrees with the calendar.

**Performance.** Low thousands of rows over a decade. `ix_pay_overdue` keeps the sweep O(overdue), not
O(history) — the difference between a job that stays fast for ten years and one that doesn't.

**Scalability.** Flat. When multi-currency arrives (§17), `scheduled_amount` gains a `currency_code`
and an `fx_rate_at_schedule`; the `CHECK`s survive unchanged because they compare like to like.

---

## 9. Platform mechanics

Per §0, Postgres *is* the queue and the broker. These four tables are the price of not installing
Redis on a contractor's office PC — and they are cheaper.

### 9.1 `outbox_events`

**Purpose.** The one mechanism (§10) by which notifications, search indexing, analytics, embeddings,
and price history react to writes without the write path knowing they exist. Appended **in the same
transaction** as the aggregate, so an event is published *iff* the write committed.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `bigint` | no | Identity. **This is the causal sequence** (D8) |
| `aggregate_type` | `text` | no | `'Contract'`, `'ProjectCost'`, … |
| `aggregate_id` | `uuid` | no | |
| `event_type` | `text` | no | `'ProjectCostRecorded'` |
| `payload` | `jsonb` | no | The event, self-contained. Consumers must not re-read the write model |
| `occurred_at` | `timestamptz(3)` | no | Domain time |
| `created_at` | `timestamptz(3)` | no | Insert time |
| `dispatched_at` | `timestamptz(3)` | yes | `NULL` ⇒ pending |
| `attempts` | `smallint` | no | `0` |
| `last_error` | `text` | yes | |
| `trace_id` | `text` | yes | Correlates to the request / AI turn that caused it |

**Constraints.** `PK (id)` · `ck_outbox_attempts CHECK (attempts >= 0)`.

**Indexes.**
- `ix_outbox_pending (id) WHERE dispatched_at IS NULL` — **the only index that matters.** The dispatcher's query is `SELECT … WHERE dispatched_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`. Because the index is partial, its size is proportional to the *backlog*, not to history. In steady state it holds single-digit entries and lives permanently in cache.
- `ix_outbox_aggregate (aggregate_type, aggregate_id, id)` — replay and debugging ("everything that ever happened to this contract").

A plain B-tree on `dispatched_at` would be the naive choice and would be ~100% dead entries within a
week. The partial index *is* the pattern.

**Ordering.** Consumers that need per-aggregate order must dispatch grouped by `(aggregate_type,
aggregate_id)` and process each group serially, because `SKIP LOCKED` deliberately breaks global
order. Consumers that don't care (search reindex, embeddings) can run fully parallel. Which of the two
a consumer is, is a property of the consumer — `material_price_history` needs order (a `PURCHASE`
after a `CATALOG_EDIT` on the same day), `search_documents` does not (last write wins).

**Cascade.** **None.** `aggregate_id` is *deliberately* not a foreign key. It is polymorphic across
twelve tables, and more importantly an event about a deleted aggregate must still dispatch — that is
often the *point* (`ContractCancelled`). An FK here would make deletion undispatchable.

**Retention.** Dispatched rows are deleted by a job after 7 days (kept briefly for forensics, not
forever). This makes the table the **highest-churn object in the database**: insert, update once,
delete. Consequences, all of which must be configured:
- `fillfactor = 70` — leaves room for the `dispatched_at` update to be a HOT update, avoiding an index write.
- Per-table aggressive autovacuum (`autovacuum_vacuum_scale_factor = 0.02`) — otherwise dead tuples accumulate between the daily delete and the default vacuum threshold, and the partial index's *scan* stays fast while the *heap fetch* rots.
- `DELETE … WHERE dispatched_at < now() - interval '7 days'` in batches of 10k, never one unbounded statement.

Ignoring this is the classic outbox failure: the pattern works beautifully for three months and then
the table is 40 GB of dead tuples.

**Performance.** Insert cost is one row on a sequential key inside an existing transaction — this is
why `bigint` identity and not UUIDv4 (D8). The dispatcher polls every 1 s; at this deployment's write
rate the backlog is almost always empty and the poll is an index-only scan of an empty partial index,
which costs microseconds.

**Scalability.** The extraction path (§12) turns this table into the broker's source. Nothing about
its shape changes — which is the whole point of paying for it now.

---

### 9.2 `jobs`

**Purpose.** *This is the "Automation Jobs" table.* Durable work that must survive a service restart:
the overdue sweep, delay detection, matview refresh, embedding backfill, DOCX cleanup, backup
verification, the `progress_percentage` reconciliation of §7.1.

**Why not `node-cron`:** it is in-memory; a restart at 02:59 silently skips the 03:00 sweep and nothing
tells you. **Why not BullMQ/Redis:** a second Windows service to install, repair, and version-gate.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `bigint` | no | Identity |
| `kind` | `text` | no | `'payments.overdue-sweep'` |
| `payload` | `jsonb` | no | `'{}'` |
| `status` | `JobStatus` | no | `{PENDING, RUNNING, SUCCEEDED, FAILED}` |
| `run_at` | `timestamptz(3)` | no | Earliest execution |
| `attempts` | `smallint` | no | `0` |
| `max_attempts` | `smallint` | no | `5` |
| `locked_by` | `text` | yes | Worker identity (`hostname:pid`) |
| `locked_at` | `timestamptz(3)` | yes | For the crashed-worker reaper |
| `schedule_id` | `bigint` | yes | → `job_schedules.id` when recurring |
| `idempotency_key` | `text` | yes | |
| `last_error` | `text` | yes | |
| `started_at` / `finished_at` | `timestamptz(3)` | yes | |
| `created_at` | `timestamptz(3)` | no | |

**Constraints.**
- `PK (id)`
- `uq_jobs_idempotency (idempotency_key) WHERE idempotency_key IS NOT NULL AND status <> 'FAILED'` — enqueueing "refresh matviews for 2026-07-10" twice yields one job.
- `ck_jobs_attempts CHECK (attempts >= 0 AND attempts <= max_attempts)`
- `ck_jobs_locked_pair CHECK ((locked_by IS NULL) = (locked_at IS NULL))`
- `ck_jobs_running CHECK (status <> 'RUNNING' OR locked_by IS NOT NULL)`

**Indexes.**
- `ix_jobs_claim (run_at, id) WHERE status = 'PENDING'` — the claim query: `SELECT … WHERE status='PENDING' AND run_at <= now() ORDER BY run_at, id LIMIT 10 FOR UPDATE SKIP LOCKED`. Partial, so it is sized by the *queue*, not by history.
- `ix_jobs_stale (locked_at) WHERE status = 'RUNNING'` — the reaper.
- `ix_jobs_schedule (schedule_id) WHERE schedule_id IS NOT NULL`

**The crashed-worker problem, which `SKIP LOCKED` alone does not solve.** `FOR UPDATE SKIP LOCKED`
holds a *row lock* for the duration of the claiming transaction. If the worker commits the
`status='RUNNING'` update and *then* the process is killed (a Windows service restart mid-job), the
lock is gone but the row stays `RUNNING` forever and the job never runs again. Hence `locked_at` plus
a reaper: `UPDATE jobs SET status='PENDING', locked_by=NULL, locked_at=NULL, attempts=attempts+1
WHERE status='RUNNING' AND locked_at < now() - interval '15 minutes'`. Every durable-queue-on-Postgres
design that omits this has a silent job-loss bug; it is the reason `locked_at` is a column and not a
comment.

Job handlers must therefore be **idempotent**, because at-least-once is the only delivery this
(or any) design provides.

**Single-instance guard.** One service ⇒ no leader election. The tick still takes
`pg_try_advisory_lock(<constant>)` so a developer running a second `tsx watch` backend cannot
double-fire the nightly sweep against the same database. Cheap, and it is the seam along which the
worker process gets extracted (§12).

**Cascade.** `schedule_id` → **C3 SET NULL** (deleting a schedule must not abort the run it already spawned).

**Retention.** `SUCCEEDED` rows deleted after 7 days; `FAILED` rows moved to `job_dead_letters`. Same
churn profile as `outbox_events` — `fillfactor = 70`, aggressive autovacuum. This table is *updated*
several times per job (claim, finish), which makes HOT updates genuinely valuable.

**Performance.** A handful of rows at rest. The 1–5 s tick is the only thing that polls the database
in a loop anywhere in this architecture, by design.

**Scalability.** `SKIP LOCKED` scales to multiple workers with no coordination the day the worker is
extracted. Nothing changes but `main`.

---

### 9.3 `job_schedules`

**Purpose.** The recurrence definition. After each run, the handler enqueues the next `jobs` row —
so a missed window is *late*, never *lost*.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `bigint` | no | Identity |
| `kind` | `text` | no | Matches a registered handler |
| `cron_expression` | `text` | no | e.g. `0 3 * * *` |
| `timezone` | `text` | no | `'Asia/Baghdad'`. **Not** UTC: "3am" means local 3am, and a UTC schedule drifts against the user's day |
| `payload` | `jsonb` | no | `'{}'` |
| `is_enabled` | `boolean` | no | `true` |
| `last_run_at` | `timestamptz(3)` | yes | |
| `next_run_at` | `timestamptz(3)` | yes | Materialized so the tick need not parse cron |
| `created_at` / `updated_at` | `timestamptz(3)` | no | |

**Constraints.** `PK (id)` · `uq_job_schedules_kind (kind)` — one schedule per job kind; two schedules for `payments.overdue-sweep` is always a misconfiguration.

**Indexes.** `ix_job_schedules_due (next_run_at) WHERE is_enabled`.

**Cascade.** ← `jobs.schedule_id` → **C3 SET NULL**.

**Performance / scalability.** Under 20 rows. Seeded on boot.

---

### 9.4 `job_dead_letters`

**Purpose.** Where a job goes after `max_attempts`. A failure that vanishes is worse than one that
alarms.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `bigint` | no | Identity |
| `original_job_id` | `bigint` | no | Not an FK — the source row is deleted |
| `kind` | `text` | no | |
| `payload` | `jsonb` | no | Enough to replay |
| `attempts` | `smallint` | no | |
| `last_error` | `text` | no | |
| `failed_at` | `timestamptz(3)` | no | |
| `resolved_at` | `timestamptz(3)` | yes | An operator retried or dismissed it |
| `resolved_by` | `uuid` | yes | → `users.id`, **C3** |

**Constraints.** `PK (id)`. **Indexes.** `ix_jdl_unresolved (failed_at DESC) WHERE resolved_at IS NULL` — the admin badge and the `jobs.read` screen.

**Cascade.** No FK to `jobs` by design: the dead letter must outlive the job row it came from, and the
retention job deletes `jobs` aggressively.

**Notification.** Insertion here emits `JobDeadLettered` → `notifications` for `OWNER`/`ADMIN`. An
unattended dead-letter queue is a dead-letter queue nobody reads.

**Performance / scalability.** Should be empty. If it isn't, that is the signal it exists to send.

---

### 9.5 `notifications`

**Purpose.** "Nothing slips through" — the product's first emotional goal. Durable, per-user, delivered
at-least-once to three channels (in-app bell, SSE to the open renderer, Windows toast via Electron IPC).

**Fan-out is materialized.** One row per (user, event), not one row per event with a role filter at
read time. Rationale: the bell's unread count is the single most-read query in the app; making it
`SELECT count(*) WHERE user_id = ? AND read_at IS NULL` — a partial index lookup — is worth the write
amplification of ≤10 rows per event at this user count. At a thousand users the trade inverts.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `bigint` | no | Identity |
| `user_id` | `uuid` | no | |
| `kind` | `text` | no | `'payment.overdue'`, `'project.delayed'`, `'job.dead_lettered'` |
| `severity` | `NotificationSeverity` | no | `{INFO, WARNING, CRITICAL}` |
| `title` | `text` | no | Arabic, pre-rendered |
| `body` | `text` | yes | |
| `entity_type` | `text` | yes | Polymorphic deep-link target |
| `entity_id` | `uuid` | yes | |
| `payload` | `jsonb` | yes | Extra render data |
| `idempotency_key` | `text` | no | See below |
| `read_at` | `timestamptz(3)` | yes | |
| `dismissed_at` | `timestamptz(3)` | yes | |
| `created_at` | `timestamptz(3)` | no | |

**Constraints.**
- `PK (id)`
- `uq_notifications_idem (idempotency_key)` — **and the key must include `user_id`.** Composed as `<rule>:<entity_id>:<period>:<user_id>`. Omitting the user id means the *first* recipient's row suppresses everyone else's — a fan-out bug that presents as "only the owner gets notified", and is maddening to diagnose. The `period` term (`2026-07-10`, or an ISO week) is what stops the 5-second overdue sweep from re-notifying the same invoice forever.
- `ck_notif_entity_pair CHECK ((entity_type IS NULL) = (entity_id IS NULL))`

**Indexes.**
- `ix_notif_unread (user_id, created_at DESC) WHERE read_at IS NULL` — the bell. Partial: sized by *unread*, not by history, so the count stays O(1) after five years.
- `ix_notif_user_recent (user_id, created_at DESC)` — the full list, paginated.
- `ix_notif_entity (entity_type, entity_id) WHERE entity_type IS NOT NULL` — "notifications about this project".

**Relationships & cascade.** `user_id` → **C1 CASCADE**. `entity_id` is polymorphic and carries **no FK**
— it spans `payments`, `projects`, `contracts`, `jobs`. The cost is that a deleted entity leaves a
dead deep-link; the UI must handle a 404 on click. The alternative — eight nullable typed FK columns —
is worse in every dimension. This is a considered denormalization, discussed in §15.

**Role scoping without a preference model.** §10.2 mandates reusing the RBAC catalog: the rule engine
asks *which permission does this notification's subject require* (`payments.read` for an overdue
payment) and fans out to every active user whose role grants it. An accountant sees overdue payments;
an engineer sees delays; nobody configures anything. No `notification_preferences` table exists, and
that is a decision, not an omission — per-user preferences can be added later as an *opt-out* overlay
without restructuring anything here.

**Performance.** Append-heavy, update-once (`read_at`). The unread partial index is the hot one and
stays tiny. `fillfactor = 90` to keep the `read_at` update HOT.

**Scalability.** Grows with tenure × users. Retention: delete `read_at IS NOT NULL AND created_at <
now() - interval '90 days'`. At 10 users this table never exceeds a few hundred thousand rows, which
is nothing; the partial index means the bell's latency is independent of that number anyway.

---

## 10. Read models

**Every table in this section is disposable.** Each can be dropped and rebuilt from the write model by
replaying `outbox_events` or by a full backfill job. That property is what makes it safe to change the
search or analytics design later without a data migration — and it is why none of them carry a
`deleted_at` or participate in a business invariant.

### 10.1 `search_documents`

**Purpose.** One index, three consumers: the command palette, global search, and **the AI's entity
resolver** (§5.5). Three rankers would eventually disagree, and a disagreement between the palette and
the assistant is experienced by the user as "the AI can't find my project."

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `bigint` | no | Identity |
| `entity_type` | `text` | no | `'project'`, `'customer'`, `'contract'`, `'material'`, `'supplier'` |
| `entity_id` | `uuid` | no | |
| `title` | `text` | no | What the user recognises |
| `subtitle` | `text` | yes | Disambiguator shown in the palette |
| `body` | `text` | yes | Searchable secondary text |
| `search_vector` | `tsvector` | no | **Generated**, see below |
| `title_norm` | `text` | no | **Generated** — `ar_normalize(title)`, the trigram target |
| `permission_key` | `text` | no | Result-level authorization, e.g. `projects.read` |
| `updated_at` | `timestamptz(3)` | no | Recency ranking term |

**Constraints.** `PK (id)` · `uq_search_entity (entity_type, entity_id)` — the projector upserts on this.

**D1, concretely.** The architecture's §10.3 writes:

```
to_tsvector('simple', unaccent(normalize(text)))
```

Neither call survives contact with Postgres:

1. `unaccent()` is declared `STABLE`, not `IMMUTABLE`, because it reads a dictionary file that could in principle change. Postgres **refuses** `STABLE` functions in index expressions and in `GENERATED … STORED` columns. The statement fails at DDL time with `functions in index expression must be marked IMMUTABLE`.
2. `normalize()` has been a **built-in** since PG13 (Unicode NFC/NFD/NFKC). Defining a function with that name shadows it or collides, depending on schema search path — a genuinely nasty, intermittent bug.

The fix is one function, and both the index and every query must call it:

> `ar_normalize(text) → text`, declared `IMMUTABLE STRICT PARALLEL SAFE`. It folds `أ إ آ → ا`,
> `ة → ه`, `ى → ي`, strips the eight diacritics and tatweel (`ـ`), lowercases, and calls
> `unaccent('unaccent', $1)` — the **two-argument** form, which pins the dictionary and is what makes
> the `IMMUTABLE` declaration honest rather than a lie to the planner.

Declaring a genuinely non-immutable function `IMMUTABLE` corrupts indexes silently. The two-argument
`unaccent` is the reason this is safe, and it is the detail that gets missed.

`search_vector` is then `GENERATED ALWAYS AS (to_tsvector('simple', ar_normalize(coalesce(title,'') || ' ' || coalesce(body,'')))) STORED`, and `title_norm` is `GENERATED ALWAYS AS (ar_normalize(title)) STORED`.

`'simple'` and not `'arabic'`: **Postgres ships no Arabic stemmer.** `'english'` would mangle the text.
`'simple'` gives exact token matching with no stemming, and `pg_trgm` carries the morphology.

**Indexes.**
- `ix_search_vector` **GIN** on `search_vector` — lexical.
- `ix_search_title_trgm` **GIN** on `title_norm gin_trgm_ops` — fuzzy. This is the **primary** mechanism for Arabic: trigram similarity is script-agnostic and handles prefixed `ال` and suffixed pronouns far better than a wrong stemmer.
- `ix_search_entity_type (entity_type) WHERE entity_type IS NOT NULL` — scoped search.

Ranking is `ts_rank(search_vector, q) + similarity(title_norm, q) + recency_decay(updated_at)`, computed
in one query. One index, one ranking, one truth.

**D10 — the deletion story the architecture omits.** The projector must **`DELETE`** the row when the
source entity is soft-deleted, not merely stop updating it. Otherwise the AI resolves "الفيلا" to a
deleted project id and the executor — which validates that the id *exists*, and it does — writes to
it. Entity resolution over a stale index is a **correctness** bug with a write path attached, not a
UX blemish. The projector therefore handles `*Deleted` and `*Restored` events explicitly, and a
nightly reconciliation job asserts `count(search_documents) = count(live entities)`.

**`permission_key` — result-level authorization.** Without it, global search leaks the *existence* of
entities a role cannot read: an engineer typing "دفعة" learns how many payments exist. Filtering at
the index means one `WHERE permission_key = ANY($principal_permissions)` instead of five post-filters.

**Cascade.** None — `entity_id` is polymorphic across five tables and carries no FK, for the same
reason as `outbox_events` (§9.1). Integrity is maintained by the projector, and the table is
rebuildable, so the integrity cost is bounded by one backfill.

**Performance.** GIN indexes are expensive to *update* and cheap to *query*. Since writes arrive
asynchronously via the outbox — never on the user's request path — the cost lands where nobody is
waiting. Set `gin_pending_list_limit` and let `fastupdate` batch them.

**Scalability.** A few thousand rows. Trigram GIN degrades when the corpus reaches ~10⁶ short strings;
this deployment is three orders of magnitude away.

---

### 10.2 `embeddings`

**Purpose.** Semantic retrieval for tier-2 recommendations ("projects like this one used template T")
and for grounding the planner's prompt (§5.5).

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `bigint` | no | Identity |
| `entity_type` | `text` | no | |
| `entity_id` | `uuid` | no | |
| `model` | `text` | no | Which embedding model produced this |
| `dimensions` | `smallint` | no | Must match the column's `vector(n)` |
| `content_hash` | `text` | no | SHA-256 of the embedded text |
| `embedding` | `vector(1024)` | no | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | |

**Constraints.** `PK (id)` · `uq_embeddings_entity (entity_type, entity_id, model)` — one vector per entity *per model*, so a model upgrade backfills alongside the old one instead of destroying it · `ck_emb_dims CHECK (dimensions = 1024)`.

**`content_hash` is the cost control.** The backfill job skips re-embedding when the hash is unchanged.
Embeddings are the only per-row **paid** operation in this system; without the hash, a nightly
reindex bills the contractor for a thousand unchanged projects. §13's "many AI users → provider cost,
not CPU" is answered here, in a column.

**D2 — HNSW, not ivfflat.** §8 specifies `ivfflat`. Do not use it:

- `ivfflat` partitions the vector space into lists **using the rows present at build time**. A fresh install has *zero* embeddings; they arrive later via backfill. An `ivfflat` index built on an empty or tiny table produces near-random recall, and it never recovers — the lists are not rebuilt as rows arrive. The failure is silent: queries return, they are just wrong.
- **HNSW** builds incrementally, requires no training set, and gives better recall at the same latency. Its costs are a slower build and more memory — both irrelevant at this row count.

And the honest recommendation: **below ~10,000 vectors, build no index at all.** A sequential scan
over 5,000 × 1024-dim vectors is a few milliseconds and has perfect recall. Add
`ix_embeddings_hnsw USING hnsw (embedding vector_cosine_ops)` when the row count justifies it, not
before. An approximate index over a small table trades correctness for a speedup nobody can perceive.

**Cascade.** None; polymorphic, rebuildable.

**Performance.** `vector(1024)` at 4 bytes/dim = 4 KB/row, which exceeds the 2 KB TOAST threshold —
every row is TOASTed out of line. That is fine for kNN (the index holds the vectors) but means a
`SELECT *` over this table is far more expensive than its row count suggests. Never select `embedding`
unless you need it.

**Scalability.** Consider `halfvec(1024)` (2 bytes/dim) if memory ever matters; recall loss is
negligible and the index halves. Not now.

---

### 10.3 `fact_project_daily`

**Purpose.** An immutable daily snapshot per project. §10.4's core insight: *you cannot recompute
"what did we think last March"; you can only have recorded it.* Progress, cost-to-date, and billing
at a past instant are not derivable from the current write model — approvals, change orders, and
back-dated costs all restate the past.

| Column | Type | Null | Notes |
|---|---|---|---|
| `snapshot_date` | `date` | no | |
| `project_id` | `uuid` | no | |
| `progress_percentage` | `numeric(6,3)` | no | As believed that day |
| `cost_to_date` | `numeric(18,4)` | no | |
| `billed_to_date` | `numeric(18,4)` | no | Σ `scheduled_amount` due on or before |
| `collected_to_date` | `numeric(18,4)` | no | Σ `paid_amount` |
| `contract_revised_total` | `numeric(18,4)` | yes | The §6.2 derived value, frozen |
| `schedule_variance_days` | `int` | yes | `+` = late |
| `open_steps` | `smallint` | no | |
| `created_at` | `timestamptz(3)` | no | |

**Constraints.** `PK (snapshot_date, project_id)` — **date first, deliberately.** It makes physical order match `snapshot_date`, which is what lets BRIN work, and range queries ("last 90 days, all projects") are the dominant access pattern. `(project_id, snapshot_date)` would optimize the rarer single-project timeline, which the covering index below serves anyway.

`ck_fpd_nonneg CHECK (cost_to_date >= 0 AND billed_to_date >= 0 AND collected_to_date >= 0)` · `ck_fpd_collected CHECK (collected_to_date <= billed_to_date)`.

**Immutable.** No `UPDATE`, ever. A snapshot corrected after the fact is not a snapshot. If the writing
job runs twice, `ON CONFLICT (snapshot_date, project_id) DO NOTHING` — idempotent, first write wins.

**Indexes.** PK. Plus `ix_fpd_project_time (project_id, snapshot_date DESC) INCLUDE (progress_percentage, cost_to_date)` for the per-project sparkline, and `ix_fpd_date_brin` **BRIN** on `snapshot_date` — append-only, perfectly correlated, so BRIN prunes year-scale scans at a fraction of a B-tree's size.

**Cascade.** `project_id` → **C1 CASCADE** (rebuildable read model; no reason to obstruct).

**Performance.** `projects × days`. Fifty active projects over ten years is ~180k rows — trivially
small, and the reason no partitioning is proposed.

**Scalability.** Written by a nightly job. Only snapshot **active** projects (`status IN
('PLANNED','IN_PROGRESS','PAUSED')`); a completed project's timeline is already frozen and re-writing
it every night for a decade is how a fact table becomes 100× larger than it needs to be.

---

### 10.4 Materialized views

Four. Each carries a `UNIQUE` index — **not optional**: `REFRESH MATERIALIZED VIEW CONCURRENTLY`
*requires* one, and without `CONCURRENTLY` the refresh takes an `ACCESS EXCLUSIVE` lock and the
dashboard blocks for its duration. This is the single most-forgotten requirement of the pattern.

| View | Grain | Feeds | Required unique index |
|---|---|---|---|
| `mv_cash_flow_monthly` | `(month)` | Dashboard cash chart. Inflow = Σ `payments.paid_amount`; outflow = Σ `project_costs.total_amount` + Σ `overhead_expenses.amount` | `(month)` |
| `mv_project_profitability` | `(project_id)` | Profitability grid. Carries the §6.2 `revised_total`, cost-to-date, margin | `(project_id)` |
| `mv_material_price_baseline` | `(material_id)` | §10.5 tier 1. 3/6/12-month volume-weighted mean, stddev, latest price, drift % | `(material_id)` |
| `mv_supplier_performance` | `(supplier_id)` | Supplier scorecard: spend, order count, mean lead time, price rank per material | `(supplier_id)` |

**Refresh.** A `jobs` row per view, nightly, `CONCURRENTLY`. Freshness becomes a tunable knob, and the
dashboard's cost is bounded by the size of the read model rather than the size of history — which is
the whole argument of §10.4 in the architecture.

**`mv_material_price_baseline` is the one that pays for `material_price_history`.** Without it, "Cement
is 14% above your 12-month average" is a full scan of the history table per material per page load.
With it, the recommendation engine reads one row.

**The rule.** The `reports` module and the recommendation engine read **only** read models, never the
write model. Enforced by `dependency-cruiser` alongside the other forbidden edges (§12).

**Scalability.** `CONCURRENTLY` needs roughly 2× the view's size in temp space and holds no exclusive
lock. When a view's refresh exceeds the nightly window, the answer is an incremental fact table
(the `fact_project_daily` shape), not a bigger machine.

---

## 11. Intelligence

Downstream of every context. Conformist. These tables are **new** — the previous AI subsystem's 96
files and its schema were removed in `20260710000000_remove_ai_subsystem`, deliberately, to clear the
way for this design (§0.1: *"a genuine clean slate"*). Nothing below resurrects the old shape.

The governing constraint is §5.1 invariant 4: **every AI turn is auditable and attributable.** These
tables are what makes that true, so their `NOT NULL`s are load-bearing.

### 11.1 `ai_sessions`

**Purpose.** A conversation. Holds the rolling memory that keeps the prompt bounded.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | no | |
| `user_id` | `uuid` | no | |
| `title` | `text` | yes | Auto-summarized from the first turn |
| `status` | `AiSessionStatus` | no | `{ACTIVE, ARCHIVED}` |
| `rolling_summary` | `text` | yes | Compacted history — a *storage* concern, not a prompt concern |
| `summary_through_message_id` | `bigint` | yes | Everything up to here is folded into the summary |
| `message_count` | `int` | no | `0` |
| `last_message_at` | `timestamptz(3)` | yes | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | |

**Constraints.** `PK (id)` · `ck_ais_count CHECK (message_count >= 0)`.

**Indexes.** `ix_ais_user_recent (user_id, last_message_at DESC) WHERE status = 'ACTIVE'` — the session switcher.

**Cascade.** `user_id` → **C1 CASCADE** (a conversation belongs to its speaker). ← `ai_messages` **C1 CASCADE**. ← `ai_executions.session_id` → **C3 SET NULL** — *the execution audit outlives the conversation.* Deleting a chat must never delete the record that the assistant approved a payment.

That asymmetry — messages cascade, executions do not — is the entire audit posture of this subsystem
expressed in two FK clauses.

**Performance / scalability.** Hundreds of rows. Archive, don't delete.

---

### 11.2 `ai_messages`

**Purpose.** The turn-by-turn transcript.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `bigint` | no | Identity (D8) — high insert rate, never exposed |
| `session_id` | `uuid` | no | |
| `role` | `AiMessageRole` | no | `{USER, ASSISTANT, SYSTEM}` |
| `content` | `text` | no | **Redacted before insert** |
| `result_kind` | `AiResultKind` | yes | `{ANSWER, CLARIFICATION, PREVIEW, EXECUTION, REJECTED, ERROR}` — the §5.3 discriminated union |
| `execution_id` | `uuid` | yes | → `ai_executions.id` |
| `sequence` | `int` | no | Ordinal within the session |
| `created_at` | `timestamptz(3)` | no | |

**Constraints.** `PK (id)` · `uq_aim_session_seq (session_id, sequence)` · `ck_aim_assistant_kind CHECK (role <> 'ASSISTANT' OR result_kind IS NOT NULL)` — an assistant message the client cannot render by `kind` is a protocol violation.

**Indexes.** `uq_aim_session_seq` is the access path (always read as an ordered window). `ix_aim_execution (execution_id) WHERE execution_id IS NOT NULL`.

**Redaction is a write-time obligation.** §5's governance ring redacts PII *before* the row is
inserted, not before it is displayed. A database that has ever held an unredacted secret has held it.
The column is `text` and the database cannot enforce this — which is exactly why it is stated here.

**Cascade.** `session_id` → **C1 CASCADE**. `execution_id` → **C3 SET NULL**.

**Performance / scalability.** The highest-cardinality AI table. Append-only. Retention: archive
sessions older than a year; `ai_executions` (the audit) is kept regardless. That split is the reason
the two tables exist separately rather than as one wide log.

---

### 11.3 `ai_plans`

**Purpose.** The typed JSON `Plan` the model emitted, awaiting human confirmation. **The LLM never
touches the database** (§5.1 invariant 1); it produces this row, and deterministic code executes it.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | no | |
| `session_id` | `uuid` | no | |
| `execution_id` | `uuid` | no | The turn that produced it |
| `user_id` | `uuid` | no | Who may confirm it — **only this user** |
| `status` | `AiPlanStatus` | no | `{PENDING, CLAIMED, EXECUTED, REJECTED, EXPIRED}` |
| `plan` | `jsonb` | no | `{ actions: [{ tool, args, refs }] }`, zod-validated |
| `preview` | `text` | no | The Arabic sentences shown to the human |
| `resolved_refs` | `jsonb` | no | Entity ids resolved against real rows at preview time |
| `expires_at` | `timestamptz(3)` | no | |
| `claimed_at` | `timestamptz(3)` | yes | |
| `executed_at` | `timestamptz(3)` | yes | |
| `rejected_at` | `timestamptz(3)` | yes | |
| `result_entity_ids` | `jsonb` | yes | What it created/changed |
| `created_at` | `timestamptz(3)` | no | |

**Constraints.**
- `PK (id)`
- `ck_aip_terminal CHECK (status <> 'EXECUTED' OR executed_at IS NOT NULL)`
- `ck_aip_claim CHECK (status = 'PENDING' OR status = 'EXPIRED' OR claimed_at IS NOT NULL)`
- `ck_aip_expiry CHECK (expires_at > created_at)`

**The atomic claim — a named defect class.** §5.2: *"the pending plan is claimed (compare-and-set on
its status) before execution, so a double-click or a duplicated request cannot execute the same plan
twice."* The schema's job is to make that CAS expressible:

```
UPDATE ai_plans
   SET status = 'CLAIMED', claimed_at = now()
 WHERE id = $1 AND status = 'PENDING' AND expires_at > now() AND user_id = $2
RETURNING *
```

Zero rows returned ⇒ already claimed, expired, or not yours ⇒ refuse. No advisory lock, no
`SELECT … FOR UPDATE` round trip, no race. This works **only because `status` is a column and not a
derived value** — which is why it is one, in a document that otherwise argues against storing derived
state. The distinction: `status` here *is* the truth, not a cache of it.

Note `user_id` in the `WHERE`: a plan proposed to one user must not be confirmable by another, even
one with the same permissions. Confirmation is an act of a person, not of a role.

**Indexes.** `ix_aip_pending (user_id, created_at DESC) WHERE status = 'PENDING'` — the pending-confirmation tray. `ix_aip_expiry (expires_at) WHERE status = 'PENDING'` — the expiry sweep job.

**Cascade.** `session_id` → **C1 CASCADE**. `execution_id` → **C2 RESTRICT** (the plan is evidence for the execution audit). `user_id` → **C2 RESTRICT**.

**Performance.** Small, high-churn. Expired rows swept after 24 h. `fillfactor = 80` — the row is
updated exactly once, at claim.

**Scalability.** None needed. `plan` and `resolved_refs` are `jsonb` and will TOAST for large plans;
that is correct — they are read once, at confirm time.

---

### 11.4 `ai_executions`

**Purpose.** *This is the "AI Logs" table.* The audit envelope of §5.1 invariant 4: **opened before the
model is called and closed on every exit path** — success, rejection, timeout, quota, breaker.

> "An assistant that can move money and cannot be audited is not shippable."

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | no | |
| `session_id` | `uuid` | yes | **SET NULL** on session delete — the audit outlives the chat |
| `user_id` | `uuid` | no | **NOT NULL.** Attribution is the point |
| `mode` | `AiTurnMode` | no | `{GENERAL, QUESTION, WORKFLOW, COMMAND}` |
| `outcome` | `AiOutcome` | no | `{PENDING, ANSWERED, CLARIFICATION, PREVIEWED, EXECUTED, REJECTED, ERROR}` |
| `pre_routed` | `boolean` | no | `true` ⇒ answered with **no LLM call** |
| `rejection_reason` | `text` | yes | |
| `error_code` | `text` | yes | `PROVIDER_DOWN`, `TIMEOUT`, `QUOTA_EXHAUSTED`, `BREAKER_OPEN` |
| `model` | `text` | yes | Null when `pre_routed` |
| `prompt_tokens` / `completion_tokens` | `int` | yes | |
| `cost_usd` | `numeric(12,6)` | yes | §1.2 — `(18,4)` would truncate a sub-cent turn to zero |
| `latency_ms` | `int` | yes | |
| `plan_id` | `uuid` | yes | |
| `quota_consumed` | `boolean` | no | Per the §5.6 table |
| `ip_address` | `inet` | yes | |
| `trace_id` | `text` | yes | Joins to `outbox_events.trace_id` |
| `started_at` | `timestamptz(3)` | no | |
| `finished_at` | `timestamptz(3)` | yes | Null ⇒ the envelope never closed. **A bug, and queryable** |

**Constraints.**
- `PK (id)`
- `ck_aie_prerouted_free CHECK (NOT pre_routed OR (model IS NULL AND cost_usd IS NULL AND NOT quota_consumed))` — encodes §5.1 invariant 2 as a database constraint. A pre-routed turn that billed the user is now *impossible to record*, not merely a bug.
- `ck_aie_terminal CHECK (outcome = 'PENDING' OR finished_at IS NOT NULL)`
- `ck_aie_error CHECK (outcome <> 'ERROR' OR error_code IS NOT NULL)`
- `ck_aie_rejected CHECK (outcome <> 'REJECTED' OR rejection_reason IS NOT NULL)`
- `ck_aie_cost CHECK (cost_usd IS NULL OR cost_usd >= 0)`

`ck_aie_prerouted_free` is the most valuable constraint in this table. §5.6's failure-semantics matrix
is a set of promises about what does and does not consume quota; a `CHECK` turns one of them into
something the database will not let the code break.

**Indexes.**
- `ix_aie_user_time (user_id, started_at DESC)` — per-user audit trail and quota reconstruction.
- `ix_aie_cost (started_at DESC) INCLUDE (cost_usd, prompt_tokens, completion_tokens) WHERE NOT pre_routed` — the spend dashboard, covering, and partial so free turns don't bloat it.
- `ix_aie_open (started_at) WHERE finished_at IS NULL` — **unclosed envelopes.** Should always be empty; if it isn't, a code path exits without closing the audit, which is precisely the failure invariant 4 exists to prevent. Monitor it.
- `ix_aie_outcome_time (outcome, started_at DESC) WHERE outcome IN ('ERROR','REJECTED')` — reliability review.

**Relationships & cascade.**
| FK | Class | Why |
|---|---|---|
| `user_id` → `users` | **C2 RESTRICT** | §3.4 — an unattributable AI execution is worthless. Users are soft-deleted, never purged |
| `session_id` → `ai_sessions` | **C3 SET NULL** | Deleting a chat must not erase what it did |
| `plan_id` → `ai_plans` | **C3 SET NULL** | |
| ← `ai_tool_invocations` | **C1 CASCADE** | |

**Performance.** One row per turn. Append, then one update to close. `fillfactor = 85`.

**Scalability.** Grows with usage, never with ledger size. Retention: **never delete.** This is the
compliance record for a system that can move money. At a few thousand turns per year it costs
kilobytes. If it ever mattered, partition by `RANGE (started_at)` yearly — but say plainly that at
this deployment it will not.

---

### 11.5 `ai_tool_invocations`

**Purpose.** One row per tool the executor actually ran. Normalizes what would otherwise be a
`tools_invoked jsonb[]` blob on `ai_executions`.

**Why normalize this.** The audit question is "which role executed `contract.approve` last quarter,
and on what". Against a JSON array that is a `jsonb_array_elements` unnest with no index. Against a
table it is an index scan. Auditability that requires a full scan is auditability nobody performs.
This is the clearest case in the schema where 1NF pays for itself.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `bigint` | no | Identity |
| `execution_id` | `uuid` | no | |
| `sequence` | `smallint` | no | Order within the plan |
| `tool_name` | `text` | no | `'contract.approve'` |
| `tool_mode` | `AiToolMode` | no | `{READ, WRITE}` |
| `permission_key` | `text` | no | The permission checked against the **live** principal |
| `args` | `jsonb` | no | Redacted |
| `status` | `AiToolStatus` | no | `{OK, DENIED, FAILED, SKIPPED}` |
| `denied_reason` | `text` | yes | |
| `entity_type` | `text` | yes | What it touched |
| `entity_id` | `uuid` | yes | |
| `duration_ms` | `int` | yes | |
| `created_at` | `timestamptz(3)` | no | |

**Constraints.** `PK (id)` · `uq_ati_exec_seq (execution_id, sequence)` · `ck_ati_denied CHECK (status <> 'DENIED' OR denied_reason IS NOT NULL)`.

**The structural guarantee.** §5.4: *"A `QUESTION` turn may only bind `READ` tools, enforced
structurally — a question can never park a mutation."* That is a type-level guarantee in code. Its
database shadow is auditable: `SELECT … FROM ai_tool_invocations i JOIN ai_executions e ON … WHERE
e.mode = 'QUESTION' AND i.tool_mode = 'WRITE'` must return zero rows, forever. Make it a test and a
monitored query. A guarantee you cannot *check* after the fact is a comment.

**Indexes.** `uq_ati_exec_seq` (access path) · `ix_ati_tool_time (tool_name, created_at DESC)` — "who approved contracts via AI" · `ix_ati_entity (entity_type, entity_id) WHERE entity_id IS NOT NULL` — "what did the AI ever do to this project", the reverse-lookup an auditor actually asks · `ix_ati_denied (created_at DESC) WHERE status = 'DENIED'` — attempted-privilege-escalation review, and the first place to look after a prompt-injection report.

**Cascade.** `execution_id` → **C1 CASCADE**. `permission_key` → **no FK** to `permissions.key`: the invocation records the permission that *was* checked, even if that key is later retired. A snapshot, by the §6.3 argument.

**Performance / scalability.** A few rows per execution. Append-only.

---

### 11.6 `ai_usage_counters`

**Purpose.** Per-user quota, durable across restarts. §5's governance ring reads this before the model
is called.

| Column | Type | Null | Notes |
|---|---|---|---|
| `user_id` | `uuid` | no | |
| `period_kind` | `QuotaPeriod` | no | `{DAY, MONTH}` |
| `period_start` | `date` | no | |
| `request_count` | `int` | no | `0` |
| `token_count` | `bigint` | no | `0` |
| `cost_usd` | `numeric(12,6)` | no | `0` |
| `updated_at` | `timestamptz(3)` | no | |

**Constraints.** `PK (user_id, period_kind, period_start)` — natural composite; makes the increment a single `INSERT … ON CONFLICT DO UPDATE SET request_count = ai_usage_counters.request_count + 1`, which is atomic under concurrency without a lock. `ck_auc_nonneg CHECK (request_count >= 0 AND token_count >= 0 AND cost_usd >= 0)`.

**Indexes.** PK only.

**Why a counter table and not `SELECT count(*) FROM ai_executions`.** The aggregate is correct and gets
slower every day, and it runs on the *pre-model* path where latency is the user's first impression.
A counter is O(1) forever. The reconciliation job (§9.2) recomputes it from `ai_executions` nightly
and alarms on divergence — the same cache-with-reconciliation posture as `projects.progress_percentage`
(§7.1), applied consistently.

**The circuit breaker is deliberately not here.** Per-user breaker state (§5.3) is in-process memory:
there is exactly one service (§0), the state is worthless after a restart (you *want* a restarted
service to retry the provider), and persisting it would add a write to the hot path for no benefit.
Named so its absence reads as a decision.

**Cascade.** `user_id` → **C1 CASCADE**.

**Performance / scalability.** `users × periods`. Delete rows older than 90 days.

---

### 11.7 `recommendations`

**Purpose.** *This is the "AI Recommendations" table.* Turns the ledger into advice without turning it
into a black box. Decision #9: **every recommendation carries an explanation and evidence the user can
open.**

> "An unexplained recommendation in a financial tool is worse than no recommendation: it either gets
> blindly trusted or permanently ignored, and both outcomes are bad."

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | no | |
| `tier` | `RecommendationTier` | no | `{RULE, STATISTICAL, SEMANTIC}` — §10.5's tiers 0/1/2 |
| `kind` | `text` | no | `'payment.overdue_cluster'`, `'material.price_drift'`, `'project.cost_overrun'` |
| `severity` | `RecommendationSeverity` | no | `{INFO, WARNING, CRITICAL}` |
| `title` | `text` | no | Arabic |
| `body` | `text` | no | Arabic |
| `explanation` | `text` | no | **NOT NULL.** *How* this was concluded |
| `score` | `numeric(6,4)` | yes | Confidence / ranking. Null for `RULE` — a rule is not confident, it is *true* |
| `entity_type` | `text` | yes | Primary subject |
| `entity_id` | `uuid` | yes | |
| `status` | `RecommendationStatus` | no | `{NEW, ACKNOWLEDGED, DISMISSED, ACTED}` |
| `dedupe_key` | `text` | no | `<kind>:<entity_id>:<period>` |
| `generated_by_job_id` | `bigint` | yes | Provenance → `jobs.id` |
| `acted_plan_id` | `uuid` | yes | → `ai_plans.id` — the plan this recommendation pre-filled |
| `acknowledged_by` | `uuid` | yes | |
| `dismissed_reason` | `text` | yes | |
| `valid_from` | `date` | no | |
| `expires_at` | `timestamptz(3)` | yes | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | |

**Constraints.**
- `PK (id)`
- `uq_rec_dedupe (dedupe_key) WHERE status IN ('NEW','ACKNOWLEDGED')` — **partial unique.** The nightly generator re-proposes the same finding every night; this collapses it to one live row. Crucially it is scoped to *live* statuses, so a **dismissed** recommendation can legitimately reappear next quarter when the condition recurs — while a still-open one cannot be duplicated. Making the unique unconditional would silently suppress recurrences forever; that is the bug this partial predicate exists to prevent.
- `ck_rec_explanation CHECK (length(btrim(explanation)) > 0)` — decision #9, enforced. An empty explanation is not a recommendation.
- `ck_rec_rule_no_score CHECK (tier <> 'RULE' OR score IS NULL)`
- `ck_rec_score_range CHECK (score IS NULL OR score BETWEEN 0 AND 1)`
- `ck_rec_dismissed CHECK (status <> 'DISMISSED' OR dismissed_reason IS NOT NULL)`
- `ck_rec_entity_pair CHECK ((entity_type IS NULL) = (entity_id IS NULL))`

**Indexes.**
- `ix_rec_open (severity DESC, created_at DESC) WHERE status = 'NEW'` — the dashboard panel, most severe first. Partial: sized by open findings, not history.
- `ix_rec_entity (entity_type, entity_id) WHERE entity_id IS NOT NULL` — "advice about this project".
- `ix_rec_kind_time (kind, created_at DESC)` — tuning: how often does this rule fire, and how often is it dismissed? A rule with a 95% dismissal rate is noise and should be deleted. That query is the reason `dismissed_reason` is `NOT NULL` when dismissed.

**Relationships & cascade.**
| FK | Class | Why |
|---|---|---|
| ← `recommendation_evidence` | **C1 CASCADE** | Evidence has no life without its claim |
| `acted_plan_id` → `ai_plans` | **C3 SET NULL** | |
| `generated_by_job_id` → `jobs` | **C3 SET NULL** | `jobs` rows are purged after 7 days |
| `acknowledged_by` → `users` | **C3 SET NULL** | |
| `entity_id` | polymorphic, **no FK** | |

**Surfaced, never executed.** §10.5: a recommendation may *pre-fill* an AI plan, which then walks the
ordinary preview-and-confirm gate of §5.2. `acted_plan_id` is the link, and it points **to** a plan
rather than the plan pointing back — because the recommendation is the cause and the plan is the
effect, and because a plan created by hand has no recommendation. There is no autonomous write path
anywhere in this architecture, and no column here could create one.

**Performance.** Small. The `NEW`-partial index keeps the dashboard O(open findings).

**Scalability.** Retention: delete `DISMISSED` older than a year. Keep `ACTED` — it is the evidence
that the advice was worth generating, and the only data from which the rules can ever be tuned.

---

### 11.8 `recommendation_evidence`

**Purpose.** The `evidence[]` of decision #9 — the record ids the user can open. Normalized out of a
JSON array for exactly the §11.5 reason: an auditor's question ("which recommendations cited *this*
payment?") must be an index scan.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `bigint` | no | Identity |
| `recommendation_id` | `uuid` | no | |
| `sequence` | `smallint` | no | Display order |
| `entity_type` | `text` | no | `'payment'`, `'project_cost'`, `'material_price_history'` |
| `entity_id` | `text` | no | **`text`, not `uuid`** — cited rows include `bigint`-keyed history |
| `label` | `text` | no | Arabic, human-readable: "دفعة متأخرة 42 يوم" |
| `value` | `text` | yes | The number that made the case |
| `created_at` | `timestamptz(3)` | no | |

**Constraints.** `PK (id)` · `uq_re_rec_seq (recommendation_id, sequence)` · `uq_re_rec_entity (recommendation_id, entity_type, entity_id)` — citing the same row twice is a generator bug.

**Indexes.** `uq_re_rec_seq` (access path) · `ix_re_entity (entity_type, entity_id)` — the reverse lookup.

**Cascade.** `recommendation_id` → **C1 CASCADE**. `entity_id` polymorphic, no FK.

**Why `entity_id` is `text` here and `uuid` elsewhere.** Evidence cites `material_price_history`, whose
PK is `bigint` (D8). A polymorphic column that must hold both a UUID and a bigint has one honest type,
and it is `text`. The alternative — two nullable columns with a `CHECK` — is more precise and less
usable. This is the one place D8's mixed-key strategy costs something, and the price is one column
type. Worth naming rather than discovering.

**Performance / scalability.** A few rows per recommendation. Append-only.

---

### 11.9 `ai_reports`

**Purpose.** *This is the "AI Reports" table.* A narrative analytical report — generated on demand or
on a schedule, over a period, with its data snapshot frozen at generation time.

**Why it is not `generated_documents`.** That table records a *rendered artefact* (a file on disk). An
`ai_report` is the **content**: parameters, a data snapshot, an LLM-written narrative, and a status
lifecycle. One report may be rendered to zero, one, or several DOCX files; `generated_documents.ai_report_id`
(§5.5) is that link. Conflating them means either a file row with no data or a data row that cannot be
re-rendered when the template changes.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | no | |
| `kind` | `AiReportKind` | no | `{CASH_FLOW, PROFITABILITY, PROJECT_STATUS, SUPPLIER_REVIEW, COST_ANALYSIS}` |
| `title` | `text` | no | |
| `parameters` | `jsonb` | no | Period, filters, project ids — what was asked |
| `period_start` / `period_end` | `date` | no | |
| `status` | `AiReportStatus` | no | `{QUEUED, RUNNING, READY, FAILED}` |
| `data_snapshot` | `jsonb` | yes | **The numbers, frozen.** Populated before the LLM is called |
| `narrative` | `text` | yes | The Arabic prose. LLM-written |
| `summary` | `text` | yes | One paragraph, for the list view |
| `execution_id` | `uuid` | yes | → `ai_executions.id` — cost and token attribution |
| `job_id` | `bigint` | yes | When scheduled rather than requested |
| `requested_by` | `uuid` | yes | |
| `error_message` | `text` | yes | |
| `started_at` / `completed_at` | `timestamptz(3)` | yes | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | |

**Constraints.**
- `PK (id)`
- `ck_air_period CHECK (period_end >= period_start)`
- `ck_air_ready CHECK (status <> 'READY' OR (data_snapshot IS NOT NULL AND completed_at IS NOT NULL))`
- `ck_air_failed CHECK (status <> 'FAILED' OR error_message IS NOT NULL)`
- `ck_air_requester CHECK (requested_by IS NOT NULL OR job_id IS NOT NULL)` — a report with no requester and no schedule appeared from nowhere.

**`data_snapshot` is computed first, and it is what makes the report trustworthy.** The pipeline is:
deterministic SQL over the **read models** → freeze the numbers into `data_snapshot` → hand *those
numbers* to the LLM → store the prose in `narrative`. The model never queries, never sums, and never
emits a figure that is not already in the snapshot. This is §5.1 invariant 3 ("the model never emits
money or quantities") applied to reporting, and it means a report can be re-rendered, re-translated,
or re-narrated years later against the numbers as they were understood that day — which is precisely
what `fact_project_daily` (§10.3) exists to make possible.

A report whose narrative disagrees with its snapshot is detectable. A report that re-queries live data
at render time silently rewrites history.

**Indexes.** `ix_air_kind_period (kind, period_end DESC)` — the report library. `ix_air_status (created_at DESC) WHERE status IN ('QUEUED','RUNNING')` — the in-progress tray, and the stale-run reaper. `ix_air_requester (requested_by, created_at DESC) WHERE requested_by IS NOT NULL`.

**Relationships & cascade.**
| FK | Class | Why |
|---|---|---|
| `execution_id` → `ai_executions` | **C3 SET NULL** | |
| `job_id` → `jobs` | **C3 SET NULL** | Job rows are purged after 7 days |
| `requested_by` → `users` | **C3 SET NULL** | The report's numbers stand alone |
| ← `generated_documents.ai_report_id` | **C3 SET NULL** | |

**Performance.** `data_snapshot` and `narrative` TOAST. Never `SELECT *` in the list view — that is
what `summary` is for, and why it is a separate column rather than `left(narrative, 300)`.

**Scalability.** Tens per year. Retention: keep forever; they are cheap and they are the record of what
the business believed.

---

## 12. Platform configuration & audit

Generic subdomains. Four small tables and one that matters a great deal.

### 12.1 `system_settings`

**Purpose.** Typed key/value bag for org-wide toggles that do not deserve a column anywhere.

| Column | Type | Null | Notes |
|---|---|---|---|
| `key` | `text` | no | PK. Module-prefixed: `general.fiscalYearStart` |
| `value` | `jsonb` | no | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | |

**Constraints.** `PK (key)` · `ck_ss_key_prefixed CHECK (key LIKE '%.%')` — an unprefixed key is a future collision.

**Indexes.** PK only. **Cascade.** None.

**Performance / scalability.** Read once at boot into an in-process config object, invalidated on
write. Under 50 rows. Resist the pull to put anything with a foreign key here — a settings bag with
relationships is a table that lost its nerve.

---

### 12.2 `currencies`

**Purpose.** Catalog of currencies with exactly one default. Money values on existing rows are **not**
touched when the default changes: currency affects **display formatting only** (§7 of the live schema's
own comment, preserved).

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | no | |
| `code` | `text` | no | ISO-ish, uppercased on write |
| `name` / `symbol` | `text` | no | |
| `symbol_position` | `CurrencySymbolPosition` | no | `{BEFORE, AFTER}` |
| `decimal_precision` | `smallint` | no | `2` |
| `thousand_separator` / `decimal_separator` | `text` | no | |
| `is_active` / `is_default` | `boolean` | no | |
| `created_at` / `updated_at` | `timestamptz(3)` | no | |

**Constraints.** `PK (id)` · `uq_currencies_code (code)` · `uq_currencies_default () WHERE is_default` — **partial unique on no columns**, the idiom for "at most one row satisfies this predicate". Already present in the live schema as a hand-written migration because Prisma cannot express it; it is the model for `supplier_materials.is_preferred` (§4.4) and `document_templates.is_default` (§5.4). · `ck_cur_precision CHECK (decimal_precision BETWEEN 0 AND 6)` · `ck_cur_code CHECK (code = upper(code))`.

**Indexes.** The two uniques suffice. **Dropped:** `@@index([isDefault])`, `@@index([isActive])` (D7).

**Cascade.** No FK anywhere — deliberately. Money columns carry **no** `currency_code`. See §17 for
what changes the day that stops being true.

---

### 12.3 `company_profile`

**Purpose.** Singleton (`id = 'default'`). Org details, logo, stamp. **Binary blobs are never stored in
the database** — only the relative path and the validated MIME type.

**Constraints.** `PK (id)` · `ck_cp_singleton CHECK (id = 'default')` — the live schema enforces the singleton *in code* ("refuse extra rows"). A one-line `CHECK` does it in the database, and no amount of future refactoring can bypass it.

Columns as today, plus `file_hash` on the two asset paths for the same reason as §5.4.

**Cascade.** None. **Performance / scalability.** One row.

---

### 12.4 `tunnel_state`

**Purpose.** Singleton. Only what the local agent needs to render a status orb; cloudflared credentials
live on disk and the management server owns the rest.

**Constraints.** `PK (id)` · `ck_ts_singleton CHECK (id = 'default')` — same fix as §12.3; the live
schema uses a `uuid` PK with no singleton guard, so a second row is currently representable and would
produce a nondeterministic status display.

**Cascade.** None. **Performance / scalability.** One row.

---

### 12.5 `audit_logs`

**Purpose.** The immutable trail of *what happened to the data*. No soft delete: an audit row that can
be deleted is not an audit row.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `bigint` | no | Identity (D8) — the highest-insert table in the schema |
| `user_id` | `uuid` | yes | Null ⇒ system action |
| `action` | `AuditAction` | no | **D9** — `{CREATE, UPDATE, DELETE, APPROVE, REJECT, EXECUTE, LOGIN, LOGOUT, EXPORT}` |
| `entity` | `text` | no | |
| `entity_id` | `text` | no | `text`: spans uuid- and bigint-keyed tables (§11.8's reasoning) |
| `old_values` | `jsonb` | yes | |
| `new_values` | `jsonb` | yes | |
| `changed_fields` | `text[]` | yes | *Added* — the diff's key set, so "who ever changed `total_price`" is answerable |
| `actor_type` | `AuditActorType` | no | *Added* — `{HUMAN, AI, SYSTEM, IMPORT}` |
| `ai_execution_id` | `uuid` | yes | *Added* — set when `actor_type = 'AI'` |
| `ip_address` | `inet` | yes | |
| `user_agent` | `text` | yes | |
| `trace_id` | `text` | yes | Joins to `outbox_events` and `ai_executions` |
| `created_at` | `timestamptz(3)` | no | |

**Constraints.**
- `PK (id)`
- `ck_al_ai_actor CHECK (actor_type <> 'AI' OR ai_execution_id IS NOT NULL)` — an AI-attributed change that cannot name its execution breaks the §5.1 invariant-4 chain from *row* to *turn* to *human*.
- `ck_al_human_actor CHECK (actor_type <> 'HUMAN' OR user_id IS NOT NULL)`
- `ck_al_values CHECK (action <> 'UPDATE' OR (old_values IS NOT NULL AND new_values IS NOT NULL))`

**D9, and why it matters.** With only `{CREATE, UPDATE, DELETE}`, approving a contract and editing its
notes are the same audit action, and a login is unrecordable. §5.1 promises the AI's every effect is
auditable; the executor calls the same Application services as the human path, which emit
`APPROVE`/`EXECUTE`. The enum must be able to say so.

**`actor_type` closes the loop.** §11.4 records *that* an AI turn happened; `audit_logs` records *what
it changed*. Without `actor_type` + `ai_execution_id`, answering "show me every row the assistant ever
touched" requires joining through `ai_tool_invocations.entity_id` and hoping the executor recorded it.
With them, it is one index scan. Two columns turn a promise into a query.

**Immutability, enforced.** `REVOKE UPDATE, DELETE ON audit_logs FROM <app_role>`. The application user
gets `INSERT` and `SELECT`, nothing else. Left as a grant rather than a trigger because a trigger can
be dropped by whoever can drop the table, and neither defends against a compromised superuser — but the
grant defends against the far likelier threat, which is application code with a bug.

**Indexes.**
- `ix_al_entity (entity, entity_id, created_at DESC)` — the record's history tab. The dominant query.
- `ix_al_user_time (user_id, created_at DESC) WHERE user_id IS NOT NULL` — "what did this user do".
- `ix_al_ai (ai_execution_id) WHERE ai_execution_id IS NOT NULL` — the AI trail.
- `ix_al_created_brin` **BRIN** on `created_at` — append-only, perfectly correlated with physical order. Serves "everything in March" at ~0.1% of a B-tree's size. The live schema's `@@index([createdAt])` B-tree is the single most expensive index in the database for what it returns.
- `ix_al_changed_fields` **GIN** on `changed_fields` — only if the "who changed this column" query proves real. Do not add it speculatively.

**Cascade.** `user_id` → **C3 SET NULL** (§3.4: the fact outlives the actor). `ai_execution_id` → **C2 RESTRICT** (`ai_executions` is never deleted). `entity_id` polymorphic, no FK — an audit row about a deleted entity is often the *only* remaining evidence it existed, which is the strongest possible argument against an FK.

**Performance.** Written on every mutation, inside the caller's transaction. Two things follow: the
insert must be *cheap* (hence `bigint` identity, hence no indexes beyond the four above), and
`old_values`/`new_values` must be diffed, not dumped — storing the full row twice per update triples
the table's size for no query anyone runs.

**Scalability.** The one table that genuinely grows without bound. Honest accounting:
- At this deployment, ~10⁵–10⁶ rows/decade. BRIN + the entity index handle it indefinitely. **Do nothing.**
- Retention is a *policy* question, not a performance one. A financial audit trail is typically kept 7–10 years; deleting it to save 200 MB is a bad trade.
- If it ever mattered: `PARTITION BY RANGE (created_at)` yearly, with the BRIN per partition and old partitions moved to a slower tablespace. The `bigint` PK and the absence of inbound FKs make that a mechanical change — which is the *reason* there are no inbound FKs.

---

## 13. Cascade matrix

Every foreign key, one table. Classes per §1.4. Remember §1.3: **soft delete means these almost never
fire.** They are the backstop that turns a bad `DELETE` into an error instead of an orphan.

| Child | Column | Parent | Action | Class |
|---|---|---|---|---|
| `role_permissions` | `role_id` | `roles` | CASCADE | C1 |
| `role_permissions` | `permission_id` | `permissions` | CASCADE | C1 |
| `role_permissions` | `granted_by` | `users` | SET NULL | C3 |
| `users` | `role_id` | `roles` | RESTRICT | C4 |
| `refresh_tokens` | `user_id` | `users` | CASCADE | C1 |
| `refresh_tokens` | `replaced_by_id` | `refresh_tokens` | SET NULL | C3 |
| `materials` | `unit_code` | `units_of_measure` | RESTRICT | C2 |
| `supplier_materials` | `supplier_id` | `suppliers` | CASCADE | C1 |
| `supplier_materials` | `material_id` | `materials` | CASCADE | C1 |
| `supplier_materials` | `unit_code` | `units_of_measure` | RESTRICT | C2 |
| `material_price_history` | `material_id` | `materials` | RESTRICT | C2 |
| `material_price_history` | `supplier_id` | `suppliers` | SET NULL | C3 |
| `material_price_history` | `source_cost_id` | `project_costs` | SET NULL | C3 |
| `material_price_history` | `recorded_by` | `users` | SET NULL | C3 |
| `building_templates` | `parent_template_id` | `building_templates` | SET NULL | C3 |
| `building_template_items` | `template_id` | `building_templates` | CASCADE | C1 |
| `building_template_items` | `material_id` | `materials` | RESTRICT | C2 |
| `building_template_items` | `unit_code` | `units_of_measure` | RESTRICT | C2 |
| `building_template_steps` | `template_id` | `building_templates` | CASCADE | C1 |
| `document_templates` | `created_by` | `users` | SET NULL | C3 |
| `generated_documents` | `template_id` | `document_templates` | RESTRICT | C2 |
| `generated_documents` | `contract_id` | `contracts` | SET NULL | C3 |
| `generated_documents` | `project_id` | `projects` | SET NULL | C3 |
| `generated_documents` | `customer_id` | `customers` | SET NULL | C3 |
| `generated_documents` | `ai_report_id` | `ai_reports` | SET NULL | C3 |
| `generated_documents` | `generated_by` | `users` | SET NULL | C3 |
| `contracts` | `customer_id` | `customers` | RESTRICT | C4 |
| `contracts` | `template_id` | `building_templates` | SET NULL | C3 |
| `contracts` | `approved_by` | `users` | SET NULL | C3 |
| `contract_items` | `contract_id` | `contracts` | CASCADE | C1 |
| `contract_items` | `material_id` | `materials` | RESTRICT | C2 |
| `contract_items` | `unit_code` | `units_of_measure` | RESTRICT | C2 |
| `change_orders` | `contract_id` | `contracts` | CASCADE | C1 |
| `change_orders` | `approved_by` | `users` | SET NULL | C3 |
| `change_orders` | `reversed_by_id` | `change_orders` | SET NULL | C3 |
| `projects` | `contract_id` | `contracts` | RESTRICT | C2 |
| `construction_steps` | `project_id` | `projects` | CASCADE | C1 |
| `project_costs` | `project_id` | `projects` | **RESTRICT** ⚠ | C2 |
| `project_costs` | `material_id` | `materials` | RESTRICT | C2 |
| `project_costs` | `supplier_id` | `suppliers` | RESTRICT | C2 |
| `project_costs` | `unit_code` | `units_of_measure` | RESTRICT | C2 |
| `project_costs` | `created_by` | `users` | SET NULL | C3 |
| `overhead_expenses` | `supplier_id` | `suppliers` | RESTRICT | C2 |
| `overhead_expenses` | `created_by` | `users` | SET NULL | C3 |
| `payments` | `project_id` | `projects` | **RESTRICT** ⚠ | C2 |
| `jobs` | `schedule_id` | `job_schedules` | SET NULL | C3 |
| `job_dead_letters` | `resolved_by` | `users` | SET NULL | C3 |
| `notifications` | `user_id` | `users` | CASCADE | C1 |
| `fact_project_daily` | `project_id` | `projects` | CASCADE | C1 |
| `ai_sessions` | `user_id` | `users` | CASCADE | C1 |
| `ai_messages` | `session_id` | `ai_sessions` | CASCADE | C1 |
| `ai_messages` | `execution_id` | `ai_executions` | SET NULL | C3 |
| `ai_plans` | `session_id` | `ai_sessions` | CASCADE | C1 |
| `ai_plans` | `execution_id` | `ai_executions` | RESTRICT | C2 |
| `ai_plans` | `user_id` | `users` | RESTRICT | C2 |
| `ai_executions` | `user_id` | `users` | **RESTRICT** | C2 |
| `ai_executions` | `session_id` | `ai_sessions` | **SET NULL** | C3 |
| `ai_executions` | `plan_id` | `ai_plans` | SET NULL | C3 |
| `ai_tool_invocations` | `execution_id` | `ai_executions` | CASCADE | C1 |
| `ai_usage_counters` | `user_id` | `users` | CASCADE | C1 |
| `recommendations` | `acted_plan_id` | `ai_plans` | SET NULL | C3 |
| `recommendations` | `generated_by_job_id` | `jobs` | SET NULL | C3 |
| `recommendations` | `acknowledged_by` | `users` | SET NULL | C3 |
| `recommendation_evidence` | `recommendation_id` | `recommendations` | CASCADE | C1 |
| `ai_reports` | `execution_id` | `ai_executions` | SET NULL | C3 |
| `ai_reports` | `job_id` | `jobs` | SET NULL | C3 |
| `ai_reports` | `requested_by` | `users` | SET NULL | C3 |
| `audit_logs` | `user_id` | `users` | SET NULL | C3 |
| `audit_logs` | `ai_execution_id` | `ai_executions` | RESTRICT | C2 |

⚠ = **changed from the live schema's `CASCADE`.** See §7.1. Money outranks structure.

**No foreign key, deliberately:** `outbox_events.aggregate_id`, `notifications.entity_id`,
`search_documents.entity_id`, `embeddings.entity_id`, `recommendations.entity_id`,
`recommendation_evidence.entity_id`, `audit_logs.entity_id`, `job_dead_letters.original_job_id`,
`ai_tool_invocations.permission_key`. Each is either polymorphic across many tables, or must
deliberately outlive its referent. Both reasons are stated at the table.

**The three FK clauses worth reading twice.**

1. `ai_executions.session_id` **SET NULL** while `ai_messages.session_id` **CASCADE**. Deleting a
   conversation erases the chat and preserves the record that the assistant approved a payment.
2. `ai_executions.user_id` **RESTRICT** while `audit_logs.user_id` **SET NULL**. The audit records what
   happened to the data and survives an anonymous actor; the AI execution exists to name the human who
   let the model act, and is worthless without one.
3. `contract_items` **CASCADE** and `projects` **RESTRICT**, off the same `contracts` parent. That is
   the aggregate boundary, written in DDL.

---

## 14. Index strategy

### 14.1 The rule

> An index earns its place by naming the query it serves. An index that cannot name one is a write
> tax collected forever.

Every index in this document names its query. Twenty-two indexes from the live schema do not, and are
dropped.

### 14.2 What was dropped, and why (D7)

The live schema places `@@index([deletedAt])` on seven tables and `@@index([status])` on five. Both are
near-worthless, for the same reason: **a B-tree over a column whose values are ~100% identical is one
enormous key.** `deleted_at` is `NULL` for essentially every row; `status` has three to five values.
The planner will choose a sequential scan and be right to. Meanwhile every insert pays to maintain
them.

The replacement is the **partial index**, and it inverts the economics:

| Instead of | Use | Why |
|---|---|---|
| `(deleted_at)` | `(name) WHERE deleted_at IS NULL` | The index holds only live rows — which is every row the application ever queries — and also serves the sort |
| `(status)` | `(status, created_at DESC) WHERE deleted_at IS NULL` | Low-cardinality leading columns are only useful when a second column makes the pair selective |
| `(due_date)` | `(due_date) WHERE status IN ('PENDING','PARTIAL') AND deleted_at IS NULL` | Sized by *collectible* payments, not by a decade of settled ones |
| `(dispatched_at)` | `(id) WHERE dispatched_at IS NULL` | Sized by the *backlog*. In steady state: empty |

The partial index on `payments` (§8.3) and on `outbox_events` (§9.1) are the two that make the
architecture's performance claims true. Both stay constant-size as history grows. That is what
"reads scale with read models, not history" means at the index level.

### 14.3 Index types, and where each earns its keep

| Type | Used on | Why there and nowhere else |
|---|---|---|
| **B-tree** | Everything by default | |
| **Partial B-tree** | Soft-delete filters, queue claims, unread counts, open findings | The dominant idiom of this schema. ~30 of its indexes |
| **Covering (`INCLUDE`)** | `contract_items`, `project_costs`, `payments`, `change_orders`, `ai_executions`, `fact_project_daily` | The grid or aggregate reads only indexed columns → index-only scan, zero heap fetches. Only worth it when the visibility map is fresh, i.e. on read-heavy tables that autovacuum keeps up with |
| **GIN (trigram)** | `customers.name`, `projects.name`, `materials.name`, `suppliers.name`, `contracts.contract_number`, `search_documents.title_norm` | The **primary** Arabic mechanism. Script-agnostic; handles prefixed `ال` and suffixed pronouns, which no Postgres stemmer will |
| **GIN (tsvector)** | `search_documents.search_vector` | Lexical half of the ranking |
| **BRIN** | `audit_logs.created_at`, `material_price_history.observed_on`, `project_costs.date`, `fact_project_daily.snapshot_date` | Append-only tables whose physical order correlates with time. ~0.1% the size of a B-tree, and range-prunes year-scale scans. **Wrong everywhere else** — BRIN on an updated table degrades to a full scan silently |
| **HNSW** | `embeddings.embedding` — *when > ~10k rows* | D2 |
| **Partial unique** | `contracts.contract_number`, `currencies.is_default`, `supplier_materials.is_preferred`, `document_templates.is_default`, `recommendations.dedupe_key`, `notifications.idempotency_key`, every soft-deleted natural key | Expresses "at most one, among the rows that count" — an invariant this schema needs eight times and Prisma cannot declare |

### 14.4 Foreign keys are not indexed automatically

Postgres indexes the **referenced** side (the PK) and not the **referencing** side. Every FK column in
§13 that is not already the leading column of some index needs one, or `DELETE`/`UPDATE` on the parent
triggers a sequential scan of the child — and, worse, holds a lock while it runs. The FK-side indexes
are listed per table; `role_permissions.permission_id` and `contract_items.material_id` are the two
most often forgotten.

---

## 15. Normalization audit

The brief said *normalize the schema*. Here is the honest reckoning: what reaches 3NF/BCNF, what does
not, and why each exception is a decision rather than a lapse.

### 15.1 What normalization fixed

| Violation | Where it was | Fix |
|---|---|---|
| **1NF** — repeating group | `tools_invoked` as a JSON array on the AI turn | `ai_tool_invocations` (§11.5). Turns an unindexable `jsonb_array_elements` unnest into an index scan |
| **1NF** — repeating group | `evidence[]` as a JSON array on a recommendation | `recommendation_evidence` (§11.8) |
| **2NF/3NF** — transitive dependency | `unit` free text on four tables; the unit's *name*, *dimension*, and *precision* depend on the unit, not on the line item | `units_of_measure` (§4.1) |
| **3NF** — M:N encoded as a repeated string | supplier identity repeated per price observation | `suppliers` + `supplier_materials` (§4.3, §4.4) |
| **Missing entity** | Price over time had nowhere to live, so §10.5 tier 1 was uncomputable | `material_price_history` (§4.5) |
| **Missing decomposition** | `payments.amount` conflating *scheduled* and *paid* | `scheduled_amount` + `paid_amount` (§8.3, D4) |

### 15.2 Denormalizations kept, each with its justification

Not every duplicate is a violation. The test is: **does the attribute depend on this row's key, or on
another table's key?**

| Column | Looks like | Actually is | Guard |
|---|---|---|---|
| `contract_items.material_name`, `.estimated_price`, `.unit_code` | A copy of `materials` | A **temporal snapshot** — what the material was called and cost *at signature*. It depends on the contract line's key, not the material's. A later catalog edit must not restate a signed contract (decision #12) | Immutable by aggregate rule; `materials` is `RESTRICT`-protected so the reference survives |
| `construction_steps.name`, `.percentage` | A copy of `building_template_steps` | Same. The project's plan as it was when the project began | Same |
| `contract_items.line_total` | `quantity × estimated_price` | A **materialized derivation** kept only because `SUM(line_total)` can be index-only and `SUM(q*p)` cannot | `CHECK (line_total = round(quantity * estimated_price, 4))`, or better: `GENERATED ALWAYS AS … STORED` |
| `project_costs.total_amount` | Same | Same | `ck_pc_line_math` |
| `projects.progress_percentage` | Σ of completed steps | A **cache with reconciliation.** The list view sorts and filters on it; a correlated subquery per row across a paginated grid is the exact failure §10.4 warns of | Written only by the aggregate on step transition; a nightly job recomputes and alarms on divergence (§7.1) |
| `ai_usage_counters.*` | `count(*)` over `ai_executions` | A **cache** on the pre-model latency path, where the aggregate gets slower every day | Nightly reconciliation against `ai_executions` (§11.6) |
| `ai_sessions.message_count` | `count(*)` over `ai_messages` | Same, for the session list | Aggregate-maintained |
| `permissions.module`, `.action` | Split of `key` | Redundant, but grouping the role editor by `module` should not parse strings | `ck_permissions_key_shape CHECK (key = module \|\| '.' \|\| action)` — self-enforcing |
| `search_documents.*`, `embeddings.*`, `fact_project_daily.*`, all matviews | Copies of everything | **Read models.** Disposable and rebuildable by definition (§10) | Dropping and rebuilding them is a supported operation, not an incident |

The pattern: every kept denormalization has a **guard** — a `CHECK`, a generated column, a single
writer, or a reconciliation job. A denormalization without a guard is just a bug that has not been
observed yet.

### 15.3 The one derivation deliberately *not* stored

`contracts.revised_total`. It is the number the entire product is about, and storing it would create a
second source of truth for it. The partial covering index `ix_co_contract_approved` (§6.4) makes the
subquery a single index range scan, and `mv_project_profitability` carries it for the dashboard. §6.2
sets out the full argument.

### 15.4 Polymorphic columns — the deliberate exception to referential integrity

Nine columns hold an `entity_type` + `entity_id` pair with **no** foreign key: the outbox, search,
embeddings, notifications, recommendations, evidence, and the audit log. This is a real cost — the
database cannot stop a dangling reference — accepted for three reasons that differ per table:

1. **It must outlive its referent.** An `audit_logs` row about a deleted entity is often the only proof it existed. An FK would make the delete impossible or the audit row disappear with it. Both are unacceptable.
2. **It spans a dozen tables.** The alternative is twelve nullable typed columns plus a `CHECK (num_nonnulls(...) = 1)`. That is more precise, and it is unusable: every consumer writes a twelve-way `COALESCE`.
3. **The table is rebuildable.** For `search_documents` and `embeddings`, integrity is maintained by a single projector and restored by a backfill. The cost of a dangling row is bounded by one job run.

Reason 3 does **not** apply to `search_documents`' *staleness*, which is a correctness bug with a write
path attached — hence D10's explicit deletion requirement.

---

## 16. Performance

### 16.1 The shape of the problem

One office PC, 1–10 humans, Postgres on the same machine as the backend and the Electron renderer
(§0). Nothing here is throughput-bound. Two things actually matter:

1. **Perceptual latency.** A grid must render in under ~100 ms. That is an index question, not a
   hardware one.
2. **The tenure curve.** A query whose cost grows with years of history punishes the most loyal user.
   This is the only failure mode this schema genuinely defends against.

### 16.2 The queries that must never degrade

| Query | Guard | Cost as history grows |
|---|---|---|
| Overdue payments sweep + dashboard card | `ix_pay_overdue` (partial) | **Constant.** Sized by unpaid rows |
| Outbox dispatch | `ix_outbox_pending` (partial) | **Constant.** Sized by backlog |
| Job claim | `ix_jobs_claim` (partial) | **Constant.** Sized by queue |
| Unread notification count | `ix_notif_unread` (partial) | **Constant.** Sized by unread |
| Open recommendations panel | `ix_rec_open` (partial) | **Constant.** Sized by open findings |
| Contract `revised_total` | `ix_co_contract_approved` (partial covering) | Constant per contract |
| Project costs grid | `ix_pc_project_date` (covering) | Constant per project |
| Cash flow / profitability dashboard | `mv_*` matviews | Constant. Bounded by read-model size |
| 12-month material baseline | `mv_material_price_baseline`, else `ix_mph_material_time` (covering) | Constant |
| Reports over a date range | BRIN on `date` / `created_at` | Linear in the *range*, not in history |

Every entry is a partial index, a covering index, a BRIN, or a materialized view. That is not a
coincidence; it is the whole design.

### 16.3 Table storage settings

Most tables take the defaults. Five do not, and getting this wrong is how the outbox pattern
famously fails three months in.

| Table | `fillfactor` | Autovacuum | Why |
|---|---|---|---|
| `outbox_events` | 70 | `scale_factor = 0.02` | Insert → update once (`dispatched_at`) → delete. `fillfactor` leaves room for a **HOT** update, which avoids touching the index. Aggressive vacuum stops dead tuples accumulating between the daily purge and the default threshold |
| `jobs` | 70 | `scale_factor = 0.02` | Updated 2–3× per row (claim, finish) |
| `notifications` | 90 | default | Updated once (`read_at`) |
| `ai_plans` | 80 | default | Updated once (claim) |
| `refresh_tokens` | 90 | `scale_factor = 0.05` | Delete-heavy |
| `project_costs`, `audit_logs`, `material_price_history`, `fact_project_daily` | **100** (default) | default | Insert-and-read. Leaving free space would only waste it |

### 16.4 The write path's cost

Every mutation, inside one transaction: the aggregate write, one `audit_logs` insert, one
`outbox_events` insert. Three sequential-key inserts and the index maintenance on the aggregate. This
is why `audit_logs` and `outbox_events` use `bigint` identity (D8) — a random UUIDv4 PK on two tables
written on **every** business transaction scatters inserts across the whole B-tree, splits pages, and
amplifies WAL. It is the single clearest performance mistake available in this schema, and it is
currently present in `audit_logs`.

### 16.5 What is deliberately not optimized

No connection pooler (one process). No read replica (one machine). No partitioning (see §17). No
query cache (Postgres's shared buffers will hold this entire database in RAM — the whole thing is a
few hundred megabytes after a decade). No `pg_stat_statements`-driven tuning until there is a
measured problem.

The scarce resource here is not CPU. It is the reviewer's attention, and it should be spent on the
`CHECK` constraints.

---

## 17. Future scalability

### 17.1 What this schema will absorb without change

Ten years of one contractor's ledgers. Every table's growth is either flat (catalog, identity,
templates), bounded by tenure at a few thousand rows per year (contracts, projects, payments), or
append-only with a BRIN and a read model in front of it (costs, price history, audit, facts). The
constant-cost queries in §16.2 do not care how much history sits behind them.

Concretely, a decade at a busy contractor: ~150k `project_costs`, ~100k `material_price_history`,
~180k `fact_project_daily`, ~1M `audit_logs`. Postgres does not notice numbers like these.

### 17.2 Where it will hurt first, and the response

Mirrors §13 of the architecture, at the table level.

| Pressure | First symptom | Response | Already designed? |
|---|---|---|---|
| Ledger grows | Reports slow | Matviews + `fact_project_daily` | Yes (§10) |
| Many AI turns | Provider **cost**, not CPU | `embeddings.content_hash`, pre-router, `ai_usage_counters` | Yes |
| Documents accumulate | **Disk**, not latency | Retention job nulls `file_path`, keeps the row | Needs `file_path` nullable — one column |
| Notifications pile up | Bell count slows | It doesn't: `ix_notif_unread` is partial | Yes |
| `outbox_events` bloat | Everything slows | `fillfactor` + aggressive autovacuum + batched purge | Yes (§16.3) |
| Audit trail grows | Nothing, for a decade | Then: yearly `RANGE` partitions | Path clear; no inbound FKs |
| Vector count grows | kNN slows past ~10k | Add the HNSW index *then* | Yes (D2) |

### 17.3 The three changes that would ripple

**Multi-currency.** Today money columns carry no currency; `currencies` affects display only. The day a
contractor signs in USD and pays suppliers in IQD, every money column needs a companion
`currency_code` **and** the exchange rate *at transaction time* — because a historical amount converted
at today's rate is a lie. The change is: `+ currency_code text NOT NULL DEFAULT <org default>` and
`+ fx_rate_to_base numeric(18,8)` on `contracts`, `payments`, `project_costs`, `overhead_expenses`,
`material_price_history`, `supplier_materials`. Every `CHECK` in this document survives unchanged,
because each compares like to like. Reports gain a base-currency conversion at the read model. This is
a large but mechanical migration, and the schema does not obstruct it.

**Multi-tenancy.** §15 of the architecture defers it. The shape of the change: a `tenant_id` on every
business table, every partial unique becomes `(tenant_id, …) WHERE …`, and row-level security policies
replace the application's implicit "all rows are mine". The read models and platform tables need it
too. The fact that §3.4 could name the single change `users` requires is a good sign; the fact that
there are 30 other tables is the honest cost.

**Extracting the job worker** (§12 of the architecture, step 1). Zero schema change. `jobs` already
claims with `FOR UPDATE SKIP LOCKED`, already has `locked_by`/`locked_at` and a reaper, and the tick
already takes an advisory lock. That was the point of paying for those three columns now.

### 17.4 What is permanently rejected

Sharding. Horizontal replication. A message broker (the outbox *is* the seam; it becomes the broker's
source, not a rewrite). Storing binary blobs in the database. Autonomous AI writes — no column in this
schema can express one, and that is deliberate: `ai_plans` cannot reach `EXECUTED` without a human
confirmation claiming it (§11.3).

---

## 18. Decisions I need from you

Nine points where I made a call that you should ratify or reverse. The first three change data; the
rest change behavior.

| # | Decision | My call | Reverse it if |
|---|---|---|---|
| 1 | **`project_costs.project_id` and `payments.project_id` cascade** | Change `CASCADE` → `RESTRICT` (§7.1) | You consider costs and payments *children* of `Project` rather than the independent aggregate roots §3.3 calls them. Note the current `CASCADE` means a physical project delete destroys its ledger |
| 2 | **`overhead_expenses`** | Add it (§8.2) | You accept that "profit" on the dashboard means *project* profit and never company profit. Nothing else depends on the table |
| 3 | **`payments.LATE` status** | Drop it; derive `LATE` from `due_date < today AND paid_amount < scheduled_amount` | You prefer a stored flag and accept the nightly window where the database disagrees with the calendar |
| 4 | **`SKIPPED` construction steps** | Currently they do **not** count toward progress, so a project with a skipped step can never reach 100% (§7.2) | Either: skipped counts as complete, or the aggregate redistributes its percentage. **This needs a product answer before the table ships** |
| 5 | **Money `(18,4)`, quantity `(18,6)`, percent `(6,3)`** | Adopt the architecture's `NUMERIC(18,4)` (D3), widen the others | You'd rather keep `(14,2)`/`(14,3)`/`(5,2)` and skip a full-table rewrite of every money column |
| 6 | **`timestamptz` + `date`** | Business days become `date`; instants become `timestamptz(3)` (D3) | You're confident the deployment will never cross a timezone. Note Prisma's bare `DateTime` is `timestamp` *without* zone today |
| 7 | **`units_of_measure`** | Add it; `unit` text becomes `unit_code` FK (§4.1) | The one-time manual reconciliation of existing free-text units is not worth it. Be aware no quantity aggregate is trustworthy until it happens |
| 8 | **`bigint` PKs on append-only tables** | `audit_logs`, `outbox_events`, `ai_messages`, `material_price_history`, `search_documents`, `fact_project_daily`, `notifications`, `jobs`, `recommendation_evidence`, `ai_tool_invocations` (D8) | You need those ids to be non-enumerable. In a single-tenant desktop app, I don't think you do |
| 9 | **`contract_items.line_total` as `GENERATED … STORED`** | Prefer generated over `CHECK` (§6.3) | Prisma's support proves awkward; the `CHECK` is the fallback and is equivalent in strength |

**Two that need no decision but need a person.** `ck_uom_*` backfill (§4.1) is lossy — nobody can
programmatically decide whether a legacy `"م"` meant metre or hour. And `search_documents` must delete
on soft-delete (D10) or the assistant will write to deleted projects; that is not a preference.

---

## 19. What this document does not do

- **No SQL.** No `CREATE TABLE`, no migration files, no `schema.prisma` edits — by instruction.
- **No seed data.** The permission keys of §3.2 and the units of §4.1 need a seeding plan.
- **No `ar_normalize` implementation.** D1 specifies its contract (`IMMUTABLE STRICT PARALLEL SAFE`, two-argument `unaccent`) and why each word matters. The body is a small `SQL` function.
- **No migration ordering.** D3, D5, and D7 touch live tables and must be sequenced (widen columns → backfill → add constraints → drop old indexes), with the forward-only, applied-on-boot policy §7 already establishes.
- **No `overhead_allocations`.** Apportioning overhead onto projects for true per-project P&L is named as deferred (§8.2), not forgotten.













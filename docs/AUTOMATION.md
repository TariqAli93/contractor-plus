# Contractor Plus — Automation Platform

**Status:** Design. No implementation.
**Continues:** `docs/ARCHITECTURE.md` (§A), `DATABASE.md` (§D), `BACKEND.md` (§B), `AI-PLATFORM.md` (§P), `BI-CAPABILITIES.md` (§I), `INTEGRATIONS.md` (§X), `FRONTEND.md` (§F).

---

## 0. There is no queue to build. There is a governor to build.

Six documents already specified the entire runtime of this platform:

| Machinery | Where | Reused verbatim |
|---|---|---|
| Durable job queue, `SKIP LOCKED`, reaper, backoff | §B16, `jobs` §D9.2 | ✅ |
| Recurring schedules, cron, timezone | §B16.3, `job_schedules` §D9.3 | ✅ |
| Dead-letter queue | §B14.4, `job_dead_letters` §D9.4 | ✅ |
| Transactional outbox + dispatcher + projectors | §B17, `outbox_events` §D9.1 | ✅ |
| Message queue (email/SMS/WhatsApp), `UNKNOWN` state | §X4, `message_outbox` §D13 | ✅ |
| Notification fan-out, SSE, idempotency | §B21, `notifications` §D9.5 | ✅ |
| The nightly intelligence DAG | §I18 | ✅ |
| Per-class retry (idempotent vs effect vs bulk) | §X7 | ✅ |

**So this document builds none of that.** Re-specifying the job runner a third time would be the exact
sprawl §A0 warns against. What is genuinely missing — and what the word *automation platform* actually
denotes at this scale — is the layer **above** the queue:

> A **declarative, RBAC-governed, fully-audited rule layer** that lets the contractor decide *what* the
> system does on its own, *when*, and *to whom* — without a code deploy, and without ever letting a
> timer move money.

The queue is *how* work runs. The automation platform is *which* work is allowed to run, *who* may
authorize it, and *what it is permitted to touch.* The value is not throughput; it is **control that a
non-technical owner can hold and an auditor can reconstruct.** That is PRODUCT.md's first emotional
goal — *in control, nothing slips through* — expressed as a subsystem.

### 0.1 The single rule that governs everything below

> **An automation may compute, notify, and send. It may never mutate a ledger row without a human
> confirmation.**

This is not a new rule. It is the same line the AI platform obeys (§P20, *no autonomous writes*) and
the same line integrations obey (§X-R2, *external data is never ledger data*). A timer is exactly as
trustworthy as a language model or an external API — useful, and never authoritative about your money.

The consequence, stated once and enforced throughout: there is **no automation in this system that
writes to `contracts`, `payments`, `project_costs`, `change_orders`, or `projects` on its own.** An
automation that "wants" to write raises a recommendation (§I) or pre-fills a plan (§P15.1) that walks
the human confirmation gate. What automations *do* autonomously is read, derive, notify, and send —
none of which can silently corrupt a ledger.

### 0.2 What "platform" does *not* mean here

Named so the absence reads as a decision:

- **Not a visual workflow builder** (Zapier / n8n / Make). A drag-and-drop node graph for 1–10 users on one office PC is a maintenance liability with a config surface nobody can audit. The automations are a **seeded catalog of fourteen** (§4), each a typed rule, extensible in code.
- **Not a general "if-this-then-that" engine.** Arbitrary user-authored conditions over arbitrary fields are an injection surface and an unindexable-query generator. Conditions are **chosen from a typed vocabulary** the schema can serve (§3.3).
- **Not a second scheduler.** `node-cron`, BullMQ, Temporal, Airflow — every one is another Windows service to install and version-gate (§B16). Postgres `jobs` is the scheduler.
- **Not autonomous.** §0.1.

---

## 1. The three-layer model

```
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 3 — GOVERNANCE  (new; this document)                          │
│   automation_rules   what may fire, on what trigger, doing what      │
│   automation_runs    every firing, its outcome, its provenance       │
│   RBAC gate · dry-run preview · consent · spend cap · kill switch    │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ enqueues / appends
┌───────────────────────────────▼─────────────────────────────────────┐
│ LAYER 2 — EXECUTION  (exists; §B16, §B17, §X4)                       │
│   jobs · job_schedules · job_dead_letters   (deferred work)          │
│   outbox_events → projectors                (reactive work)          │
│   message_outbox                            (external effects)       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ reads / derives
┌───────────────────────────────▼─────────────────────────────────────┐
│ LAYER 1 — TRUTH  (exists; §D, §I)                                    │
│   write model · read models (matviews, facts) · Knowledge Engine     │
└─────────────────────────────────────────────────────────────────────┘
```

Layer 3 is the only new construction. It is thin: two tables and a rule evaluator. Its entire job is to
turn *"the system does things"* into *"the owner controls, and the auditor can reconstruct, exactly
what the system does."*

---

## 2. The automation rule

```
AutomationRule {
  key            'payment.reminder' | 'report.monthly' | …     -- from the seeded catalog
  trigger        Trigger                                       -- §3
  condition      TypedCondition?                               -- §3.3, from a fixed vocabulary
  action         Action                                        -- §3.4
  enabled        boolean                                       -- default FALSE (§X-R1)
  parameters     jsonb                                         -- typed per key: thresholds, offsets
  required_permission  PermissionKey                           -- §8
  actor          'SYSTEM'                                      -- runs as Principal.system() (§B12.2)
  effect_class   COMPUTE | NOTIFY | SEND                       -- §3.4. Never WRITE_LEDGER
  spend_cap_ref  text?                                         -- for SEND rules (§X10.5)
  last_run_at · next_run_at · created_by · updated_by
}
```

**`enabled` defaults to false.** A freshly-installed system does nothing on its own until the owner
turns each automation on and — for anything that sends or spends — completes a dry run (§6.1). This is
§X-R1 (*every integration off by default*) applied to automation: a zero-automation install is fully
functional and is the reference configuration, not a degraded one.

**`effect_class` is declared, not inferred**, and the enum deliberately has no `WRITE_LEDGER` member.
The type system refuses to express an automation that mutates money. §0.1 is a compile-time property,
not a runtime check that could be forgotten.

---

## 3. Triggers, conditions, actions

### 3.1 Three trigger types, and why exactly three

```
Trigger =
  | Time      { cron, timezone }              -- "every Monday 06:00"     → a job_schedule
  | Event     { eventType }                   -- "when a cost is recorded" → an outbox subscription
  | Threshold { factKey, comparator, value }  -- "when CPI < 0.95"         → evaluated in the nightly DAG
```

These are not interchangeable, and collapsing them is the most common automation-platform mistake.

| Trigger | Latency | Cost when idle | Backed by | Example |
|---|---|---|---|---|
| **Time** | up to the cron granularity | one `jobs` row per occurrence | `job_schedules` (§D9.3) | Scheduled report, weekly price sync |
| **Event** | seconds (outbox dispatch, §B17.1) | **zero** — nothing polls | `outbox_events` subscription | Notify on `ProjectCostRecorded` |
| **Threshold** | up to a day (evaluated in §I18) | zero — piggybacks the nightly sweep | Fact re-evaluation | Alert when `CPI < 0.95` |

**Why a threshold trigger is not an event trigger.** "When cement price drifts 10%" cannot be an event
— no single write *is* that condition; it emerges from an aggregate over many rows. Evaluating it on
every cost write would recompute a baseline on the request path (§I ground rules). So thresholds are
evaluated once nightly, inside the DAG that already computed the fact (§I18 stage 8). The fact is
computed exactly once and reused by every threshold rule that references it.

**Why a time trigger is not a threshold.** A monthly report fires on the calendar regardless of state.
Forcing it through fact-evaluation would make "the 1st of the month" a fact, which it is not.

### 3.2 Trigger → execution routing

Each trigger type lands in the Layer-2 machinery built for it. No new runtime:

```
Time      → job_schedules row → jobs row on each occurrence → handler       (§B16)
Event     → projector subscribes to outbox_events → handler                 (§B17.2)
Threshold → nightly DAG evaluates fact vs value → fires action if crossed    (§I18)
```

### 3.3 Conditions — a typed vocabulary, never free text

A rule may narrow its trigger with a condition, but only from a fixed, indexable vocabulary:

```
TypedCondition {
  subject   'payment' | 'contract' | 'project' | 'material' | 'customer'
  field     an enumerated, INDEXED column of that subject   -- e.g. payment.status, project.status
  comparator = | ≠ | < | > | ∈ | daysUntil | daysSince
  value     typed to the field
}
```

Two hard rules, both imported from the schema:

1. **Every condition field maps to a backing index** (§B14, §F14.1). A condition the database cannot serve without a full scan is not offered. There is no "where notes contains".
2. **No user-authored expression.** `payment.status = 'PENDING' AND payment.dueDate daysUntil 7` is chosen from dropdowns, not typed. Arbitrary boolean text is an injection surface and an unindexable-query generator (§0.2). This is the same discipline §B10.2 applies to validators.

### 3.4 Actions — three classes, and the one that does not exist

```
Action =
  | Compute { factOrReport }         effect_class COMPUTE   -- refresh a matview, generate a report row
  | Notify  { severity, template }   effect_class NOTIFY    -- a notifications row → bell/SSE/toast
  | Send    { channel, template }    effect_class SEND      -- a message_outbox row → email/SMS/WhatsApp
  -- there is NO WriteLedger action. §0.1
```

| Effect class | Writes to | Reversible? | Governance |
|---|---|---|---|
| `COMPUTE` | read models, `ai_reports` — never the ledger | yes (rebuildable, §D10) | permission only |
| `NOTIFY` | `notifications` (per-user, in-app) | trivially (dismiss) | permission + role scoping |
| `SEND` | `message_outbox` → *external humans* | **no** — a message cannot be un-sent | permission + consent + suppression + spend cap + dry run |

The governance escalates with irreversibility. A `COMPUTE` needs a permission. A `SEND` needs five
gates, because §X4 is right that the only integrations that can embarrass the contractor in front of the
person paying them are the ones that send.

---

## 4. The seeded catalog — fourteen automations

Every requested capability is one seeded `AutomationRule`. Mapped to trigger, effect class, and the
Layer-2 machinery it drives:

| # | Automation | Trigger | Effect | Drives | Workflow |
|---|---|---|---|---|---|
| 1 | **Scheduled reports** | Time | COMPUTE | `jobs` → `ai_reports` | §5.1 |
| 2 | **Contract reminders** | Threshold (`contract.daysUntil(expiry/milestone)`) | NOTIFY / SEND | `notifications` / `message_outbox` | §5.2 |
| 3 | **Payment reminders** | Threshold (`payment.overdue`) | SEND | `message_outbox` | §5.3 |
| 4 | **Material price updates** | Time | COMPUTE | `jobs` → §X3.3 sync → `material_price_history` | §5.4 |
| 5 | **Expense monitoring** | Event (`ProjectCostRecorded`) + Threshold | NOTIFY | outbox → `notifications` | §5.5 |
| 6 | **Project monitoring** | Threshold (`CPI`, `SPI`, delay) | NOTIFY | nightly DAG → `notifications` | §5.6 |
| 7 | **Automatic notifications** | Event | NOTIFY | outbox → `notifications` → SSE | §5.7 |
| 8 | **Recurring jobs** | Time | COMPUTE | `job_schedules` | §5.8 |
| 9 | **Retry jobs** | (mechanism, not a rule) | — | job runner | §7.1 |
| 10 | **Queue system** | (mechanism) | — | `jobs` + `SKIP LOCKED` | §7 |
| 11 | **Failure recovery** | (mechanism) | — | reaper + DLQ | §7.3 |
| 12 | **Logging** | (cross-cutting) | — | `automation_runs` + audit | §9 |
| 13 | **History** | (cross-cutting) | — | `automation_runs` | §10 |
| 14 | **Permissions** | (cross-cutting) | — | RBAC | §8 |

Items 9–14 are not automations; they are the substrate every automation runs on, and they are what the
brief is really asking to see governed. They get their own sections.

The catalog is **seeded, idempotently, on boot** — the same pattern as the permission catalog
(§B12.6) and the unit catalog (§D4.1). A new automation is a new seed row plus a handler, reviewed in a
PR, never a runtime-authored graph.

---

## 5. The eight automation workflows

### 5.1 Scheduled reports — Time → COMPUTE

```
job_schedule 'report.monthly'  cron '0 6 1 * *'  Asia/Baghdad
   │  (enqueues the next jobs row after each run — a missed window is LATE, never LOST, §B16.1)
   ▼
jobs 'report.generate' { kind, period }
   ▼
deterministic SQL over READ MODELS → data_snapshot (frozen)          §I13, §P15.3
   ▼
LLM narrates ONLY the snapshot → narrative   (skipped if OpenRouter down → narrative=null)
   ▼
ai_reports row status=READY
   ▼
NOTIFY the report's audience (role-scoped) + optional SEND if configured
```

**Provenance is the point.** The report freezes its numbers *before* the model sees them, so it can be
re-rendered years later against the numbers as they were understood that day (§I13). A scheduled report
that re-queries live data at render time silently rewrites history.

**Failure semantics.** OpenRouter down → the report still reaches `READY` with tables and templated
captions; the prose is a courtesy (§F12.3). A snapshot that *cannot be computed* is `FAILED` and
dead-letters. The distinction is exactly §X's data-vs-effect line.

### 5.2 Contract reminders — Threshold → NOTIFY / SEND

Fires on `contract.daysUntil(x) = n` where `x` is expiry, a milestone date, or an unsigned-draft age.

```
nightly DAG evaluates each open contract's dates
   │
   ├─ draft unsigned > 14 days        → NOTIFY owner "عقد لم يُعتمد منذ ١٤ يوماً"
   ├─ milestone due in 7 days         → NOTIFY the assigned role
   └─ (optional) SEND customer a scheduled-work reminder  ← consent + template + dry run
```

Idempotency key `<rule>:<contractId>:<milestone>:<userId>` — the `userId` term stops the first
recipient's row from suppressing everyone else's (§B21.3, §X4.1).

### 5.3 Payment reminders — Threshold → SEND (the highest-stakes automation)

This is the one that sends money-related messages to *your customers*, so it obeys the full §X4
discipline. It is worth tracing end to end because every gate matters.

```
job 'payments.overdue-sweep'  every 15 min  (§B16.3)
   ▼
for each payment WHERE status ∈ {PENDING,PARTIAL} AND dueDate < today:
   │
   ├─ 1. RE-EVALUATE the precondition AT CLAIM TIME (§X9):
   │      still owed? still overdue? not cancelled?
   │      → if the invoice was paid since queueing, SUPPRESS. Never send.   ← the offline bug
   │
   ├─ 2. CONSENT check, same transaction that claims the row (§X10.4):
   │      customer.messaging_consent.{sms|whatsapp}? → else SUPPRESS
   │
   ├─ 3. SUPPRESSION list check (§X4.6): hard-bounced / opted-out? → SUPPRESS
   │
   ├─ 4. SPEND CAP check BEFORE send (§X10.5): month cap reached? → SUPPRESS + CRITICAL notify
   │
   ├─ 5. IDEMPOTENCY: <rule>:<paymentId>:<period>:<customerId>
   │      the period term stops the 15-min sweep re-notifying the same invoice 96×/day
   │
   ▼
message_outbox row (channel per §X4, template — NEVER free prose, NEVER LLM-authored, §X4.6)
   ▼
messages.dispatch (every 30s) → provider send
   ├─ 2xx                 → SENT → poll → DELIVERED/READ
   ├─ 4xx (bad number)    → FAILED, terminal, suppress
   ├─ 429/5xx             → QUEUED, backoff (safe: never left)
   └─ TIMEOUT             → UNKNOWN → reconcile by query, NEVER resend   (§X4.2)
```

**A payment reminder is a `SEND`, and a send cannot be blind-retried.** A timeout is not a failure; the
message may have gone out and the response been lost. Retrying sends the customer a second reminder at
3 a.m. This is the single most important paragraph in §X, and it is why payment reminders are the
automation that most needs the governor, not the least.

**Why no per-message human confirmation** (unlike an AI plan, §P15.1)? Because a reminder is a *template
to a consented recipient about a true fact*, configured and reviewed **once** at rule-enable time (§6.1
dry run), not a mutation of business state. The confirmation happens at configuration, not at each of
forty monthly sends. That is the clean line between `SEND` (rule-level governance) and `WRITE_LEDGER`
(which does not exist, §0.1).

### 5.4 Material price updates — Time → COMPUTE

```
job_schedule 'integrations.priceindex.sync'  weekly  (§X6)
   ▼
pull external index (if a provider exists — §X3.3 flags that most do not for Iraqi materials)
   ▼
append to material_price_history as source=EXTERNAL_INDEX, weight 0.20   (§X3.3)
   ▼
recompute mv_material_price_baseline
```

**An external price update can never move a baseline that real purchases set** (§X3.3, §X11). It fills
a gap where there are none; it does not overrule your ledger. And it never fires a price-drift anomaly
on its own — it has no `valueAtStake` because you did not buy anything (§I6). This automation informs;
it does not alarm.

### 5.5 Expense monitoring — Event + Threshold → NOTIFY

Two triggers, deliberately:

```
Event ProjectCostRecorded (immediate, §B17):
   ├─ duplicate-invoice rule (tier 1, deterministic) → NOTIFY / block at write (§I16)
   └─ temporal-impossibility (cost before project start) → NOTIFY

Threshold (nightly, §I7):
   ├─ Poisson cost-velocity anomaly (end-of-month receipt dump) → NOTIFY
   └─ category budget variance > threshold                       → NOTIFY
```

The event trigger catches what must be caught *now* (a duplicate, an impossibility); the threshold
trigger catches what only emerges *over time* (a velocity spike). Same capability, two latencies,
because the findings have two natures (§3.1).

### 5.6 Project monitoring — Threshold → NOTIFY

```
nightly DAG (§I18) computes CPI, SPI, EAC, delay per live project
   ├─ CPI < 0.95 ∧ progress < 0.60   → Signal[RISK,COST_OVERRUN] → NOTIFY if CRITICAL
   ├─ SPI < 0.90                       → Signal[RISK,SCHEDULE]     (requires planned dates, §I2.2)
   ├─ SCOPE_SKIPPED_WITHOUT_CHANGE_ORDER → NOTIFY                   (§I1.3)
   └─ liquidity trough P(cash<0)>0.15  → NOTIFY CRITICAL           (§I9)
```

**Notify only when `severity = CRITICAL ∧ sufficiency ≥ ADEQUATE`** (§I14, §F9.1). A `WEAK` finding
built on three data points that wakes a contractor is how the whole notification system gets muted in
week two. The automation's restraint is a feature, and it is enforced at the notify gate, not left to
each rule.

### 5.7 Automatic notifications — Event → NOTIFY (the fan-out engine)

Not a single automation but the mechanism every `NOTIFY` action shares (§B21):

```
domain event → rule engine: which PERMISSION does this notification's subject require?
             → fan out to every active user whose role grants it (role-scoped, §B21.2)
             → one notifications row per user (materialized fan-out, §D9.5)
             → in-app bell (partial index, O(unread)) · SSE (Last-Event-ID replay) · Windows toast (CRITICAL)
```

Role scoping reuses the RBAC catalog, so an accountant sees overdue payments and an engineer sees
delays, and **nobody configures a preference model** (§B21.2). The automation's audience is a function
of the permission its subject requires, not a settings screen.

### 5.8 Recurring jobs — Time → COMPUTE (the maintenance backbone)

The scheduled maintenance already catalogued in §B16.3 and §X6, now understood as automations:

matview refresh · fact snapshot · calibration · embedding backfill · outbox purge · token sweep ·
idempotency purge · progress reconcile · usage reconcile · plan expiry · backup run · **backup verify
(restore into a temp schema)** · suppression sync · integration health.

Each is a `job_schedule`. Each **enqueues its next occurrence after it runs**, so a service restart at
02:59 does not silently skip the 03:00 job — the missed window is *late*, never *lost* (§B16.1). This is
the entire reason the design refuses `node-cron`.

---

## 6. Governance — how a human stays in control

### 6.1 The dry run — mandatory before any SEND rule goes live

Enabling a `SEND` automation for the first time does not send. It **previews**:

```
تفعيل تذكيرات الدفع
سيُرسَل هذا التذكير إلى العملاء المتأخرين عبر واتساب.

معاينة (بناءً على البيانات الحالية):
  • ٤ عملاء سيتلقون تذكيراً الآن
  • ٣ عملاء بلا موافقة على المراسلة — لن يُرسَل إليهم
  • التكلفة المقدّرة: ٤ رسائل ≈ ٠٫٤٨ د.ع
  • الحد الشهري: ٥٠ رسالة (متبقٍّ ٥٠)

[إلغاء]   [تفعيل وإرسال المعاينة أولاً]   [تفعيل]
```

The owner sees *who* would be contacted, *who is excluded and why*, and *what it costs*, before a single
message leaves the machine. This is the confirmation that §5.3 defers from per-send to per-rule — and it
is where a mistake (a reminder rule pointed at every customer instead of overdue ones) is caught before
it embarrasses the contractor forty times.

A `SEND` rule that changes its recipient *class* (new template, new channel) requires a fresh dry run.

### 6.2 The kill switch

Two levels, both instant, both `settings.manage`:

```
Global:   pause ALL automation.  Sets a system_settings flag the job claim query checks.
          The queue drains nothing; in-flight jobs finish; nothing new starts.
Per-rule: disable one automation.  enabled=false. Takes effect on the next evaluation.
```

The global switch matters because §0's whole premise is owner control. If an automation misbehaves at 2
a.m., the owner must be able to stop *everything* with one click and diagnose in daylight, without an
engineer and without a database. The switch is a flag, not a deploy.

### 6.3 What a human must confirm, and what they configure once

| Automation does | Confirmation model |
|---|---|
| Compute a report, refresh a matview | None. Reversible, no external effect |
| Notify a colleague in-app | None. Dismissible |
| **Send to a customer** | **Once**, at rule-enable (dry run §6.1). Then autonomous within consent + cap |
| **Mutate a ledger row** | **Every time**, via the AI plan gate (§P15.1) — because this action class does not exist as an automation (§0.1) |

The escalation is by irreversibility, and it is the same shape as §3.4. A report can be regenerated. A
notification can be dismissed. A message cannot be recalled. A ledger write cannot be un-made without a
compensating entry and an audit trail — which is exactly why an automation is never permitted to make
one.

---

## 7. Queue, retry, failure recovery

All three exist (§B16, §X7). Restated here only as the automation platform *uses* them.

### 7.1 Retry — three policies, by effect class

The retry policy is a property of the effect class, because retrying is safe for two of the three and
dangerous for one (§X7):

| Effect | Retry | Max | On exhaustion |
|---|---|---|---|
| `COMPUTE` | free — idempotent, read-only. `backoff = min(2ⁿ×30s, 1h) × jitter` | 5 | dead-letter + CRITICAL |
| `NOTIFY` | safe — idempotency key dedupes | 3 | dead-letter |
| `SEND` | **never blind.** Transport-fail-before-send → retry; timeout-after-send → `UNKNOWN` → reconcile by query | 3 | dead-letter; a message worth 4 tries is worth a human |

`retryable: false` errors (a `4xx`, a rejected template) go **straight to dead-letter** without burning
attempts (§B14.4). The bit exists so a permanent failure is diagnosed now, not in five backoffs.

### 7.2 The queue

`jobs` + `SELECT … FOR UPDATE SKIP LOCKED` (§B16, §D9.2). One in-process worker, 5s tick, guarded by
`pg_try_advisory_lock` so a second dev instance cannot double-fire. Nothing new. The automation platform
is a *producer* into this queue and a *reader* of its outcomes; it does not reimplement it.

### 7.3 Failure recovery

Three failure classes, each with a recovery already designed:

```
crashed worker (job stuck RUNNING)  → reaper: RUNNING ∧ locked_at < now()-15min → requeue, attempts++
poison job (fails max_attempts)     → job_dead_letters + JobDeadLettered event → NOTIFY owner
poison event (projector fails N×)   → mark dispatched, copy to dead-letter, CRITICAL — outbox NEVER blocks
```

**The outbox must never block** (§B17.1): a stuck event freezes search, notifications, analytics, and
price history *simultaneously*, and the symptom the user reports is "the app stopped updating" — four
subsystems, one cause, no error. So a poison event is quarantined, not retried forever.

**The dead-letter queue is surfaced, not silent** (§F14.3). An unread DLQ is a DLQ nobody reads. The
Jobs & Health screen shows it with a retry action, and insertion raises a `JobDeadLettered` notification
to the owner.

---

## 8. Permissions

Automation is governed by the same RBAC catalog as everything else (§B12), because a second
authorization model is a second thing that can drift.

### 8.1 Two distinct permission questions

| Question | Permission | Who |
|---|---|---|
| May you **manage** automations (enable, disable, configure, dry-run)? | `automation.manage` | OWNER, ADMIN |
| May *this automation* **do its action**, as it runs? | the action's own permission | `Principal.system()` |

The second is the subtle one. An automation runs as `Principal.system()` (§B12.2), but it is **not a
super-user.** A `SEND` automation still checks `messaging.send`; a report automation checks
`reports.generate`. The system principal's audit rows carry `actor_type = 'SYSTEM'` (§D12.5), so "who
sent this" resolves to the *rule*, not to a person — which is the honest answer, and the reason
`actor_type` distinguishes `SYSTEM` from `HUMAN` from `AI`.

### 8.2 New permission keys

```
automation.read           see the automation list and history
automation.manage         enable/disable/configure/dry-run
automation.run-now        trigger a rule manually (subject to its own action permission)
```

Every seeded automation's `required_permission` must exist in `rbac.catalog.ts`, checked in CI (§B12.6)
— a rule referencing a missing permission would otherwise fail **open**.

### 8.3 Notification scoping is a permission, not a preference

An automation's `NOTIFY` audience is *"every active user whose role grants the permission the subject
requires"* (§5.7, §B21.2). Enabling "payment reminders" does not ask *who* to notify; the accountant
role already grants `payments.read`, so accountants are the audience, structurally. This is why there is
no `notification_preferences` table — the RBAC catalog already encodes who cares about what.

---

## 9. Logging

Three streams, already separated (§B15.1), each answering a different question about an automation:

| Stream | Table | Answers |
|---|---|---|
| Application log | pino → file | "what did the worker do" (14-day retention) |
| **Audit log** | `audit_logs`, `actor_type=SYSTEM` | "what did the automation change / send, and under which rule" (7–10 y) |
| **Automation run** | `automation_runs` (new) | "did this rule fire, when, and with what outcome" (§10) |

A `SEND` automation writes an `audit_logs` row with `action = EXPORT` (§D-D9 added the value for exactly
this — PII left the machine) and `actor_type = SYSTEM`, so *"what did you send about me, when, and on
whose authority"* is answerable a year later (§X10.4).

**Redaction is a write-time obligation** (§B15.2): a reminder's rendered body may contain a customer
name and amount; the log stores the template key and variables, never the sent bytes, and never a phone
number in plaintext.

Every automation run carries the `trace_id` (§B15.3) that threads: the schedule → the job → the audit
row → the message → the delivery event. Given a message a customer disputes, you walk backwards to the
rule, the run, and the fact that triggered it.

---

## 10. History

`automation_runs` — one append-only row per firing. This *is* the "History" requirement, and it is what
makes the platform auditable rather than merely functional.

```
automation_runs {
  id             bigint identity              -- append-only, high volume (§D-D8)
  rule_key       text
  trigger_type   TIME | EVENT | THRESHOLD
  triggered_at   timestamptz
  trigger_detail jsonb          -- the fact value that crossed, the event id, the cron occurrence
  outcome        FIRED | SUPPRESSED | SKIPPED | FAILED
  suppression_reason text?      -- 'no_consent' | 'spend_cap' | 'precondition_failed' | 'suppressed_list'
  affected_count int            -- 4 customers notified, 3 suppressed
  job_id         bigint?        -- the work it enqueued
  message_ids    bigint[]?      -- the sends it produced
  notification_ids bigint[]?
  duration_ms    int
  trace_id       text
}
```

**`SUPPRESSED` is a first-class outcome, and the most valuable one.** When a payment reminder does *not*
send because the invoice was paid (§5.3 step 1) or consent was absent, that is recorded with its reason.
A history that only shows what fired cannot answer *"why didn't the customer get reminded"* — which is
the exact question that follows a dispute. Recording the non-events is what separates an audit trail
from a log.

`affected_count` split into fired-vs-suppressed is what the §6.1 dry run previews and what the history
screen shows after the fact — so the owner can compare *"the rule said it would contact 4"* against
*"the rule contacted 4"* and catch drift.

Retention: `automation_runs` follows the `material_price_history` shape (append-only, BRIN on
`triggered_at`, §D-D8). It is cheap and it is the record of what the system did on its own; keep it as
long as the audit log.

---

## 11. The automation surface (frontend)

Per §F, one new screen under ADMIN, `automation.read`-gated.

```
الأتمتة (Automations)
┌──────────────────────────────────────────────────────────────────────────┐
│ التقارير المجدولة       تقرير شهري · أول كل شهر ٠٦:٠٠   [مُفعّل ●] [سجل] │
│ تذكيرات الدفع           عند التأخر · واتساب              [متوقف ○] [تفعيل]│
│ مراقبة المشاريع         يومياً                            [مُفعّل ●] [سجل] │
│ تحديث أسعار المواد      أسبوعياً                          [متوقف ○] [تفعيل]│
├──────────────────────────────────────────────────────────────────────────┤
│                                          [⏸ إيقاف كل الأتمتة]  ← kill switch│
└──────────────────────────────────────────────────────────────────────────┘
```

- A dense table, not cards (§F5.2). One row per rule: name, cadence, status, history link.
- The toggle for a `SEND` rule opens the dry-run dialog (§6.1) before enabling.
- `[سجل]` opens `automation_runs` for that rule — fired/suppressed/failed with reasons, keyset-paginated.
- The global kill switch is `--danger`-bordered and always visible.
- Jobs & Health (§F14.3) shows the DLQ and the four zero-alarms; Automations shows the *rules*. Two screens, because a rule is a policy and a job is a mechanism.

---

## 12. Schema deltas

Two new tables. Everything else is reused from §D9 and §X13.

| Table | Purpose |
|---|---|
| `automation_rules` | §2. The declarative catalog. Seeded on boot, idempotently |
| `automation_runs` | §10. Append-only firing history. `bigint` identity, BRIN on `triggered_at`, no soft delete |

Column note: `automation_rules.effect_class` is an enum `{COMPUTE, NOTIFY, SEND}` — with **no**
`WRITE_LEDGER` member, so §0.1 is enforced by the type, not by a runtime check.

No new runtime. No new scheduler. No new queue. The automation platform is two tables and a rule
evaluator over machinery six documents already built — which is the whole point (§0).

---

## 13. Decisions

Resolved by design:

- ✅ **No visual workflow builder.** A seeded catalog of fourteen typed rules, extensible in code, not a node graph (§0.2).
- ✅ **No autonomous ledger writes, enforced by the type system.** `effect_class` has no `WRITE_LEDGER` member (§0.1, §12).
- ✅ **Everything off by default; a zero-automation install is the reference config** (§2, §X-R1).
- ✅ **`SEND` rules governed once at enable-time via dry run, then autonomous within consent + cap.** Ledger writes governed every time via the AI plan gate — which is why they are not automations (§6.3).
- ✅ **Suppression is a first-class, recorded outcome.** *"Why didn't it send"* is answerable (§10).

Needing your sign-off:

| # | Decision | My call |
|---|---|---|
| 1 | Automations are a **seeded catalog**, not a user-authored rule builder | Yes. A drag-and-drop engine for 1–10 users is an unauditable liability. The rule model is extensible in code |
| 2 | An automation may **never** mutate a ledger row; the enum forbids it | Not negotiable. It is the same line the AI and integrations already hold |
| 3 | Payment/contract reminders **send without per-message confirmation**, governed once at rule-enable via dry run | Yes. Per-send confirmation defeats the automation; per-rule review + consent + cap + suppression is the right gate |
| 4 | A global **kill switch** (pause all automation) is a `system_settings` flag, instant, no deploy | Yes. Owner control at 2 a.m. without an engineer is the product's first emotional goal |
| 5 | Threshold triggers are evaluated **once nightly** in the §I18 DAG, never on the write path | Yes. Evaluating a baseline threshold per cost write is the exact failure §I forbids |

**And one that needs a person, not a decision.** §5.3's payment reminders send to customers over
WhatsApp/SMS, which per §X14 has the longest lead time in the whole product (Meta business verification,
template approval, webhook ingress the machine has no public URL for). **The automation platform is
ready before the channel it most wants to use.** Sequence payment reminders to *email* first (SMTP,
days) and *notifications* (in-app, immediate), and treat WhatsApp payment reminders as the last thing
that ships, not the first — the same ordering §X14 already argued for.

# Contractor Plus — The Embedded AI Platform

**Status:** Design. No implementation.
**Continues:** `docs/ARCHITECTURE.md` (§A), `docs/DATABASE.md` (§D), `docs/BACKEND.md` (§B).

---

## 0. The thesis

> The AI must not be a chatbot. The AI must become a business intelligence layer.

Taken seriously, that sentence has one architectural consequence, and it is not a UI decision:

**The intelligence must not live in the language model.**

A language model cannot be a business intelligence layer. It cannot sum a column, it cannot be held to
a margin calculation, and it cannot be audited. §A5.1 invariant 3 already says so — *the model never
emits money or quantities* — and this document takes that to its conclusion:

> **Of the fifteen services requested, twelve contain no language model at all.**

| Service | LLM? | What actually computes the answer |
|---|---|---|
| AI Core | ✗ | Routing, governance, transactions |
| Knowledge Engine | ✗ | SQL over read models |
| Financial Intelligence | ✗ | `Decimal` arithmetic — EVM, variance, cash |
| Predictive Engine | ✗ | Closed-form EVM forecasts, robust trend |
| Anomaly Detection | ✗ | Median/MAD, Poisson, deterministic rules |
| Pattern Recognition | ✗ | Association rules, cosine similarity |
| Risk Detection | ✗ | Likelihood × impact, in money |
| Recommendation Engine | ✗ | Rules over signals |
| Recommendation Ranking | ✗ | Expected value at stake |
| Confidence Scoring | ✗ | Sample size, freshness, interval width |
| Memory Layer | ✗ | Rows |
| Decision Engine | ✗ | Typed plan, permission gate, human confirm |
| **Semantic Search** | ~ | Lexical + trigram; embeddings *assist* |
| **Document Intelligence** | ✓ | Extraction proposes; humans confirm |
| **Prompt Orchestration** | ✓ | It *is* the LLM boundary |

The language model does exactly three things, and none of them is "know the business":

1. **Understand** — turn Arabic text into a typed intent or a typed `Plan` (never a write).
2. **Narrate** — turn numbers *already computed and frozen* into Arabic prose.
3. **Extract** — turn an unstructured supplier invoice into a *proposal* a human confirms.

Everything else is SQL, statistics, and `Prisma.Decimal`. That is what makes it a business intelligence
layer rather than a chatbot with database access.

### 0.1 The falsifiable test

> **Unplug OpenRouter. Twelve of fifteen services keep working.**

The nightly analysis still runs. Anomalies still fire. The margin is still computed, the cash-flow
forecast still produced, the risk register still updated, the recommendations still generated, ranked,
and pushed to the notification bell — each with its explanation and its evidence rows, because the
explanation is a *template over facts*, not a generated sentence.

What you lose without the model: typing a command in Arabic prose, the narrative paragraph on top of a
report, and invoice OCR. Three conveniences. Not the intelligence.

If a future change makes that test fail, the platform has regressed into a chatbot.

### 0.2 Chat is one adapter, not the platform

§A5 describes a session, messages, and a conversation ring, which reads like a chatbot. It is one of
**three** entry points into the same core:

```
  ┌──────────────┐   ┌────────────────┐   ┌─────────────────┐
  │ Human text   │   │ UI affordance  │   │ Scheduled job   │
  │ "لماذا …؟"   │   │ [Explain this] │   │ nightly sweep   │
  │ (assistant)  │   │ [Why flagged?] │   │ (no human)      │
  └──────┬───────┘   └───────┬────────┘   └────────┬────────┘
         │                   │                     │
         └───────────────────┴─────────────────────┘
                             ▼
                      Intent { kind, subject, principal }
                             ▼
                        ┌─────────┐
                        │ AI Core │
                        └─────────┘
```

The third entry point has no chat, no session, and no user waiting. It produces most of the value. A
design in which the nightly sweep is a special case of the chat loop has the dependency backwards.

---

## 1. The constraints that decide everything

§A0 fixed the deployment: one Windows PC, one contractor's office, **one to ten humans**. Two further
constraints follow, and they are the ones that kill most "AI platform" designs on contact.

### 1.1 The data is small. Very small.

Per §D17.1, a decade at a *busy* contractor:

| Table | Decade | **Year one** |
|---|---|---|
| `projects` | ~500 | **~20** |
| `contracts` | ~500 | ~20 |
| `project_costs` | ~150,000 | **~3,000** |
| `material_price_history` | ~100,000 | ~2,000 |
| `payments` | ~5,000 | ~200 |

Consequences, stated bluntly because they are usually elided:

- **Nothing here can be trained.** Twenty projects is not a training set. It is barely a sample.
- **`stddev` is useless for outlier detection.** With n=20 and one true outlier, the outlier inflates the standard deviation enough to hide itself. Use **median + MAD**. This is not a refinement; it is the difference between a detector that works and one that reports nothing.
- **ARIMA/Prophet on 47 price observations is theatre.** Use a robust trend (Theil–Sen) and say what the interval is.
- **Benford's law needs ~500+ values** before its χ² has any power. Below that it produces confident nonsense.
- **Every engine must have an `INSUFFICIENT_DATA` output**, and must emit it rather than a number. §11.

The honest framing: this is not machine learning. It is **applied statistics and earned-value
management, executed with discipline, over a small clean dataset.** That is a much better fit for a
financial tool than a model nobody can interrogate, and it is why every output here can cite rows.

### 1.2 The system must be trustworthy before it is clever

§A10.5: *"An unexplained recommendation in a financial tool is worse than no recommendation: it either
gets blindly trusted or permanently ignored, and both outcomes are bad."*

Three rules fall out, and they constrain every service below:

1. **Every number has provenance.** A `Fact` carries the rows it was computed from. `recommendation_evidence.explanation` is `NOT NULL` by schema (§D11.7) — the database refuses an unexplained recommendation.
2. **Every number has a confidence and a data-sufficiency verdict**, and the UI renders both. "Margin 18.5% (n=3 costs, WEAK)" is honest. "Margin 18.5%" is not.
3. **Nothing writes autonomously.** Ever. §A5.2's preview-and-confirm gate is the only write path, for humans and for the assistant alike. No column in §D can express an autonomous write (§D17.4).

### 1.3 Arabic, and one egress

Retrieval is Arabic-first: no Postgres stemmer exists, so `ar_normalize` + trigram carries the
morphology (§D-D1). Embeddings must come from a genuinely multilingual model, not an English one.

OpenRouter is the **only** required egress (§A9) and it may be down. The pre-router, and the entire
deterministic stack, must not care.

---

## 2. The Fact — the unit of currency

Before the services, the type they all speak. This is the single design decision that makes fifteen
services one platform instead of fifteen features.

> **No engine reads the database. Every engine reads Facts.**

```
Fact {
  key           'project.margin' | 'material.priceDrift12m' | 'project.cpi' | …
  subject       EntityRef { type, id }
  value         Decimal                    // never a float. §B11.1
  unit          Unit  { MONEY | RATIO | DAYS | COUNT | RATE }
  asOf          Instant                    // freshness is explicit, always
  sufficiency   INSUFFICIENT | WEAK | ADEQUATE | STRONG
  confidence    0.0 … 1.0
  provenance    EvidenceRef[]              // the rows. Openable by the user
}
```

`asOf` is not decoration. Most facts come from a materialized view refreshed nightly (§D10.4), so they
are stale by construction, and a financial UI must be able to say how stale.

`provenance` is what turns "your cement is 14% over baseline" into a claim a human can check in two
clicks. It is also what `recommendation_evidence` (§D11.8) persists.

### 2.1 The Fact Catalog

A code registry — not a table — of every named metric the business has. Each entry declares its SQL
(over **read models only**, §B8.2), its unit, its precision, its refresh cadence, and its minimum n.

| Fact key | Unit | Source | Min n |
|---|---|---|---|
| `project.costToDate` | MONEY | `mv_project_profitability` | 1 |
| `project.revisedContractValue` | MONEY | derived, §D6.2 | 1 |
| `project.progress` | RATIO | `projects.progress_percentage` | 1 |
| `project.earnedValue` | MONEY | `revisedContractValue × progress` | 1 |
| `project.cpi` | RATIO | `earnedValue / costToDate` | 5 costs |
| `project.spi` | RATIO | `earnedValue / plannedValue` | 3 steps |
| `project.marginToDate` | RATIO | | 5 costs |
| `project.forecastAtCompletion` | MONEY | §6 | 5 costs |
| `material.priceBaseline12m` | MONEY | `mv_material_price_baseline` | 8 obs |
| `material.priceDrift12m` | RATIO | | 8 obs |
| `supplier.spendShare` | RATIO | `mv_supplier_performance` | 1 |
| `supplier.leadTimeMedian` | DAYS | | 5 orders |
| `customer.daysSalesOutstanding` | DAYS | `payments` | 3 payments |
| `company.cashPosition30d` | MONEY | `mv_cash_flow_monthly` + schedule | 1 |
| `company.overheadAbsorption` | RATIO | `overhead_expenses` (optional, §D8.2) | 1 |

`Min n` is enforced by the Knowledge Engine, not by each consumer. A fact computed from fewer rows is
returned with `sufficiency = INSUFFICIENT` **and its `value` still populated** — so the UI can show a
greyed number with a caveat rather than an empty box, and so no downstream engine can accidentally
treat it as solid.

### 2.2 The three derived types

```
Signal   { kind: ANOMALY|RISK|PATTERN|OPPORTUNITY, subject, severity,
           method, observed: Fact, expected: Fact|Interval,
           confidence, valueAtStake: Money, evidence[], detectedAt }

Forecast { metric, subject, horizon, point: Decimal,
           interval: [lo, hi], method, confidence, sufficiency, madeAt }

Plan     { actions: [{ tool, args, refs }] }        // §A5.4. The ONLY thing that can write
```

And the triad that keeps the engines from overlapping — a distinction most "AI insights" products
never draw, which is why their outputs feel like noise:

| | Tense | Question | Service |
|---|---|---|---|
| **Anomaly** | past | *"This is unusual."* | Anomaly Detection |
| **Risk** | future | *"This is likely to hurt."* | Risk Detection |
| **Recommendation** | imperative | *"Do this about it."* | Recommendation Engine |

An anomaly is not a recommendation. A cement price 14% above baseline is an *observation*; whether to
renegotiate, switch supplier, or do nothing is a *decision*, and it depends on how much is left to buy.
Collapsing the two is why dashboards nag.

---

## 3. Service map and communication

### 3.1 The topology

```
                          ┌───────────────────────────────────────┐
   chat / UI / job ─────▶ │              AI CORE                  │
                          │  governance · routing · effect · audit│
                          └───┬───────────────────────┬───────────┘
                              │                       │
              ┌───────────────▼──────┐        ┌───────▼─────────────┐
              │   DECISION ENGINE    │        │ PROMPT ORCHESTRATION│──▶ OpenRouter
              │  plan · gate · confirm│       │ context · schema    │    (only egress)
              └───────────┬──────────┘        └───────┬─────────────┘
                          │                           │
                          │  ┌────────────────────────▼──────────┐
                          │  │      DOCUMENT INTELLIGENCE        │
                          │  │   extract (in) · narrate (out)    │
                          │  └───────────────────────────────────┘
                          │
        ┌─────────────────┴───────────────────────────────────────┐
        │                RECOMMENDATION RANKING                   │
        └─────────────────▲───────────────────────────────────────┘
                          │  Recommendation[]
        ┌─────────────────┴───────────────────────────────────────┐
        │                RECOMMENDATION ENGINE                    │
        └─────────────────▲───────────────────────────────────────┘
                          │  Signal[]
   ┌──────────────┬───────┴────────┬───────────────┬──────────────┐
   │  FINANCIAL   │   PREDICTIVE   │    ANOMALY    │     RISK     │   PATTERN
   │ INTELLIGENCE │     ENGINE     │   DETECTION   │  DETECTION   │ RECOGNITION
   └──────┬───────┴───────┬────────┴───────┬───────┴──────┬───────┴─────┬─────
          │               │                │              │             │
          └───────────────┴────── Fact[] ──┴──────────────┴─────────────┘
                                     ▲
                       ┌─────────────┴──────────────┐
                       │      KNOWLEDGE ENGINE      │  ← the ONLY reader of the database
                       │   facts · entities · graph │
                       └──────┬──────────────┬──────┘
                              │              │
                   ┌──────────▼───┐   ┌──────▼─────────┐
                   │ SEMANTIC     │   │ MEMORY LAYER   │
                   │ SEARCH       │   │ session · org  │
                   └──────────────┘   └────────────────┘

   CONFIDENCE SCORING ── not a box. A field on every arrow. §11
```

### 3.2 Four communication mechanisms, and when each is used

| Mechanism | Used for | Why not the others |
|---|---|---|
| **Typed port call** (in-process, synchronous) | Everything on the read path: `KnowledgeEngine.fact(key, subject)` | One process (§A0). A message bus between two objects in the same heap is ceremony |
| **Domain events → outbox** (§B17) | Triggering analysis after a write: `ProjectCostRecorded` → recompute `material.priceDrift` | Decouples the write path from analysis. The user's `POST /costs` must not wait for statistics |
| **`jobs` queue** (§B16) | The nightly sweep, embedding backfill, report generation | Durable, survives restart, retried |
| **`ai_plans` + human confirm** | The **only** write path out of the platform | §A5.1 invariant 1 |

**The rule that `dependency-cruiser` enforces (§A12):** `ai/*` may not import any repository. It reads
through `KnowledgeEngine` and writes through the Capability Registry. Nothing else.

This is not architectural fussiness. It is the reason a prompt injection cannot exfiltrate the payment
table: the code that would do it does not exist in the reachable graph.

### 3.3 What flows on each arrow

```
Knowledge Engine   ──Fact[]──▶            Financial / Predictive / Anomaly / Risk / Pattern
Financial          ──Fact[]──▶            Predictive, Risk          (CPI feeds EAC)
Anomaly            ──Signal[ANOMALY]──▶   Recommendation Engine
Risk               ──Signal[RISK]──▶      Recommendation Engine
Pattern            ──Signal[PATTERN]──▶   Recommendation Engine, Semantic Search (similarity)
Predictive         ──Forecast[]──▶        Risk Detection, Recommendation Engine
Recommendation Eng ──Recommendation[]──▶  Ranking
Ranking            ──Recommendation[]──▶  Notification engine (§B21), UI, AI Core
Decision Engine    ──Plan──▶              AI Core ──▶ Application use cases (§B5.2)
Memory             ──dismissalRate, prefs──▶ Ranking
Confidence         ──score──▶             every one of the above
```

Note the two feedback edges. `Memory → Ranking` is how a rule with a 95% dismissal rate stops
shouting. `Forecast.actual → Confidence` (§11.3) is how the platform learns whether its own numbers
were any good. Without them the system cannot improve, and "AI" is just a label.

---

## 4. AI Core

**Purpose.** The kernel. It is not where thinking happens; it is where *permission, transaction, and
audit* happen. It owns §A5's six rings and the Capability Registry.

**It is not a chat loop.** It accepts an `Intent` from three adapters (§0.2) and returns a `Result`.

```
Input   Intent { kind: QUESTION | COMMAND | ANALYZE | NARRATE | EXTRACT,
                 subject?: EntityRef, text?: string,
                 principal: Principal, traceId }
Output  Result = Answer | Clarification | Preview | Execution | Rejected | Error
```

**Responsibilities, in ring order (§A5):**

| Ring | Does | LLM |
|---|---|---|
| 1 Transport | Route, SSE stream, one discriminated union | ✗ |
| 2 Governance | Live-role re-check, per-**user** rate limit + breaker, quota, PII redaction, **open the audit envelope** | ✗ |
| 3 Conversation | Session load, rolling memory, mode classify | ✗ |
| 4 Reasoning | Pre-router → Retriever → Planner | only the Planner |
| 5 Capability | Tool registry, arg resolution, per-action permission gate, Arabic preview | ✗ |
| 6 Effect | Executor → Application use cases, one transaction | ✗ |

**The pre-router is the anti-chatbot device.** Greetings, "what can you do", and status restatements
are answered with **zero** LLM calls: zero latency, zero cost, zero quota, works offline. A large share
of real assistant traffic is this (§A5.1 invariant 2). `ck_aie_prerouted_free` (§D11.4) makes a
pre-routed turn that billed the user *impossible to record*.

**The audit envelope.** One `ai_executions` row, opened before the model is called, closed on every
exit path — success, rejection, timeout, quota, breaker. `ix_aie_open` (§D11.4) is a monitored query
that must always return zero rows. An assistant that can move money and cannot be audited is not
shippable.

**Failure mode.** Provider down → breaker opens **per user** (a shared breaker is a cross-user denial
of service, §A5.3). Pre-router still answers. The deterministic stack is untouched.

---

## 5. Knowledge Engine

**Purpose.** The single read surface. Every other engine — and the LLM's retriever — reads Facts from
here and never touches Prisma. This is the anti-corruption layer between the domain and the
intelligence, and the thing that makes `ai/* → repository` a forbidden import rather than a guideline.

**Inputs**
```
fact(key: FactKey, subject: EntityRef, asOf?: Instant)        → Fact
facts(keys: FactKey[], subject: EntityRef)                    → Fact[]
series(key, subject, window: DateRange, grain)                → TimeSeries
cohort(key, filter: EntityFilter)                             → Fact[]     // all projects' CPI
graph(subject, depth)                                         → EntityGraph
```

**Outputs.** `Fact`, `TimeSeries`, `EntityGraph` — never a Prisma row, never a DTO.

**What it does**

1. **Resolves the Fact Catalog entry** (§2.1) and executes its SQL against **read models only** — matviews and `fact_project_daily` (§B8.2). Never the write model. A dashboard that recomputes five years of `Decimal` sums on every page load has a p95 that degrades with tenure, punishing the most loyal user (§A10.4).
2. **Attaches `asOf`** from the matview's refresh timestamp. Freshness is never implicit.
3. **Counts n and assigns `sufficiency`** against the catalog's `minN`.
4. **Collects provenance** — the row ids behind the number, so `recommendation_evidence` can cite them.
5. **Serves the entity graph** — `contract → project → costs → materials → suppliers` — which is what lets a question about a project reach the supplier that caused its overrun.

**The time-travel obligation.** `fact(key, subject, asOf: '2026-03-01')` must answer *what we believed
last March*, which is not recomputable from the current write model (back-dated costs, later change
orders, retroactive approvals all restate the past). It reads `fact_project_daily` (§D10.3), which
exists for exactly this. Any engine that needs history — Predictive calibration, drift detection,
`ai_reports` re-narration — depends on this method being honest.

**Failure mode.** A matview refresh that failed last night → `asOf` is 48 h old → every consuming Fact
carries the stale `asOf`, and the Ranking service (§13) *demotes* recommendations built on stale facts
rather than suppressing them. Stale-but-labelled beats absent.

---

## 6. Financial Intelligence

**Purpose.** The actual business intelligence. Deterministic `Decimal` arithmetic over Facts. **Zero
LLM.** This is the service that makes the platform a BI layer.

**The framing: Earned Value Management.** Construction has a mature, boring, correct answer to "is this
project healthy", and it is EVM. It requires nothing this schema lacks.

| Term | Formula | From |
|---|---|---|
| **BAC** Budget at Completion | `revisedTotal` = original + Σ approved change orders | §D6.2 |
| **PV** Planned Value | `BAC × plannedProgress(today)` | `construction_steps` planned dates |
| **EV** Earned Value | `BAC × progress` | `projects.progress_percentage` |
| **AC** Actual Cost | `Σ project_costs.total_amount` | `mv_project_profitability` |
| **CPI** Cost Performance Index | `EV / AC` | < 1.0 ⇒ over budget |
| **SPI** Schedule Performance Index | `EV / PV` | < 1.0 ⇒ behind schedule |
| **CV / SV** | `EV − AC` / `EV − PV` | in money |

**Other outputs**

| Fact | Formula |
|---|---|
| `project.marginToDate` | `(EV − AC) / EV` |
| `company.cashPosition30d` | `cash + Σ scheduled receipts(30d) − Σ committed costs(30d) − overhead` |
| `company.burnRate` | trailing 90-day `AC` / 90 |
| `customer.daysSalesOutstanding` | Σ`(paymentDate − dueDate)` weighted by amount |
| `supplier.spendShare` | supplier spend / total procurement, trailing 12 m |
| `contract.changeOrderErosion` | `Σ approved CO amount / originalTotal` |
| `company.overheadAbsorption` | overhead / direct cost — *only if `overhead_expenses` ships (§D8.2)* |

**Inputs.** Facts from the Knowledge Engine. **Outputs.** Facts (which feed Predictive and Risk).

**The discipline.** Every operation via `lib/money.ts` (`Prisma.Decimal`). §B6.5 K3 proposes a lint rule
banning `.toNumber()` outside the DTO layer. It matters most here: `CPI = EV/AC` is a division, and a
`Decimal` division without an explicit precision and rounding mode is where a financial engine quietly
starts lying.

**The honest caveat.** `SPI` depends on `plannedProgress(today)`, which needs `construction_steps.planned_start_date` /
`planned_end_date` — columns §D7.2 *adds*. Without them there is no schedule baseline and SPI is
uncomputable. **Schedule intelligence is blocked on that migration**, and no amount of AI substitutes
for a baseline nobody recorded.

**And the one that blocks arithmetic.** `progress_percentage` is derived from completed steps, but
§D18 #4 / §B6.3 P5 remain unanswered: a `SKIPPED` step keeps its percentage, so a project with one can
never reach 100%. Every EVM number above is a function of `progress`. **EV, CPI, SPI, and every forecast
built on them are wrong for any project containing a skipped step** until that product question is
answered. This is the highest-leverage open item in the entire platform.

---

## 7. Predictive Engine

**Purpose.** Forecasts with intervals. **Zero LLM. Zero training.**

§1.1 rules out machine learning: twenty projects is not a training set. What replaces it is not a
weaker version of ML — it is the closed-form forecasting that project controls has used for forty
years, plus robust statistics for prices.

### 7.1 Cost at completion

```
EAC = AC + (BAC − EV) / CPI          // remaining work costs what work so far has cost
ETC = EAC − AC
VAC = BAC − EAC                      // variance at completion, in money. NEGATIVE = overrun
```

No training. No hyperparameters. One assumption, stated: *future cost performance resembles past cost
performance*, which is the industry default and is falsifiable per project.

Interval: recompute `EAC` under `CPI ± MAD(CPI over the last k snapshots)` from `fact_project_daily`.
That is where the interval comes from — the project's own volatility, not a prior.

### 7.2 Completion date

```
forecastEnd = today + remainingWork / velocity
velocity    = median(step completion rate over trailing 60d)      // median, not mean (§1.1)
```

Interval from the empirical distribution of step durations across historical projects **of the same
template**. With fewer than 5 comparable projects: `sufficiency = WEAK`, and the interval widens to the
full observed range rather than a quantile.

### 7.3 Cash-flow projection (13-week)

Deterministic, and the single most valuable output for a contractor:

```
inflow(w)  = Σ payments.scheduled_amount due in w × P(collect | customer DSO history)
outflow(w) = Σ committed costs in w + overhead run-rate + ETC × plannedProgressDelta(w)
cash(w)    = cash(w−1) + inflow(w) − outflow(w)
```

`P(collect)` is a **Beta-Binomial posterior** on that customer's on-time history — `(onTime + 1) /
(total + 2)`, Laplace-smoothed. With three payments it is barely informative, and it says so. It is not
a model; it is counting, done correctly.

### 7.4 Material price forecast

- **Theil–Sen slope** over `material_price_history` (§D4.5) — median of pairwise slopes. Breakdown point 29%, so a few panic-buy outliers cannot swing the trend. `stddev`-based OLS would.
- **Seasonal naive** overlay if ≥ 2 years of observations; otherwise omitted, not guessed.
- Interval from the residual MAD.
- **Below 8 observations: `INSUFFICIENT_DATA`.** No line is drawn.

### 7.5 The contract every forecast obeys

```
Forecast { metric, subject, horizon,
           point, interval: [lo, hi],          // NEVER a bare point
           method: 'EVM_EAC' | 'THEIL_SEN' | 'BETA_BINOMIAL' | …,
           confidence, sufficiency, madeAt,
           actual?: Decimal, actualAt?: Instant }   // ← filled later. §11.3
}
```

`actual` is the whole reason forecasts are **persisted** rather than computed on read. It is how
calibration becomes possible, and calibration is the only thing separating a forecast from a guess.

---

## 8. Anomaly Detection

**Purpose.** *"This is unusual."* Past tense. **Zero LLM.**

### 8.1 Method selection is dictated by n

| Detector | Method | Why not the obvious one | Min n |
|---|---|---|---|
| Cost line outlier | **Robust z** = `0.6745 × (x − median) / MAD` | Classic z-score uses mean and stddev, both of which the outlier itself corrupts. At n=20 a single 10× cost raises stddev enough to make its own z-score ≈ 1.0 — invisible | 8 |
| Price spike | Deviation from `mv_material_price_baseline` in MAD units | | 8 obs |
| Cost velocity | **Poisson** on cost lines/day; flag `P(X ≥ k) < 0.01` | Counts are not normal | 30 days |
| Supplier price divergence | This supplier vs. cross-supplier median for the same material | | 3 suppliers |
| Duplicate invoice | Exact / near match on `(supplier_id, invoice_reference, amount)` | A rule, not statistics. Deterministic and high-precision | 1 |
| Temporal impossibility | Cost dated before `project.start_date`; payment before contract signature | Rule | 1 |
| Round-number clustering | Excess of amounts ≡ 0 mod 1000 | A weak fraud smell. **Low severity, never CRITICAL** | 100 |
| Benford 1st-digit | χ² against Benford | **Requires ≥ 500 values.** Below that it is noise dressed as rigor | 500 |

Threshold: `|robust z| > 3.5` (Iglewicz–Hoaglin). Not 2, which at n=20 flags one row in twenty and
trains users to ignore the feature.

### 8.2 Output

```
Signal { kind: ANOMALY, subject: EntityRef,
         method: 'ROBUST_Z' | 'POISSON' | 'RULE_DUPLICATE_INVOICE' | …,
         observed: Fact, expected: Interval,
         severity, confidence,
         valueAtStake: Money,          // how much money this anomaly is about
         evidence: EvidenceRef[] }
```

**`valueAtStake` is mandatory**, and it is what stops the anomaly detector from being a nuisance. A 4×
outlier on a 12 000 IQD cost line and a 1.3× outlier on a 400 000 IQD one are not equally interesting,
and only one of them should reach a human. Statistical surprise ranks nothing; money does (§13).

**Anomalies are not recommendations.** They are observations, handed to §12.

---

## 9. Pattern Recognition

**Purpose.** *"This tends to co-occur."* **Zero LLM. Nothing neural.**

Interpretability is the requirement (§1.2), and association metrics are interpretable in a way
embeddings are not: *support*, *confidence*, *lift* are three numbers a contractor can be shown.

| Pattern | Method | Output |
|---|---|---|
| Template → overrun | Historical `VAC` distribution grouped by `template_id` (+ version) | "Villa-2F v3 overran on 4 of 6 projects, median −7%" |
| Material co-occurrence | **FP-growth** market-basket over `contract_items` | "Projects with X also used Y (support 0.4, lift 2.1)" |
| Cost-profile similarity | **Cosine** over the normalized `CostCategory` spend vector | "This project's cost shape resembles P-014" |
| Step-duration signature | Median duration per step name, per template | Feeds §7.2's interval |
| Supplier price co-movement | Spearman rank correlation between suppliers' price series | "These two suppliers move together — they are not independent quotes" |
| Seasonality | Month-of-year median deviation, ≥ 2 years | Feeds §7.4 |

**Minimum support is high** (≥ 0.3, and ≥ 5 supporting projects) because with 20 projects, a pattern
supported by 2 is a coincidence with a name. Below the floor: emit nothing. **A pattern engine that
always finds patterns has found none.**

The last row is quietly the most valuable: a contractor collecting "three quotes" from suppliers whose
prices move in lockstep has one quote. That is a finding no chatbot produces and a spreadsheet never
surfaces.

**Output.** `Signal { kind: PATTERN, … support, confidence, lift }`. Also consumed by Semantic Search
to power "projects like this one" without a vector store (§10.4).

---

## 10. Semantic Search

**Purpose.** One index, three consumers: the command palette, global search, and the AI's **entity
resolver**. Three rankers would eventually disagree, and a disagreement between the palette and the
assistant is experienced as *"the AI can't find my project."* (§A10.3)

### 10.1 Hybrid retrieval

```
lexical  : search_vector @@ websearch_to_tsquery('simple', ar_normalize(q))
fuzzy    : title_norm % ar_normalize(q)              -- pg_trgm. Carries Arabic morphology
semantic : embedding <=> embed(q)                    -- pgvector, cosine
score    = 1.0·ts_rank + 0.8·similarity + 0.6·(1 − cosine_distance) + 0.3·recency_decay
```

`ar_normalize` must be the **same** `IMMUTABLE` function at index and query time, and the two-argument
`unaccent` is what makes that declaration honest rather than a lie to the planner (§D-D1). Get this
wrong and recall drops silently.

`'simple'`, never `'arabic'` — Postgres ships no Arabic stemmer. Trigram does the morphological work
(prefixed `ال`, suffixed pronouns).

### 10.2 The semantic tier is optional, and should start off

§D-D2: below ~10 000 vectors, build **no HNSW index** — a sequential scan over a few thousand vectors
is milliseconds with perfect recall, and an `ivfflat` index built on the empty table a fresh install
has will silently return near-random results forever.

At year one this product has ~4 000 searchable entities. **Ship lexical + trigram. Add embeddings when
the corpus earns them.** The score formula above degrades gracefully: drop the third term.

### 10.3 `query` and `resolve` are different methods

```
query(q, principal, opts)               → SearchHit[]
resolve(q, type, principal)             → { kind:'unique', id }
                                        | { kind:'ambiguous', candidates }
                                        | { kind:'none' }
```

`resolve` is **not** `query(...).limit(1)`. Taking the top hit when two projects match "الفيلا" is how
an assistant writes a cost to the wrong project. Ambiguity must surface as a `Clarification` turn, not
be resolved by ranking. This is the single most dangerous shortcut available in the platform.

### 10.4 Authorization inside the index

`WHERE permission_key = ANY($principal.permissions)` (§B20.4). Without it, search leaks the *existence*
of entities a role cannot read: an engineer typing "دفعة" learns how many payments exist.

### 10.5 What is retrieved for the LLM

Not documents. **Entity candidates with ids, and Facts.** The planner's prompt is grounded in
`Fact[]` from §5, not in prose scraped from rows. Entity resolution is a *search* problem, not a
language problem (§A5.5).

---

## 11. Confidence Scoring

**Purpose.** Not a stage in a pipeline — **a field on every arrow in §3.1.**

### 11.1 What confidence is made of

```
confidence = w₁·sampleAdequacy + w₂·freshness + w₃·methodPower + w₄·(1 − dispersion)
```

| Component | Measured by |
|---|---|
| `sampleAdequacy` | `min(1, n / minN)` from the Fact Catalog (§2.1) |
| `freshness` | `exp(−age(asOf) / halfLife(factKey))`. A nightly matview has a 48 h half-life |
| `methodPower` | A constant per method: a duplicate-invoice rule is 0.99; a Benford χ² at n=520 is 0.4 |
| `dispersion` | Interval width / point, for forecasts. Wide interval ⇒ low confidence |

**Confidence propagates multiplicatively.** A recommendation built on a WEAK fact and a WEAK forecast
is not ADEQUATE because two weak things agreed. `conf(rec) = Π conf(inputs) × conf(rule)`.

### 11.2 Sufficiency is a separate, blunter verdict

```
INSUFFICIENT   n < minN            → emit no signal. Say "not enough data" and name what is missing
WEAK           minN ≤ n < 2·minN   → emit, greyed, never CRITICAL, never notifies
ADEQUATE       2·minN ≤ n < 5·minN → emit normally
STRONG         n ≥ 5·minN          → emit, may notify
```

`INSUFFICIENT` is an **output**, not a silence. "I cannot assess this project's cost performance: 3 cost
entries recorded, 5 needed" is useful and honest. A blank card is neither, and a number computed from
3 rows is worse than both. This is the cold-start behaviour of the entire platform (§16).

### 11.3 Calibration — the part everyone skips

> A confidence number nobody validates is decoration.

`forecasts` is persisted with `actual` / `actualAt` (§7.5). A nightly job backfills `actual` once the
horizon passes, and computes:

- **Brier score** for binary predictions (will this payment be collected on time?)
- **Interval coverage**: of forecasts claiming an 80% interval, what fraction contained the actual? If it is 45%, the intervals are **too narrow** and every downstream confidence is inflated.
- **MAPE** on `EAC` vs final cost, grouped by `method`.

These are surfaced on an internal diagnostics screen and, more importantly, **fed back as
`methodPower`**. A method that has been wrong on this contractor's data earns a lower weight on this
contractor's data. That is the only "learning" in this platform, it is transparent, and it is enough.

If calibration says a detector is badly calibrated and nobody acts, delete the detector. §13's
dismissal-rate feedback will do it automatically.

---

## 12. Risk Detection

**Purpose.** *"This is likely to hurt."* Future tense. Consumes Facts (§6) and Forecasts (§7). **Zero
LLM.**

### 12.1 The risk register

Each risk is `likelihood × impact`, and **impact is denominated in money**, never in stars.

| Risk | Trigger | Likelihood | Impact (money) |
|---|---|---|---|
| **Cost overrun** | `CPI < 0.95 ∧ progress < 60%` | `1 − CPI`, capped | `\|VAC\|` (§7.1) |
| **Schedule slip** | `SPI < 0.90` | from SPI trend | liquidated damages, or `overhead/day × slipDays` |
| **Liquidity** | `cash(w) < 0` for any w ≤ 13 (§7.3) | interval overlap with 0 | shortfall at trough |
| **Collection** | customer DSO trending up ∧ exposure > threshold | Beta-Binomial (§7.3) | outstanding receivable |
| **Supplier concentration** | `supplier.spendShare > 0.40` | 1.0 (it is a fact) | spend at risk if they fail |
| **Margin erosion** | `changeOrderErosion > 0.15 ∧ marginToDate < expected` | | `(expected − actual) × BAC` |
| **Price exposure** | `priceDrift12m > 0.10` ∧ remaining quantity to buy > 0 | forecast interval | `drift × remainingQty × price` |
| **Single point of failure** | one supplier is the sole source of a material on a live project | 1.0 | that material's remaining cost |

**Severity** = a monotone function of `likelihood × impact`, bucketed to `{INFO, WARNING, CRITICAL}`
with the money thresholds read from `system_settings` — because "large" is 5 000 for one contractor and
500 000 for another, and hard-coding it makes the feature wrong for everyone but the first customer.

### 12.2 Why `price exposure` multiplies by *remaining* quantity

This is the distinction §2.2 draws, made concrete. Cement being 14% over baseline is an **anomaly**
regardless. It is a **risk** only if you still have cement to buy. If the project is at 95% progress and
all cement is purchased, the money is spent, the anomaly is history, and telling the owner to
renegotiate is noise.

An anomaly detector that fires on past facts and a risk engine that multiplies by future exposure are
different services for this reason, and collapsing them is why most alerting nags.

**Output.** `Signal { kind: RISK, likelihood, impact: Money, valueAtStake: Money, horizon, evidence[] }`

---

## 13. Recommendation Engine & Ranking

Two services, deliberately split: **generation** answers *what could be said*; **ranking** answers *what
is worth a human's attention*. Attention is the scarce resource, not compute.

### 13.1 Recommendation Engine — three tiers

Ship tier 0 first (§A10.5). **Zero LLM in any tier.**

| Tier | Mechanism | Example | Explainable |
|---|---|---|---|
| **0 — Rule** | Deterministic SQL over read models | "3 payments overdue > 30 days" | Trivially. Cites the rows |
| **1 — Statistical** | Consumes §8/§12 signals | "Cement is 14% above your 12-month average" | Yes. Shows the baseline |
| **2 — Semantic** | Consumes §9 patterns, pgvector kNN | "Projects like this used template T" | Partially. Shows the neighbours |

**Input.** `Signal[]` from Anomaly, Risk, Pattern; `Forecast[]` from Predictive; `Fact[]` from Financial.
**Output.** `Recommendation` rows (§D11.7) + `recommendation_evidence` (§D11.8).

**The schema enforces the ethic.** `explanation` is `NOT NULL` with `CHECK (length(btrim(explanation)) > 0)`.
`tier = 'RULE' ⇒ score IS NULL` — a rule is not *confident*, it is *true*, and attaching a confidence
score to a deterministic fact is a category error the `ck_rec_rule_no_score` check refuses to store.

**Explanations are templates over Facts, not generated text.** That is what keeps §0.1's unplug test
green, and it is what makes the explanation reproducible — the same facts always yield the same
sentence, which an LLM cannot promise.

```
"سعر {material} الحالي {latest} أعلى بنسبة {drift}% من متوسط {window}
 المحسوب على {n} ملاحظة."
```

The LLM may *rephrase* this for the chat surface. It may never *author* it. If the model is down, the
template renders anyway.

**Deduplication.** `uq_rec_dedupe (dedupe_key) WHERE status IN ('NEW','ACKNOWLEDGED')` — the partial
predicate is load-bearing: the nightly generator re-proposes the same finding every night and this
collapses it to one live row, while a **dismissed** recommendation can legitimately recur next quarter
when the condition returns. An unconditional unique would suppress recurrences forever.

### 13.2 Recommendation Ranking

**The ordering function is economic, not statistical.**

```
priority = valueAtStake
         × confidence                       (§11)
         × urgency(timeToImpact)            exp decay; a 90-day risk ranks below a 7-day one
         × actionability                    1.0 if a Capability tool exists, 0.6 if advisory only
         × novelty                          1.0 first time, decays on repeat
         × trust(kind)                      ← the feedback loop
```

`trust(kind)` is a Beta posterior over that recommendation kind's historical `ACTED` vs `DISMISSED`
outcomes, from Memory (§14.3). A rule with a 95% dismissal rate decays toward silence **automatically**.
This is why `dismissed_reason` is `NOT NULL` when dismissed (§D11.7): it is the training signal, and
it is the query that finds rules worth deleting.

**Ranking by model score would be wrong here.** A 0.98-confidence finding about 12 000 IQD must lose to
a 0.55-confidence finding about 400 000 IQD. In a financial tool the ordering function is money.

**Attention budget.** The dashboard shows **at most 5**; the notification bell fires only for
`CRITICAL ∧ sufficiency ≥ ADEQUATE`. Everything else lives in a list the user visits. A platform that
notifies twenty times a day has trained the user to dismiss twenty times a day.

---

## 14. Memory Layer

**Purpose.** Three tiers. The critical rule first:

> **Memory holds conversation and preference. It never holds facts.**

The model must not "remember" the contractor's data; it must **retrieve** it (§A5.5). A fact cached in
a rolling summary is a fact that will be wrong tomorrow, quoted confidently, with no `asOf`. Every
number in every turn is fetched fresh from §5.

### 14.1 Working memory (one turn)

Resolved entities, retrieved Facts, the plan under construction. Lives in `TxContext`. Discarded at the
end of the turn.

### 14.2 Session memory (one conversation)

`ai_sessions.rolling_summary` + `summary_through_message_id` (§D11.1). Beyond N messages the tail is
compacted by the LLM into a summary of **intent and preference** — *"the user is investigating the
Riyadh villa's cost overrun"* — never of values. Bounded prompt, bounded cost.

Redaction happens **before insert** (§D11.2). A database that has ever held an unredacted secret has
held it.

### 14.3 Institutional memory (the organization, forever)

This is the tier that matters and the one usually missing. It is not chat history.

| What | Stored in | Used by |
|---|---|---|
| Which recommendation kinds get dismissed, and why | `recommendations.status` + `dismissed_reason` | Ranking's `trust(kind)` (§13.2) |
| Which plans were confirmed vs rejected | `ai_plans.status` | Preview phrasing; tool trust |
| Which forecasts were right | `forecasts.actual` | `methodPower` (§11.3) |
| Which entity a nickname resolves to | `ai_entity_aliases` **(new)** | The resolver — "الفيلا" → project 14 |
| Thresholds the owner has tuned | `system_settings` | Risk severity buckets (§12.1) |

The alias table is small and high-value: a contractor says "الفيلا" and means one specific project.
Learning that from confirmed resolutions — and *only* from confirmed ones — turns a `Clarification`
turn into a `Preview` turn on the second ask. Learning it from *unconfirmed* guesses would make the
assistant confidently wrong, permanently. Only human-confirmed resolutions are written.

---

## 15. Decision Engine, Prompt Orchestration, Document Intelligence

### 15.1 Decision Engine

**Purpose.** Turn an intent or an accepted recommendation into a typed `Plan`, gate it, preview it,
and — only after a human confirms — execute it. §A5 rings 5 and 6.

```
Intent | Recommendation
   ▼
[Plan synthesis]       LLM (for text intents) or a template (for recommendations)
   ▼
[zod validate]         a hallucinated tool name gets a rejection, not a write
   ▼
[resolve refs]         §10.3. Ambiguous → Clarification, NOT a guess
   ▼
[permission gate]      EACH action, against the LIVE principal
   ▼
[preview]              Arabic sentences. No ids, no JSON, no tool names
   ▼
[HUMAN CONFIRM]  ──reject──▶ audit closed, nothing written
   ▼ approve
[atomic claim]         UPDATE ai_plans SET status='CLAIMED' WHERE status='PENDING' AND user_id=$2
   ▼                   zero rows ⇒ 409. A double-click cannot execute twice (§D11.3)
[execute]              ApplicationService.execute(...) × N — the SAME code path as the HTTP UI
```

**Decision *support*, not decision *making*.** Asked "should I approve this change order?", the engine
does not answer. It returns the **consequences of each option**, computed:

```
approve → revisedTotal 136 700 (+5.0%) · margin 18.5% → 17.2% · EAC +4 200 · cash trough w6 −1 100
reject  → scope unchanged · schedule risk ↑ (likelihood 0.4, impact ~9 000)
```

The human decides. There is no autonomous write path anywhere in this architecture, and no column in
§D can express one (§D17.4). A recommendation may **pre-fill** a plan; the plan still walks the gate.

### 15.2 Prompt Orchestration

**Purpose.** The only place a prompt is constructed, and the only ring that talks to a model.
Isolated so it can be faked in tests — which is exactly what made the previous AI test suite possible
with a fake `LlmClient` and a real database.

**Prompts are versioned code artifacts, not strings in a service.**

```
PromptTemplate { name, version, body, model, outputSchema, maxTokens, temperature }
```

Stored in `ai_prompt_templates` **(new table)** so a prompt change is a migration with a diff and a
rollback, not a redeploy nobody can trace. `ai_executions` records which `(name, version)` ran, so a
regression in answer quality can be bisected against prompt history.

| Concern | Rule |
|---|---|
| **Context assembly** | System + capability manifest + `Fact[]` + resolved entities + rolling summary. Hard token budget; **facts are never truncated** — the conversation tail is |
| **Structured output** | Every call declares a zod schema. The model's response is parsed, not interpreted. A parse failure is a retry, then a `rejected` |
| **Model routing** | Cheap fast model for mode classification; the better model only for planning and narration. Most turns never reach the expensive one |
| **Grounding** | The prompt contains **only** facts retrieved this turn. No pretraining is trusted for business data |
| **Redaction** | PII stripped before the prompt leaves the process, not before it is displayed |
| **Determinism** | `temperature = 0` for planning and extraction. Non-zero only for narration prose |
| **Caching** | Identical `(template version, fact hash, question hash)` → cached response. `embeddings.content_hash` (§D10.2) does the same for the only *paid* per-row operation |

**Cost control** is a schema constraint, not a hope: `ck_aie_prerouted_free` makes a pre-routed turn
that billed the user impossible to record (§D11.4).

### 15.3 Document Intelligence

Two directions. The LLM appears in both, and writes in neither.

**Inbound — extraction.** A photographed or PDF supplier invoice → structured cost lines.

```
upload → quarantine (§B18.2) → OCR/parse → LLM extract → zod validate
       → resolve supplier & materials against real rows (§10.3)
       → recompute totals in Decimal (the model's arithmetic is DISCARDED)
       → build a Plan  →  PREVIEW  →  human confirm  →  project_costs rows
                                                     →  material_price_history (§D4.5)
```

Two rules make this safe. The model proposes `{ supplier: "…", lines: [{material, qty, unitPrice}] }`
and **never a total** — the backend multiplies and sums in `Decimal` (§A5.1 invariant 3). And an
unresolvable supplier is a `Clarification`, never a silently created one. An extraction pipeline that
auto-creates entities will fill the catalog with near-duplicate suppliers within a month.

Confidence is **per field**. A low-confidence `unitPrice` is highlighted in the preview for the human
to check; the row is not dropped and not silently accepted.

**Outbound — narration.** `ai_reports` (§D11.9):

```
deterministic SQL over READ MODELS
   → freeze the numbers into data_snapshot (jsonb)
   → hand ONLY those numbers to the LLM
   → store prose in `narrative`
```

The model never queries, never sums, and never emits a figure not already in the snapshot. A report can
be re-rendered, re-translated, or re-narrated years later against the numbers **as they were understood
that day** — which is precisely what `fact_project_daily` exists to make possible (§D10.3).

A report whose narrative disagrees with its snapshot is detectable, and a test asserts every numeral in
`narrative` appears in `data_snapshot`. A report that re-queries live data at render time silently
rewrites history.

**Also:** `{{placeholder}}` mapping for DOCX templates. The renderer never computes (§B19.2) — it
receives `"131500.0000"` and prints it.

---

## 16. Workflows

Six end-to-end traces. Note that **only two involve a human typing**, and only three call the model.

### W1 — The nightly intelligence sweep *(no human, no chat; most of the value)*

```
02:00  jobs: analytics.refresh-matviews      REFRESH … CONCURRENTLY ×4
02:30  jobs: analytics.snapshot-facts        append fact_project_daily (ACTIVE projects only)
03:00  jobs: forecasts.backfill-actuals      fill forecasts.actual where horizon passed
       jobs: confidence.calibrate            Brier, interval coverage, MAPE → methodPower
05:00  jobs: intelligence.sweep
         │
         ├─ KnowledgeEngine.cohort(...)                 → Fact[]  (every live project)
         ├─ FinancialIntelligence.evaluate(facts)       → Fact[]  (CPI, SPI, margin, cash)
         ├─ PredictiveEngine.forecast(facts)            → Forecast[]  (EAC, dates, cash, prices)
         ├─ AnomalyDetection.scan(facts, series)        → Signal[ANOMALY]
         ├─ PatternRecognition.mine(history)            → Signal[PATTERN]
         ├─ RiskDetection.assess(facts, forecasts)      → Signal[RISK]
         │        (all five run in parallel; none calls an LLM; none writes)
         ▼
       RecommendationEngine.generate(signals, forecasts, facts)
         │   dedupe via uq_rec_dedupe (partial: NEW|ACKNOWLEDGED only)
         ▼
       RecommendationRanking.rank(recs, memory.trust, confidence)
         │   priority = valueAtStake × confidence × urgency × actionability × novelty × trust
         ▼
       persist recommendations + recommendation_evidence
         │
         ▼
       outbox → NotificationProjector
                  → notify ONLY where severity=CRITICAL ∧ sufficiency ≥ ADEQUATE
                  → idempotency_key = <kind>:<entityId>:<date>:<userId>   (§B21.3)
```

Zero LLM calls. Zero tokens. Works with OpenRouter unreachable. If the contractor never opens the
chat, the platform still delivered a ranked, explained, evidence-backed briefing to the bell.

**That is the business intelligence layer.** Everything below is interface.

### W2 — A question *(LLM narrates; it does not compute)*

> *"لماذا انخفض هامش الربح في فيلا الرياض؟"* — Why did the margin drop on the Riyadh villa?

```
Governance: live-role recheck → per-user rate limit → quota → OPEN ai_executions
Conversation: load session + rolling summary → classify mode = QUESTION
Reasoning:
  ├─ Pre-router: not a greeting → continue                      (no LLM yet)
  ├─ Resolver:  "فيلا الرياض" → resolve('project')
  │              unique → project 14        (ambiguous ⇒ Clarification, §10.3)
  ├─ KnowledgeEngine.facts([marginToDate, cpi, costToDate, earnedValue], project 14)
  │              + series(costByCategory, 90d)
  │              + Signal[] already computed by W1  ← the analysis is ALREADY DONE
  ▼
Planner (LLM, READ tools only — structurally, a QUESTION cannot bind a WRITE tool)
  ▼
Narration: the model receives Facts and Signals; it writes a sentence; it computes NOTHING
  ▼
{ kind: 'answer',
  text: "انخفض الهامش من 18.5% إلى 14.2% بسبب تجاوز تكلفة المواد بمقدار 6,400 …",
  citations: [ {project_cost, 8821}, {material_price_history, 4410} ] }
  ▼
CLOSE ai_executions (tokens, cost, latency, tools invoked)
```

The model's contribution is the *sentence*. The `14.2%` came from `Decimal` arithmetic in §6, and the
citation ids let the user open the rows. With the model down, the same question answered from the UI's
"explain" affordance renders the template instead — less fluent, equally true.

### W3 — A command *(LLM plans; deterministic code writes)*

> *"سجل تكلفة 500 ألف للأسمنت على مشروع الفيلا"*

```
mode = COMMAND
  ├─ Resolver: "الفيلا" → ai_entity_aliases hit → project 14 (learned from a prior CONFIRMED turn)
  ├─ Resolver: "الأسمنت" → material 7
  ▼
Planner (LLM) → Plan { actions: [{ tool: 'cost.record',
                                   args: { projectId: <ref>, materialId: <ref>,
                                           quantity: "…", unitPrice: "…" } }] }
  ▼
zod validate → allow-list check → resolve refs to REAL ROWS → permission-gate 'costs.create'
  ▼
Preview (Arabic, no ids):  "سيتم تسجيل تكلفة أسمنت بقيمة 500,000 على مشروع فيلا الرياض."
  ▼
HUMAN CONFIRM  ─reject─▶ audit closed, nothing written
  ▼ approve
Atomic claim (CAS on ai_plans.status) — a double-click returns 409, not a second cost
  ▼
BEGIN
  RecordProjectCost.execute(cmd, principal)   ← the SAME use case the HTTP UI calls
  outbox.append(ProjectCostRecorded)
COMMIT
  ▼
dispatcher → PriceHistoryProjector → material_price_history (uq_mph_purchase: idempotent)
           → SearchProjector, AnalyticsProjector
```

Note step 1: the model produced `quantity` and `unitPrice` as *strings it read from the user's own
sentence*, and the backend recomputes `totalAmount = quantity × unitPrice` in `Decimal`. The model's
arithmetic is never trusted (§A5.1 invariant 3), and `ck_pc_line_math` is the backstop.

### W4 — Invoice extraction *(LLM proposes; a human confirms)*

```
upload PDF → quarantine → magic-byte sniff → OCR
  ▼
LLM extract (temperature 0, zod schema, NO totals requested)
  → { supplier: "مؤسسة الأمل", lines: [{ material:"أسمنت", qty:"12.5", unitPrice:"342" }] }
  ▼
resolve supplier → ambiguous (two similar names) ⇒ CLARIFICATION, never auto-create
resolve materials → material 7
  ▼
recompute totals in Decimal; DISCARD any number the model emitted
  ▼
Plan → Preview (per-field confidence; low-confidence unitPrice highlighted)
  ▼
HUMAN CONFIRM → project_costs rows → outbox → material_price_history (source = PURCHASE)
```

The cost row that lands here becomes tomorrow's price baseline, which becomes next week's anomaly, which
becomes a recommendation. **The loop closes**, and no step trusted the model with a number.

### W5 — Report generation

```
POST /ai/reports {kind, period} → 202 + jobs row
  ▼
deterministic SQL over READ MODELS → data_snapshot (jsonb, FROZEN)
  ▼
LLM narrates ONLY the snapshot → narrative
  ▼
status=READY. Optionally rendered to DOCX (generated_documents.ai_report_id)
```

Test: every numeral in `narrative` must appear in `data_snapshot`.

### W6 — Recommendation → action

```
Recommendation (from W1) → user taps "act"
  ▼
recommendation.actionPlan (a TEMPLATE, not an LLM output) pre-fills ai_plans
  ▼
…the ordinary Decision Engine gate: validate → resolve → permission → preview → confirm → execute
  ▼
recommendations.acted_plan_id = plan.id ; status = ACTED
  ▼
Memory: trust(kind) ↑        ← the loop that makes ranking improve
```

`acted_plan_id` points from the recommendation **to** the plan, because the recommendation is the cause
and the plan is the effect — and because a hand-built plan has no recommendation (§D11.7).

---

## 17. Cold start — what the platform can honestly say, and when

A fresh install has zero rows. Most "AI insights" products are silently useless here and cover it with
empty-state art. This one must **say what it needs**.

| Data | Available | Blocked, and the platform says so |
|---|---|---|
| **Day 0** — nothing | Pre-router, capability answers, semantic search over the seeded catalog | "لا توجد بيانات كافية بعد." Everything else `INSUFFICIENT` |
| **1 project, 5 costs** | `costToDate`, `marginToDate` (WEAK), rule-tier recommendations (overdue payments, missing data) | No anomaly detection (n < 8), no forecast, no pattern |
| **1 project, 30 costs** | + Anomaly (robust z), cost velocity (Poisson), `EAC` (WEAK) | No cross-project patterns |
| **3 months, 8 price obs/material** | + price drift, price baseline, supplier divergence | No seasonality (< 2 y) |
| **5 comparable projects** | + template→overrun patterns, step-duration intervals, cost-profile similarity | Market-basket still below support floor |
| **20 projects, 3 000 costs** | + FP-growth patterns, calibrated `methodPower`, meaningful `trust(kind)` | Benford (< 500 values per grouping) |
| **2 years** | + seasonality | |

Two design consequences:

1. **The tier-0 rule engine must carry the product for the first quarter.** "Three payments overdue > 30 days" needs no statistics and is immediately valuable. Ship it first (§A10.5).
2. **Onboarding is a data-sufficiency problem.** The most useful thing the platform can say on day 30 is *"record `planned_start_date` on your steps and I can tell you if you're behind schedule."* That is an `INSUFFICIENT_DATA` output with a call to action, and it is worth more than a fabricated SPI.

---

## 18. Failure and degradation

| Failure | Result kind | Quota | What still works |
|---|---|---|---|
| OpenRouter down / breaker open | `error` | no | **12 of 15 services.** W1 runs. Recommendations still generated, ranked, notified. Templates render explanations |
| Model returns invalid JSON | retry, then `rejected` | yes | |
| Ambiguous entity | `clarification` | yes | Progress, not failure |
| Permission denied | `rejected` | **no** — refused before the model | |
| Quota exhausted | `error` | — | The deterministic stack is unaffected. Analysis is not billed |
| Matview refresh failed | — | — | Facts carry a stale `asOf`; Ranking **demotes** rather than suppresses |
| `INSUFFICIENT_DATA` | an output, not an error | — | The platform names what is missing (§17) |
| Projector poisoned | dead-letter + CRITICAL notification | — | Outbox never blocks (§B17.1) |

`rejected` ("I understood you and the answer is no") and `error` ("I could not serve you") are distinct
kinds because they are distinct to a human, and conflating them makes the assistant feel broken when it
is merely offline (§A5.6).

**The breaker is per-user.** A shared breaker is a cross-user denial of service (§A5.3).

---

## 19. Schema deltas this design requires

`docs/DATABASE.md` §11 covers the *assistant* (`ai_sessions`, `ai_messages`, `ai_plans`,
`ai_executions`, `ai_tool_invocations`, `ai_usage_counters`) and the *output* (`recommendations`,
`recommendation_evidence`, `ai_reports`). It has **nowhere to put the intelligence layer's intermediate
state.** Four tables are missing, and they are what make §11.3's calibration and §13.2's feedback loop
possible at all.

| Table | Purpose | Why it cannot be derived |
|---|---|---|
| `signals` | Append-only. Every `ANOMALY \| RISK \| PATTERN \| OPPORTUNITY` ever emitted, with `method`, `observed`, `expected`, `confidence`, `value_at_stake`, `evidence` | A recommendation is a *decision about* signals. Discarding signals means you cannot ask "did we detect this and choose not to say it?" — which is the first question after a loss |
| `forecasts` | `metric, subject, horizon, point, interval, method, confidence, made_at, actual, actual_at` | **The `actual` column is the entire calibration story.** A forecast recomputed on read can never be scored, because you no longer know what you predicted (§11.3) |
| `ai_prompt_templates` | `name, version, body, model, output_schema, is_active` | Prompt changes must be diffable and bisectable against answer-quality regressions (§15.2) |
| `ai_entity_aliases` | `alias_norm, entity_type, entity_id, confirmed_by, confirm_count` | Institutional memory (§14.3). Written **only** from human-confirmed resolutions |

Plus two column additions:

- `construction_steps.planned_start_date` / `planned_end_date` — §D7.2 already adds them. **Without them SPI, schedule risk, and delay forecasting are uncomputable** (§6). This is not optional for the platform as briefed.
- `recommendations.value_at_stake numeric(18,4)` — the ranking function's primary term (§13.2). §D11.7 has `score` but no money.

`signals` and `forecasts` follow the `material_price_history` shape exactly: `bigint` identity,
append-only, BRIN on the time column, no soft delete, rebuildable in principle but retained because
history is the point.

---

## 20. What the platform is not

Named so they read as choices, not gaps.

- **Not a chatbot.** Chat is one of three adapters (§0.2), and the least valuable.
- **Not machine learning.** Twenty projects is not a training set (§1.1). Applied statistics, EVM, and rules, executed with discipline.
- **No fine-tuning.** Retrieval solves the actual problem (§A15). Fine-tuning on a contractor's 20 projects would memorize, not generalize.
- **No autonomous writes. Permanently rejected, not deferred** (§A15). No column in §D can express one.
- **No agent loop.** The model is called once or twice per turn with a bounded prompt, and it returns a typed value. A model that can call itself in a loop can spend unbounded money and produce unbounded plans, and neither has an owner.
- **No vector database.** pgvector, and not even an index until ~10k rows (§10.2).
- **No RLHF, no preference tuning.** `trust(kind)` is a Beta posterior over dismissals — transparent, inspectable, and enough.
- **No "AI-generated numbers."** Anywhere. The model narrates a frozen snapshot and proposes typed plans.

---

## 21. Decisions I need from you

| # | Decision | My call | Reverse it if |
|---|---|---|---|
| 1 | **`SKIPPED` steps and progress** — §D18 #4, §B6.3 P5, still unanswered | **Blocks everything.** `progress` feeds EV, which feeds CPI, SPI, EAC, cost-overrun risk, and half the recommendations. Every one of them is wrong today for any project with a skipped step | — this is not a preference, it needs a product answer before §6 can be written |
| 2 | **`planned_start_date` / `planned_end_date` on steps** | Ship them. Without a schedule baseline there is no SPI, no delay forecast, no schedule risk | You accept that the platform can assess **cost** but never **schedule** |
| 3 | **The four new tables** (§19) | Add them. `forecasts.actual` is the only thing that makes confidence honest | You accept that confidence scores are never validated — in which case, per §11.3, delete confidence rather than fake it |
| 4 | **Ranking by `valueAtStake`, not by score** | Money orders the list | You want statistical surprise to order a financial tool's attention |
| 5 | **Explanations are templates, not LLM output** | Templates. It is what keeps §0.1's unplug test green and makes explanations reproducible | You'd trade reproducibility for fluency |
| 6 | **Semantic tier off at launch** (lexical + trigram only, §10.2) | Off. ~4 000 entities; an `ivfflat` index on a fresh install returns near-random results forever | |
| 7 | **`overhead_expenses`** (§D8.2, optional) | Ship it. Without it `company.overheadAbsorption` and the true cash-outflow term in §7.3 are uncomputable, and "profit" on the dashboard means project profit, never company profit | |
| 8 | **Benford / round-number detectors** | Ship behind the n≥500 gate, `INFO` severity only. They are fraud *smells*, not findings | Cut them. They are the two lowest-value detectors and the two most likely to embarrass |

---

## 22. What this document does not do

- **No code, no schemas, no prompts.** By instruction.
- **No thresholds.** `|robust z| > 3.5`, support ≥ 0.3, and the severity money buckets are *starting points* read from `system_settings` (§12.1), to be calibrated against the first real dataset. Hard-coding "large" makes the feature wrong for every contractor but the first.
- **No model choice.** §A9: OpenRouter *is* the abstraction over providers; re-implementing it was the prior mistake. Model routing (§15.2) is a config table, not an architecture.
- **No evaluation harness.** §11.3 specifies *what* is measured (Brier, interval coverage, MAPE) and that it feeds `methodPower`. The harness is phase-5 work.




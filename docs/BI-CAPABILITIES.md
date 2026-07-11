# Contractor Plus — Business Intelligence Capabilities

**Status:** Specification. No implementation.
**Continues:** `docs/ARCHITECTURE.md` (§A), `docs/DATABASE.md` (§D), `docs/BACKEND.md` (§B), `docs/AI-PLATFORM.md` (§P).

Fifteen capabilities. For each: **inputs · algorithm · workflow · confidence · fallback · outputs.**

Per §P0, twelve of these contain no language model. Three (Automatic Reports, Executive Summaries,
and the extraction half of Duplicate Detection) use one, and none of them lets it produce a number.

---

## 0. Ground rules, restated because every section depends on them

1. **No engine reads the database.** Every capability consumes `Fact` from the Knowledge Engine (§P5) and emits `Fact`, `Signal`, or `Forecast`. This is what makes `ai/* → repository` a forbidden import (§A12).
2. **All arithmetic is `Prisma.Decimal`.** No `.toNumber()` outside the DTO layer (§B6.5 K3). A `CPI = EV/AC` division without an explicit precision and rounding mode is where a financial engine quietly starts lying.
3. **Nothing throws. Nothing guesses.** Every capability returns one of three shapes (§2.4). `INSUFFICIENT_DATA` is an *output*, not a silence.
4. **Every number carries `asOf`, `sufficiency`, `confidence`, and `provenance`.** A number without provenance cannot appear in a recommendation, because `recommendation_evidence` requires rows (§D11.8).
5. **Robust statistics, always.** Median and MAD, never mean and stddev (§P1.1). At n=20 a single outlier inflates stddev enough to hide itself.

---

## 1. The progress rule — resolved, and its consequences

Every capability that touches Earned Value depends on this. It is now decided: **a `SKIPPED` step's
percentage is redistributed pro rata across the remaining non-skipped steps.**

### 1.1 The formula

Let `S` = all steps of a project, `K ⊂ S` the skipped ones, `D ⊂ S \ K` the completed ones.

```
skippedShare    = Σ_{i∈K} pct_i
remainingShare  = 100 − skippedShare

effectivePct_i  = pct_i × 100 / remainingShare          for i ∉ K
progress        = Σ_{i∈D} effectivePct_i
                = 100 × ( Σ_{i∈D} pct_i ) / (100 − skippedShare)
```

Stored `construction_steps.percentage` values still sum to 100 — the `SUM = 100` aggregate invariant
(§B6.6) is untouched. Redistribution happens **at read**, inside `Project.recomputeProgress()`. Nothing
is rewritten, so un-skipping a step is lossless.

Worked example (the one from the decision):

| Step | pct | status | effectivePct |
|---|---|---|---|
| A | 30 | COMPLETED | `30 × 100/80 = 37.5` |
| B | 20 | **SKIPPED** | — |
| C | 50 | PENDING | `50 × 100/80 = 62.5` |

`progress = 37.5`. When C completes: `100.0`. Reachable.

### 1.2 Edge cases, each of which will occur

| Case | Rule |
|---|---|
| **All steps skipped** (`remainingShare = 0`) | `progress` is **undefined**, not `0` and not `100`. Return `INSUFFICIENT_DATA`. Division by zero is a real path here, not a hypothetical |
| **Skipping a step raises progress** | Yes, and it is correct. A project at 30% jumps to 37.5% by skipping B. The denominator shrank. §1.3 |
| **Un-skipping lowers progress** | Also correct, and monotonicity is therefore **not** an invariant. Any UI or forecast that assumes progress never decreases is wrong |
| **A COMPLETED step is later marked SKIPPED** | Refuse in the domain: `SKIPPED` is only legal from `PENDING`. `ck_cs_started` (§D7.2) already forbids `started_at` on a skipped step |
| **Progress and `fact_project_daily`** | Snapshots record progress *as believed that day*. Skipping a step today does **not** restate yesterday's snapshot. This is exactly why §D10.3 is immutable |

### 1.3 The consequence nobody asked for, and it is valuable

`EV = BAC × progress`, and `BAC = revisedTotal` — the contract value, which **does not fall when work is
skipped**. So skipping a step:

```
progress ↑   →   EV ↑   →   CPI = EV/AC ↑   →   forecast margin ↑
```

You are paid the same and did less work. **That is economically correct** — and it is exactly why it is
dangerous. If the skipped scope should have triggered a deduction, a *negative* change order was
required (§D6.4 O3), and its absence silently inflates the project's margin and every forecast built
on it.

> **New detector: `SCOPE_SKIPPED_WITHOUT_CHANGE_ORDER`.**
> Trigger: a step transitions to `SKIPPED` and no `APPROVED` change order with `amount < 0` exists on
> the parent contract within N days.
> `valueAtStake = BAC × pct_skipped / 100` — the contract value attributable to work not performed.
> Severity `WARNING`. Method is a **rule**, so `confidence = 0.99` and `tier = RULE` (hence
> `score IS NULL`, per `ck_rec_rule_no_score`).

This detector exists only because the progress rule was decided honestly. Had we chosen "skipped counts
as complete", the same inflation would occur with no signal at all — the numbers would look fine.

### 1.4 What this unblocks

`progress` → `EV` → `CPI`, `SPI`, `EAC`, `VAC`, `TCPI` → §3 Project Analysis, §8 Financial Forecasting,
§9 Profit Prediction, §10 Risk, §11 Budget Analysis. Five of fifteen capabilities were uncomputable
until this turn.

---

## 2. Shared machinery

### 2.1 The EVM base, computed once per project, reused by five capabilities

```
BAC  Budget at Completion   = contract.revisedTotal          (§D6.2, derived)
EV   Earned Value           = BAC × progress                 (§1.1)
AC   Actual Cost            = Σ project_costs.total_amount
PV   Planned Value          = BAC × plannedProgress(today)   (§2.2)

CPI  = EV / AC          < 1 ⇒ over budget
SPI  = EV / PV          < 1 ⇒ behind schedule
CV   = EV − AC          money
SV   = EV − PV          money
TCPI = (BAC − EV) / (BAC − AC)      cost performance the remainder must achieve
```

`TCPI` is the underused one. If `CPI = 0.85` and `TCPI = 1.30`, the project must suddenly perform 53%
better than it ever has. That is not a forecast, it is an **arithmetic impossibility statement**, and it
is the single most persuasive number you can put in front of an owner.

Guard: `AC = 0` ⇒ `CPI` undefined (not infinite). `BAC = AC` ⇒ `TCPI` undefined. Both return
`INSUFFICIENT_DATA`, never `Infinity`. A `Decimal` division by zero throws; every call site checks.

### 2.2 `plannedProgress(t)` — and the migration it needs

```
plannedProgress(t) = Σ_{i ∉ K} effectivePct_i × completionFraction_i(t)

completionFraction_i(t) = 0                                            t < plannedStart_i
                        = (t − plannedStart_i)/(plannedEnd_i − plannedStart_i)   within
                        = 1                                            t > plannedEnd_i
```

Linear interpolation within a step. Requires `construction_steps.planned_start_date` /
`planned_end_date` (§D7.2, §P19).

**Without them there is no schedule baseline, and `SPI`, `SV`, schedule risk, and delay forecasting are
uncomputable.** They degrade to `INSUFFICIENT_DATA` with `missing: ['construction_steps.planned_start_date']`
— which §17 (Missing Data Detection) then surfaces as an actionable onboarding prompt. The platform
tells you what to record so it can tell you more.

### 2.3 Confidence, uniformly

```
confidence = w₁·sampleAdequacy + w₂·freshness + w₃·methodPower + w₄·(1 − dispersion)
             w = (0.35, 0.20, 0.30, 0.15)

sampleAdequacy = min(1, n / minN)                       from the Fact Catalog (§P2.1)
freshness      = exp(−age(asOf) / halfLife)             halfLife = 48 h for nightly matviews
methodPower    = constant per method, tuned by calibration (§P11.3)
dispersion     = intervalWidth / |point|                forecasts only; 0 otherwise
```

`methodPower` starting values, before calibration has data:

| Method | power | Why |
|---|---|---|
| Deterministic rule (duplicate invoice, missing field) | 0.99 | It is true, not inferred |
| EVM closed form (CPI, EAC) | 0.85 | Assumes past performance predicts future |
| Robust z / MAD | 0.80 | Well-founded at n ≥ 8 |
| Theil–Sen trend | 0.75 | Breakdown point 29% |
| Beta-Binomial collection | 0.70 | Honest, but weak at n = 3 |
| Poisson rate | 0.65 | Counts are bursty in construction |
| Cosine similarity (cost profile) | 0.55 | Interpretable, not predictive |
| Benford χ² | 0.40 | Weak evidence even at n = 500 |
| Round-number clustering | 0.30 | A smell, never a finding |

**Confidence propagates multiplicatively.** `conf(EAC) = conf(CPI) × conf(BAC) × methodPower(EVM)`.
Two weak inputs agreeing do not make a strong output.

### 2.4 The sufficiency ladder and the fallback contract

Every capability returns exactly one of three shapes. **None throws. None guesses.**

```
Computed    { value, confidence, sufficiency: ADEQUATE|STRONG, asOf, provenance[] }
Degraded    { value, confidence, sufficiency: WEAK, asOf, provenance[], caveats[] }
Insufficient{ reason, missing: string[], needed: n, have: n, remedy: string }
```

| Sufficiency | Condition | Behaviour |
|---|---|---|
| `INSUFFICIENT` | `n < minN` | **Emit no signal.** Name what is missing and what to do about it |
| `WEAK` | `minN ≤ n < 2·minN` | Emit, rendered greyed. **Never `CRITICAL`. Never notifies** |
| `ADEQUATE` | `2·minN ≤ n < 5·minN` | Emit normally |
| `STRONG` | `n ≥ 5·minN` | Emit; may notify |

`Insufficient` is a first-class answer:

> *"I cannot assess this project's cost performance: 3 cost entries recorded, 5 needed."*

Useful and honest. A blank card is neither, and a number computed from 3 rows is worse than both.

### 2.5 Degradation cascade

When a dependency degrades, the dependant does **not** fail — it inherits and widens.

```
matview refresh failed        →  asOf 48h stale  →  freshness ↓  →  confidence ↓
                                                 →  Ranking DEMOTES, does not suppress (§P5)
planned dates missing         →  SPI Insufficient →  EAC falls back to the CPI-only variant (§9.2)
                                                  →  schedule risk Insufficient, cost risk unaffected
CPI undefined (AC = 0)        →  EAC Insufficient →  Budget Analysis reports BAC only
customer has < 3 payments     →  P(collect) = prior (0.5, Laplace)  →  cash forecast interval widens
OpenRouter down               →  narration falls back to the template  →  numbers unchanged
```

The invariant: **a missing input never fabricates a value; it widens an interval or removes a term.**

---

## 3. Project Analysis

**Inputs.** `contract.revisedTotal`, `project.progress` (§1), `Σ project_costs`, `construction_steps`
(+ planned dates), `fact_project_daily` history.

**Algorithm.** The EVM base (§2.1), plus a **health rubric** — not a black-box score.

```
components:
  cost      = CPI            band: ≥1.00 GOOD | 0.95–1.00 WATCH | <0.95 BAD
  schedule  = SPI            band: ≥0.95 GOOD | 0.90–0.95 WATCH | <0.90 BAD
  feasible  = TCPI − CPI     band: ≤0.05 GOOD | 0.05–0.15 WATCH | >0.15 BAD
  cash      = collected/billed  band: ≥0.90 GOOD | 0.70–0.90 WATCH | <0.70 BAD

health = worst(components)          ← NOT a weighted average
```

**`worst()`, deliberately.** A weighted average lets a healthy cash position mask an impossible `TCPI`.
In a financial tool the composite must be the *binding constraint*, and the UI shows which component
bound it. A single number that cannot be decomposed is exactly the "unexplained recommendation" §A10.5
forbids.

**Workflow.** W1 nightly (§P16) for every live project; on demand from `GET /projects/:id/summary`;
recomputed on `ProjectCostRecorded` / `ConstructionStepCompleted` via the outbox.

**Confidence.** `minN = 5` cost entries and `≥ 3` steps. `dispersion = 0` (no forecast term).
Stale matview ⇒ `freshness` decays.

**Fallback.**

| Missing | Behaviour |
|---|---|
| planned dates | `SPI`, `SV`, `feasible` → `Insufficient`. `cost` and `cash` still reported. Health = worst of the *available* components, and says so |
| `AC = 0` (no costs yet) | `CPI` undefined. Report `EV`, `BAC`, progress only |
| all steps skipped | progress undefined (§1.2) → whole analysis `Insufficient` |
| `< 5` costs | `Degraded`, `WEAK`, never notifies |

**Outputs.** `Fact[]` (`project.cpi`, `.spi`, `.evm.*`, `.health`), `Signal[RISK]` when a band is BAD.

---

## 4. Client Analysis

**Inputs.** `payments` (scheduled, paid, due, paid dates), `contracts`, `projects`, `customers`.

**Algorithms.**

**Days Sales Outstanding** — amount-weighted, so a large late payment outranks a small one:

```
DSO = Σ_p amount_p × max(0, paymentDate_p − dueDate_p) / Σ_p amount_p
```

**Collection probability** — Beta-Binomial with a Laplace prior. Not a model; counting, done correctly:

```
P(collect on time) = (onTime + 1) / (total + 2)
```

At `total = 0` this yields `0.5` — an explicit *"I have no idea"*, not an optimistic `1.0`. That single
`+1/+2` is what keeps the cash forecast (§8) from being wrong about every new customer in the same
direction.

Credible interval from the Beta posterior `Beta(onTime+1, late+1)`; report the 80% HDI.

**Exposure and expected loss:**

```
exposure     = Σ (scheduled_amount − paid_amount)   over live, uncancelled payments
expectedLoss = exposure × (1 − P(collect))
```

**Revenue concentration — Herfindahl–Hirschman Index** over customer revenue shares:

```
HHI = Σ s_i²        s_i = customer_i revenue / total revenue
  < 0.15  competitive     0.15–0.25  moderate     > 0.25  concentrated
```

A contractor with `HHI = 0.6` has two clients and a business-continuity risk, not a customer base. HHI
is preferred over "top-1 share" because it responds to the whole distribution, and it is a number the
owner can be shown alongside its definition.

**Lifetime margin** per client: `Σ (EV − AC)` across their projects.

**Workflow.** W1 nightly. On demand from `GET /customers/:id`. Recomputed on `PaymentSettled`.

**Confidence.** `minN = 3` settled payments for DSO and `P(collect)`; `minN = 3` customers for HHI.
`methodPower` = 0.70 (Beta-Binomial), 0.99 (HHI — it is a definition, not an inference).

**Fallback.** `< 3` payments ⇒ `P(collect)` returns the prior `0.5` with `sufficiency = INSUFFICIENT`,
and §8's cash forecast widens rather than dropping the customer. `< 3` customers ⇒ HHI suppressed (it
would trivially read "concentrated" and say nothing).

**Outputs.** `Fact[]` (`customer.dso`, `.collectionProbability`, `.exposure`, `company.revenueHHI`),
`Signal[RISK]` for collection and concentration.

---

## 5. Contract Analysis

**Inputs.** `contracts`, `contract_items` (snapshots), `change_orders`, `material_price_history`,
realized `project_costs`.

**Algorithms.**

```
changeOrderErosion = Σ approved CO amount / originalTotal
marginVariance     = realizedMarginToDate − expectedProfitMargin
approvalLatency    = signedAt − createdAt
```

**Estimate accuracy per line** — the one that compounds. Compare the snapshotted
`contract_items.estimated_price` against what the material *actually* cost on that project:

```
lineAccuracy_m = actualUnitPrice_m / estimatedPrice_m
estimateBias   = median_m(lineAccuracy_m)          median, not mean (§P1.1)
```

`estimateBias > 1` means the contract systematically under-priced its inputs. Aggregated by
`template_id + version`, this is the feedback that makes the *next* estimate better (§6, §14).

**Under-pricing at signature** — was the estimate wrong, or did prices move? Compare
`estimated_price` against `material.priceBaseline12m` **as of `signedAt`** (`asOf` time travel, §P5):

```
signatureGap_m = estimatedPrice_m / baseline12m(m, signedAt) − 1
```

`signatureGap < −0.1` and `lineAccuracy > 1.1` together mean the estimate was optimistic *at the time*,
not a victim of the market. Those are different failures with different remedies, and separating them is
the whole point of snapshotting prices into `contract_items` (§D6.3).

**Workflow.** On `ContractApproved` and `ChangeOrderApproved`; nightly for open contracts.

**Confidence.** `minN = 3` matched line items for `estimateBias`; `minN = 8` price observations for
`baseline12m`. `methodPower` 0.85.

**Fallback.** No `material_price_history` at signature time (a new install) ⇒ `signatureGap`
`Insufficient`; `lineAccuracy` still computable from realized costs. Contract with zero items ⇒ the
contract could not have been approved (`C6`), so this is a data-integrity signal, not an analysis gap.

**Outputs.** `Fact[]`, `Signal[ANOMALY]` for `estimateBias` outliers, `Signal[RISK]` for margin erosion,
and — from §1.3 — `SCOPE_SKIPPED_WITHOUT_CHANGE_ORDER`.

---

## 6. Material Analysis

**Inputs.** `materials`, `contract_items` (planned BOM), `project_costs` (actual consumption),
`material_price_history`, `supplier_materials`, `units_of_measure`.

**Algorithms.**

**Consumption variance / realized waste.** All quantities normalized to the material's unit via
`conversionToMaterialUnit` **at write time** (§D4.4) — comparing 12.5/bag against 340/ton at read time
silently produces nonsense.

```
realizedWaste_m = actualQty_m / plannedQty_m − 1
wasteGap_m      = realizedWaste_m − template.waste_factor_m
```

`wasteGap > 0` on the same material across several projects is a *process* finding (bad handling, theft,
bad estimate), not a project finding. That is a §7 pattern, surfaced here.

**Price drift** (12-month, robust):

```
drift = latestPrice / baseline12m − 1
baseline12m = volume-weighted median of unit_price over the window   ← median, not mean
```

Volume weighting matters: one 0.5-ton spot purchase must not move the baseline that a 200-ton order
sets.

**Supplier spread** — the dispersion of quotes for the same material:

```
spread = (p_max − p_min) / median(p)     across supplier_materials for material m
```

A spread near zero across "independent" suppliers is the co-movement finding of §P9 — three quotes that
are one quote.

**ABC classification** — Pareto by trailing-12-month spend:

```
sort materials by spend desc; cumulative share
  A: cumulative ≤ 0.80      (typically ~20% of SKUs)
  B: 0.80 < cum ≤ 0.95
  C: cum > 0.95
```

Only **A-class** materials get price forecasting (§15), drift alerts, and supplier scorecards. Running
Theil–Sen over C-class rebar clips is compute spent to generate noise. ABC is how the platform's
attention budget (§P13.2) reaches the catalog.

**Workflow.** W1 nightly. On `ProjectCostRecorded` (drift recheck for that material only, via outbox).

**Confidence.** `minN = 8` price observations for drift/baseline; `minN = 3` suppliers for spread;
`minN = 2` projects for `wasteGap`.

**Fallback.** `< 8` observations ⇒ drift `Insufficient`, `latestPrice` still reported as a bare fact.
Material with no `unit_code` (pre-migration free text) ⇒ **all quantity aggregates suppressed**, and
§17 raises it: *"unit not set — quantity totals for this material are not trustworthy."* This is the
one place the design refuses to compute rather than compute on dirty data.

**Outputs.** `Fact[]`, `Signal[ANOMALY]` (price spike, waste gap), `Signal[PATTERN]` (co-movement).

---

## 7. Expense Analysis

**Inputs.** `project_costs`, `overhead_expenses` (optional, §D8.2), `contract_items`, `building_templates`.

**Algorithms.**

```
burnRate      = Σ costs(trailing 90d) / 90                       money/day
categoryMix_c = spend_c / Σ spend                                per CostCategory
billableRatio = Σ (is_billable) / Σ total
```

**Category budget variance** — the planned category share comes from the template's BOM, not from thin
air:

```
plannedShare_c = Σ template item cost in category c / Σ all template item cost
budget_c       = BAC × plannedShare_c
variance_c     = actual_c − budget_c × progress          ← progress-adjusted. §1
```

Progress-adjusting is essential: a project 20% complete that has spent 20% of its material budget is on
plan, and comparing raw actual to total budget would call it healthy at 90% complete and healthy at 10%.

**Cost velocity anomaly** — Poisson, because cost *counts* are not normal:

```
λ = median(costLines per day, trailing 60d)
flag day d if P(X ≥ k_d | Poisson(λ)) < 0.01
```

Catches the end-of-month dump of thirty back-dated receipts, which is both a data-quality and a control
finding.

**Overhead absorption** (requires `overhead_expenses`):

```
absorption = Σ overhead(period) / Σ direct cost(period)
companyProfit = Σ project (EV − AC) − Σ overhead
```

**Without `overhead_expenses`, "profit" on the dashboard means *project* profit and never company
profit.** The two differ by exactly this term. §21 #3.

**Workflow.** W1 nightly; on `ProjectCostRecorded`.

**Confidence.** `minN = 30` days for burn rate and Poisson λ; `minN = 5` costs for category mix.

**Fallback.** No template ⇒ `plannedShare_c` unavailable ⇒ variance falls back to comparing against the
**peer median** category mix across this contractor's completed projects (`minN = 5` projects), and says
which basis it used. No overhead table ⇒ absorption `Insufficient`; the dashboard labels its profit
figure *"project profit (overhead not tracked)"* rather than *"profit"*.

**Outputs.** `Fact[]`, `Signal[ANOMALY]` (velocity, category blowout).

---

## 8. Payment Analysis

**Inputs.** `payments` (`scheduled_amount`, `paid_amount`, `due_date`, `payment_date`, `status`).

This capability is the direct beneficiary of §D-D4 — the `scheduled`/`paid` split. With a single
`amount` column, none of the below is expressible.

**Algorithms.**

```
aging buckets: 0–30 | 31–60 | 61–90 | 90+   on (today − due_date) for unsettled remainder
outstanding   = Σ (scheduled_amount − paid_amount)   WHERE status ∈ {PENDING, PARTIAL}
adherence     = count(settled on or before due) / count(settled)
partialHabit  = median(first paid_amount / scheduled_amount)   over PARTIAL-then-PAID histories
isLate        = due_date < today ∧ paid_amount < scheduled_amount   ← DERIVED, never stored (§B6.4 Y5)
```

`isLate` derived is the reason `PaymentStatus.LATE` should leave the enum: a stored flag is wrong every
night between midnight and the sweep.

**Expected receipts** for the cash forecast, per payment `p` of customer `c`:

```
E[receipt_p] = (scheduled_p − paid_p) × P(collect | c)          §4
```

**Workflow.** `payments.overdue-sweep` every 15 min (§B16.3) → `PaymentOverdue` → notification, with
idempotency key `<rule>:<paymentId>:<date>:<userId>` — the `userId` term is what stops the first
recipient's row from suppressing everyone else's (§B21.3), and the `date` term is what stops the
15-minute sweep from re-notifying the same invoice ninety-six times a day.

**Confidence.** `minN = 3` settled payments for `adherence` and `partialHabit`. Aging buckets are a
**definition**, `confidence = 0.99`, `minN = 1`.

**Fallback.** New customer ⇒ `P(collect)` = prior `0.5` (§4), cash forecast interval widens rather than
excluding the receipt. Zero settled payments ⇒ `adherence` `Insufficient`; aging still reported, because
aging needs no history.

**Outputs.** `Fact[]`, `Signal[RISK]` (collection), `Signal[ANOMALY]` (a payment settled before its
contract was signed — a temporal impossibility, §16).

---

## 9. Financial Forecasting — 13-week cash

**Inputs.** Current cash, `payments` schedule, `P(collect)` per customer (§4), `ETC` per project (§10),
overhead run-rate (§7), `plannedProgress` (§2.2).

**Algorithm.** Deterministic, and the single most valuable output for a contractor.

```
inflow(w)  = Σ_p E[receipt_p]                       for p due in week w
outflow(w) = Σ committed costs due in w
           + overheadRunRate × 7
           + Σ_projects ETC_j × Δ plannedProgress_j(w)
cash(w)    = cash(w−1) + inflow(w) − outflow(w)
```

**The interval, without Monte Carlo.** Inflow is a sum of independent Bernoulli receipts with different
amounts — a **Poisson-binomial**, whose mean and variance are exact and closed-form:

```
E[inflow(w)]   = Σ_p a_p · π_p
Var[inflow(w)] = Σ_p a_p² · π_p (1 − π_p)          a_p = amount, π_p = P(collect)
```

Cumulative cash variance sums across weeks (receipts are independent). The 80% band is a normal
approximation on the cumulative sum — justified by Lyapunov once `w` aggregates ≥ 10 payments, and
**flagged as `WEAK` below that** rather than silently assumed.

No simulation, no seed, no run-to-run variance. Two contractors with identical data get identical
forecasts, which a Monte Carlo cannot promise and an auditor will ask about.

**Trough detection:**

```
w* = argmin_w E[cash(w)]
P(cash(w*) < 0) = Φ( (0 − E[cash(w*)]) / σ(w*) )
```

`P > 0.15` at any week ⇒ `Signal[RISK, LIQUIDITY]`, `valueAtStake` = the expected shortfall at `w*`.
Liquidity is the risk that ends contractors, and it is the one they see last.

**Workflow.** W1 nightly. Recomputed on `PaymentScheduled`, `PaymentSettled`, `ProjectCostRecorded`.

**Confidence.** `minN = 3` payments *per customer* for `π_p`; `minN = 30` days for overhead run-rate.
`dispersion = intervalWidth / |E[cash(w*)]|` — a trough forecast of `−1 000 ± 40 000` has near-zero
confidence and must not fire a `CRITICAL`.

**Fallback.**

| Missing | Behaviour |
|---|---|
| No planned dates | The `ETC × Δ plannedProgress` term is dropped and replaced by `burnRate × 7` (§7). Coarser, still bounded. Caveat recorded |
| No overhead table | The overhead term is **0**, and the forecast is explicitly labelled *"direct costs only — overhead not tracked"*. A forecast that silently omits rent is worse than none |
| All customers new | Every `π = 0.5`; interval is enormous; `sufficiency = WEAK`; no notification |

**Outputs.** `Forecast{metric: 'company.cash', horizon: 13w, point, interval}` per week, persisted to
`forecasts` (§P19) so `actual` can be backfilled and the intervals calibrated (§19).

---

## 10. Profit Prediction

**Inputs.** EVM base (§2.1), `CPI` history from `fact_project_daily`.

**Algorithm.** Three standard `EAC` variants. **The choice is made by data, not by taste.**

```
EAC₁ = AC + (BAC − EV)                    remaining work at BUDGETED rate
                                          (assumes the overrun was a one-off)
EAC₂ = BAC / CPI      ≡ AC + (BAC−EV)/CPI remaining work at CURRENT rate
                                          (assumes the overrun is systemic)   ← default
EAC₃ = AC + (BAC − EV) / (CPI × SPI)      schedule-coupled
                                          (late projects cost more per unit of work)
```

Selection rule:

```
if SPI unavailable            → EAC₂
if CPI volatility (MAD/median over last 8 snapshots) > 0.15  → EAC₁, WEAK
   ("performance is unstable; extrapolating it is unjustified")
if SPI < 0.90                 → EAC₃
else                          → EAC₂
```

Then:

```
ETC             = EAC − AC
VAC             = BAC − EAC                    negative = overrun
forecastMargin  = (BAC − EAC) / BAC
```

**The interval comes from the project's own volatility,** not from a prior:

```
CPI_lo, CPI_hi  = median(CPI) ∓ 1.4826 · MAD(CPI)      over fact_project_daily, last 8 snapshots
EAC_hi = BAC / CPI_lo        EAC_lo = BAC / CPI_hi     (note the inversion)
```

Time-travel to `fact_project_daily` is mandatory here (§P5): `CPI` history is **not** recomputable from
the current write model, because back-dated costs and later change orders restate the past.

**Workflow.** W1 nightly, persisted to `forecasts`. On demand from `GET /projects/:id/summary`.

**Confidence.** `minN = 5` costs and `≥ 3` daily snapshots for the interval. `methodPower` 0.85.
`dispersion = (EAC_hi − EAC_lo) / EAC`.

**Fallback.** `< 3` snapshots ⇒ point `EAC₂` with **no interval**, `sufficiency = WEAK`, and never
notifies. `AC = 0` ⇒ `Insufficient`. `progress = 0` ⇒ `EV = 0` ⇒ `CPI = 0` ⇒ `EAC = ∞`: guarded,
returns `Insufficient` with `remedy: "record at least one completed step"`.

**Outputs.** `Forecast{metric: 'project.eac' | 'project.forecastMargin'}`, `Signal[RISK, COST_OVERRUN]`
when `VAC < 0` and `TCPI − CPI > 0.15`.

---

## 11. Budget Analysis

**Inputs.** §2.1 base, §7 category variances, §10 `EAC`.

**Algorithm.**

```
VAC   = BAC − EAC                         money left on the table (or lost)
TCPI  = (BAC − EV) / (BAC − AC)           §2.1
burnDown(t) = BAC − AC(t)                 series for the chart
runway      = (BAC − AC) / burnRate       days of budget remaining at current pace
```

**The feasibility statement** — the output that changes behaviour:

```
if TCPI − CPI > 0.15:
    "To finish on budget, the remaining work must be delivered at CPI = {TCPI},
     which is {TCPI/CPI:.0%} of the performance achieved so far. This has not
     occurred on any of your completed projects."       ← last clause only if n ≥ 5 comparable
```

That final clause is a §14 pattern lookup, and it is what turns an index into an argument.

**Per-category budget** uses the progress-adjusted variance of §7, not raw actual-vs-budget.

**Workflow.** W1 nightly; on `ProjectCostRecorded` and `ChangeOrderApproved` (which moves `BAC`).

**Confidence.** Inherits `conf(EAC)` (§10) multiplicatively. `TCPI` is arithmetic on facts,
`methodPower = 0.99`, so budget analysis is usually *more* confident than the forecast it contains —
correctly, because `VAC` is a subtraction and `EAC` is an extrapolation.

**Fallback.** `BAC = AC` ⇒ `TCPI` undefined (the budget is exactly consumed) ⇒ report `VAC` and a
`CRITICAL` "budget exhausted". `EAC` `Insufficient` ⇒ report `BAC`, `AC`, `burnDown` only, with
`caveats: ['forecast unavailable']`.

**Outputs.** `Fact[]`, `Signal[RISK]`, the burn-down series.

---

## 12. Risk Detection

**Inputs.** Facts (§3–§8), Forecasts (§9, §10, §15).

**Algorithm.** `severity = bucket(likelihood × impact)`, **impact always in money**, thresholds from
`system_settings` (§P12.1) — "large" is 5 000 for one contractor and 500 000 for another.

| Risk | Trigger | Likelihood | Impact |
|---|---|---|---|
| Cost overrun | `CPI < 0.95 ∧ progress < 0.60` | `min(1, 1 − CPI)` | `\|VAC\|` |
| Budget infeasible | `TCPI − CPI > 0.15` | `1 − P(CPI reaches TCPI)` from CPI MAD | `\|VAC\|` |
| Schedule slip | `SPI < 0.90` | from SPI trend slope | `overheadPerDay × slipDays` |
| **Liquidity** | `P(cash(w) < 0) > 0.15`, any `w ≤ 13` | that probability | expected shortfall at trough |
| Collection | `exposure > θ ∧ DSO trending up` | `1 − P(collect)` | `exposure` |
| Supplier concentration | `spendShare > 0.40` | 1.0 (a fact) | spend at risk |
| Single point of failure | sole source of a material on a live project | 1.0 | that material's remaining cost |
| Margin erosion | `erosion > 0.15 ∧ marginToDate < expected` | | `(expected − actual) × BAC` |
| Price exposure | `drift > 0.10 ∧ remainingQty > 0` | forecast interval | `drift × remainingQty × price` |
| **Scope skipped, no CO** | §1.3 | 1.0 | `BAC × skippedPct` |

**Price exposure multiplies by *remaining* quantity.** Cement 14% over baseline is an anomaly
regardless; it is a **risk** only if you still have cement to buy. At 95% progress with all cement
purchased, the money is spent and telling the owner to renegotiate is noise. This is the anomaly/risk
distinction of §P2.2, made arithmetic.

**Workflow.** W1 nightly, after all Facts and Forecasts. Never on the write path — the user's
`POST /costs` must not wait for statistics.

**Confidence.** Multiplicative over inputs. A risk built on a `WEAK` forecast is `WEAK` and cannot be
`CRITICAL`.

**Fallback.** Each risk independently `Insufficient`; the register renders the rest. There is no
"overall risk score" — it would be a weighted average of incommensurable things, and §3's `worst()`
argument applies.

**Outputs.** `Signal[RISK]` → `signals` (§P19) → Recommendation Engine.

---

## 13. Automatic Reports

**Inputs.** `kind`, `period`, filters. Reads **read models only**.

**Algorithm / workflow.** The order is the entire safety property (§P15.3):

```
1. deterministic SQL over read models        → numbers
2. FREEZE into ai_reports.data_snapshot (jsonb)
3. hand ONLY the snapshot to the LLM         → narrative (Arabic prose)
4. status = READY.  optionally render DOCX (generated_documents.ai_report_id)
```

The model never queries, never sums, and never emits a figure not already in the snapshot. A report can
be re-rendered, re-translated, or re-narrated years later **against the numbers as they were understood
that day** — which is exactly what `fact_project_daily` exists to make possible (§D10.3).

**The test that must exist:** every numeral appearing in `narrative` must appear in `data_snapshot`.
A report whose prose disagrees with its numbers is then detectable in CI, not by a customer.

**Confidence.** The report carries the **minimum** confidence and the **oldest** `asOf` of any fact in
its snapshot, printed in the header. A report is only as fresh as its stalest input.

**Fallback.** OpenRouter down ⇒ the report reaches `READY` **with `narrative = null`** and renders as
tables plus templated captions. The numbers are the report; the prose is a courtesy. `status = FAILED`
is reserved for a snapshot that could not be computed.

**Outputs.** `ai_reports` row; optional `generated_documents`.

---

## 14. Executive Summaries

**Inputs.** Ranked `Recommendation[]` (§P13.2), top Facts, Forecasts, the risk register.

**Algorithm.** Selection, not generation.

```
select top 5 by  priority = valueAtStake × confidence × urgency
                          × actionability × novelty × trust(kind)
subject to:  sufficiency ≥ ADEQUATE
             at most 2 per category (no five cash items)
             always include the binding constraint from §3's worst()
```

Render each through an Arabic **template**:

```
"{project}: التكلفة المتوقعة عند الإنجاز {EAC} مقابل ميزانية {BAC}
 — تجاوز متوقع {VAC} ({VAC/BAC:.0%})."
```

The LLM may **rephrase for fluency**. It may never **author**, never reorder, and never add a number.
Templates are what keep §P0.1's unplug test green and what make summaries reproducible — the same facts
always produce the same summary, which a model cannot promise.

**Confidence.** Inherited per line and rendered per line. A summary with one `WEAK` item shows it greyed
rather than dropping it, because omission is a claim too.

**Fallback.** Nothing above `ADEQUATE` ⇒ the summary says so, and pivots to §17's missing-data prompts:
*"Not enough data for an assessment yet. Record planned step dates and I can evaluate schedule
performance."* An empty executive summary is a failure; an honest one is a feature.

**Outputs.** A summary block for the dashboard, `ai_reports.summary`, and the notification digest.

---

## 15. Material Price Forecasting

**Inputs.** `material_price_history` (§D4.5), A-class materials only (§6).

**Algorithm.** **Theil–Sen**, because OLS is not survivable here.

```
slope = median{ (p_j − p_i) / (t_j − t_i) : i < j }          all pairs
inter = median{ p_i − slope · t_i }
forecast(t) = inter + slope · t
```

Breakdown point **29%**: nearly a third of the observations can be panic-buy outliers before the trend
moves. Least-squares has a breakdown point of `0` — one bad row swings it. With 47 observations and a
handful of emergency purchases, this is not a refinement; it is the difference between a trend and a
rumour.

**Interval** from residual MAD:

```
r_i   = p_i − forecast(t_i)
band  = 1.4826 · MAD(r) · z₀.₈
```

**Seasonality**, only with ≥ 2 years:

```
seasonal_m = median( p / trend(p) )  for calendar month m
forecast'(t) = forecast(t) × seasonal_{month(t)}
```

Below 2 years the term is **omitted, not guessed**. Construction materials do have real seasonality
(rainy season, Ramadan logistics); one year of data cannot distinguish it from trend.

**Volume weighting.** The baseline (§6) is a volume-weighted median. A 0.5-ton spot purchase must not
move the number a 200-ton order sets.

**Workflow.** W1 nightly for A-class materials. On `MaterialPriceChanged` / `ProjectCostRecorded`, only
the affected material is recomputed (outbox, ordered — a `PURCHASE` after a `CATALOG_EDIT` on the same
day must apply in order, §B17.2).

**Confidence.** `minN = 8` observations. `methodPower` 0.75. `dispersion = band / |forecast|`.

**Fallback.** `< 8` observations ⇒ `Insufficient`, and **no line is drawn on the chart**. The UI shows
the observed points and nothing else. Drawing a two-point trend line is the most common way a BI tool
loses a user's trust permanently.

**Outputs.** `Forecast{metric: 'material.price', horizon: 90d}` → `forecasts`, `Signal[RISK]` price
exposure (§12) when remaining quantity > 0.

---

## 16. Duplicate Detection

**Inputs.** `project_costs`, `payments`, `customers`, `suppliers`, `materials`.

**Algorithm.** Two tiers, and the tiers have different consequences.

**Tier 1 — deterministic rules. High precision. May block.**

```
duplicate invoice   : exact match on (supplier_id, invoice_reference)          → 409 CONFLICT
duplicate payment   : exact match on (project_id, reference) where reference ≠ null
temporal impossible : cost.date  < project.start_date
                    : payment.payment_date < contract.signed_at
                    : cost.date  > project.actual_end_date
```

These are `CHECK`-adjacent facts. `confidence = 0.99`, `tier = RULE` ⇒ `score IS NULL`.

**Tier 2 — near-duplicates. Fuzzy. Warns, never blocks, never auto-merges.**

```
cost near-dup:  same supplier
              ∧ |amount_a − amount_b| / max(amount) < 0.005
              ∧ |date_a − date_b| ≤ 7 days
              ∧ same material (or both null)

entity near-dup: similarity(ar_normalize(name_a), ar_normalize(name_b)) > 0.85    (pg_trgm)
```

**Blocking, so it is not O(n²).** Candidate pairs come from the trigram GIN index
(`ix_customers_name_trgm`, §D6.1), not from a nested loop. At 500 customers a full pairwise scan is
125 000 comparisons and merely wasteful; the point is that the index is the *only* mechanism that stays
sane as the catalog grows, and it already exists.

**Why customers warn and materials error.** Two different people are genuinely called *محمد علي*, so a
unique constraint on customer name would teach users to type *محمد علي 2*. Two materials named *أسمنت*
are always a mistake. §D6.1 draws this distinction — the question is whether the name is an *identity*
or a *label* — and duplicate detection must honour it. **Auto-merge is never offered.** Merging two
customers silently reparents signed contracts.

**Workflow.** Tier 1 on write (synchronous, blocks). Tier 2 nightly + on `CustomerCreated` /
`SupplierCreated` (asynchronous, warns). Invoice extraction (§P15.3, W4) runs tier 1 before proposing
cost lines, so the same invoice photographed twice yields a clarification, not two costs.

**Confidence.** Tier 1: 0.99. Tier 2: `similarity` itself, floored at the 0.85 threshold, times
`methodPower = 0.80`.

**Fallback.** `invoice_reference` null (cash purchase, common) ⇒ tier 1 cannot fire; tier 2's
amount+date+supplier window is the only net, and it says so. `ar_normalize` unavailable (pre-migration)
⇒ entity near-dup falls back to exact `lower()` match, catching far less, and §17 flags the degradation.

**Outputs.** `409 CONFLICT` (tier 1, write path) or `Signal[ANOMALY, DUPLICATE]` (tier 2) with both row
ids as evidence.

---

## 17. Missing Data Detection

**Purpose.** The cold-start engine (§P17), and the reason the platform is useful on day 30 instead of
month 6. It is not an anomaly detector. It produces **enablement recommendations**: *record X and I can
tell you Y.*

**Inputs.** Schema completeness rules over live entities.

**Algorithm.** A declarative rule table. Each rule names the field, the capability it unblocks, and the
remedy — so the output is never "field missing", which no user acts on.

| Missing | Blocks | Remedy prompt | Severity |
|---|---|---|---|
| `construction_steps.planned_start_date` | SPI, schedule risk, delay forecast, `EAC₃` (§2.2) | "Set planned dates on this project's steps to enable schedule tracking." | WARNING |
| `materials.unit_code` | **all quantity aggregates for that material** (§6) | "Set a unit — quantity totals are not trustworthy until you do." | CRITICAL |
| `overhead_expenses` empty | company profit, cash outflow term (§7, §9) | "Record overhead to see company profit rather than project profit." | WARNING |
| `project_costs.material_id` null on `category = MATERIAL` | price history, drift, baselines | Refused by `ck_pc_material_category`. This is a data-integrity bug, not a gap | — |
| `project_costs.supplier_id` null | supplier scorecard, concentration risk, price spread | "Attach a supplier to see who you're exposed to." | INFO |
| `contracts.expected_profit_margin` null | margin variance (§5) | | INFO |
| `customers.tax_number` null | invoice generation | | INFO |
| `< 8` price observations for an A-class material | price forecast (§15) | "Record 3 more purchases of cement to enable price forecasting." | INFO |
| `< 3` settled payments for a customer | `P(collect)`, DSO (§4) | | INFO |
| `building_template.waste_factor = 0` on all items | realized-waste gap (§6) | | INFO |

**The counting matters.** *"Record 3 more purchases of cement to enable price forecasting"* is
actionable; *"insufficient data"* is not. `needed − have` comes straight from the Fact Catalog's `minN`
(§P2.1), so the prompt cannot drift from the threshold that actually gates the computation. One source
of truth for "how much is enough".

**Workflow.** W1 nightly. Also on demand when any capability returns `Insufficient` — the `missing[]`
and `remedy` fields of the `Insufficient` shape (§2.4) *are* this capability's output, surfaced inline
rather than in a list. The two paths share one rule table.

**Confidence.** `1.0`. A field is null or it is not.

**Fallback.** None needed. This is the capability that *is* the fallback for the other fourteen.

**Outputs.** `Recommendation{tier: RULE, kind: 'data.missing.*'}` with `valueAtStake = 0` — which means
the ranking function (§P13.2) would sort them last, so they are ranked in a **separate onboarding
surface**, not against financial findings. A "set your units" prompt must not outrank a liquidity
warning, and a liquidity warning must not bury the onboarding prompt that would make the next one
accurate.

---

## 18. The nightly dependency DAG

W1 (§P16) is not a list; it is an ordering, and getting it wrong produces facts computed from stale
inputs. Stages 4–8 are internally parallel.

```
1  analytics.refresh-matviews         (CONCURRENTLY ×4; needs a UNIQUE index on each)
2  analytics.snapshot-facts           → fact_project_daily   (ACTIVE projects only)
3  forecasts.backfill-actuals         → forecasts.actual, where the horizon has passed
   confidence.calibrate               → methodPower  (Brier, interval coverage, MAPE)
4  KnowledgeEngine.cohort()           → Fact[]        ← everything below reads only Facts
5  ├─ §3 Project    ├─ §4 Client     ├─ §5 Contract
   ├─ §6 Material   ├─ §7 Expense    ├─ §8 Payment          [parallel, deterministic]
6  ├─ §15 Price forecast  ├─ §10 Profit  ├─ §9 Cash          [need stage 5's CPI, π]
7  ├─ §11 Budget    ├─ §16 Duplicates (tier 2)  ├─ §17 Missing data
8  §12 Risk                                     [needs 5 and 6]
9  RecommendationEngine.generate(signals, forecasts, facts)
10 RecommendationRanking.rank(...)    ← reads Memory.trust(kind)
11 persist → notify (CRITICAL ∧ sufficiency ≥ ADEQUATE only)
```

**Stage 3 before stage 4.** Calibration must update `methodPower` *before* today's confidences are
computed, or every confidence in the run is one day stale. This is the kind of ordering bug that never
throws.

**Zero LLM calls in the entire DAG.** If OpenRouter is unreachable, the sweep completes and the bell
fills. That is §P0.1's falsifiable test, and the DAG is where it is either true or not.

---

## 19. Confidence and calibration, end to end

`forecasts` (§P19) persists `point`, `interval`, `method`, `confidence`, `made_at`, and — later —
`actual`, `actual_at`. Stage 3 above backfills `actual`. Then:

| Measure | Applies to | Tells you |
|---|---|---|
| **Interval coverage** | every forecast with an interval | Of forecasts claiming an 80% band, what fraction contained the actual? **45% ⇒ intervals are too narrow and every downstream confidence is inflated** |
| **Brier score** | `P(collect)` | `mean((π − outcome)²)`. Compare against the base rate; a Brier worse than always-predicting-the-base-rate means the model is *anti*-informative |
| **MAPE by method** | `EAC₁ / EAC₂ / EAC₃` | Which variant actually works on *this* contractor's projects |

These feed back as `methodPower` (§2.3). **A method that has been wrong on this contractor's data earns
a lower weight on this contractor's data.** That is the only learning in the platform, it is
transparent, it is inspectable in a table, and it is enough.

> A confidence number nobody validates is decoration.

If calibration shows a detector is badly calibrated and nobody acts, §P13.2's `trust(kind)` — a Beta
posterior over `ACTED` vs `DISMISSED` — will silence it automatically. The system prunes its own noise.

---

## 20. Fallback matrix

The unifying invariant: **a missing input never fabricates a value. It widens an interval, drops a
term, or returns `Insufficient` with a remedy.**

| Condition | Affected | Behaviour |
|---|---|---|
| `planned_*_date` absent | SPI, SV, schedule risk, `EAC₃`, cash outflow term | `Insufficient` + remedy. Cost analysis unaffected. Cash falls back to `burnRate × 7` |
| `overhead_expenses` absent | company profit, absorption, cash outflow | Term = 0, output **relabelled** "project profit / direct costs only" |
| `unit_code` absent | quantity aggregates for that material | **Refuse to compute.** CRITICAL remedy |
| `AC = 0` | CPI, EAC | `Insufficient`. Report `BAC`, `EV`, progress |
| `progress = 0` | CPI, EAC | `Insufficient`, remedy "complete one step" |
| all steps `SKIPPED` | progress and everything downstream | `Insufficient` (§1.2) |
| `< 8` price observations | drift, baseline, price forecast, price risk | `Insufficient`. **No trend line drawn** |
| `< 3` settled payments | `P(collect)`, DSO | Prior `0.5`; cash interval widens; `WEAK` |
| `< 3` daily snapshots | EAC interval | Point only, no interval, `WEAK`, never notifies |
| matview stale | every Fact | `freshness ↓` → confidence ↓ → Ranking **demotes**, never suppresses |
| OpenRouter down | narration, chat, extraction | Reports render with tables + templates. **Twelve of fifteen capabilities unaffected** |
| projector poisoned | search, price history, notifications | Dead-letter + CRITICAL. Outbox never blocks (§B17.1) |
| `ar_normalize` absent | fuzzy duplicate detection, search recall | Falls back to `lower()` exact match. §17 flags the degradation |

---

## 21. What remains blocked

Ranked by how much they block.

| # | Blocker | Blocks | Status |
|---|---|---|---|
| 1 | **The BI substrate does not exist.** The live schema has 24 models; no `suppliers`, `material_price_history`, `units_of_measure`, `signals`, `forecasts`, `fact_project_daily`, and no matviews | §4–§17 entirely. Nothing here can be written against the current database | `docs/DATABASE.md` is design-only; no migration has been run |
| 2 | `construction_steps.planned_start_date` / `planned_end_date` | SPI, SV, schedule risk, delay forecast, `EAC₃`, the cash-outflow progress term | Specified (§D7.2); not migrated |
| 3 | `signals` + `forecasts` tables (§P19) | §19 calibration entirely. Without persisting what was predicted, no confidence can ever be validated | Specified; not migrated |
| 4 | `payments.scheduled_amount` / `paid_amount` split (§D-D4) | §8 Payment Analysis, §9 cash inflow. With one `amount` column, partial payments are unrepresentable | Specified; not migrated |
| 5 | `overhead_expenses` (§D8.2, optional) | Company profit, absorption, the overhead term in §9 | Decision made (ship it); not migrated |
| 6 | The four-ring refactor (§B25 phase 2) | The capabilities are Application-ring services calling `KnowledgeEngine`. Today services hold Prisma calls | Phase 0–1 not started |

**Nothing in this document is implementable until (1).** The next concrete step is the migration that
lands the substrate — and per §B25 phase 3 the ordering is: widen money → backfill → add constraints →
drop old indexes, with D4 (`payments` split) and D-D7 (partial indexes) first, because they are the two
with user-visible effects.

---

## 22. Decisions

Resolved this turn:

- ✅ **`SKIPPED` steps redistribute proportionally** (§1). Unblocks EV, CPI, SPI, EAC, TCPI, and five capabilities. Consequence: skipping paid work inflates margin, so §1.3's `SCOPE_SKIPPED_WITHOUT_CHANGE_ORDER` detector exists *because* of the choice.

Still open, and each changes what gets built:

| # | Decision | My call |
|---|---|---|
| 1 | `EAC₂` (`BAC/CPI`) as the default variant | Yes — the industry default, and §10's selection rule overrides it on evidence |
| 2 | Poisson-binomial closed form for the cash interval, not Monte Carlo | Closed form. Reproducible run-to-run; an auditor will ask |
| 3 | `worst()` rather than a weighted average for project health | `worst()`. A weighted average lets healthy cash mask an impossible TCPI |
| 4 | Duplicate customers **warn**; duplicate materials **error**; never auto-merge | Yes (§16). The distinction is whether the name is an identity or a label |
| 5 | Missing-data prompts ranked in a **separate** surface, not against financial findings | Separate (§17). `valueAtStake = 0` would otherwise bury them forever |
| 6 | ABC classification gates price forecasting to A-class materials | Yes (§6). Attention budget applies to the catalog too |
| 7 | Benford + round-number detectors behind `n ≥ 500`, `INFO` only | Ship gated, or cut. They are the two most likely to embarrass |
| 8 | Reports reach `READY` with `narrative = null` when the LLM is down | Yes (§13). The numbers are the report; the prose is a courtesy |

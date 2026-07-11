# Contractor Plus — External Integrations

**Status:** Design. No implementation.
**Continues:** `docs/ARCHITECTURE.md` (§A), `docs/DATABASE.md` (§D), `docs/BACKEND.md` (§B), `docs/AI-PLATFORM.md` (§P), `docs/BI-CAPABILITIES.md` (§I).

---

## 0. This request breaks a load-bearing premise. Deliberately, and here are the terms.

§A9 states: *"There is exactly **one** required egress, and the product must degrade gracefully without
it."* §A0: *"Every new infrastructure dependency is a liability, not an asset."*

This document adds nine. That is a real change to the product's risk surface, and it is only safe under
conditions that must be stated before a single adapter is designed.

**First, a correction.** §A9 already undercounted. The tree has two outbound callers today:

```
backend/src/modules/tunnel/tunnel.client.ts:23   fetch(MANAGEMENT_API_URL)     ← the management server
                                                  OpenRouter                    ← per §A9
```

`MANAGEMENT_API_URL` is in `config/env.ts` and is called on the tunnel path. So the honest baseline is
**two**, not one, and the discipline §A9 describes has already eroded once without anyone recording it.
That is exactly how a modular monolith on one office PC becomes a distributed system by accident.

**Second, the terms.** Nine integrations are acceptable if and only if all four of the following hold.
Everything in this document exists to keep them true.

### The four inviolable rules

| # | Rule | Consequence if broken |
|---|---|---|
| **R1** | **Every integration is off by default.** A zero-egress install is fully functional — it is the *reference* configuration, not a degraded one | A contractor's office loses internet and the app stops working. This is a construction site in Iraq, not a datacenter |
| **R2** | **External data is *reference* data, never *ledger* data.** No external value ever writes a money row, restates a contract, or alters a payment without explicit human confirmation | An FX API glitch silently restates every contract's value. Unrecoverable, and discovered by a customer |
| **R3** | **Idempotent pulls retry freely. Effects never blind-retry.** A `GET` costs nothing to repeat. A WhatsApp message cannot be un-sent | A network timeout on a payment reminder sends the customer four messages, and you pay for four |
| **R4** | **No required inbound ingress.** The machine has no public URL. Delivery receipts are **polled**, not webhooked | The product's core loop depends on the optional cloudflared tunnel being up |

R2 is the one that matters most, and it is the same rule the AI platform obeys: **no autonomous
writes** (§P20). An external API is precisely as trustworthy as a language model — which is to say,
useful, and never authoritative about your money.

---

## 1. Three classes of integration, and why the distinction is the spine

Lumping nine integrations into an "integrations module" would give them one retry policy, one cache,
and one failure mode. They do not share any of those. Retrying a currency fetch is free; retrying a
WhatsApp send costs money and embarrasses the user.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ CLASS R — Reference data.  INBOUND PULL.  Idempotent.                    │
│   Material price indexes · Currency · Weather · Government · Constr. idx │
│   retry: free · cache: aggressive · offline: serve stale · conflict: none│
│   failure: degrade to stale, then to INSUFFICIENT (§I2.4)               │
├─────────────────────────────────────────────────────────────────────────┤
│ CLASS E — Effects.  OUTBOUND PUSH.  NOT idempotent. Costs money.         │
│   Email · SMS · WhatsApp                                                 │
│   retry: NEVER blind · cache: none · offline: queue · conflict: dedupe   │
│   failure: UNKNOWN state, reconcile by query — never resend             │
├─────────────────────────────────────────────────────────────────────────┤
│ CLASS B — Bulk state.  BIDIRECTIONAL. Large. Encrypted. Rare.            │
│   Cloud backup / restore                                                 │
│   retry: safe (content-addressed) · offline: local snapshots             │
│   failure: the ONLY integration whose failure is silent and terminal     │
└─────────────────────────────────────────────────────────────────────────┘
```

Everything below — scheduler, retry, cache, offline, conflict, security, recovery — is specified **per
class**, because a single policy would be wrong for two of the three.

### 1.1 Where each lands in the existing architecture

| Class | Mechanism | Existing machinery |
|---|---|---|
| R | `jobs` rows, scheduled (§B16) | `job_schedules`, `SKIP LOCKED`, reaper |
| E | `message_outbox` rows, driven by domain events (§B17) | outbox dispatcher, DLQ |
| B | `jobs` rows, weekly + on-demand | `backup.verify` already stubbed in §B16.3 |

No new runtime. No Redis, no broker, no worker fleet (§A0). Nine integrations, zero new Windows
services.

---

## 2. Ports, adapters, and provider switching

Every integration is a **port** named for what the application needs, never for the vendor (§B3).
`FxRateProvider`, not `ExchangeRateHostClient`.

```ts
interface IntegrationProvider {
  readonly key: string;                       // 'fx.exchangerate-host'
  readonly kind: IntegrationKind;             // FX | SMS | WHATSAPP | BACKUP | …
  readonly capabilities: Capability[];        // see §2.2
  health(): Promise<HealthState>;
}

interface FxRateProvider extends IntegrationProvider {
  rates(base: CurrencyCode, quotes: CurrencyCode[], on?: LocalDate): Promise<FxObservation[]>;
}

interface MessageProvider extends IntegrationProvider {
  send(msg: OutboundMessage, idempotencyKey: string): Promise<SendReceipt>;
  status(providerMessageId: string): Promise<DeliveryState>;   // R4: polled, not webhooked
}
```

### 2.1 The registry and the failover chain

`integration_providers` (new table, §12) holds `(kind, key, priority, enabled, config, secret_ref)`.
Resolution:

```
resolve(kind) → providers WHERE kind = ? AND enabled ORDER BY priority
                filtered by: breaker closed ∧ within monthly spend cap ∧ capabilities ⊇ required
```

- **Class R: failover is automatic and free.** FX provider A times out → try B → serve stale cache → `Insufficient`. Each step is safe because the operation is idempotent and read-only.
- **Class E: failover is *not* automatic.** If SMS provider A returned a timeout, you do **not** know whether the message went out. Failing over to B may send it twice. The message enters `UNKNOWN` and is reconciled by querying A (§7.2). Failover to B happens only for messages that never left `QUEUED`.

That asymmetry is the whole reason the classes are separate, and it is the most common integration bug
in products of this shape.

### 2.2 Capability manifest — because providers are not interchangeable

A `MessageProvider` for WhatsApp cannot send arbitrary text to a cold contact; it must use a
pre-approved template. An SMS provider can, but has a 160-character segment cost. Pretending they share
an interface without declaring the differences pushes the difference into the caller.

```
Capability = FREEFORM_TEXT | TEMPLATE_ONLY | DELIVERY_RECEIPT | STATUS_QUERY
           | ATTACHMENTS | UNICODE_ARABIC | SESSION_WINDOW_24H | INBOUND_REPLY
```

The application asks for capabilities; the registry supplies a provider that has them, or reports that
no enabled provider can satisfy the request. A "send this PDF invoice to the customer" request that
finds no `ATTACHMENTS` provider must fail **loudly at composition time**, not silently drop the
attachment at send time.

### 2.3 Switching providers

Provider config lives in `integration_providers.config` (jsonb) and secrets in the OS secret store
(§10.1), referenced by `secret_ref`. Switching is:

1. Add the new provider row, `enabled = false`.
2. Set its secret.
3. `POST /integrations/:key/test` — a live, side-effect-free probe (`health()`, or for Class E a send to a configured test recipient).
4. Raise its priority above the incumbent. The next resolution picks it up.
5. Old provider stays enabled at lower priority for one release as the failover.

No redeploy. No env-var change. **`MANAGEMENT_API_URL` and `OPENROUTER_*` should migrate into this
table too**, so that the two egresses that already exist are governed by the same allowlist, breaker,
spend cap, and audit trail as the nine being added. Today they are governed by none of it.

---

## 3. Class R — the five inbound integrations

### 3.1 A necessary honesty about data availability

The deployment is a contractor in Iraq (`Asia/Baghdad`, Arabic/RTL, IQD). Three of these five
integrations are commonly specified and rarely available, and designing them as if a clean REST API
exists would produce adapters that can never be written.

| Integration | Reality | Design consequence |
|---|---|---|
| **Currency** | Genuinely available. Many providers (ECB reference rates, exchangerate.host, OpenExchangeRates, Fixer). ECB is free, unauthenticated, and does **not** quote IQD | Multi-provider, with a USD cross-rate path for IQD |
| **Weather** | Genuinely available. Open-Meteo is free, keyless, and has historical + forecast for arbitrary lat/lon | The easiest adapter, and more useful than it sounds (§3.4) |
| **Material prices** | **No API exists for Iraqi cement, rebar, or aggregate prices.** Global commodity indices (LME metals, regional steel benchmarks) are proxies at best, and most are paywalled | The primary price source is the contractor's own `material_price_history` (§D4.5). External is *supplementary*, and mostly CSV import |
| **Construction indexes** | ENR CCI is paywalled and US-centric. Iraq's CSO publishes CPI, not a construction cost index, and not as an API | Manual/CSV ingestion with a provenance record. No live adapter |
| **Government** | I could not verify that public APIs exist for Iraqi tax (GCT), company registration, or contractor licensing. **I am not going to invent endpoints** | Adapter interface defined; the day-one implementation is a *manual entry + document upload* adapter that satisfies the same port |

> **This is a finding, not a caveat.** Two of the nine integrations you listed likely have no
> counterparty to integrate with. Building the *port* is right — it means the day a provider appears,
> nothing else changes. Building a speculative *adapter* against an API nobody has seen is how a
> sprint is spent producing a mock.

Verify (3), (4), and (5) against real vendor documentation before scheduling any of them. The rest of
this section designs the ports so that verification is the only remaining work.

### 3.2 Currency — and the one thing that will bite

**Port.** `FxRateProvider.rates(base, quotes, on?) → FxObservation[]`

```
FxObservation { base, quote, rate: Decimal, rateType, source, observedOn, fetchedAt }
```

**`rateType` is the design.** For IQD there is an official Central Bank rate and a parallel-market rate,
and they have diverged materially at times. A contractor who buys imported materials pays one and books
the other. **Storing a single "the rate" is a decision to be wrong for one of them.**

```
RateType = OFFICIAL | PARALLEL | PROVIDER_MID
```

The org picks a booking policy in `system_settings` (`fx.bookingRateType`). Reports may show both.

**The rule that cannot be broken (R2, and §D17.3):**

> **A new FX rate never restates a historical amount.**

Every money row that involves conversion freezes `fx_rate_at_transaction` at write time. Fetching
today's rate updates *future* entries and *display-only* conversions. There is no code path — none —
that back-propagates a rate into `contracts`, `payments`, or `project_costs`. An FX API returning a
bad value must be able to corrupt a chart, and nothing else.

Today the schema is single-currency and `currencies` affects **display formatting only** (§D12.2). So
this integration is *inert* until the multi-currency migration of §D17.3 lands. It should be built now
anyway, storing observations in `fx_rates` (append-only), because the historical series is what makes
the migration possible later — you cannot retroactively learn what the rate was last March.

**Cache.** 24 h. Rates are daily. **Stale is fine and must be labelled** — every FX-derived number
carries `asOf`, and `freshness` decays its confidence (§I2.3).

**Schedule.** `0 4 * * *` local. Not on the request path, ever.

### 3.3 Material prices & construction indexes

**Port.** `PriceIndexProvider.observations(indexKey, from, to) → IndexObservation[]`

**The critical integration point is `material_price_history`'s `PriceSource` enum (§D4.5).** It already
has `{CATALOG_EDIT, SUPPLIER_QUOTE, PURCHASE, IMPORT, AI_ESTIMATE}`. Add `EXTERNAL_INDEX`, and add a
`source_provider` column.

**External observations are appended, never merged.** They become additional rows in the same
observation log. This is why §D4.5 chose an observation log over a validity-range temporal table — an
external index and a real purchase are two observations of different things, and both are true.

**Precedence, applied at baseline computation (§I6), not at write:**

```
weight(PURCHASE)       1.00     ← what you actually paid
weight(SUPPLIER_QUOTE) 0.60     ← what you were offered
weight(EXTERNAL_INDEX) 0.20     ← what the world says
weight(CATALOG_EDIT)   0.10
weight(AI_ESTIMATE)    0.00     ← never enters a baseline
```

`baseline12m` is a **volume-weighted, source-weighted median**. An external index cannot move a
baseline that real purchases have set — it can only fill a gap where there are none. That is precisely
the right epistemics: your own ledger outranks the world's average, and the world's average outranks
silence.

An external index also **never** triggers a price-drift anomaly on its own (§I6). It has no
`valueAtStake`: you did not buy anything.

**Ingestion.** For construction indexes: a CSV upload through `/integrations/indexes/import`, producing
`construction_indexes` rows with provenance (`source`, `published_on`, `imported_by`, `file_hash`). A
human is in the loop, which is the correct posture for a number that will appear in an escalation
clause.

**Cache.** Indefinite — these are historical facts. Never re-fetched, only appended.

### 3.4 Weather — cheap, keyless, and quietly the most valuable of the five

**Port.** `WeatherProvider.daily(lat, lon, from, to) → WeatherObservation[]`
Open-Meteo: free, no API key, historical archive + forecast. It is the only Class R integration that
can ship this quarter with certainty.

**Why it earns its place.** §I3's `SPI` says a project is behind schedule. It does not say *why*. With
daily precipitation against `construction_steps` planned windows:

```
weatherLostDays(step) = |{ d ∈ [plannedStart, plannedEnd] : precip_mm(d) > θ }|
```

That converts an accusatory number into an explanation: *"Project is 12 days behind; 7 of those days
had > 10 mm rainfall."* It also feeds **schedule-risk attribution** (§I12) — a slip caused by weather
is a different management problem from a slip caused by a subcontractor, and the contractor's own
delay-claim documentation needs exactly this record.

**Requirement:** `projects` needs a location. Add `latitude` / `longitude` (nullable). Without them the
adapter returns `Insufficient` with `remedy: "set the project's location"` — which §I17's Missing Data
Detection then surfaces. The pattern holds.

**Threshold `θ` is a setting**, not a constant. "Too wet to pour" differs by climate and by trade.

**Cache.** Historical: forever (immutable). Forecast: 6 h. **Never let a forecast overwrite an
observation** — they land in different rows with `is_forecast`, and the archive backfills the truth.

### 3.5 Government

**Port.** `GovernmentRegistryProvider` with three optional capabilities:

```
verifyTaxNumber(taxNumber)      → { valid, registeredName?, status? }
lookupCompany(registrationNo)   → { name, status, address? }
validateContractorLicense(id)   → { valid, expiresOn?, classes[] }
```

**Day-one adapter: `ManualGovernmentRegistry`.** It satisfies the port by recording what a human
entered and which document they attached — `verified_by`, `verified_at`, `evidence_document_id`,
`verification_method: MANUAL`. The application code is identical whether verification came from an API
or from a clerk looking at a PDF.

This is the honest answer, and it is a good one: it means the feature ships, the audit trail is
complete, and if a real API materialises it is a new adapter behind the same port with
`verification_method: API`.

**Never cache a negative.** A tax number that failed validation today may be valid tomorrow; caching
"invalid" for 24 h creates a support call nobody can explain. Cache positives (7 d), re-check negatives
on demand.

**PII posture:** sending a customer's tax number to a government endpoint is a lawful-basis question,
not an engineering one. Gate it behind §10.4's consent check like any other PII egress.

---

## 4. Class E — the three outbound channels

These send messages to *your customers*. They cost money, they cannot be recalled, and they are the
only integrations that can embarrass the contractor in front of the person paying them.

### 4.1 The `message_outbox` — one queue, three channels

Domain events (§B7.5) never call a provider. They append a row.

```
message_outbox {
  id  bigint identity
  channel          EMAIL | SMS | WHATSAPP
  recipient_ref    { customerId | userId }         -- never a bare phone number
  to_address       text                             -- resolved at send, from the live row
  template_key     'payment.reminder' | 'contract.ready' | …
  payload          jsonb                            -- template variables. NO free prose
  locale           'ar'
  idempotency_key  text  UNIQUE                     -- <template>:<entityId>:<period>:<recipientId>
  status           QUEUED|SENDING|UNKNOWN|SENT|DELIVERED|READ|FAILED|SUPPRESSED
  provider_key     text
  provider_message_id text
  attempts         smallint
  cost             numeric(12,6)
  last_error       text
  queued_at / sending_at / sent_at / delivered_at / failed_at
  consent_snapshot jsonb                            -- §10.4. What consent existed AT SEND TIME
}
```

**`idempotency_key` includes the recipient**, for the same reason `notifications.idempotency_key` does
(§B21.3): omit it and the first recipient's row suppresses everyone else's.

**`consent_snapshot`** freezes the consent that authorized this send. Consent revoked later does not
retroactively make a past send unlawful, and a past send does not survive a revocation. Storing the
snapshot is how you can answer "why did you message them" a year later.

### 4.2 The state machine, and `UNKNOWN` — the state everyone forgets

```
QUEUED ──claim──▶ SENDING ──provider 2xx──▶ SENT ──poll──▶ DELIVERED ──▶ READ
   ▲                  │                                  └──▶ FAILED
   │                  ├── provider 4xx (bad number) ─────▶ FAILED   (terminal, no retry)
   │                  ├── provider 429/5xx ──────────────▶ QUEUED   (backoff. SAFE: never left)
   │                  └── TIMEOUT / connection reset ────▶ UNKNOWN  ◀── the dangerous one
   │                                                          │
   └───────────────── reconcile: provider.status(key) ────────┘
                       found  → SENT/DELIVERED/FAILED
                       absent → QUEUED (safe to retry)
                       error  → stay UNKNOWN, alert. NEVER guess.
```

**A timeout is not a failure.** The request may have succeeded and the response may have been lost. A
system that retries on timeout will send the customer two payment reminders, and the second one will
arrive at 3 a.m.

`UNKNOWN` is resolved by **querying the provider**, keyed by the idempotency key we sent it (Twilio,
Meta, and every serious provider accept one). If the provider has no record, the send never happened and
the row returns to `QUEUED`. If the provider cannot be reached, the row **stays `UNKNOWN`** and raises a
`WARNING` notification. It is never resent on a guess.

This is R3, and it is the single most important paragraph in this document.

### 4.3 Email

Two adapters, different postures:

| Adapter | Use | Note |
|---|---|---|
| `SmtpEmailProvider` | The contractor's own mailbox (Gmail app password, local ISP) | No third party sees the content. No `DELIVERY_RECEIPT` capability — SMTP gives you a queue accept, not a delivery |
| `TransactionalEmailProvider` | Resend / SES / Postmark | Real delivery events, bounce handling, reputation. Requires the customer's data to leave the machine |

**Default to SMTP** (R1's spirit: the smallest egress that works). Deliverability from a residential IP
is poor — say so in the UI rather than letting the contractor discover it when an invoice lands in
spam.

Attachments (PDF invoice, DOCX contract) stream from `private/` (§B18.3), never inline base64 in the
queue payload.

### 4.4 SMS

Cost per segment; Arabic is **UCS-2**, so a segment is **70 characters, not 160**. A template that fits
in one segment in English costs three in Arabic. The estimator must compute segments *in the target
encoding* and show the cost before the user confirms a bulk send.

Provider choice is regional. Twilio reaches Iraq; local aggregators (via Zain / Asiacell) are typically
cheaper and require a local entity. **Verify sender-ID registration rules before committing** — many
regions require pre-registered alphanumeric sender IDs, and unregistered traffic is silently dropped,
which presents as "SMS doesn't work" with a 2xx from the provider.

**Spend cap per month, enforced before send**, mirroring `ai_usage_counters` (§D11.6). An integration
that can spend the contractor's money needs the same governor as one that spends it on tokens.

### 4.5 WhatsApp — the hardest, and the one to sequence last

Meta's Cloud API imposes constraints that are **product** constraints, not technical ones:

| Constraint | Consequence |
|---|---|
| Business verification + a registered phone number | Weeks of lead time, not an afternoon |
| **Outside a 24 h session window, only pre-approved templates** may be sent | You cannot send arbitrary text to a customer who has not messaged you recently. `TEMPLATE_ONLY` capability |
| Templates are approved per-language, per-category, and can be rejected | The message body is a *deployment artifact*, subject to a third party's review |
| Per-conversation pricing | Cost model differs from SMS entirely |
| Delivery receipts arrive by **webhook** | R4: the machine has no public URL |

**R4's answer.** The Cloud API's message-status is primarily push. Without ingress, you either:
1. **Poll** where the provider offers a status endpoint (limited), or
2. **Enable the existing cloudflared tunnel** (§A0, off by default) and expose exactly one signed webhook route.

Option 2 is the realistic one and it must be **opt-in, scoped, and verified**: the webhook route
validates Meta's `X-Hub-Signature-256` HMAC, enforces a replay window, is rate-limited, and **cannot
authenticate anything** — it only updates `message_delivery_events`. A webhook endpoint that can be
tricked into mutating business state is a public write API you did not mean to publish.

If the tunnel is off, WhatsApp still *sends*; the app simply never learns whether the message was read.
`status` stops at `SENT`. That is an acceptable degradation and must be visible in the UI, not hidden.

### 4.6 What may be sent, and what may never be

`template_key` + `payload`. **No free-form prose, and no LLM-authored message bodies, ever.**

A generated sentence sent to a customer over the contractor's identity is an unbounded liability — it
cannot be reviewed before it is sent, it cannot be recalled, and the contractor is accountable for it.
Templates are reviewed once, translated once, and approved by Meta once. This is the same argument as
§I14's "the LLM may rephrase, never author", with the stakes raised because the audience is external.

**Suppression list.** A hard `message_suppressions` table (bounce, complaint, opt-out, invalid number).
Checked before every send, in the same transaction that claims the row. Sending to a hard bounce twice
is how a sender reputation dies.

---

## 5. Class B — Cloud backup, and the finding that matters most

### 5.1 🔴 A DPAPI-sealed backup key is unrecoverable at exactly the moment you need it

`backend/src/lib/dpapi.ts` seals secrets with:

```
ProtectedData.Protect(..., LocalMachine)     // machine scope
```

That is correct for the DB password and the JWT secret — they only need to survive across *principals*
on **this** machine, which is exactly the problem the file's comment describes.

It is catastrophic for a backup encryption key.

> A backup encrypted with a machine-bound key is readable **only on the machine that created it**.
> The event a backup exists to survive — that machine dying, being stolen, being ransomwared, or being
> replaced — is precisely the event that makes the key unrecoverable.
>
> You would have years of encrypted ledgers in cloud storage and no way to decrypt a single byte.

This is not a hypothetical failure mode. It is the default outcome of reusing the existing secret
helper for the backup path, which is the obvious thing to do.

**The design:**

```
backupKey = Argon2id(passphrase, salt, m=64MiB, t=3, p=1)      ← owner-supplied, at setup
                │
                ├─▶ used to encrypt each archive (AES-256-GCM, fresh nonce per archive)
                │
                └─▶ ALSO sealed via DPAPI into %ProgramData%    ← convenience cache ONLY
                                                                  so unattended backups run
                                                                  without prompting
```

- The passphrase is entered once, at setup, and **displayed as a printable recovery sheet** the owner is required to acknowledge storing offline. Setup does not complete until they confirm.
- The DPAPI copy lets the Windows Service back up unattended. It is a *cache*, never the *source*.
- **Restore never uses the DPAPI copy.** Restore always prompts for the passphrase — because if DPAPI can decrypt it, you are on the old machine and the disaster did not happen.
- Key rotation re-encrypts forward only; old archives keep their old key id (`backup_runs.key_id`). Never re-encrypt history.
- `argon2id` parameters are stored alongside the salt in the archive header, so a future parameter change does not orphan old archives.

**The recovery drill must be a scheduled job, not a document.** §B16.3 already lists `backup.verify`
weekly. Strengthen it: restore the latest archive **into a temporary schema**, run the migration head,
count rows against source, then drop it. A backup that has never been restored is a hypothesis.

### 5.2 Backup mechanics

| Concern | Design |
|---|---|
| Source | `pg_dump --format=custom` (compressed, restorable selectively) + `private/` file tree |
| Content addressing | `sha256` of the plaintext archive **before** encryption. Idempotent re-upload; dedupe |
| Encryption | AES-256-GCM, per-archive nonce, AAD = `{schemaVersion, createdAt, machineId}` |
| Transport | Any S3-compatible object store (Backblaze B2, Wasabi, S3), or OneDrive/Google Drive folder for the least technical users |
| Retention | GFS: 7 daily, 4 weekly, 12 monthly. Object-lock / immutability if the provider supports it — **ransomware deletes backups first** |
| Resumability | Multipart upload with part-level retry. Safe by content addressing (R3 does not apply: it is idempotent) |
| Local first | A local snapshot always exists, on a different volume if one is present. Cloud is the *second* copy, not the only one |
| Restore | **Never automatic.** Requires the passphrase, a typed confirmation of the target, a dry-run into a temp schema, and a row-count diff shown to the human |

**Restore is not a conflict-resolution problem, it is a decision.** If the local database has diverged
from the archive, there is no merge — there are two ledgers, and only a human can say which one is
real. The system's job is to show the divergence (row counts per table, last `audit_logs.created_at` on
each side) and then do exactly what it is told.

---

## 6. Sync Scheduler

All Class R and Class B work is `jobs` rows (§B16). No new scheduler.

| Job | Cron (Asia/Baghdad) | Class | Notes |
|---|---|---|---|
| `integrations.fx.sync` | `0 4 * * *` | R | After the matview refresh, before the intelligence sweep |
| `integrations.weather.observations` | `0 5 * * *` | R | Historical archive for yesterday |
| `integrations.weather.forecast` | `0 */6 * * *` | R | 6-hourly |
| `integrations.priceindex.sync` | `0 6 * * 1` | R | Weekly. Nothing moves daily |
| `integrations.gov.recheck` | `0 7 1 * *` | R | Monthly re-verification of positives |
| `messages.dispatch` | every 30 s | E | Claims `QUEUED` with `SKIP LOCKED` |
| `messages.reconcile` | every 5 min | E | Resolves `UNKNOWN`, polls `SENT` → `DELIVERED` |
| `messages.suppression-sync` | `0 3 * * *` | E | Pulls bounces/complaints from provider |
| `backup.run` | `0 1 * * *` | B | Local snapshot, then upload |
| `backup.verify` | `0 5 * * 0` | B | **Restore into a temp schema.** §5.1 |
| `integrations.health` | every 15 min | all | `health()` on enabled providers; drives the breaker and `/admin/metrics` |

**Ordering matters once.** `integrations.fx.sync` runs *before* `analytics.refresh-matviews`, which runs
before the §I18 intelligence DAG. A rate fetched after the matviews refresh is a rate that arrives a day
late in every report, and nothing throws.

**Jitter every schedule by ±5 minutes.** Ten thousand installs of this product all fetching Open-Meteo
at exactly `05:00 Asia/Baghdad` is a self-inflicted thundering herd against a free service that has been
generous to you.

**The single-instance guard** (`pg_try_advisory_lock`, §B16.5) matters more here than anywhere: a
developer running a second backend against production would otherwise double-send every queued SMS.

---

## 7. Retry Strategy — three policies, because there are three classes

### 7.1 Class R — retry freely

```
backoff(n) = min(2ⁿ × 30 s, 1 h) × jitter(0.5 … 1.5)
max_attempts = 5 → dead-letter → CRITICAL notification
```

- **Honour `Retry-After`** when present. Ignoring it is how a free tier becomes a banned IP.
- **429 and 5xx retry. 4xx does not** (except 408/429) — a `400` will be a `400` forever, and retrying it five times just delays the alert.
- **Circuit breaker per provider**, not global: FX being down must not stop weather. Open after 5 consecutive failures, half-open probe after 10 min.
- Retrying is **free and safe** because every Class R call is a `GET` and every result is an append-only observation with a natural key. A duplicate fetch produces a duplicate row that `ON CONFLICT DO NOTHING` discards.

### 7.2 Class E — never blind-retry

```
transport-level failure BEFORE the request left  → QUEUED, backoff. Safe.
provider 429 / 5xx (response received)           → QUEUED, backoff, honour Retry-After. Safe.
provider 4xx (invalid number, template rejected) → FAILED. Terminal. No retry, ever.
TIMEOUT or reset AFTER the request left          → UNKNOWN. §4.2. Reconcile, never resend.
```

`max_attempts = 3`, then dead-letter. A message worth sending four times is a message worth a human
looking at.

**Send the idempotency key to the provider**, not just to our table. Twilio, Meta, Resend, and SES all
accept one. Our unique constraint prevents *us* from double-queueing; the provider's key prevents a
retried HTTP request from double-*sending*. Both are needed, and they defend different failures.

**Rate limit outbound sends** to the provider's documented ceiling, and cap monthly spend
(`integration_spend_counters`, upsert-increment, exactly like `ai_usage_counters`). A bug in a
notification rule that queues 10 000 SMS must hit a wall the contractor set, not a bill they did not.

### 7.3 Class B — retry safe, verify always

Multipart parts retry individually. Content addressing (`sha256` of plaintext) makes a re-upload a
no-op. The only non-retryable failure is *"the archive did not restore"*, which is not a network problem
and must page a human.

---

## 8. Caching

**Cache configuration and reference data. Never cache ledger data** (§B13.1). All of Class R is
reference data, so all of it is cached; none of Class E is.

| Data | TTL | Store | Invalidation |
|---|---|---|---|
| FX rates | 24 h | `fx_rates` rows (the cache **is** the table) | Append-only; newest `observed_on` wins for display |
| Weather — historical | ∞ | `weather_observations` | Immutable |
| Weather — forecast | 6 h | `weather_observations` `is_forecast = true` | Overwritten by the archive backfill |
| Price / construction indexes | ∞ | `material_price_history`, `construction_indexes` | Append-only |
| Government positive result | 7 d | `verification_results` | Monthly re-check job |
| Government negative result | **0** | — | §3.5. Never cache a "no" |
| Provider health | 60 s | in-process `Cache` (§B13.2) | Epoch bump on config change |
| Provider config / capabilities | epoch | in-process | `cache.bump('integrations')` on write |

**The cache is the database, not a layer in front of it.** These are observations with an `observed_on`
and a `fetched_at`; they belong in tables that the BI layer already knows how to read with an `asOf`
(§P2). Adding a separate cache would create a second source of truth for a number that appears in a
financial report.

**HTTP conditional requests.** Store `etag` / `last_modified` per `(provider, resource)` in
`integration_sync_runs` and send `If-None-Match` / `If-Modified-Since`. A `304` costs nothing and is the
politest thing you can do to a free API.

---

## 9. Offline Support

**Offline is the reference state, not a mode** (R1). The Electron client talks to `localhost:31734`,
which talks to `localhost:5432`. Nothing in the core loop crosses the network.

| Class | Offline behaviour |
|---|---|
| **R** | Serve the last observation with its real `asOf`. `freshness` decays → `confidence` decays → §P13.2's Ranking **demotes** rather than suppresses. Past a staleness ceiling, the fact becomes `Insufficient` with `remedy: "no internet connection since {date}"` |
| **E** | Messages accumulate in `message_outbox` as `QUEUED`. The dispatcher finds no provider and does nothing. **A queued message is not a sent message** — the UI must show "3 reminders waiting to send", never a green tick |
| **B** | The local snapshot still runs. Upload queues. The UI shows "last cloud backup: 6 days ago" prominently — a backup that only exists on the machine being backed up is not a backup |

**Staleness ceilings** are per-fact and enforced by the Knowledge Engine (§P5), not by each caller:

```
fx            7 d    → beyond this, refuse to convert. Show original currency.
weather       ∞      → historical facts do not go stale
priceIndex    90 d
govVerification 365 d
```

The FX ceiling is a hard refusal, and it is correct: silently converting a contract at a rate from last
month is worse than showing the contractor a number in the currency it was recorded in.

**A queued Class E message that is 7 days old is stale in a different sense.** A payment reminder for an
invoice that has since been paid must not be sent when connectivity returns. Every message carries a
`valid_until` and a **precondition** re-evaluated at claim time:

```
precondition('payment.reminder', paymentId) := payment.status ∈ {PENDING, PARTIAL}
                                             ∧ payment.due_date < today
```

Fails → `SUPPRESSED`, not `SENT`. This is the offline bug that damages a customer relationship, and it
is invisible in testing because tests are never offline for three days.

---

## 10. Security

### 10.1 Secrets

| Rule | Mechanism |
|---|---|
| Never in the database | `integration_providers.secret_ref` is a **pointer**; the value lives in the OS store |
| Never in env vars, in prod | Service reads DPAPI-sealed `%ProgramData%` blobs (existing pattern, `lib/dpapi.ts`) |
| Never returned by an API | `GET /integrations/:key` returns `hasSecret: true`, never the value. Response zod schema enforces it (§B9.1) |
| Never logged | pino `redact` paths already specified (§B15.2); add `*.apiKey`, `*.authToken`, `*.passphrase` |
| Never in a prompt trace | §A8 |
| Rotatable without redeploy | §2.3 |
| **Backup key is NOT machine-bound** | §5.1. The one exception, and the most important one |

### 10.2 Egress control

The application must only be able to reach hosts it was configured to reach.

- **Allowlist** of `(provider_key → hostname)` in code, checked by a single `HttpClient` wrapper. Every outbound call goes through it. There is no bare `fetch()` anywhere else — a `dependency-cruiser` rule and a lint rule enforce it (§B24).
- **No user-supplied URLs. Ever.** A "custom webhook URL" or "custom API base" field is an SSRF primitive pointed at `169.254.169.254` and at the Postgres port on localhost. If a self-hosted provider must be supported, the host goes in a config file an administrator edits, not in a form field a user fills.
- **Do not follow redirects to a new host.** A `302` to an internal address is the classic bypass of the allowlist you just wrote.
- TLS 1.2 minimum, certificate validation **on**, no `NODE_TLS_REJECT_UNAUTHORIZED=0` — a grep for that string belongs in CI.
- Per-provider timeouts (connect 5 s, total 30 s) and a response size cap. A provider that streams 2 GB of JSON should fail, not exhaust the office PC's RAM.

### 10.3 Inbound (webhooks) — minimize, verify, and never trust

Only WhatsApp needs it, only if the tunnel is enabled (§4.5).

- HMAC signature verification (`X-Hub-Signature-256`), constant-time compare.
- Replay window (reject timestamps > 5 min skew); store `(provider, event_id)` and reject duplicates.
- The route is **`Principal.system()`** and can write to exactly one table: `message_delivery_events`. It cannot approve a contract, cannot create a user, cannot read a payment.
- Rate-limited and separately auditable.
- **The tunnel being on must not be a precondition for anything else.** If the webhook is unreachable, delivery status stalls at `SENT` and the product works.

### 10.4 PII egress and consent

Sending a customer's phone number to Twilio or Meta means their personal data leaves the country. That
is a decision the *contractor* makes and the *customer* should have agreed to.

```
customers.messaging_consent        { email: bool, sms: bool, whatsapp: bool }
customers.messaging_consent_at     timestamptz
customers.messaging_consent_source text
```

- Checked in the same transaction that claims a `message_outbox` row. No consent → `SUPPRESSED`, with a reason.
- `consent_snapshot` frozen onto the message (§4.1).
- **Every PII egress writes an `audit_logs` row** with `action = EXPORT` (§D-D9 added it for exactly this) and `actor_type`. Asked "what did you send about me, when, and on whose authority", the system can answer.
- Data minimisation: send the phone number and the template variables. Not the contract, not the balance, not the project name unless the template needs it.

### 10.5 Spend as a security control

`integration_spend_counters (provider_key, period_kind, period_start, requests, cost)`, PK-composite,
atomic upsert — the exact shape of `ai_usage_counters` (§D11.6). Monthly caps per provider, enforced
**before** the call. Exceeding the cap is an `Insufficient`/`SUPPRESSED`, not an overdraft.

An integration that can spend money is an integration that can be abused into spending money.

---

## 11. Conflict Resolution

There is less conflict here than the word suggests, because of a deliberate schema choice: **almost
everything external is append-only observation, and observations do not conflict.** Two sources
disagreeing about the price of cement are two true facts about two different questions.

| Conflict | Resolution |
|---|---|
| **External index vs. own purchase price** | No conflict. Both are rows in `material_price_history`. The **baseline** weights them (§3.3): `PURCHASE 1.0`, `EXTERNAL_INDEX 0.2`. Your ledger outranks the world |
| **Two FX providers disagree** | Both stored, with `source`. Display and booking use `system_settings.fx.primaryProvider`. A divergence > 2% raises a `Signal[ANOMALY]` — one of them is broken, and you want to know |
| **Official vs. parallel FX rate** | Not a conflict; two `rateType`s. The booking policy is a setting (§3.2) |
| **New FX rate vs. historical amounts** | **Never resolved, because it never arises.** `fx_rate_at_transaction` is frozen. R2 |
| **Weather forecast vs. later observation** | Observation wins, always. Different rows (`is_forecast`); the archive backfill is authoritative |
| **Government API says "invalid", human says "valid"** | Human wins, and the disagreement is *recorded*: `verification_method: MANUAL_OVERRIDE`, with `overridden_by`, `reason`, and the API's response stored verbatim. A registry can be wrong or stale |
| **Message queued offline, world changed** | The precondition re-check at claim time (§9). `SUPPRESSED`, never sent |
| **Same message sent twice by two providers** | `idempotency_key` unique in our table; provider-side key on the request. Duplicates detected post-hoc by `provider_message_id` mismatch and alerted |
| **Restore vs. diverged local database** | **Not resolved by software.** Show the divergence, require an explicit human choice (§5.2). There is no merge for two ledgers |

**The general rule:** an external system may *inform* a decision; it may never *make* one, and it may
never *rewrite* a fact this business recorded. When they disagree, store both, weight them explicitly,
and show the human which won and why. That is R2 restated, and it is the same discipline that makes the
AI platform safe (§P1.2).

---

## 12. Failure Recovery

| Failure | Detection | Recovery | Silent? |
|---|---|---|---|
| Class R provider down | breaker opens; `integrations.health` job | Failover → stale cache → `Insufficient` with a remedy | No — `asOf` visible |
| Class R provider returns garbage | Range checks: FX rate within ±20% of the last, precip ≥ 0 | Reject the observation, do not store, alert. **A bad row is worse than a missing row** | No |
| Two FX sources diverge > 2% | Cross-check on sync | `Signal[ANOMALY]`; do not book until a human picks | No |
| Class E timeout | Transport | → `UNKNOWN` → reconcile by query. **Never resend** (§4.2) | No |
| Class E provider silently drops (unregistered sender ID) | `SENT` never becomes `DELIVERED` within N hours | Alert on the aging `SENT` cohort. This is the failure that looks like success | **Would be — hence the alert** |
| Spend cap hit | Pre-send check | `SUPPRESSED`, `CRITICAL` notification | No |
| Suppression list stale | Bounce sync job | Hard-bounce on send → immediate suppression | No |
| Webhook unreachable | Statuses stall at `SENT` | Degrade; poll where possible | No |
| Backup upload fails | `backup_runs.status` | Retry; alert after 2 consecutive days | No |
| **Backup silently corrupt** | `backup.verify` weekly restore into a temp schema | Alert. The only real test of a backup is a restore | **Yes, without the verify job** |
| **Backup key lost** | — | **Unrecoverable.** Mitigated only by the printed passphrase (§5.1) | **Yes, and terminal** |
| Ransomware deletes cloud backups | Object-lock / immutability | Provider-side retention | Yes, without object-lock |

**The two rows in bold are the only failures in this document that are both silent and terminal**, and
both live in Class B. Everything else degrades loudly. That asymmetry is why backup gets its own class,
its own key management, and a weekly job that actually restores.

---

## 13. Schema deltas

`docs/DATABASE.md` has nowhere to put any of this.

| Table | Purpose |
|---|---|
| `integration_providers` | `(kind, key, priority, enabled, config jsonb, secret_ref, health, last_ok_at)`. Partial unique: one enabled provider per `(kind, priority)` |
| `integration_sync_runs` | `(provider_key, started_at, finished_at, status, items, etag, cursor, error)`. Append-only, BRIN on `started_at` |
| `integration_spend_counters` | `(provider_key, period_kind, period_start)` PK. Atomic upsert. Mirrors `ai_usage_counters` |
| `fx_rates` | `(base, quote, rate_type, source, observed_on, rate, fetched_at)`. Append-only. Unique `(base, quote, rate_type, source, observed_on)` |
| `weather_observations` | `(project_id, date, is_forecast, precip_mm, temp_min, temp_max, source)`. Unique `(project_id, date, is_forecast)` |
| `construction_indexes` | `(index_key, period, value, source, published_on, imported_by, file_hash)` |
| `verification_results` | `(entity_type, entity_id, check_kind, result, method, verified_by, evidence_document_id, expires_at)` |
| `message_outbox` | §4.1. The Class E queue |
| `message_delivery_events` | `(message_id, status, occurred_at, provider_payload)`. Append-only |
| `message_suppressions` | `(channel, address, reason, suppressed_at)`. Unique `(channel, address)` |
| `backup_runs` | `(started_at, finished_at, size, sha256, destination, key_id, uploaded_at, verified_at, restore_tested_at, status)` |

Column additions:

- `customers.messaging_consent jsonb`, `.messaging_consent_at`, `.messaging_consent_source` — §10.4
- `projects.latitude`, `.longitude` (nullable) — §3.4. Without them, weather returns `Insufficient`
- `material_price_history.source_provider text` and `PriceSource += EXTERNAL_INDEX` — §3.3
- `PriceSource` weighting is code, not schema (§3.3)

Every one follows the append-only, BRIN-on-time, no-soft-delete shape of `material_price_history`
(§D4.5) — because they are all observation logs, and observation logs do not update.

---

## 14. Sequencing

Ordered by `value ÷ (risk × lead-time)`. Do not build these in the order they were listed.

| # | Integration | Why here | Lead time |
|---|---|---|---|
| 1 | **Backup** (local first, then cloud) | The only integration whose absence is catastrophic and silent. The passphrase design (§5.1) must land before any archive is written, or early backups are unrecoverable | Days |
| 2 | **Weather** (Open-Meteo) | Free, keyless, no PII, no consent, no cost. Immediately explains SPI (§3.4). The perfect first adapter to validate the whole port/registry/breaker stack | Days |
| 3 | **Email** (SMTP) | Smallest egress that delivers value. No third party sees content | Days |
| 4 | **Currency** | Real APIs exist. Inert until multi-currency (§D17.3) — but start collecting `fx_rates` **now**, because history cannot be back-fetched | Days, then dormant |
| 5 | **SMS** | Real, costly, needs sender-ID registration. Verify regional rules first | Weeks |
| 6 | **Construction indexes** | CSV import + provenance. No live API to integrate | Days (import), ∞ (API) |
| 7 | **Material price APIs** | **Verify a counterparty exists.** Your own `material_price_history` already outperforms any external index for your own baselines | Unknown |
| 8 | **Government** | Ship the `ManualGovernmentRegistry` adapter. Revisit if an API is confirmed to exist | Days (manual) |
| 9 | **WhatsApp** | Business verification, template approval, webhook ingress, per-conversation pricing. Highest lead time and highest liability | Weeks–months |

**Build #2 first as the reference adapter.** It exercises the registry, the breaker, the sync-run
cursor, the cache-as-table pattern, and the `Insufficient` degradation — with zero cost, zero secrets,
and zero PII. Get that right and the other eight are variations. Start with WhatsApp and you will spend
three weeks on Meta's verification queue before you have learned whether the port abstraction works.

---

## 15. Decisions I need from you

| # | Decision | My call | Reverse it if |
|---|---|---|---|
| 1 | **Backup key derived from an owner passphrase, not DPAPI** (§5.1) | **Not negotiable.** A machine-bound key makes the backup unreadable after the machine dies. The DPAPI copy is a convenience cache for unattended runs; restore always prompts | — |
| 2 | Setup blocks until the owner acknowledges storing the printed recovery sheet | Yes. Everything else in this document is recoverable; this is not | You accept that a lost passphrase means a lost archive, with no prompt |
| 3 | **Every integration off by default; zero-egress is the reference config** (R1) | Yes | You want the product to assume connectivity. It is deployed on Iraqi office broadband |
| 4 | **No LLM-authored message bodies to customers.** Templates only (§4.6) | Yes. An ungoverned sentence sent over the contractor's identity is unbounded liability | |
| 5 | External price data is weighted at `0.2` and can never move a baseline set by real purchases (§3.3) | Yes. Your ledger outranks the world's average | |
| 6 | Migrate `OPENROUTER_*` and `MANAGEMENT_API_URL` into `integration_providers` (§2.3) | Yes. Two egresses currently escape the allowlist, breaker, spend cap, and audit trail | |
| 7 | WhatsApp webhook requires the cloudflared tunnel; without it, status stops at `SENT` | Accept the degradation. Do not make the tunnel a dependency of the core loop (R4) | |
| 8 | Weather first, WhatsApp last (§14) | Yes | |

**And two that need verification, not a decision.** I could not confirm that public APIs exist for
Iraqi tax/registration lookup, or for Iraqi material price indexes, and I did not invent endpoints for
them. Before either is scheduled, someone should confirm a counterparty exists. The ports are designed
so that answer changes an adapter and nothing else.

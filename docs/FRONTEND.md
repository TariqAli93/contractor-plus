# Contractor Plus — Frontend Design

**Status:** Specification. No implementation.
**Continues:** `docs/ARCHITECTURE.md` (§A), `DATABASE.md` (§D), `BACKEND.md` (§B), `AI-PLATFORM.md` (§P), `BI-CAPABILITIES.md` (§I), `INTEGRATIONS.md` (§X).
**Governed by:** `frontend/PRODUCT.md` (register: `product`), `frontend/DESIGN.md`.

Decisions taken this turn: **dark mode ships as a token remap** (DESIGN.md's theme lock is amended, not broken); **desktop-only, 1024px floor**; **specification, no code**.

---

## 0. Three contrast failures, measured

Before designing anything I computed WCAG ratios for the approved palette and the proposed dark
remap. DESIGN.md's pre-flight audit asserts *"Primary action text has sufficient contrast"* and
PRODUCT.md promises *"WCAG AA contrast for all text and UI in the approved light desktop theme."*

Both are false today.

| # | Failure | Measured | Needs |
|---|---|---|---|
| **F1** | `--accent #B7791F` used as **text** on `--surface #FFFFFF` | **3.64:1** | 4.5:1 |
| | same accent on `--background #F3F5F7` | **3.33:1** | 4.5:1 |
| **F2** | `--border #CBD5E0` as the boundary of an **interactive control** (input, button outline) on white | **1.49:1** | 3:1 (WCAG 1.4.11) |
| **F3** | *(dark, proposed)* white text on the lifted primary `#6BA3CC` | **2.71:1** | 4.5:1 |

**F1 is live in production.** The amber is the "attention state" colour, so it lands on exactly the
strings a user most needs to read: an overdue amount, a warning label, a stale-data caption. It is
legible enough to look fine and not legible enough to pass, which is the worst place on the curve.

**F2 is subtler and arguably intentional.** DESIGN.md's whole thesis is *"structure is expressed
through 1px rules, not card elevation."* A hairline row separator is decorative and needs no ratio. But
the border of a **text input** is the thing that tells you where the input is, and WCAG 1.4.11 wants
3:1 for that. One token cannot be both.

**F3 kills the "pure token remap" premise**, and this is the interesting one. §1.3.

---

## 1. The colour system, verified

### 1.1 One structural change: borders split, primaries split

Two role splits are forced by measurement. Neither adds a colour family (DESIGN.md's rule holds);
both split an existing role into the two jobs it was silently doing.

```
--border          →  --rule            hairline structure, separators, table grid   (no ratio req.)
                     --border-strong   bounds of an INTERACTIVE control              (≥3:1)

--primary         →  --primary-fill    button/nav background
                     --on-primary      text ON that fill            ← NEW. Was hard-coded #FFFFFF
                     --primary-text    links, selected nav label, focus ring         (≥4.5:1 as text)
```

`--on-primary` is the token that makes dark mode possible. See §1.3.

### 1.2 Light theme (amended)

| Token | Value | Change | Verified |
|---|---|---|---|
| `--bg` | `#F3F5F7` | — | |
| `--surface` | `#FFFFFF` | — | |
| `--panel` | `#E9EEF3` | — | |
| `--rule` | `#CBD5E0` | renamed from `--border` | structural only |
| `--border-strong` | **`#6F7B8A`** | **new (F2)** | 4.31:1 / white · 3.69:1 / panel ✅ |
| `--primary-fill` | `#234E70` | — | |
| `--on-primary` | `#FFFFFF` | new token, same value | 8.77:1 ✅ |
| `--primary-text` | `#234E70` | — | 8.77:1 / white ✅ |
| `--accent` | `#B7791F` | **fills and indicators only** | — |
| `--accent-text` | **`#96620F`** | **new (F1)** | 5.18:1 / white · 4.74:1 / bg ✅ |
| `--success` | `#2F855A` | — | 4.54:1 ✅ (thin, but passes) |
| `--danger` | `#C53030` | — | 5.47:1 ✅ |
| `--ink` | `#1A202C` | — | 16.32:1 ✅ |
| `--ink-2` | `#4A5568` | — | 7.53:1 / white · 6.45:1 / panel · 6.10:1 / table-header ✅ |
| `--table-header` | `#E2E8F0` | — | |
| `--selected` | `#D9EAF7` | — | primary on it: 7.12:1 ✅ |

**The `--accent` / `--accent-text` split is the fix for F1.** Amber at `#B7791F` may fill a chip, draw
a bar, or tint a row. It may never be a glyph. When the word "متأخر" needs to be amber, it is
`#96620F`. Same hue, same family, legible.

`--success #2F855A` passes at 4.54:1 with 0.04 to spare. It is on the list to watch, not to change:
moving it now would break the one semantic colour users have already learned.

### 1.3 Dark theme — and why "pure token remap" was almost true

The premise you approved: *same geometry, same density, only the role tokens change.* It survives,
with **one** amendment, and the amendment is forced by arithmetic, not taste.

Look at the primary blue. Dark surfaces need a **lifted** primary so links and selected nav read on
`#22262B`. But a primary light enough to be legible as text is too light to carry white text as a
button fill:

| Candidate | as **text** on surface (need 4.5) | **white** on it as button (need 4.5) |
|---|---|---|
| `#6BA3CC` | **5.61 ✅** | **2.71 ❌** |
| `#4A87B5` | 3.93 ❌ | 3.87 ❌ |
| `#3D7AA8` | 3.30 ❌ | **4.62 ✅** |
| `#356F9C` | 2.83 ❌ | 5.38 ✅ |

**No single value satisfies both.** The band where a colour is legible *as text on dark* and the band
where *white is legible on it* do not overlap. That is not a palette problem; it is a fact about
luminance.

The resolution: `--on-primary` becomes a token. In dark, the primary button is a **light blue fill with
dark ink on it** — which is what GitHub, Linear, and Windows 11's own accent buttons do, and which
therefore reads as native rather than inverted.

```
light:  [ ███ Save ]   #234E70 fill, #FFFFFF text     8.77:1
dark:   [ ███ Save ]   #6BA3CC fill, #1A1D21 text     6.23:1
```

Everything else remaps cleanly.

| Token | Dark value | Verified |
|---|---|---|
| `--bg` | `#1A1D21` | |
| `--surface` | `#22262B` | |
| `--panel` | `#2A2F35` | |
| `--rule` | `#343A42` | structural hairline only |
| `--border-strong` | **`#6B7480`** | 3.21:1 / surface · 3.57:1 / bg ✅ |
| `--primary-fill` | `#6BA3CC` | |
| `--on-primary` | **`#1A1D21`** | **6.23:1 ✅** (F3 fixed) |
| `--primary-text` | `#6BA3CC` | 5.61:1 / surface ✅ · focus ring 5.61 / 6.23 ✅ |
| `--accent` | `#D9A54A` | fills only |
| `--accent-text` | `#D9A54A` | 6.83:1 ✅ |
| `--success` | `#5FC08A` | 6.81:1 ✅ |
| `--danger` | `#F08585` | 6.09:1 ✅ |
| `--ink` | `#E4E7EB` | 12.27:1 / surface · 13.63:1 / bg ✅ |
| `--ink-2` | `#9AA3AE` | 5.96:1 / surface · 5.28:1 / panel ✅ |
| `--table-header` | `#2E343B` | |
| `--selected` | `#2C3A47` | ink on it 9.39:1 ✅ |

**Semantic colours invert in lightness, never in hue.** `#C53030` on dark is 2.78:1 and unusable;
`#F08585` is the same red, lifted. A user who learned "red = overdue" in light mode learns nothing new.

**The selected-row problem, named honestly.** `--selected #2C3A47` sits only **1.31:1** against the dark
surface. That is fine as a *hint* and insufficient as the sole carrier of state (WCAG 1.4.11 wants 3:1
for a component's state). Raising the fill until it clears 3:1 produces a bar so bright it reads as an
error. So selection is carried by **three** cues, as it should have been in light mode too:

1. the `--selected` fill (perceptual, not load-bearing),
2. a 1px `--primary-text` outline on the full row (a full border, never a side stripe — that is a banned pattern),
3. `aria-selected="true"`.

### 1.4 Theme switching

```html
<html data-theme="light|dark">
```

- Default follows the OS (`prefers-color-scheme`), because the contractor's Windows theme is the intent they already expressed.
- Overridable in Settings, persisted to `localStorage`, applied **before first paint** by an inline script in `index.html`. A theme flash on a business tool reads as a bug.
- Tokens are CSS custom properties on `:root[data-theme=…]`. Vuetify's theme object reads the same values. **No component knows which theme it is in.** If a component branches on theme, the token set is wrong.
- `color-scheme: light dark` on `:root` so native scrollbars, form controls, and the Electron title bar follow.

### 1.5 The data-visualisation ramp — the one honest gap in DESIGN.md

DESIGN.md says *"No other colour family is introduced."* A chart with five series needs five
distinguishable colours, and semantic red/green/amber are spoken for. The rule was written for chrome
and never tested against charts.

**Amendment:** one categorical ramp, derived from the primary hue by rotation and lightness, never
used outside a plot area.

```
viz-1  #234E70   primary        viz-4  #7E6C9E   muted violet
viz-2  #2F7A87   teal           viz-5  #96620F   accent-text amber
viz-3  #4E6B4A   moss           viz-6  #6B7480   neutral (always "other")
```

Rules: sequential data uses a single-hue lightness ramp of `viz-1`. Diverging data uses
`danger ↔ neutral ↔ success` and nothing else. **A series is never coloured by the semantic palette
unless it *is* that semantic** — a "revenue" line is not green because revenue is good.

---

## 2. The application frame

Five durable regions (DESIGN.md), all already built: `TitleBar`, `MenuBar`, `CommandBar`, `SideNav` +
workspace, `StatusBar`.

```
┌───────────────────────────────────────────────────────────────────────┐
│ TitleBar        Contractor Plus  ·  المشاريع                     ─ □ ✕│  28px
├───────────────────────────────────────────────────────────────────────┤
│ MenuBar         ملف  تحرير  عرض  أدوات  تقارير  مساعدة                 │  24px
├───────────────────────────────────────────────────────────────────────┤
│ CommandBar   [+ جديد ▾] │ [⌕ بحث  Ctrl+K] │      [🔔 3] [☾] [👤]      │  32px
├──────────┬────────────────────────────────────────────────────────────┤
│          │  PageHeader   المشاريع                    [إجراءات ▾]      │  32px
│ SideNav  ├────────────────────────────────────────────────────────────┤
│  200px   │  FilterBar   [حالة ▾][عميل ▾][التاريخ ▾]   [⌕]  [مسح]     │  36px
│  (icon   ├───────────────────────────────┬────────────────────────────┤
│   56px   │                               │  DetailsPane               │
│   <1280) │  DataGrid                     │  ┌──────────────────────┐  │
│          │  26px rows, 28px header       │  │ PropertyGrid         │  │
│          │                               │  │ ruled label / value  │  │
│          │                               │  └──────────────────────┘  │
│          │                               │  ◄ splitter, draggable     │
├──────────┴───────────────────────────────┴────────────────────────────┤
│ StatusBar  ● الخدمة  ● قاعدة البيانات  ● النسخ الاحتياطي 6س  │ tariq │ v1.4.2 │ 22px
└───────────────────────────────────────────────────────────────────────┘
```

**Why the frame never floats.** Chrome is opaque, flat, and separated by 1px rules. Menus and dialogs
are the only surfaces with a shadow. This is the single decision that makes the app read as a Windows
tool rather than a web page, and it is why `backdrop-filter` appears nowhere in this document.

### 2.1 The status bar is not decoration

It is the product's first emotional goal — *in control, nothing slips through* — rendered as pixels.
Six live indicators, each mapping to a real check:

| Slot | Source | States |
|---|---|---|
| Service | `GET /health` | ● ok · ● degraded · ● down |
| Database | `/health.db` | ● / ● |
| **Backup** | `backup_runs.uploaded_at` (§X5) | `آخر نسخة: قبل 6 س` · **`لا توجد نسخة منذ 9 أيام`** in `--danger` |
| Tunnel | `TunnelStatusChip` | off / connecting / on |
| Sync | `integration_sync_runs` (§X6) | `غير متصل منذ 3 أيام` when stale |
| User · version | | |

**The backup slot earns its place.** §X12 identifies backup failure as one of only two failures in the
entire system that are silent *and* terminal. A silent failure needs a loud pixel. If the last cloud
backup is older than 48 h, the slot turns `--danger` and stays there. It is not dismissible.

---

## 3. Navigation and information architecture

Three parallel systems, each for a different user. This is deliberate: PRODUCT.md describes an owner
who *sits down to check status* and staff who *live by the keyboard*, and one navigation model cannot
serve both.

### 3.1 SideNav — the owner's map

Grouped, not flat. Twelve top-level destinations is beyond recall; four groups of three is not.

```
لوحة المعلومات            Dashboard
──────────────────
العمل                     WORK
  المشاريع                  Projects
  العقود                    Contracts
  أوامر التغيير             Change orders
──────────────────
المال                      MONEY
  الدفعات                   Payments
  التكاليف                  Costs
  المصاريف العامة           Overhead        (hidden if overhead_expenses unused)
──────────────────
السجلات                    RECORDS
  العملاء                   Customers
  الموردون                  Suppliers       NEW
  المواد                    Materials
  القوالب                   Templates
──────────────────
التحليل                    INSIGHT
  التوصيات            [3]   Recommendations NEW
  التقارير                  Reports
  المساعد                   AI console      NEW
──────────────────
الإدارة                    ADMIN           (permission-gated, collapsed by default)
  المستخدمون · الصلاحيات · الإعدادات · التكاملات · المهام · السجل
```

Each item is `AccessGate`d on a permission key (§B12.6). **An item the role cannot use is not
disabled; it is absent.** A greyed menu item teaches a user that the software is bigger than their job
and that they are second-class in it. Absence teaches nothing and costs nothing.

The `[3]` badge on Recommendations counts only `status = NEW ∧ severity = CRITICAL`. §11.4.

### 3.2 Command palette — the staff's map

`Ctrl+K`. Already built (`CommandPalette.vue`). It is the primary navigation for anyone who types.

It searches four namespaces in one ranked list, backed by the **same** `search_documents` index the AI's
entity resolver uses (§P10.1) — because §A10.3 is right that three rankers eventually disagree, and a
palette that finds a project the assistant cannot is a bug the user experiences as distrust.

```
Ctrl+K  ┌────────────────────────────────────────────────┐
        │ ⌕ فيلا                                          │
        ├────────────────────────────────────────────────┤
        │ الانتقال إلى                                     │
        │   ▸ فيلا الرياض            مشروع · قيد التنفيذ   │
        │   ▸ فيلا الرياض            عقد CP-2026-0041     │
        │ الإجراءات                                        │
        │   + تسجيل تكلفة                          Ctrl+E │
        │   + جدولة دفعة                                   │
        │ الانتقال                                         │
        │   ⇥ المشاريع                                g p │
        └────────────────────────────────────────────────┘
```

Results are filtered by `permission_key` **inside the SQL** (§B20.4). Post-filtering would let an
engineer learn how many payments exist by watching the result count shrink.

### 3.3 Keyboard map

Already partly built (`useQuickNav`, `useSaveShortcut`, `ShortcutsHelp.vue`).

| Key | Action |
|---|---|
| `Ctrl+K` | Command palette |
| `g` then `p` / `c` / `u` / `m` / `r` | Go to Projects / Contracts / Customers / Materials / Reports |
| `Ctrl+S` | Save the focused form or grid |
| `Ctrl+E` | Quick-add cost on the focused project |
| `Enter` | Commit the grid row, move down |
| `Esc` | Cancel the cell edit, then the row, then close the pane. **Never closes an unsaved form silently** |
| `F2` | Edit the focused cell |
| `Ctrl+Shift+V` | Paste from Excel into the grid |
| `?` | Shortcuts help |
| `Alt+↑ / ↓` | Previous / next record, keeping the details pane in place |

`Alt+↑/↓` is the one worth calling out. It is what makes master-detail *faster* than a list of forms:
review twelve costs without touching the mouse or losing the pane's scroll position.

### 3.4 Routing and breadcrumbs

No breadcrumbs. The sidebar shows depth 1, the workspace title shows depth 2, and depth never exceeds
2. A breadcrumb trail on a two-level app is decoration that costs 32px of vertical space on every
screen.

---

## 4. Screen inventory

Twenty-eight screens. Nine exist and are unchanged, twelve exist and change, seven are new.

| Screen | Route | Status | §|
|---|---|---|---|
| Login | `/login` | unchanged | |
| Setup wizard | `/setup` | unchanged | |
| **Dashboard** | `/` | **rework** | §5 |
| Projects workspace | `/projects` | changes | §6.1 |
| Project wizard | `/projects/new` | unchanged | |
| Project detail | `/projects/:id` | changes | §6.2 |
| Contracts | `/contracts` | changes | §6.3 |
| Contract detail | `/contracts/:id` | changes | §6.3 |
| Change orders | tab | unchanged | |
| Costs | `/costs`, `/projects/:id/costs` | changes | §7.2 |
| Payments | `/payments` | **changes materially** | §6.4 |
| Customers | `/customers` | changes | §6.5 |
| **Suppliers** | `/suppliers` | **new** | §6.6 |
| Materials | `/materials` | changes | §6.7 |
| **Material price history** | `/materials/:id/prices` | **new** | §6.7 |
| Templates | `/templates` | unchanged | |
| **Recommendations** | `/recommendations` | **new** | §11 |
| **AI console** | `/ai` | **new** | §10 |
| Reports | `/reports` | **rework** | §12 |
| **AI reports** | `/reports/generated` | **new** | §12.3 |
| **Search results** | `/search` | **new** | §13 |
| **Notification centre** | `/notifications` | **new** | §9.2 |
| Users · RBAC | `/users`, `/rbac` | unchanged | |
| Settings | `/settings/*` | changes | §14 |
| **Integrations** | `/settings/integrations` | **new** | §14.2 |
| **Jobs & health** | `/admin/jobs` | **new** | §14.3 |
| Audit log | `/audit` | changes | |
| Profile · 404 | | unchanged | |

Every screen follows DESIGN.md's mandatory sequence: page header → filter bar → dense table → docked
details pane → inline loading/empty/error that **preserve the workspace shape**.

---

## 5. Dashboard

The one screen where the owner, not the staff, is the user. It is also where every temptation lives:
PRODUCT.md's anti-references ban *"marketing-style hero sections"* and the shared bans ban the
**hero-metric template** (big number, small label, gradient accent). DESIGN.md permits the dashboard
*"a compact financial summary"* and nothing more.

### 5.1 Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│ لوحة المعلومات                       آخر تحديث ٠٢:٠٠ · ٩ يوليو            │  ← asOf, always
├──────────────┬──────────────┬──────────────┬───────────────┬───────────────┤
│ السيولة      │ متأخرات      │ هامش الربح   │ مشاريع متأخرة │ نسخة احتياطية │
│ ١٢٤٬٥٠٠      │ ٣٨٬٢٠٠       │ ١٤٫٢٪        │ ٢ من ٧        │ قبل ٦ س       │
│ د.ع          │ ٣ دفعات      │ ضعيف · ن=٣   │               │               │
└──────────────┴──────────────┴──────────────┴───────────────┴───────────────┘
   5 metric cells in ONE ruled band. No cards. 1px rules between. No icons.

┌─────────────────────────────────────────┬──────────────────────────────────┐
│ التدفق النقدي · ١٣ أسبوعاً               │ يحتاج انتباهك                    │
│                                         │ ┌──────────────────────────────┐ │
│  [line + shaded 80% interval band]      │ │ ▲ السيولة سالبة في الأسبوع ٦ │ │
│  ─────────────────────── zero line      │ │   عجز متوقع ١١٬٤٠٠           │ │
│  ▓▓ trough w6                           │ │   ثقة ٠٫٦٢ · كافٍ             │ │
│                                         │ ├──────────────────────────────┤ │
│                                         │ │ ● أسمنت أعلى ١٤٪ من المتوسط  │ │
│                                         │ │   ٣ مشاريع · ٨٬٢٠٠ معرّضة     │ │
│                                         │ └──────────────────────────────┘ │
│                                         │              [كل التوصيات ←]     │
├─────────────────────────────────────────┴──────────────────────────────────┤
│ دفعات مستحقة                                        [الكل ←]               │
│ ┌────────────────────────────────────────────────────────────────────────┐ │
│ │ العميل        المشروع       المستحق      تاريخ الاستحقاق   التأخير      │ │
│ │ شركة البناء   فيلا الرياض   ١٢٬٠٠٠      ٢٠٢٦-٠٦-١٥        ٢٤ يوماً     │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 UX decisions

**The metric band is a table, not five cards.** One ruled strip, five cells, 1px separators. Cards
would give each number a shadow, a radius, and 16px of padding it has not earned, and the anti-reference
list names that exact pattern. A number's importance is carried by position and by `--metric` type
size, not by a container.

**Every derived number shows its freshness and its sufficiency.** `١٤٫٢٪ · ضعيف · ن=٣` is honest. `١٤٫٢٪`
alone is a lie of omission, because §I2.4 says a margin computed from three costs is `WEAK`. The
dashboard header carries a single `asOf` from the oldest fact in the band — a dashboard is only as fresh
as its stalest input (§I13).

**The cash chart is the hero, and it is a line.** §I9's Poisson-binomial interval is the reason it can
show a shaded band rather than a false-precision line. The trough is marked because §I12 names liquidity
*"the risk that ends contractors, and the one they see last."*

**"Needs your attention" is capped at three.** It is the top of the ranked recommendation list (§P13.2),
filtered to `sufficiency ≥ ADEQUATE`. Not five, not "all". §I14: a platform that notifies twenty times a
day has trained the user to dismiss twenty times a day.

**No greeting, no date widget, no activity feed, no chart of new customers per month.** The owner has
one question — *where is the money* — and four surfaces answer it.

### 5.3 Cold start

Day 0 has no data, and §P17 says the platform must **say what it needs**, not show empty art.

```
┌────────────────────────────────────────────────────────────────────────┐
│  لا توجد بيانات كافية بعد.                                              │
│                                                                        │
│  لعرض الأداء المالي، سجّل أول عقد ومشروع.                                │
│  [+ عقد جديد]  [+ مشروع جديد]                                          │
│                                                                        │
│  ─────────────────────────────────────────────────────────────────     │
│  لتفعيل تتبع الجدول الزمني، أضف تواريخ مخططة لمراحل البناء.               │
│  لتفعيل توقّع الأسعار، سجّل ٣ مشتريات إضافية من الأسمنت.                  │
└────────────────────────────────────────────────────────────────────────┘
```

Those last two lines are §I17's Missing Data Detection, rendered. `"سجّل ٣ مشتريات إضافية"` is
actionable; `"بيانات غير كافية"` is not. The count comes from the Fact Catalog's `minN`, so the prompt
cannot drift from the threshold that gates the computation.

---

## 6. Tables

Tables are the primary content surface. `DataGrid.vue` exists and is the keystone of the Excel-ease
work: in-cell edit, keyboard nav, paste-from-Excel, multi-delete, sort/filter, pinned/resize, CSV
export, virtual scroll.

### 6.1 The master-detail workspace

```
list (DataGrid)  ◄──splitter──►  DetailsPane (PropertyGrid)
```

Split renders at **≥1024px** (Tailwind `lg`), not Vuetify's `lgAndUp` = 1280. Below 1024 the details
pane becomes a full-page route. This gate is already in the codebase and is correct.

### 6.2 Grid rules

| Rule | Value | Why |
|---|---|---|
| Row height | 26px | DESIGN.md. ~34 rows visible at 1080p |
| Header | 28px, `--table-header`, `--ink-2` | Quiet. Headers are not content |
| Money | inline-end aligned, `font-variant-numeric: tabular-nums` | Digits must stack. This is a correctness feature |
| Money source | the **string** from the DTO (§B11.1) | Never `parseFloat` for display. Never re-sum client-side |
| Selection | fill + 1px `--primary-text` full border + `aria-selected` | §1.3 |
| Zebra striping | **none** | 1px rules already separate rows. Stripes plus rules is two systems doing one job |
| Row status | one cell, one `StatusBadge` | DESIGN.md: *"Do not give every row a colored badge"* |
| Virtualisation | above 100 rows | Already shipped |
| Sort | header click; the sort key **must match a backing index** (§B14) | A sort the database cannot serve is a full scan on every click |
| Pagination | keyset (`nextCursor`), infinite-scroll within the virtual list | §B8.3. `OFFSET 20000` reads and discards 20,000 rows |
| Total row count | **omitted** on keyset lists | Nobody reads "1 of 24,318", and `COUNT(*)` costs more than the page |

### 6.3 In-cell editing

Enter commits and moves down. `F2` or typing begins an edit. `Esc` reverts the cell, then the row.
Optimistic write with rollback on error, and the failed row keeps its value and gains a `--danger`
border plus an inline message. **The row is never silently reverted** — a staff member who typed 4,200
and watched it become 3,800 will not trust the grid again.

Paste from Excel maps columns by header, shows a preview dialog of `n` rows with the parse errors
highlighted, and commits in one transaction (`POST /projects/:id/costs/bulk`, ≤500 rows,
all-or-nothing).

### 6.4 Payments — the grid that changes most

§D-D4 splits `amount` into `scheduled_amount` and `paid_amount`. The old grid could not represent a
partial payment; the new one must make partial the obvious case.

```
│ القسط │ المجدول    │ المدفوع    │ المتبقي   │ الحالة   │ الاستحقاق  │ التأخير │
│ ٣     │ ١٢٬٠٠٠٫٠٠ │  ٥٬٠٠٠٫٠٠ │ ٧٬٠٠٠٫٠٠ │ جزئي     │ ٢٠٢٦-٠٧-١٥ │ —      │
│ ٤     │  ٨٬٠٠٠٫٠٠ │      ٠٫٠٠ │ ٨٬٠٠٠٫٠٠ │ متأخر    │ ٢٠٢٦-٠٦-٠١ │ ٣٨ يوم │
```

`المتبقي` and `التأخير` are **derived in the DTO**, never stored. `متأخر` is a computed state, not a
`status` value (§I8, §B6.4 Y5) — a stored `LATE` flag is wrong every night between midnight and the
sweep, and the UI would faithfully render the wrong thing.

Settling a payment is `POST /payments/:id/settle` with an amount, not a checkbox. The dialog defaults
the amount to the remaining balance, because full settlement is the common case, and accepts less
without ceremony.

### 6.5–6.7 Customers, suppliers, materials

`Customers` and `Suppliers` are the same screen with different columns, deliberately — §D4.3 shaped
`suppliers` to mirror `customers` so a reviewer who reads one predicts the other. The UI honours that.

**Duplicate handling differs, and the UI must show why** (§I16, §D6.1):

- **Customer**: a trigram match above 0.85 shows an inline `--accent` warning under the name field: `"يشبه عميلاً موجوداً: محمد علي"` with a link. Saving is allowed. Two people are genuinely called محمد علي, and a hard constraint teaches users to type "محمد علي 2".
- **Material**: the same match is an **error**. Two materials named أسمنت are always a mistake.

Never offer "merge". Merging two customers silently reparents signed contracts.

**Material price history** (`/materials/:id/prices`) is a chart plus a table of observations, each
labelled with its `PriceSource`. §X3.3's weighting is visible: a purchase row is `--ink`, an external
index row is `--ink-2` and captioned `"مؤشر خارجي"`. Below 8 observations, **no trend line is drawn** —
only the points (§I15). Drawing a two-point trend is the fastest way to lose a user's trust
permanently.

---

## 7. Forms

### 7.1 Structure

Labels **above** inputs, always. A placeholder never replaces a label (DESIGN.md), and placeholder text
must meet the same 4.5:1 as body text — the single most common contrast failure in AI-built UIs is a
light-gray placeholder on white.

28px controls, 3px radius, `--border-strong` boundary (§1.1), `--primary-text` 2px focus ring with a
1px offset. Focus is never removed; `:focus-visible` scopes it to keyboard.

`AdvancedOptions.vue` collapses the rare fields. Progressive disclosure is PRODUCT.md's *"calm under
density."*

### 7.2 Money and quantity inputs

Text inputs with an inline-end unit suffix. **Never `<input type="number">`**: it accepts `1e5`, its
spinners are a mouse affordance in a keyboard app, and scroll-wheel-over-a-focused-number-field silently
edits money.

Input is a string, validated against `^-?\d{1,14}(\.\d{1,4})?$`, sent as a string, stored as `Decimal`
(§B10.1). The client never computes a total. `totalAmount` on a cost row is echoed back by the server,
which computed it, and the grid displays what it was told (§I ground rule 2, `ck_pc_line_math`).

### 7.3 Validation and errors

Validate on blur, not on keystroke. Re-validate on submit. Errors appear **below** the field in
`--danger`, and the first invalid field receives focus with `aria-invalid` and `aria-describedby`.

Server errors map by `code`, never by `message`. §B14.2 is explicit that `message` is a developer-facing
English sentence and Arabic user text is the frontend's job:

```ts
CONTRACT_NOT_DRAFT      → "لا يمكن اعتماد عقد غير مسودة."
PAYMENT_EXCEEDS_SCHEDULED → "المبلغ أكبر من المتبقي على هذا القسط."
CONTRACT_NUMBER_TAKEN   → "رقم العقد مستخدم. جرّب الرقم التالي."
IDEMPOTENCY_KEY_REUSED  → "تم إرسال هذا الطلب مسبقاً."
```

`retryable: true` renders a "أعد المحاولة" button. `retryable: false` does not. A retry button on an
unretryable error is a lie that costs the user four clicks.

### 7.4 Save, and the double-submit problem

`Ctrl+S`. The button enters a `loading` state and is `disabled` for the duration — necessary but not
sufficient. Every money-creating `POST` carries a client-generated `Idempotency-Key` (§B7.4), stable
across retries. The network layer generates it once per user intent, not once per request.

Without it, a flaky tunnel plus an impatient double-click creates a second payment.

---

## 8. Dialogs

> *"Modal as first thought is laziness. Exhaust inline / progressive alternatives first."* — product register

Three legitimate uses, and no others:

| Dialog | Why it must be modal |
|---|---|
| **Destructive confirm** (`ConfirmDialog.vue`) | An irreversible act needs a deliberate second gesture |
| **AI plan preview** (§10.3) | The confirmation gate *is* the safety property. It must interrupt |
| **Excel paste preview** | Reviewing 40 parsed rows before committing has no inline home |

Everything else is inline or in the `DetailsPane`. Creating a cost is a grid row. Editing a customer is
the details pane. Adding a contract line is a row. `AddCostDialog` survives only as "detailed add" for
the rare full-form case.

**Mechanics.** Native `<dialog>` (or Vuetify's overlay), because a `position: absolute` dropdown inside
an `overflow: auto` grid gets clipped. Focus moves to the first control, is trapped, and returns to the
trigger on close. `Esc` closes. Backdrop click does **not** close a destructive dialog. A `--surface`
panel, 5px radius, one restrained shadow, no blur.

Known gotcha, already recorded in this codebase: close before navigating (`nextTick`), and set
`:transition="false"` on `v-dialog` when the scrim would otherwise linger.

**Destructive confirmations name the object and the consequence:**

```
حذف العقد CP-2026-0041؟
سيتم حذف ٨ بنود مرتبطة. لا يمكن التراجع.
[إلغاء]  [حذف العقد]
```

Not "هل أنت متأكد؟". The verb on the button repeats the verb in the title, so a user who reads only the
button still knows what they are doing.

---

## 9. Notifications

### 9.1 What fires, and what does not

`notifications` rows exist for many events. **The bell rings for very few.** §I14: notify only when
`severity = CRITICAL ∧ sufficiency ≥ ADEQUATE`.

A `WEAK` finding never notifies. A finding built on three data points that wakes a contractor is how
the feature gets muted in week two.

### 9.2 Surfaces

- **`NotificationsBell`** in the command bar. The unread count comes from `ix_notif_unread`, a partial index, so it is O(unread) and does not degrade after five years.
- **Dropdown**: last 10, grouped by day.
- **`/notifications`**: full history, filterable, with the entity deep-link. Dead links (the entity was deleted) render as disabled text, not a 404 — `entity_id` is polymorphic and carries no FK (§D9.5), and the UI must handle it.
- **SSE** (`GET /notifications/stream`): live push. On reconnect the client sends `Last-Event-ID` and the server replays. Replay is possible only because notifications are durable rows.
- **Windows toast** via Electron IPC, for `CRITICAL` only.

### 9.3 Toasts vs. notifications

They are different things and the codebase must not conflate them.

| | Toast | Notification |
|---|---|---|
| Lifetime | 4s, ephemeral | Durable row |
| Origin | *Your own* action succeeded | The *system* found something |
| Example | "تم حفظ العقد." | "٣ دفعات متأخرة أكثر من ٣٠ يوماً." |
| Dismissible | auto | explicit |

A toast for a system event loses it. A notification for your own save is noise.

**Never toast an error that has an inline home.** A failed field validation belongs under the field.

---

## 10. AI widgets

§P0: *the AI is not a chatbot.* The frontend must make that structurally true, not merely say it. So
the AI appears in **four** places and only one of them is a chat window.

### 10.1 The `asOf` / sufficiency micro-components

These are the most-used new components in the app, and they are two chips.

```
ConfidenceBadge      ثقة ٠٫٦٢          title="محسوبة من ن=٥ · حداثة ٤٨س"
SufficiencyChip      كافٍ | ضعيف | غير كافٍ
FreshnessCaption     آخر تحديث ٠٢:٠٠
```

Rules:
- **`ضعيف` (WEAK) renders the number in `--ink-2`, not `--ink`.** Greyed, present, honest.
- **`غير كافٍ` (INSUFFICIENT) renders no number at all** — it renders the remedy: `"سجّل ٣ مشتريات إضافية"`. A blank card is not an option; a number from 3 rows is worse than blank (§I2.4).
- Confidence is never a progress bar and never a star rating. It is a number with a tooltip that decomposes it (`sampleAdequacy`, `freshness`, `methodPower`, `dispersion`).

This is the whole "AI widget" surface for 12 of the 15 BI capabilities, and none of it involves a
language model.

### 10.2 The "explain this" affordance

Any derived number — margin, CPI, forecast, drift — carries a subtle inline trigger. It opens the
`DetailsPane`, not a chat:

```
هامش الربح  ١٤٫٢٪ ⓘ
            └─▸  القيمة المكتسبة      ٤٥٬٠٠٠٫٠٠
                 التكلفة الفعلية      ٣٨٬٦٠٠٫٠٠
                 مؤشر أداء التكلفة    ٠٫٨٦
                 ── الأدلة ──
                 ▸ ١٢ تكلفة  (افتح)
                 ▸ ٤ ملاحظات سعر أسمنت  (افتح)
```

Every row of evidence is a link to real rows. This is `recommendation_evidence` (§D11.8) rendered.
`explanation` is `NOT NULL` at the database level; the UI can therefore rely on it existing and has no
"no explanation available" state to design.

### 10.3 The plan preview dialog — the safety gate, drawn

The only place the AI can cause a write. §P15.1.

```
┌──────────────────────────────────────────────────────┐
│  تأكيد الإجراء                                        │
├──────────────────────────────────────────────────────┤
│  سيتم تسجيل تكلفة أسمنت بقيمة ٥٠٠٬٠٠٠ د.ع              │
│  على مشروع فيلا الرياض بتاريخ ٩ يوليو ٢٠٢٦.            │
│                                                      │
│  ينتهي هذا الطلب خلال ٤:٥٢                            │
├──────────────────────────────────────────────────────┤
│                        [رفض]  [تأكيد وتنفيذ]          │
└──────────────────────────────────────────────────────┘
```

- **Arabic sentences. No ids, no JSON, no tool names.** (§A5.4)
- A countdown, because `ai_plans.expires_at` is real.
- `تأكيد` fires the CAS (`UPDATE … WHERE status='PENDING'`). A double-click returns `409 PLAN_ALREADY_CLAIMED`, and the UI renders `"تم تنفيذ هذا الإجراء بالفعل."` — **not** an error toast. It is not an error; it is the guarantee working.
- The dialog cannot be dismissed by backdrop click.

### 10.4 The AI console (`/ai`)

The chat surface, and deliberately the *least* prominent of the four. It is one navigation item under
INSIGHT, not a floating orb in the corner.

It renders the closed result union by `kind` (§P15.1) — `answer` (with citation chips) ·
`clarification` (with candidate buttons; **never** auto-picks the top hit) · `preview` (opens §10.3) ·
`execution` · `rejected` · `error`.

`rejected` and `error` look different. *"فهمت طلبك، والجواب لا"* is `--ink` with a reason. *"تعذّر
الاتصال بالخدمة"* is `--ink-2` with a retry button. Conflating them makes the assistant feel broken when
it is merely offline (§A5.6).

When OpenRouter is down, the console shows a persistent inline banner and the pre-router still answers
greetings and capability questions. **Nothing else in the app changes**, which is §P0.1's falsifiable
test made visible.

---

## 11. Recommendations

### 11.1 The screen

A list, ranked by `priority = valueAtStake × confidence × urgency × actionability × novelty × trust`
(§P13.2). **Ordered by money, not by model score.** A 0.98-confidence finding about 12,000 loses to a
0.55-confidence finding about 400,000. In a financial tool the ordering function is economic.

```
┌────────────────────────────────────────────────────────────────────────┐
│ ▲ CRITICAL   السيولة سالبة في الأسبوع ٦                     ٦ يوليو    │
│   عجز متوقع ١١٬٤٠٠ د.ع في أدنى نقطة.                                    │
│   ▸ الأساس: ٤ دفعات مجدولة · احتمال التحصيل ٠٫٦٢ · معدل الإنفاق ٨٤٠/يوم │
│   ثقة ٠٫٦٢ · كافٍ                                                       │
│   [عرض الأدلة]  [إجراء]  [تجاهل]                                        │
├────────────────────────────────────────────────────────────────────────┤
│ ● WARNING    سعر الأسمنت أعلى ١٤٪ من متوسط ١٢ شهراً          ٩ يوليو    │
│   ٨٬٢٠٠ د.ع معرّضة على ٣ مشاريع لم تُشترَ موادها بعد.                     │
│   ثقة ٠٫٧٤ · قوي                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### 11.2 Non-negotiables, enforced by the schema

- **`explanation` is always shown.** It is `NOT NULL` with a `CHECK` (§D11.7). There is no card without a "why".
- **`evidence[]` opens real rows.** Not a modal of JSON. A route to the cost, the payment, the price observation.
- **A `RULE`-tier recommendation shows no confidence score**, because `ck_rec_rule_no_score` forbids storing one. A rule is not confident; it is true. The UI shows `مؤكد` instead of a number.
- **`تجاهل` requires a reason.** `dismissed_reason` is `NOT NULL` when dismissed. It is the training signal for `trust(kind)`, and it is the query that finds rules worth deleting.

### 11.3 `إجراء` walks the gate

Acting on a recommendation pre-fills an `ai_plans` row and opens §10.3's preview dialog. It does not
execute. There is no autonomous write path anywhere in this product, and no button in this UI creates
one.

### 11.4 Two surfaces, deliberately separated

§I17's missing-data prompts have `valueAtStake = 0` and would sort last forever. They live in a
**separate onboarding panel** on the dashboard and in Settings, never interleaved with financial
findings.

A "set your units" prompt must not outrank a liquidity warning. A liquidity warning must not bury the
prompt that would make the next one accurate.

---

## 12. Reports

### 12.1 Structure

Filter bar → dense table → export. Reports read matviews only (§B8.2), so **every report header carries
`asOf`.** A number from a matview is stale by construction and a financial UI must be able to say how
stale.

Four standing reports: cash flow · profitability · overdue · delays.

### 12.2 Charts

`ApexCharts`, already lazy-loaded (`FinancialOverviewChart.vue`). Rules:

| Rule | Reason |
|---|---|
| No gradient fills, no 3D, no drop shadows, no donut with a big number in the middle | Bans, and the hero-metric template |
| Series colours from the `viz-*` ramp (§1.5) | Semantic red/green mean *state*, not *series* |
| Tabular numerals in every tooltip and axis label | Digits must stack |
| Money axis labels never abbreviated to `12K` | Precision is the brand |
| Forecast series drawn with an interval band, never a bare line | §I9. A point forecast is false precision |
| Grid lines `--rule`, axis text `--ink-2` | The data is the ink |
| RTL: axis reversed, tooltip anchored inline-end | `dir="rtl"` on the container is not enough for canvas |
| A chart with `sufficiency = INSUFFICIENT` renders **points only, no line** | §I15 |
| No animation on load; `prefers-reduced-motion` disables the tooltip transition | Users load into a task |

### 12.3 AI reports (`/reports/generated`)

Generation is a job. The screen shows `QUEUED / RUNNING / READY / FAILED` with the deterministic
`data_snapshot` rendered as tables and the `narrative` as prose above it.

**When OpenRouter is down the report still reaches `READY` with `narrative = null`** and renders tables
plus templated captions (§X, §I13). The numbers are the report; the prose is a courtesy. The UI shows a
quiet caption, not an error: `"تعذّر توليد الملخص النصي. الأرقام كاملة."`

---

## 13. Search

`Ctrl+K` for navigation (§3.2). `/search` for a full result page when the palette is not enough.

One index, one ranking, three consumers (§P10). Results are grouped by entity type, each with its
`subtitle` disambiguator, ranked by `ts_rank + similarity + recency`.

**Arabic is the design constraint.** Postgres ships no Arabic stemmer, so recall comes from `pg_trgm`
over `ar_normalize` (§D-D1). Practically: the user types `فيلا` and finds `الفيلا`. The UI must not
add its own client-side filtering on top — a client-side `includes()` over the server's results will
silently drop the fuzzy matches that were the whole point.

No result caching (§B13.1). A stale search index resolves a name to a deleted project, and §D-D10 makes
the projector delete on soft-delete precisely so the UI can trust what it renders.

---

## 14. Filters, settings, admin

### 14.1 `FilterBar`

One compact 36px row above the table. Never a left rail, never a modal, never an accordion.

- Filters are `v-model`-bound to the query string, so a filtered view is a URL a user can bookmark and paste into a message.
- Every filter maps to a **backing index** (§B14). A filter the database cannot serve without a full scan is not offered. This is a design constraint imported from the schema, and it is why there is no "filter by notes contains".
- Active filters render as removable chips. `[مسح]` clears all.
- Filter state survives navigation to a detail and back.

### 14.2 Integrations (`/settings/integrations`)

New. One row per provider: kind, enabled, priority, health, last sync, monthly spend against cap.

Two things this screen must get right:

- **`hasSecret: true` is shown; the secret never is.** The response schema enforces it (§X10.1).
- **There is no free-text "custom API URL" field.** §X10.2: it is an SSRF primitive pointed at `169.254.169.254` and at the Postgres port on localhost. Self-hosted endpoints go in a config file an administrator edits.

**Backup gets its own panel**, above the rest, because §X12 names it the only silent-and-terminal
failure. It shows last run, last *verified restore*, and the recovery-sheet acknowledgement state. If
the passphrase has never been acknowledged, the panel is `--danger` and the app nags on every launch.

### 14.3 Jobs & health (`/admin/jobs`)

The four alarms of §B15.4, each a number that should be zero: outbox pending, stale job locks, unclosed
AI audit envelopes (`ix_aie_open`), search-index drift. Plus the dead-letter queue with a retry action.

An unread dead-letter queue is a dead-letter queue nobody reads.

---

## 15. Dark mode

Specified in §1.3. Two operational notes:

**What must be re-verified when the theme flips**, because a token that passes on white can fail on
`#22262B`:
1. every semantic colour as text (all three were failing before the lift),
2. `--on-primary` (the reason the naive remap breaks),
3. chart series against the plot background,
4. disabled-state text, which is `--ink-2` at 60% and is the easiest thing in the system to accidentally push below 4.5:1,
5. focus rings on `--panel`, not just on `--surface`.

**What must not change:** row height, radii, border widths, spacing, type scale, component vocabulary.
If a screenshot of dark mode has different *geometry* from light mode, the remap leaked into layout.

Electron's native title bar follows via `nativeTheme` + `color-scheme`.

---

## 16. Responsive

Desktop only. 1024px floor. The tunnel is for a laptop, not a phone.

| Width | Sidebar | Split | Notes |
|---|---|---|---|
| ≥1280 | 200px labelled | list + details pane | The design target |
| 1024–1279 | 56px icons, tooltips | list + details pane | Splitter min-width enforced |
| <1024 | 56px icons | **list only** | Selecting a row routes to a full-page detail |
| <768 | — | — | A blocking notice: `"يتطلب هذا التطبيق شاشة أوسع."` |

**Responsive here is structural, never fluid** (product register). No `clamp()` on type. Users view at
a consistent DPI, and a heading that shrinks inside a narrow pane looks broken, not adaptive.

The 1024 gate is Tailwind's `lg`, **not** Vuetify's `lgAndUp` (1280). Those two constants differ, and
mixing them puts the splitter in a state where neither pane has room.

---

## 17. Accessibility

WCAG 2.2 AA, and PRODUCT.md commits to it explicitly.

| Area | Requirement |
|---|---|
| **Contrast** | §0 and §1. Three failures found and fixed. Placeholders meet 4.5:1, not the muted default |
| **Non-text contrast** | `--border-strong` ≥3:1 for every interactive boundary and every state indicator (1.4.11) |
| **Keyboard** | Everything operable without a mouse. The DataGrid is a full roving-tabindex grid: `role="grid"`, `aria-rowindex`, `aria-selected`. §3.3 |
| **Focus** | Visible always, `:focus-visible`, 2px `--primary-text` ring + 1px offset. Never `outline: none` |
| **Focus order** | Follows DOM order. Dialogs trap and restore |
| **RTL** | Logical properties (`margin-inline-start`) everywhere. No `left`/`right`. Directional icons mirror; **numeric and clock icons do not** |
| **Numerals** | `font-variant-numeric: tabular-nums` on every money, count, percentage, date, and identifier |
| **Motion** | `prefers-reduced-motion: reduce` → instant or crossfade. Not optional |
| **Screen reader** | Live regions for toasts (`role="status"`) and for the SSE notification (`role="alert"` only for CRITICAL) |
| **Forms** | `<label for>`, `aria-invalid`, `aria-describedby` on the error. Errors announced |
| **Charts** | Every chart has an adjacent data table (`<details>` or a toggle). A canvas is invisible to a screen reader, and this is a financial number |
| **Zoom** | 200% without horizontal scroll on the content column |
| **Target size** | 24×24 minimum (2.2 AA). 26px rows satisfy it; a 16px icon button does not — pad to 24 |

**The RTL trap worth naming.** Mirroring *all* icons is wrong. A "next" chevron mirrors. A clock does
not. A chart's trend arrow does not. A checkmark does not. Mirror by meaning, not by reflex.

---

## 18. Motion

*"No unnecessary animations"* is the requirement, and the product register agrees: motion conveys
state, nothing else.

| Element | Duration | Curve |
|---|---|---|
| Dialog enter | 150ms | `ease-out-quart` |
| Toast enter/exit | 150ms | `ease-out-quart` |
| Details pane slide | 180ms | `ease-out-quart` |
| Row selection | 0ms | none. Instant |
| Hover | 100ms | `linear` on colour only |
| Chart draw | **0ms** | none |
| Skeleton shimmer | — | opacity pulse, disabled under reduced-motion |

No page transitions. No staggered list entrances. No orchestrated load sequence. No bounce, no elastic.
Never animate `width`, `height`, `top`, or `left` — `transform` and `opacity` only, and the details-pane
splitter uses `transform`.

**The bans that apply here**, from the register: decorative motion, and *"no orchestrated page-load
sequences. Product loads into a task; users don't want to watch it load."*

---

## 19. States

Every screen ships all five. Half of them is not a screen.

| State | Treatment |
|---|---|
| **Loading** | Skeleton rows in the grid's real geometry (26px, same columns). **Never a centred spinner** — it destroys the workspace shape DESIGN.md requires be preserved |
| **Empty (no data yet)** | Teaches the interface: what this screen is for, one primary action. `EmptyState.vue` |
| **Empty (filters excluded everything)** | Different copy, and a `[مسح المرشحات]` button. Confusing these two is a classic |
| **Error** | `ErrorState.vue`, keyed on `code`, with `retryable` deciding whether a retry button exists |
| **Insufficient** | §10.1. The number is absent; the remedy is present |
| **Offline / stale** | An inline caption, not a modal. `"غير متصل منذ ٣ أيام. الأرقام محدّثة حتى ٦ يوليو."` (§X9) |
| **Queued, not sent** | §X9: a queued message shows `"بانتظار الإرسال"`, never a green tick. A queued message is not a sent message |

---

## 20. Performance

| Budget | Target | Mechanism |
|---|---|---|
| Cold start (Electron → interactive) | <1.5s | Route-level code splitting; charts lazy |
| Route change | <100ms | Prefetch on nav hover |
| Grid scroll | 60fps at 10k rows | Virtual scroll (shipped) |
| Keystroke → cell update | <16ms | No reactive `computed` over the whole dataset |
| Bundle | <300KB gz initial | `@mdi/js` tree-shaken SVG icons (shipped); ApexCharts lazy (shipped) |
| Fonts | 0 network | Self-hosted IBM Plex Sans Arabic via `@fontsource` (shipped) |

**Known gotcha, recorded:** editing `vite.config` can unmask a latent dual-vite install; a clean
reinstall fixes it.

**No client-side money math.** It is a correctness rule, and it is also why the grid is fast: rows
render strings.

---

## 21. Pre-flight audit

DESIGN.md's checklist, run against this specification:

| Check | Result |
|---|---|
| One light desktop theme only | ⚠️ **Amended by your decision.** Two themes, one geometry (§1.3). DESIGN.md must be updated |
| Every visual colour from the approved palette | ⚠️ **Two additions**: `--accent-text` (fixes F1), `--border-strong` (fixes F2). Plus the `viz-*` ramp for charts (§1.5), which the palette never covered |
| No gradients, backdrop blur, or glass | ✅ |
| All radii 3/5/7px | ✅ |
| Structure via 1px rules, not elevation | ✅ |
| Main data in a dense table or property grid | ✅ |
| Frame regions always visible | ✅ |
| Primary action text has sufficient contrast | ✅ **now** — `--on-primary` is a token, and dark's value is `#1A1D21` |
| No em dash in user-facing strings | ✅ Every Arabic string in this document uses `·` or a full stop |

---

## 22. Decisions

Resolved this turn:

- ✅ **Dark mode ships**, as a token remap. DESIGN.md's theme lock is rewritten: *two themes, one geometry.*
- ✅ **Desktop only, 1024px floor.** No phone layout.
- ✅ **Specification, not code.**

Needing your sign-off:

| # | Decision | My call |
|---|---|---|
| 1 | **`--accent #B7791F` is fills-only from now on; amber text is `#96620F`** | Not negotiable. 3.64:1 fails AA, and it lands on overdue amounts |
| 2 | **`--border` splits into `--rule` and `--border-strong`** | Yes. One token cannot be both a decorative hairline and a control boundary |
| 3 | **`--on-primary` becomes a token; dark primary buttons have dark text** | Forced by arithmetic (§1.3). No single blue satisfies both constraints |
| 4 | **A `viz-*` ramp is added for charts only** | DESIGN.md's "no other colour family" was written for chrome and never tested against a five-series chart |
| 5 | Selection is fill + full 1px border + `aria-selected`, never a side stripe | Side stripes are a banned pattern, and the dark fill alone is 1.31:1 |
| 6 | Missing-data prompts get a separate surface from financial recommendations | §11.4 |
| 7 | Toasts never carry system events; notifications never carry your own saves | §9.3 |
| 8 | Charts always ship an adjacent data table | A canvas is invisible to a screen reader, and this is money |

**And one that needs a person, not a decision.** `--success #2F855A` passes at **4.54:1**, with 0.04 to
spare. It is correct today and will fail the first time someone nudges it. Either lock it with a
contrast test in CI, or darken it now while nobody has learned the exact hue.

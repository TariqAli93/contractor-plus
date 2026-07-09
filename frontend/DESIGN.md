---
name: Contractor Plus
description: A native-desktop instrument for construction-contractor money and project management, Arabic/RTL.
colors:
  ledger-blue: "#1E5F8C"
  ledger-blue-soft: "#EAF2F9"
  ochre-flag: "#D97706"
  slate-secondary: "#37474F"
  success: "#16A34A"
  success-soft: "#E7F6EC"
  warning: "#F59E0B"
  warning-soft: "#FEF3E1"
  error: "#DC2626"
  error-soft: "#FDECEC"
  info: "#0284C7"
  bg: "#F6F8FB"
  bg-soft: "#EEF2F7"
  surface: "#FFFFFF"
  surface-2: "#FAFBFD"
  border: "#E3E8EF"
  border-strong: "#CBD5E1"
  ink: "#0F172A"
  ink-muted: "#64748B"
  ink-subtle: "#94A3B8"
typography:
  metric:
    fontFamily: "Segoe UI, Tahoma, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Segoe UI, Tahoma, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Segoe UI, Tahoma, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Segoe UI, Tahoma, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  eyebrow:
    fontFamily: "Segoe UI, Tahoma, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "0.7rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.08em"
  mono:
    fontFamily: "ui-monospace, Consolas, SFMono-Regular, Menlo, monospace"
    fontSize: "0.78rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "3px"
  md: "5px"
  lg: "7px"
  xl: "10px"
  pill: "999px"
spacing:
  topbar: "42px"
  statusbar: "24px"
  row: "30px"
components:
  button-primary:
    backgroundColor: "{colors.ledger-blue}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "28px"
  button-primary-hover:
    backgroundColor: "#1A5379"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  nav-item-active:
    backgroundColor: "{colors.ledger-blue-soft}"
    textColor: "{colors.ledger-blue}"
    rounded: "{rounded.sm}"
  chip:
    backgroundColor: "{colors.bg-soft}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.sm}"
    size: "small"
---

# Design System: Contractor Plus

## 1. Overview

**Creative North Star: "The Ledger Instrument"**

Contractor Plus is a precise desktop instrument for tracking money and work — not a web app that happens to run on a desktop. Its surface is built like a well-kept ledger: dense, tabular, hairline-ruled, with quiet chrome so the data is always the hero. Two people share it — a non-technical contractor owner checking where the money stands, and office staff living in the keyboard all day — so it must read as calm and unintimidating at a glance while staying tight and fast under the fingers. Every screen is a workspace, not a page.

The visual language is deliberately **native-desktop business software**, rendered through Electron but never *looking* like a browser. Structure comes from 1px hairline borders and tonal surface layering, not floating cards and drop shadows. Corners are low and crisp (3–7px) like native window controls. The top bar is opaque and flat; a thin bottom status strip reports connection, context, and time. Type is a single UI family led by Segoe UI for a genuine Windows feel, tuned tight, with tabular numerals wherever figures appear.

This system explicitly **rejects two opposites**. It is not *sterile enterprise gray* — dense is the goal, but density must keep clear hierarchy, a real accent, and breathing room where it counts; no dead SAP/legacy-ERP screens. And it is not *consumer web-app fluff* — no big rounded cards, roomy padding, decorative gradients, marketing hero sections, mascots, confetti, or dark-glass "AI product" styling. It's Arabic-first and RTL by default: layout is authored in logical properties, figures are tabular, directional cues mirror.

**Key Characteristics:**
- Native-desktop density: hairline borders, low radii, opaque flat toolbars, a bottom status bar.
- One quiet UI type family, tuned tight, with tabular numerals for money and metrics.
- Calm blue chrome; a rare burnt-amber accent that only marks what needs attention.
- Flat by default — shadows appear only on genuinely floating layers (menus, dialogs).
- Keyboard-first, RTL-first, AA-contrast, reduced-motion aware.

## 2. Colors

A calm, authoritative palette: a deep muted blue carries the chrome, a rare burnt amber flags attention, and a cool near-white slate ramp does the structural work. Semantic greens/ambers/reds are reserved for state.

### Primary
- **Ledger Blue** (#1E5F8C): The chrome and command color — sidebar active state, primary buttons, links, focus rings, selected rows, key iconography. Authoritative but muted; never neon. Paired with **Ledger Blue Soft** (#EAF2F9) for active-nav and selected backgrounds and soft icon tiles.

### Secondary
- **Slate Secondary** (#37474F): A cool dark slate for secondary emphasis and muted chrome accents. Used sparingly; most neutrals come from the Neutral ramp below.

### Tertiary
- **Ochre Flag** (#D97706): A burnt amber/ochre reserved as an attention flag — the one element on a screen that needs the eye (a pending action, an alert CTA, a highlighted total). Warm counterweight to all the blue. Its rarity is the entire point.

### Neutral
- **Ink** (#0F172A): Primary text. Hits AA on all surfaces.
- **Ink Muted** (#64748B): Secondary text, labels, captions — AA on white and bg.
- **Ink Subtle** (#94A3B8): Tertiary hints, disabled, placeholder edges (use full Ink Muted for real placeholders to keep 4.5:1).
- **Background** (#F6F8FB) / **Background Soft** (#EEF2F7): The workspace canvas and its recessed zones.
- **Surface** (#FFFFFF) / **Surface 2** (#FAFBFD): Panels, cards, toolbars, and their subtle inner layer.
- **Border** (#E3E8EF) / **Border Strong** (#CBD5E1): Hairline structure and its hover/emphasis step.

### State
- **Success** (#16A34A / soft #E7F6EC), **Warning** (#F59E0B / soft #FEF3E1), **Error** (#DC2626 / soft #FDECEC), **Info** (#0284C7). Soft variants back status chips and inline banners; solid variants carry text/icons and orbs.

### Dark theme
A slate dark theme (`contractorPlusDark`) mirrors every role — Ledger Blue lightens to #4F9BD0, surfaces are slate (#0F172A bg / #1E293B surface, never pure black), state colors lighten for contrast, and the `--cp-*` custom properties re-theme all non-Vuetify chrome. Both themes must clear AA.

### Named Rules
**The Ochre Flag Rule.** The amber accent (#D97706) is never decoration. It appears only to flag the one thing on a screen that needs attention. If two things are amber, one is wrong.

**The Blue-Is-Chrome Rule.** Ledger Blue owns navigation, primary actions, selection, and focus — never body backgrounds or large fills. Chrome is calm; the data carries the screen.

## 3. Typography

**UI Font:** Segoe UI (with Tahoma → IBM Plex Sans Arabic → system-ui fallback)

**Character:** One family, no display/body pairing. Segoe UI leads so the app renders as a native Windows program (its Arabic coverage is the "desktop program, not web app" cue); Tahoma covers older Windows; the self-hosted IBM Plex Sans Arabic is the cross-platform fallback. The scale is tight and functional, tuned for a fixed-DPI desktop workspace — fixed rem sizes, never fluid clamps. `font-feature-settings: 'cv11','ss01'` and antialiasing are on app-wide.

### Hierarchy
- **Metric** (600, 1.625rem/26px, line-height 1.15, -0.02em): Big financial figures and dashboard totals. Tabular numerals mandatory.
- **Title** (600, 0.95rem/~15px, line-height 1.3, -0.005em): Section and panel titles.
- **Body** (400, 0.875rem/14px, line-height 1.5): Default reading text, dialog bodies, descriptions. Prose caps at 65–75ch; dense tables may run wider.
- **Label** (500, 0.8rem/~13px): Buttons, nav items, form labels, toolbar text.
- **Eyebrow / Group label** (600–700, 0.64–0.7rem, +0.08em, uppercase): Sparse section kickers and sidebar group headings only — a quiet organizing device, not a decoration on every block.

### Named Rules
**The One Family Rule.** No display font, no second family. Hierarchy comes from size and weight within Segoe UI. A display or decorative face in a label, button, or figure is prohibited. The single exception is `--cp-font-mono`, used *only* for literal machine tokens the user copies verbatim (DOCX placeholders, generated credentials) — never for label, body, or figure text.

**The Tabular Numerals Rule.** Every money value, metric, count, and clock uses `font-variant-numeric: tabular-nums` so columns align and figures don't jitter as they update.

## 4. Elevation

Flat by default. Desktop chrome is defined by **hairline 1px borders and tonal surface layering**, not float. Shadows are reserved for layers that genuinely float above the workspace (menus, dialogs, tooltips) and are kept shallow so panels sit flat against the canvas. The top bar and status bar carry no shadow at all — only a single hairline rule. Depth reads as *material stacking* (bg → surface → surface-2), not as blur-and-lift.

### Shadow Vocabulary
- **xs** (`0 1px 0 rgba(15,23,42,0.03)`): Barely-there seat under a resting panel.
- **sm** (`0 1px 2px rgba(15,23,42,0.06)`): Elevated cards and the panel default.
- **md** (`0 2px 8px -2px rgba(15,23,42,0.12)`): Panel hover, low popovers.
- **lg** (`0 8px 24px -6px rgba(15,23,42,0.18)`): Dialogs and true overlays.

Dark theme deepens each step with layered black shadows since hairlines read less on slate.

### Named Rules
**The Hairline Rule.** Structure is drawn with 1px borders (#E3E8EF), not shadows. If a boundary needs emphasis, step the border to Border Strong (#CBD5E1) — do not add a shadow to a non-floating element.

## 5. Components

### Buttons
- **Shape:** Low radius (`3px`, `--cp-radius-sm`). Small size by default (Vuetify `size="small"`, `variant="flat"`).
- **Primary:** Ledger Blue fill, white text, ~28px tall in toolbars, tight horizontal gutters. The default committed action.
- **Toolbar buttons:** Packed tightly (min-width 0, 8px inline padding, 28–30px), grouped by thin vertical rules (`.cp-toolbar-sep`) like a native ribbon.
- **Hover / Focus:** Subtle darken on hover; a visible `2px` Ledger Blue focus-visible outline (offset -2px) — keyboard operability is required, never remove the focus ring.
- **Secondary / Ghost:** Outlined or text variants in Ink Muted for lower-priority actions; one save button shape across the whole app.

### Inputs / Fields
- **Style:** `variant="outlined"`, `density="compact"`, `3px` radius. Hairline border, white surface.
- **Focus:** Border shifts to Ledger Blue; no glow. Compact vertical rhythm for fast entry.
- **Error / Disabled:** Error border/text in #DC2626; disabled drops to Ink Subtle. Enter-to-save is a first-class pattern.

### Cards / Panels
- **Corner Style:** Cards `5px` (`--cp-radius-md`); reusable `.cp-panel` primitive `7px` (`--cp-radius-lg`).
- **Background / Border:** White surface, hairline Border. Outlined cards soften Vuetify's hard border to #E3E8EF.
- **Shadow Strategy:** Flat (xs) at rest; `.cp-panel-hover` lifts to md and steps the border to Border Strong on hover. Never nested cards.
- **Internal Padding:** ~16px; dialogs run tighter (10–12px) for desktop density.

### Navigation (sidebar `.cp-nav`)
- **Style:** Compact list, `0.8rem` labels, 28px min-height, `3px` radius, small margins. Group labels are uppercase Ink Subtle micro-headings, hidden when the drawer is rail-collapsed.
- **Default / Hover:** Flat; hover fills Surface 2.
- **Active:** Ledger Blue Soft background, Ledger Blue text (600), plus a `3px` Ledger Blue accent rail on the inline-start edge (logical inset, RTL-correct) — the classic desktop active-item marker.

### Top bar & Status bar
- **Top bar** (`.cp-topbar`, 42px): Opaque Surface, hairline bottom border, **no glass blur, no shadow** — a real application toolbar.
- **Status bar** (`.cp-statusbar`, 24px): Bottom strip found in every desktop business app — connection state, context, clock. Small (0.72rem) dense items separated by hairline rules; tabular where numeric.

### Signature components
- **DataGrid** (`shared/datagrid/`): The Excel-like keystone — in-cell edit, keyboard nav, paste-from-Excel, multi-delete, sort/filter, pinned/resizable columns, CSV export/import, virtual scroll. Hairline grid lines, `30px` rows, tabular figures. This is the heart of the keyboard-first, entry-fast promise.
- **Icon tile** (`.cp-icon-tile`, 36px): Soft-tinted rounded square (Ledger Blue Soft / success / warning / error / neutral) holding an entity or metric icon.
- **Status orb** (`.cp-orb`, 10px): Connection/health dot with an optional pulsing ring (`cp-pulse`) for live tunnel/service state.

## 6. Do's and Don'ts

### Do:
- **Do** define structure with 1px hairline borders (#E3E8EF) and tonal layering; reserve shadows for floating layers only (The Hairline Rule).
- **Do** keep the amber accent (#D97706) rare — one attention flag per screen (The Ochre Flag Rule).
- **Do** use `tabular-nums` on every money value, metric, count, and clock.
- **Do** use one UI family (Segoe UI stack); build hierarchy with size/weight, not new fonts.
- **Do** keep radii low and crisp (3–7px), density compact, and forms Enter-to-save and fully keyboard-operable with a visible Ledger Blue focus ring. `pill` (999px) is reserved for genuinely round chrome — status orbs and icon halos — never for panels, cards, or bubbles.
- **Do** author in logical properties (inline-start/end) so Arabic RTL is correct by default; verify AA contrast in both light and dark themes.
- **Do** honor `prefers-reduced-motion`; keep transitions 90–220ms and state-conveying only.

### Don't:
- **Don't** ship *sterile enterprise gray* — dense is fine, but never gray-on-gray with no hierarchy, no accent, and dead screens (SAP/legacy-ERP look).
- **Don't** ship *consumer web-app fluff* — no big rounded cards, roomy padding, decorative gradients, marketing hero sections, or illustrated flourishes. This is a desktop tool, not a SaaS landing page.
- **Don't** use toy/gamified touches (mascots, confetti, celebratory animation, candy color) or the dark-glass "AI product" aesthetic (glassmorphism, neon gradients, purple-black).
- **Don't** use `background-clip: text` gradient text, or a `border-left`/`border-right` greater than 1px as a colored stripe on cards, callouts, or alerts. (The sidebar's `3px` active rail is the one sanctioned exception — it's the native desktop active-item marker, not a card accent.)
- **Don't** add glass/blur to the top bar or any non-floating chrome — desktop toolbars are opaque and flat.
- **Don't** reach for a modal first, invent non-standard controls, or let a "save" button look different in two places. Consistency is the virtue here.

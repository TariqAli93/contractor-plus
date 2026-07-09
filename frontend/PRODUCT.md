# Product

## Register

product

## Platform

web

<!-- Electron renders the Vue SPA as HTML/CSS, so the impeccable platform is `web`.
     But the intended *design language* is native-desktop business software (dense,
     hairline-bordered, low-radius, opaque toolbars + bottom status bar), NOT a roomy
     web dashboard. Treat Windows-desktop conventions as a design constraint — see
     Design Principles. -->

## Users

A **mixed team inside a single construction-contractor business**, working in Arabic (RTL) on a Windows desktop:

- **The contractor owner** — often non-technical. Wants to know where the money is: cash flow, profitability, overdue payments, delayed projects. Sits down to check status and approve work, not to do data entry.
- **Office / accounting staff** — do the daily entry: costs, payments, contracts, projects, materials. Faster and more technical, in the app all day, live by the keyboard.

Access is **role-scoped (RBAC, ~60 permission keys, OWNER is super-admin)**, so any given screen must serve a range of expertise levels — approachable enough for the owner, dense and fast enough for staff. The whole workflow (customers → building templates → contracts → projects → costs/payments → reports → contract documents) runs on **one Windows machine**; the backend is a local Windows Service, the tunnel is optional.

## Product Purpose

Contractor Plus runs the full **money-and-progress lifecycle** for a construction contractor in one place. It turns reusable cost/step **building templates** into **contracts**, converts approved contracts into **projects**, tracks construction steps and progress, logs **costs and payments**, and surfaces **cash flow, profitability, overdue amounts, and delays** in reports — then generates the contract DOCX from templates. An AI assistant sits alongside to answer questions and drive commands. Success = the contractor always knows their financial and project standing, and staff can keep the books current without friction. This is a contractor/project system, not a store — no products/inventory/POS.

## Brand Personality

**Solid, precise, quiet.** A dependable instrument, not a product with a personality to perform. The voice is plain, exact, and Arabic-first; numbers are trustworthy and precise (real decimal money math, tabular figures). It should feel like a serious business tool that a contractor and their staff rely on every day — understated, never shouting, never gimmicky. Emotional goals, in order: **in control** (nothing slips through), **fast/efficient** (data-dense, keyboard-first, gets out of the way), and **at ease** (a non-technical owner is never intimidated).

## Anti-references

- **Sterile enterprise gray.** The SAP / legacy-ERP look: cold gray-on-gray, no hierarchy, dead screens. Dense is the goal; lifeless is not. Density must still have clear hierarchy, a real accent, and breathing room where it counts.
- **Consumer web-app fluff.** Big rounded cards, roomy padding, decorative gradients, marketing-style hero sections, playful illustrations. This is a desktop business tool, not a SaaS landing page.
- Also off-limits: toy/gamified touches (mascots, confetti, candy color) and the trendy dark-glass "AI product" aesthetic (glassmorphism, neon gradients, purple-black).

## Design Principles

- **The tool disappears into the task.** Earned familiarity over novelty. Standard affordances, one consistent component vocabulary screen-to-screen, no invented controls. If a save button looks different in two places, one is wrong.
- **Native-desktop density, not web roominess.** Hairline borders define structure (shadows only for genuinely floating layers), low crisp radii, opaque flat toolbars, a bottom status bar, tight rows. The screen is a workspace, not a page.
- **Numbers you can trust at a glance.** Money and metrics are precise, tabular, and legible; hierarchy makes the important figure obvious. Financial accuracy is a design value, not just a backend one.
- **Keyboard-first, entry-fast.** Staff live in the keyboard: shortcuts, Enter-to-save, paste-from-Excel grids, command palette. Every flow should be completable without reaching for the mouse.
- **Calm under density.** Approachable for the non-technical owner even while dense for staff — clear labels, honest empty/error states, progressive disclosure of advanced options. Density earns its keep only when hierarchy stays legible.

## Accessibility & Inclusion

- **WCAG AA contrast** for all text and UI, verified in **both light and dark themes** (placeholder and muted text included — no light-gray-on-tinted-white).
- **Full keyboard operability** — everything reachable and operable by keyboard, with visible focus states; critical for fast data entry.
- **RTL-first correctness** — Arabic RTL is the primary layout: logical CSS properties (inline-start/end), mirrored directional icons where needed, tabular numerals for figures.
- **Reduced-motion support** — honor `prefers-reduced-motion`; animations degrade to instant or crossfade. Motion conveys state (150–250 ms), never decoration.

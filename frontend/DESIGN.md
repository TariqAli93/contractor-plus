---
name: Contractor Plus
description: Arabic RTL desktop software for contractor operations, money, and project control.
colors:
  background: "#F3F5F7"
  surface: "#FFFFFF"
  panel: "#E9EEF3"
  primary: "#234E70"
  primary-hover: "#1C3F5A"
  accent: "#B7791F"
  success: "#2F855A"
  danger: "#C53030"
  warning: "#B7791F"
  text-primary: "#1A202C"
  text-secondary: "#4A5568"
  border: "#CBD5E0"
  table-header: "#E2E8F0"
  selected-row: "#D9EAF7"
typography:
  fontFamily: "Segoe UI, Tahoma, IBM Plex Sans Arabic, system-ui, sans-serif"
  body: "0.875rem"
  label: "0.78rem"
  title: "0.95rem"
  metric: "1.625rem"
rounded:
  sm: "3px"
  md: "5px"
  lg: "7px"
---

# Design System: Contractor Plus

## Product direction

Contractor Plus is a dense Windows business application. Its interface is a working ledger, not a web page. The user should find a fixed application frame, compact commands, tables, property panes, and persistent operational context on every primary screen.

The approved visual direction is Desktop ERP with Fluent and Windows business-software cues. It uses a single light theme. Dark mode, gradients, glass surfaces, landing-page layouts, marketing CTAs, oversized cards, and decorative illustration are not part of the product language.

## Theme lock

Only one theme is permitted. The application uses the following roles exactly:

| Role | Value | Use |
| --- | --- | --- |
| Background | `#F3F5F7` | Workspace canvas |
| Surface | `#FFFFFF` | Panes, menus, dialogs, inputs |
| Panel | `#E9EEF3` | Toolbars, side regions, passive bands |
| Primary | `#234E70` | Primary commands, navigation, focus |
| Primary hover | `#1C3F5A` | Pressed and hover primary command |
| Accent and warning | `#B7791F` | Limited attention state only |
| Success | `#2F855A` | Confirmed and healthy states |
| Danger | `#C53030` | Errors, overdue, destructive actions |
| Text primary | `#1A202C` | Main content |
| Text secondary | `#4A5568` | Labels and supporting context |
| Border | `#CBD5E0` | All structural 1px rules |
| Table header | `#E2E8F0` | Dense table headers |
| Selected row | `#D9EAF7` | Selected records and active item fills |

No other color family is introduced. Semantic colors are reserved for actual state. Amber does not decorate ordinary controls.

## Application frame

The standard desktop frame has five durable regions:

1. Title bar: application and current workspace.
2. Menu bar: File, Edit, View, Tools, Reports, Help.
3. Compact command bar: one primary create command plus search and utilities.
4. Docked sidebar and main workspace: section navigation, workspace tabs or split panes, and the document surface.
5. Status bar: service, database, branch, current user, license, backup state, time, and version.

Chrome uses opaque surfaces and 1px rules. It never floats above content. Menus and dialogs are the only surfaces allowed a light shadow.

## Layout and density

Visual density is 9 out of 10. Page titles stay small. Filters remain in a single compact toolbar directly above the table. The main record index takes the central area. A selected record is shown in a docked details pane at inline end, with a draggable splitter and a hairline property grid.

Use a 6px workspace gutter. Use 26px data rows and 28px table headers. Controls are normally 28px high. Keep whitespace for boundaries and readability, not as page decoration.

## Shape and elevation

The radius scale is locked:

- 3px: buttons, inputs, chips, active nav items
- 5px: panes, tables, dialogs, property sheets
- 7px: exceptional larger contained surfaces only

All boundaries use 1px borders. Regular panels are flat. Menus and dialogs may use a restrained shadow based on the text-primary color. There are no pills, large rounded cards, blurred backgrounds, or gradients.

## Typography and numbers

Use the Segoe UI stack throughout. Arabic remains RTL-first and all directional layout uses logical CSS properties. The UI has one type family and relies on size and weight rather than display typography.

Money, counts, percentages, dates, times, and identifiers use tabular numerals. Table headers are small and quiet. Labels appear above inputs. A placeholder never replaces a label. Primary text and input labels must meet AA contrast on their surface.

## Component rules

### Commands and inputs

Primary buttons use Primary with white text. Secondary commands are outlined or text controls. Keep command groups separated by 1px rules in the command bar. Inputs use white surface, 1px border, 3px radius, and a visible Primary focus outline.

### Tables

Tables are the primary content surface. Use Table Header for `thead`, Border for row and column structure where needed, 26px body rows, and Selected Row for the current record. Amounts align to inline end and use tabular numerals. Do not replace record indexes with cards.

### Panels and details

Panels are opaque Surface with Border. Headers use Panel or Table Header and a single divider. Details panes show label/value properties in a ruled grid. Avoid nested cards and decorative status strips.

### Statuses

Use Success for confirmed states, Danger for failure or overdue states, and Accent for an attention state. Do not give every row a colored badge. The color must communicate a real state.

## Screen pattern

Every primary workspace follows this sequence:

1. Small page header and local command.
2. Compact filter bar.
3. Dense data table or report index.
4. Docked detail panel when a record is selected.
5. Inline loading, empty, and error states that preserve the workspace shape.

Dashboard is the exception only in that it begins with a compact financial summary. It still uses ruled panels, small metric blocks, tables, and operational lists rather than an oversized web dashboard.

## Pre-flight audit

Before shipping a screen, verify:

- One light desktop theme only.
- Every visual color is from the approved palette.
- No gradients, backdrop blur, or glass effect.
- All boxed radii are 3px, 5px, or 7px.
- Structure is expressed through 1px rules, not card elevation.
- Main operational data is in a dense table or property grid.
- Title bar, menu bar, command bar, sidebar, and status bar remain visible in the app shell.
- Primary action text has sufficient contrast.
- No em dash is visible in user-facing strings.

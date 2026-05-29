# @contractor-plus/shared

Shared TypeScript contracts consumed by both `apps/frontend` and `apps/backend`.

## What lives here

Stable, framework-free contracts only:

- API response/error payload shapes
- Pagination types
- Auth roles
- Domain enums that mirror the Prisma schema (DRAFT/APPROVED, PENDING/PAID, etc.)

## What does NOT live here

- Business logic, services, repositories
- DTO interfaces tied to a specific module (customers, contracts, projects, payments, costs, reports — these stay in each app for now)
- Zod schemas or other runtime validators
- Prisma model types (`@prisma/client` is a backend-only dependency)
- UI components

## How it is built and consumed

This is a **built** package. Source in `src/`, compiled JS + `.d.ts` in `dist/`.

- `pnpm --filter @contractor-plus/shared build` — clean + emit `dist/`
- `pnpm --filter @contractor-plus/shared dev` — `tsc --watch`, used by the root `dev` script
- Consumers import via standard node resolution (`@contractor-plus/shared` → `dist/index.js`); there is no tsconfig `paths` shortcut into `src/`.
- `dist/` must exist before backend/frontend run `typecheck`, `build`, or `dev`. The root scripts (`pnpm dev`, `pnpm typecheck`, `pnpm build:backend`, `pnpm build:frontend`) build it first.

## Prisma enum drift

`apps/backend/src/shared/types/prisma-enum-guard.ts` asserts at compile time that every shared enum (RoleName, ContractStatus, ProjectStatus, PaymentStatus, PaymentMethod, CostCategory, AuditAction, ConstructionStepStatus, TunnelStatus) matches its `@prisma/client` counterpart. If a Prisma enum gains or loses a member, the backend `typecheck` fails until the shared mirror is updated.

## Usage

```ts
import {
  ContractStatus,
  PaymentStatus,
  RoleName,
  type ApiErrorPayload,
  type Paginated,
  type PaginationQuery,
} from '@contractor-plus/shared';
```

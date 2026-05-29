// Backend RBAC role groups. Canonical RoleName + ROLE_GROUPS live in
// @contractor-plus/shared; this file re-exports them under the names this
// app already uses. Prisma enum compatibility is guarded at compile time in
// ../types/prisma-enum-guard.ts.
import { ROLE_GROUPS, RoleName } from '@contractor-plus/shared';

export { RoleName };
export const ROLES = ROLE_GROUPS;

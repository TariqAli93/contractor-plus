// ============================================================
// Aggregated AI-tool permissions for the RBAC catalog.
//
// Every tool owns its own permission definitions; this is the union the RBAC
// catalog merges in, so a tool can never declare a permission the catalog is
// unaware of (which would break seeding / the OWNER super-set). It mirrors what
// the runtime `ToolRegistry.contributedPermissions()` yields, but is assembled
// from the tools' lightweight, service-free permission modules — so the catalog
// consumes it WITHOUT importing the tool registry (that would pull the whole
// service graph and create an import cycle through AccessService → rbac.catalog).
//
// Adding a tool = add its `*.permissions.ts` module to this list.
// ============================================================

import type { PermissionDef } from '../../rbac/rbac.catalog.js';
import { ESTIMATION_PERMISSIONS } from './estimation/estimation.permissions.js';

export const TOOL_CONTRIBUTED_PERMISSIONS: PermissionDef[] = [...ESTIMATION_PERMISSIONS];

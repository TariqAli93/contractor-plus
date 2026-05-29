// Compile-time guard that asserts the string-union enums published by
// @contractor-plus/shared remain exactly in sync with the Prisma-generated
// enums. If a Prisma enum gains or loses a member, this file fails to compile,
// and the shared enum must be updated to match.
//
// Pure type-level — emits nothing at runtime.

import type {
  AuditAction as PrismaAuditAction,
  ConstructionStepStatus as PrismaConstructionStepStatus,
  ContractStatus as PrismaContractStatus,
  CostCategory as PrismaCostCategory,
  PaymentMethod as PrismaPaymentMethod,
  PaymentStatus as PrismaPaymentStatus,
  ProjectStatus as PrismaProjectStatus,
  RoleName as PrismaRoleName,
} from '@prisma/client';

import type {
  AuditAction as SharedAuditAction,
  ConstructionStepStatus as SharedConstructionStepStatus,
  ContractStatus as SharedContractStatus,
  CostCategory as SharedCostCategory,
  PaymentMethod as SharedPaymentMethod,
  PaymentStatus as SharedPaymentStatus,
  ProjectStatus as SharedProjectStatus,
  RoleName as SharedRoleName,
} from '@contractor-plus/shared';

type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// Each line below must resolve to `true`. Any `never` is a drift between
// Prisma's schema and the shared enum mirror — fix the shared enum.
const _roleName: AssertEqual<PrismaRoleName, SharedRoleName> = true;
const _contractStatus: AssertEqual<PrismaContractStatus, SharedContractStatus> = true;
const _projectStatus: AssertEqual<PrismaProjectStatus, SharedProjectStatus> = true;
const _paymentStatus: AssertEqual<PrismaPaymentStatus, SharedPaymentStatus> = true;
const _paymentMethod: AssertEqual<PrismaPaymentMethod, SharedPaymentMethod> = true;
const _costCategory: AssertEqual<PrismaCostCategory, SharedCostCategory> = true;
const _auditAction: AssertEqual<PrismaAuditAction, SharedAuditAction> = true;
const _constructionStepStatus: AssertEqual<
  PrismaConstructionStepStatus,
  SharedConstructionStepStatus
> = true;

// Silence unused-locals — the assertions above already do the type work.
void [
  _roleName,
  _contractStatus,
  _projectStatus,
  _paymentStatus,
  _paymentMethod,
  _costCategory,
  _auditAction,
  _constructionStepStatus,
];

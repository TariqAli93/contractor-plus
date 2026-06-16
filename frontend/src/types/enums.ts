// Canonical enums live in @contractor-plus/shared. This file re-exports them
// so existing local imports (`@/types/enums`) keep working without churn.
export {
  AuditAction,
  ConstructionStepStatus,
  ContractStatus,
  CostCategory,
  PaymentMethod,
  PaymentStatus,
  ProjectStatus,
  RoleName,
} from '@contractor-plus/shared';

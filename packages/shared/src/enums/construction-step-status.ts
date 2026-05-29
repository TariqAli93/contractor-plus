export const ConstructionStepStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  SKIPPED: 'SKIPPED',
} as const;
export type ConstructionStepStatus =
  (typeof ConstructionStepStatus)[keyof typeof ConstructionStepStatus];

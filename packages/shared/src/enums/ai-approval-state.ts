export const AiApprovalState = {
  NONE: 'NONE',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type AiApprovalState = (typeof AiApprovalState)[keyof typeof AiApprovalState];

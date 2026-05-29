export const ContractStatus = {
  DRAFT: 'DRAFT',
  APPROVED: 'APPROVED',
  CANCELLED: 'CANCELLED',
} as const;
export type ContractStatus = (typeof ContractStatus)[keyof typeof ContractStatus];

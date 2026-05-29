export const CostCategory = {
  MATERIAL: 'MATERIAL',
  LABOR: 'LABOR',
  MACHINERY: 'MACHINERY',
  TRANSPORT: 'TRANSPORT',
  MISC: 'MISC',
} as const;
export type CostCategory = (typeof CostCategory)[keyof typeof CostCategory];

export const RoleName = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  ACCOUNTANT: 'ACCOUNTANT',
  ENGINEER: 'ENGINEER',
  VIEWER: 'VIEWER',
} as const;
export type RoleName = (typeof RoleName)[keyof typeof RoleName];

export const ROLE_GROUPS = {
  ALL: [
    RoleName.OWNER,
    RoleName.ADMIN,
    RoleName.ACCOUNTANT,
    RoleName.ENGINEER,
    RoleName.VIEWER,
  ] as const,
  MANAGEMENT: [RoleName.OWNER, RoleName.ADMIN] as const,
  FINANCE: [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT] as const,
  OPERATIONS: [RoleName.OWNER, RoleName.ADMIN, RoleName.ENGINEER] as const,
} as const;

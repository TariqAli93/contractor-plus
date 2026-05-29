import type { AuditAction, AuditLog, User } from '@prisma/client';

export type AuditLogWithUser = AuditLog & {
  user: Pick<User, 'id' | 'email' | 'fullName'> | null;
};

export interface AuditLogListArgs {
  entity?: string;
  entityId?: string;
  action?: AuditAction;
  userId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  skip: number;
  take: number;
  sortDir: 'asc' | 'desc';
}

export interface AuditLogFilter {
  entity?: string;
  entityId?: string;
  action?: AuditAction;
  userId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface EntityHistoryArgs {
  entity: string;
  entityId: string;
  skip: number;
  take: number;
  sortDir: 'asc' | 'desc';
}

export interface UserHistoryArgs {
  userId: string;
  entity?: string;
  action?: AuditAction;
  dateFrom?: Date;
  dateTo?: Date;
  skip: number;
  take: number;
  sortDir: 'asc' | 'desc';
}

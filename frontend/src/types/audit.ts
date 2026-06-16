import type { AuditAction } from './enums';

export interface AuditUserRef {
  id: string;
  email: string;
  fullName: string;
}

export interface AuditLog {
  id: string;
  userId: string | null;
  user: AuditUserRef | null;
  action: AuditAction;
  entity: string;
  entityId: string;
  oldValues: unknown;
  newValues: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface ListAuditLogsQuery {
  page?: number;
  pageSize?: number;
  entity?: string;
  entityId?: string;
  action?: AuditAction;
  userId?: string;
  dateFrom?: string | Date;
  dateTo?: string | Date;
  sortBy?: 'createdAt';
  sortDir?: 'asc' | 'desc';
}

export interface EntityHistoryQuery {
  page?: number;
  pageSize?: number;
  sortBy?: 'createdAt';
  sortDir?: 'asc' | 'desc';
}

export interface UserHistoryQuery {
  page?: number;
  pageSize?: number;
  entity?: string;
  action?: AuditAction;
  dateFrom?: string | Date;
  dateTo?: string | Date;
  sortBy?: 'createdAt';
  sortDir?: 'asc' | 'desc';
}

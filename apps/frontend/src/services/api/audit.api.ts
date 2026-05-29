import { apiGet } from './client';
import type {
  AuditLog,
  EntityHistoryQuery,
  ListAuditLogsQuery,
  UserHistoryQuery,
} from '@/types/audit';
import type { Paginated } from '@/types/pagination';

export const auditApi = {
  listLogs: (query: ListAuditLogsQuery = {}): Promise<Paginated<AuditLog>> =>
    apiGet('/audit/logs', { params: query }),

  getLog: (id: string): Promise<AuditLog> => apiGet(`/audit/logs/${id}`),

  getEntityHistory: (
    entity: string,
    entityId: string,
    query: EntityHistoryQuery = {},
  ): Promise<Paginated<AuditLog>> =>
    apiGet(`/audit/entity/${encodeURIComponent(entity)}/${encodeURIComponent(entityId)}`, {
      params: query,
    }),

  getUserHistory: (
    userId: string,
    query: UserHistoryQuery = {},
  ): Promise<Paginated<AuditLog>> =>
    apiGet(`/audit/user/${encodeURIComponent(userId)}`, { params: query }),
};

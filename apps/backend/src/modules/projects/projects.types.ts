import type { ProjectStatus } from '@prisma/client';

export interface ProjectListArgs {
  search?: string;
  status?: ProjectStatus;
  delayed?: boolean;
  contractId?: string;
  includeDeleted?: boolean;
  skip: number;
  take: number;
  sortBy: 'createdAt' | 'name' | 'deliveryDate' | 'startDate';
  sortDir: 'asc' | 'desc';
}

export interface ProjectFilter {
  search?: string;
  status?: ProjectStatus;
  delayed?: boolean;
  contractId?: string;
  includeDeleted?: boolean;
}

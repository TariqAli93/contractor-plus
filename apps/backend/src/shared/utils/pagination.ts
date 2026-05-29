import type { PaginationQuery } from '../validation/common.schemas.js';
import type { Paginated } from '../types/pagination.js';

export function toSkipTake(query: PaginationQuery): { skip: number; take: number } {
  return {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  };
}

export function buildPaginated<T>(
  items: T[],
  total: number,
  query: PaginationQuery,
): Paginated<T> {
  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

export interface CustomerListArgs {
  search?: string;
  skip: number;
  take: number;
  sortBy: 'name' | 'createdAt';
  sortDir: 'asc' | 'desc';
}

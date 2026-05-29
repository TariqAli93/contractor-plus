export interface MaterialListArgs {
  search?: string;
  isActive?: boolean;
  skip: number;
  take: number;
  sortBy: 'name' | 'createdAt' | 'defaultPrice';
  sortDir: 'asc' | 'desc';
}

export interface MaterialFilter {
  search?: string;
  isActive?: boolean;
}

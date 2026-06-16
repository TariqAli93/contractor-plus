export interface UserListArgs {
  search?: string;
  role?: string;
  isActive?: boolean;
  skip: number;
  take: number;
  sortBy: 'username' | 'fullName' | 'createdAt' | 'lastLoginAt';
  sortDir: 'asc' | 'desc';
}

// Safe user shape returned by the API — never includes passwordHash.
export interface UserDto {
  id: string;
  username: string;
  email: string | null;
  fullName: string;
  phone: string | null;
  roleId: string;
  // Role name (system or custom).
  role: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

import type { RoleName } from './enums';

export interface User {
  id: string;
  username: string;
  email: string | null;
  fullName: string;
  phone: string | null;
  roleId: string;
  role: RoleName;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateUserInput {
  username: string;
  password: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  roleName: RoleName;
  isActive?: boolean;
}

export interface UpdateUserInput {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  roleName?: RoleName;
  isActive?: boolean;
}

export interface ListUsersQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: RoleName;
  isActive?: boolean;
  sortBy?: 'username' | 'fullName' | 'createdAt' | 'lastLoginAt';
  sortDir?: 'asc' | 'desc';
}

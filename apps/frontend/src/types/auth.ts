import type { RoleName } from './enums';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: RoleName;
  lastLoginAt: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResponse {
  user: UserProfile;
  tokens: TokenPair;
}

export interface LoginInput {
  email: string;
  password: string;
}

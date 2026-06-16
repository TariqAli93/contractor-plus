export interface UserProfile {
  id: string;
  username: string;
  email: string | null;
  fullName: string;
  phone: string | null;
  // Role name (system role from RoleName, or a custom role name).
  role: string;
  roleDisplayName: string | null;
  // Effective permission keys for the user's role (OWNER = all).
  permissions: string[];
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
  username: string;
  password: string;
}

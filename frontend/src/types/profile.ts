export interface UpdateProfileInput {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

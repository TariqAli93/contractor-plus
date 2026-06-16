// Mirrors the backend Settings types. Kept here (rather than imported from
// a shared package) so frontend builds don't take a hard dependency on
// the backend's Prisma client types. Update both sides in lock-step.

export type CurrencySymbolPosition = 'BEFORE' | 'AFTER';

export interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string;
  symbolPosition: CurrencySymbolPosition;
  decimalPrecision: number;
  thousandSeparator: string;
  decimalSeparator: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyProfile {
  id: string;
  companyName: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  registrationNumber: string | null;
  website: string | null;
  footerText: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeneralSettings {
  appName: string;
  fiscalYearStartMonth: number;
  defaultLocale: 'ar' | 'en';
  dateFormat: string;
}

// ---------- input shapes ----------

export interface CreateCurrencyInput {
  code: string;
  name: string;
  symbol: string;
  symbolPosition: CurrencySymbolPosition;
  decimalPrecision: number;
  thousandSeparator: string;
  decimalSeparator: string;
  isActive: boolean;
}

export type UpdateCurrencyInput = Partial<CreateCurrencyInput>;

export type UpdateCompanyProfileInput = Partial<{
  companyName: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  registrationNumber: string | null;
  website: string | null;
  footerText: string | null;
  notes: string | null;
}>;

export type UpdateGeneralSettingsInput = Partial<GeneralSettings>;

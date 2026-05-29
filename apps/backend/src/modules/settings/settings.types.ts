import type { Currency, CompanyProfile } from '@prisma/client';

// Response shape for GET /settings/general. The frontend always receives a
// fully-typed object — missing keys are filled in with sensible defaults at
// the service layer so the UI never has to special-case "missing".
export interface GeneralSettings {
  appName: string;
  fiscalYearStartMonth: number; // 1-12
  defaultLocale: 'ar' | 'en';
  dateFormat: string;
}

export type CurrencyDTO = Currency;
export type CompanyProfileDTO = CompanyProfile;

import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type {
  CompanyProfile,
  CreateCurrencyInput,
  Currency,
  GeneralSettings,
  UpdateCompanyProfileInput,
  UpdateCurrencyInput,
  UpdateGeneralSettingsInput,
} from '@/types/settings';

export const settingsApi = {
  // General
  getGeneral: (): Promise<GeneralSettings> => apiGet('/settings/general'),
  updateGeneral: (input: UpdateGeneralSettingsInput): Promise<GeneralSettings> =>
    apiPatch('/settings/general', input),

  // Company
  getCompany: (): Promise<CompanyProfile> => apiGet('/settings/company'),
  updateCompany: (input: UpdateCompanyProfileInput): Promise<CompanyProfile> =>
    apiPatch('/settings/company', input),

  // Currencies
  listCurrencies: (): Promise<{ items: Currency[] }> => apiGet('/settings/currencies'),
  createCurrency: (input: CreateCurrencyInput): Promise<Currency> =>
    apiPost('/settings/currencies', input),
  updateCurrency: (id: string, input: UpdateCurrencyInput): Promise<Currency> =>
    apiPatch(`/settings/currencies/${id}`, input),
  deleteCurrency: (id: string): Promise<void> => apiDelete(`/settings/currencies/${id}`),
  setDefaultCurrency: (id: string): Promise<Currency> =>
    apiPost(`/settings/currencies/${id}/set-default`),
};

import type { CompanyProfile, Contract, Currency, Customer, Project } from '@prisma/client';
import { formatDate } from './format-date.js';
import { formatMoney } from './format-money.js';

// Typed placeholder map produced by the renderer. Every supported token has
// a stable key here so future additions (or removals) are caught at compile
// time across the codebase.
//
// Renderer rule: every value is a *string*. Missing inputs collapse to an
// empty string — never `undefined` — so docxtemplater never throws on a
// legitimate but unfilled token.

export interface PlaceholderMap {
  // Company
  company_name: string;
  company_email: string;
  company_phone: string;
  company_address: string;
  company_tax_number: string;
  // Customer
  client_name: string;
  client_phone: string;
  client_address: string;
  // Project
  project_name: string;
  project_location: string;
  project_start_date: string;
  project_delivery_date: string;
  project_progress: string;
  // Contract
  contract_number: string;
  contract_date: string;
  contract_total: string;
  contract_status: string;
  // Currency
  currency_symbol: string;
}

/**
 * Every supported token, grouped by domain. The frontend uses the same
 * grouping for its PlaceholderReferenceCard, so keep them in sync when
 * extending the map.
 */
export const PLACEHOLDER_GROUPS = {
  company: [
    'company_name',
    'company_email',
    'company_phone',
    'company_address',
    'company_tax_number',
  ],
  customer: ['client_name', 'client_phone', 'client_address'],
  project: [
    'project_name',
    'project_location',
    'project_start_date',
    'project_delivery_date',
    'project_progress',
  ],
  contract: ['contract_number', 'contract_date', 'contract_total', 'contract_status'],
  currency: ['currency_symbol'],
} as const satisfies Record<string, ReadonlyArray<keyof PlaceholderMap>>;

export const ALL_PLACEHOLDERS: ReadonlyArray<keyof PlaceholderMap> = Object.values(
  PLACEHOLDER_GROUPS,
).flat() as ReadonlyArray<keyof PlaceholderMap>;

// Slim input shape — the service builds this from Prisma rows; the mapper
// never sees a raw Prisma object, which keeps the seam clean for future
// non-DB data sources (test fixtures, preview).
export interface PlaceholderInputs {
  company: Pick<
    CompanyProfile,
    'companyName' | 'email' | 'phone' | 'address' | 'taxNumber'
  > | null;
  customer: Pick<Customer, 'name' | 'phone' | 'address'> | null;
  project:
    | (Pick<Project, 'name' | 'startDate' | 'deliveryDate' | 'progressPercentage'> & {
        // No dedicated "location" column on Project; we fall back to the
        // customer address so the placeholder is meaningful for now.
        location?: string | null;
      })
    | null;
  contract: Pick<
    Contract,
    'contractNumber' | 'totalPrice' | 'status' | 'signedAt' | 'createdAt'
  > | null;
  currency: Pick<
    Currency,
    'symbol' | 'symbolPosition' | 'decimalPrecision' | 'thousandSeparator' | 'decimalSeparator'
  > | null;
}

const NONE = '';

export function buildPlaceholderMap(input: PlaceholderInputs): PlaceholderMap {
  const symbol = input.currency?.symbol ?? '';
  const moneyOpts = { currency: input.currency ?? null };
  return {
    // Company
    company_name: input.company?.companyName ?? NONE,
    company_email: input.company?.email ?? NONE,
    company_phone: input.company?.phone ?? NONE,
    company_address: input.company?.address ?? NONE,
    company_tax_number: input.company?.taxNumber ?? NONE,
    // Customer
    client_name: input.customer?.name ?? NONE,
    client_phone: input.customer?.phone ?? NONE,
    client_address: input.customer?.address ?? NONE,
    // Project — `location` falls back to the customer address when the
    // project doesn't carry one. We never invent data.
    project_name: input.project?.name ?? NONE,
    project_location: input.project?.location ?? input.customer?.address ?? NONE,
    project_start_date: formatDate(input.project?.startDate ?? null),
    project_delivery_date: formatDate(input.project?.deliveryDate ?? null),
    project_progress: input.project ? `${Number(input.project.progressPercentage)}%` : NONE,
    // Contract
    contract_number: input.contract?.contractNumber ?? NONE,
    contract_date: formatDate(input.contract?.signedAt ?? input.contract?.createdAt ?? null),
    contract_total: input.contract
      ? formatMoney(input.contract.totalPrice, moneyOpts)
      : NONE,
    contract_status: input.contract?.status ?? NONE,
    // Currency
    currency_symbol: symbol,
  };
}

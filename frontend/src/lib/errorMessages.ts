import { ApiError } from '@/types/api';
import { t } from '@/i18n';

// Turn any thrown error into a plain-Arabic "what went wrong + how to fix it"
// message for the end user. Backend error CODES map to a written explanation;
// anything unmapped falls back to a message by HTTP status class. The raw
// backend/JS message (e.g. "Validation failed", "Foreign key constraint",
// "Network Error") is NEVER surfaced to the user.
const CODE_KEYS: Record<string, string> = {
  NETWORK_ERROR: 'errors.network',
  NETWORK_TIMEOUT: 'errors.timeout',
  RATE_LIMITED: 'errors.rateLimited',
  // Projects ↔ contracts linkage / lifecycle
  PROJECT_HAS_FINANCIAL_RECORDS: 'errors.codes.PROJECT_HAS_FINANCIAL_RECORDS',
  PROJECT_NOT_LINKED: 'errors.codes.PROJECT_NOT_LINKED',
  PROJECT_ALREADY_LINKED: 'errors.codes.PROJECT_ALREADY_LINKED',
  PROJECT_ALREADY_EXISTS: 'errors.codes.PROJECT_ALREADY_EXISTS',
  CONTRACT_HAS_PROJECT: 'errors.codes.CONTRACT_HAS_PROJECT',
  CONTRACT_NOT_APPROVED: 'errors.codes.CONTRACT_NOT_APPROVED',
  CONTRACT_CANCELLED: 'errors.codes.CONTRACT_CANCELLED',
  CONTRACT_NUMBER_TAKEN: 'errors.codes.CONTRACT_NUMBER_TAKEN',
  CONTRACT_LOCKED: 'errors.codes.CONTRACT_LOCKED',
  CONTRACT_NOT_DRAFT: 'errors.codes.CONTRACT_NOT_DRAFT',
  // Identity / settings
  EMAIL_TAKEN: 'errors.codes.EMAIL_TAKEN',
  USERNAME_TAKEN: 'errors.codes.USERNAME_TAKEN',
  ROLE_IN_USE: 'errors.codes.ROLE_IN_USE',
  ROLE_NAME_TAKEN: 'errors.codes.ROLE_NAME_TAKEN',
  CURRENCY_CODE_DUPLICATE: 'errors.codes.CURRENCY_CODE_DUPLICATE',
};

export function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    const key = CODE_KEYS[err.code];
    if (key) return t(key);
    const s = err.statusCode;
    if (s === 0) return t('errors.network');
    if (s === 401) return t('errors.auth');
    if (s === 403) return t('errors.forbidden');
    if (s === 404) return t('errors.itemNotFound');
    if (s === 409) return t('errors.conflict');
    if (s === 429) return t('errors.rateLimited');
    if (s >= 500) return t('errors.server');
  }
  return t('errors.generic');
}

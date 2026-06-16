import type { CompanyProfile, Currency, PrismaClient } from '@prisma/client';
import { SettingsRepository } from './settings.repository.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { ConflictError } from '../../shared/errors/conflict.error.js';
import { toJsonValue } from '../../shared/utils/json.js';
import type {
  CreateCurrencyInput,
  GeneralSettingsInput,
  UpdateCompanyProfileInput,
  UpdateCurrencyInput,
} from './settings.schemas.js';
import type { GeneralSettings } from './settings.types.js';

const ENTITY_GENERAL = 'SystemSettings';
const ENTITY_COMPANY = 'CompanyProfile';
const ENTITY_CURRENCY = 'Currency';

// Defaults for the General bag — surfaced when no row exists yet so the UI
// always renders a known shape.
const GENERAL_DEFAULTS: GeneralSettings = {
  appName: 'Contractor+',
  fiscalYearStartMonth: 1,
  defaultLocale: 'ar',
  dateFormat: 'yyyy-MM-dd',
};

const GENERAL_KEYS: ReadonlyArray<keyof GeneralSettings> = [
  'appName',
  'fiscalYearStartMonth',
  'defaultLocale',
  'dateFormat',
];

export class SettingsService {
  private readonly repo: SettingsRepository;
  private readonly audit: AuditService;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new SettingsRepository(prisma);
    this.audit = new AuditService(prisma);
  }

  // ============================================================
  // General
  // ============================================================

  async getGeneral(): Promise<GeneralSettings> {
    const rows = await this.repo.getAllGeneral();
    const map: Record<string, unknown> = {};
    for (const r of rows) {
      const short = r.key.replace(/^general\./, '');
      map[short] = r.value;
    }
    return {
      appName: typeof map.appName === 'string' ? map.appName : GENERAL_DEFAULTS.appName,
      fiscalYearStartMonth:
        typeof map.fiscalYearStartMonth === 'number'
          ? map.fiscalYearStartMonth
          : GENERAL_DEFAULTS.fiscalYearStartMonth,
      defaultLocale:
        map.defaultLocale === 'en' || map.defaultLocale === 'ar'
          ? map.defaultLocale
          : GENERAL_DEFAULTS.defaultLocale,
      dateFormat:
        typeof map.dateFormat === 'string' ? map.dateFormat : GENERAL_DEFAULTS.dateFormat,
    };
  }

  async updateGeneral(input: GeneralSettingsInput, actor: AuditActor): Promise<GeneralSettings> {
    const before = await this.getGeneral();
    await this.prisma.$transaction(async (tx) => {
      for (const key of GENERAL_KEYS) {
        const value = input[key];
        if (value === undefined) continue;
        await this.repo.upsertGeneral(`general.${key}`, value as never, tx);
      }
    });
    const after = await this.getGeneral();

    await this.audit.log(actor, {
      action: 'UPDATE',
      entity: ENTITY_GENERAL,
      entityId: 'general',
      oldValues: toJsonValue(before),
      newValues: toJsonValue(after),
    });

    return after;
  }

  // ============================================================
  // Company profile
  // ============================================================

  async getCompany(): Promise<CompanyProfile> {
    return this.repo.getCompany();
  }

  async updateCompany(
    input: UpdateCompanyProfileInput,
    actor: AuditActor,
  ): Promise<CompanyProfile> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.repo.getCompany(tx);

      // If companyName is included it must be non-empty. (Zod allows
      // partial(); we enforce the not-empty rule here so PATCH-without-name
      // is still legal.)
      if (input.companyName !== undefined && input.companyName.trim() === '') {
        throw new ConflictError('Company name must not be empty', 'COMPANY_NAME_REQUIRED');
      }

      const updated = await this.repo.updateCompany(input, tx);

      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: ENTITY_COMPANY,
          entityId: updated.id,
          oldValues: toJsonValue(before),
          newValues: toJsonValue(updated),
        },
        tx,
      );

      return updated;
    });
  }

  // ============================================================
  // Currencies
  // ============================================================

  async listCurrencies(): Promise<Currency[]> {
    return this.repo.listCurrencies();
  }

  async createCurrency(input: CreateCurrencyInput, actor: AuditActor): Promise<Currency> {
    return this.prisma.$transaction(async (tx) => {
      const dup = await this.repo.findCurrencyByCode(input.code, tx);
      if (dup) throw new ConflictError('Currency code already exists', 'CURRENCY_CODE_DUPLICATE');

      const created = await this.repo.createCurrency(
        { ...input, isDefault: false }, // a new currency never becomes default on create
        tx,
      );

      await this.audit.log(
        actor,
        {
          action: 'CREATE',
          entity: ENTITY_CURRENCY,
          entityId: created.id,
          newValues: toJsonValue(created),
        },
        tx,
      );

      return created;
    });
  }

  async updateCurrency(
    id: string,
    input: UpdateCurrencyInput,
    actor: AuditActor,
  ): Promise<Currency> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findCurrencyById(id, tx);
      if (!existing) throw new NotFoundError(ENTITY_CURRENCY, 'CURRENCY_NOT_FOUND');

      // Default currency must remain active. Block deactivation of the
      // current default; the user has to switch default first.
      if (existing.isDefault && input.isActive === false) {
        throw new ConflictError(
          'The default currency must remain active',
          'DEFAULT_CURRENCY_MUST_BE_ACTIVE',
        );
      }

      // Code change must remain unique.
      if (input.code && input.code !== existing.code) {
        const dup = await this.repo.findCurrencyByCode(input.code, tx);
        if (dup) throw new ConflictError('Currency code already exists', 'CURRENCY_CODE_DUPLICATE');
      }

      // isDefault is NEVER toggled via PATCH — there is a dedicated
      // /set-default endpoint. Drop it defensively if a client sends it.
      const { isDefault: _ignored, ...payload } = input as UpdateCurrencyInput & {
        isDefault?: boolean;
      };
      void _ignored;

      const updated = await this.repo.updateCurrency(id, payload, tx);

      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: ENTITY_CURRENCY,
          entityId: id,
          oldValues: toJsonValue(existing),
          newValues: toJsonValue(updated),
        },
        tx,
      );

      return updated;
    });
  }

  async deleteCurrency(id: string, actor: AuditActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findCurrencyById(id, tx);
      if (!existing) throw new NotFoundError(ENTITY_CURRENCY, 'CURRENCY_NOT_FOUND');

      if (existing.isDefault) {
        throw new ConflictError(
          'Cannot delete the default currency',
          'DEFAULT_CURRENCY_DELETE_FORBIDDEN',
        );
      }

      await this.repo.deleteCurrency(id, tx);

      await this.audit.log(
        actor,
        {
          action: 'DELETE',
          entity: ENTITY_CURRENCY,
          entityId: id,
          oldValues: toJsonValue(existing),
        },
        tx,
      );
    });
  }

  async setDefaultCurrency(id: string, actor: AuditActor): Promise<Currency> {
    return this.prisma.$transaction(async (tx) => {
      const target = await this.repo.findCurrencyById(id, tx);
      if (!target) throw new NotFoundError(ENTITY_CURRENCY, 'CURRENCY_NOT_FOUND');

      if (!target.isActive) {
        throw new ConflictError(
          'Cannot set an inactive currency as default',
          'DEFAULT_CURRENCY_MUST_BE_ACTIVE',
        );
      }

      // Already default — no-op (but still audit the request? No. Idempotent).
      if (target.isDefault) return target;

      // Two-step swap. The partial unique index would otherwise reject the
      // intermediate "two-default" state if we updated in parallel, so we
      // clear first, then set.
      await this.repo.clearAllDefaults(tx);
      const updated = await this.repo.updateCurrency(id, { isDefault: true }, tx);

      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: ENTITY_CURRENCY,
          entityId: id,
          oldValues: toJsonValue({ isDefault: false }),
          newValues: toJsonValue({ isDefault: true }),
        },
        tx,
      );

      return updated;
    });
  }
}

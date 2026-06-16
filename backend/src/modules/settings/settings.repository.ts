import type {
  CompanyProfile,
  Currency,
  Prisma,
  PrismaClient,
  SystemSetting,
} from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

const COMPANY_ID = 'default';

export class SettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------- General (key/value bag) ----------

  getAllGeneral(): Promise<SystemSetting[]> {
    return this.prisma.systemSetting.findMany({
      where: { key: { startsWith: 'general.' } },
    });
  }

  upsertGeneral(
    key: string,
    value: Prisma.InputJsonValue,
    client: DbClient = this.prisma,
  ): Promise<SystemSetting> {
    return client.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  // ---------- Company (singleton) ----------

  async getCompany(client: DbClient = this.prisma): Promise<CompanyProfile> {
    const existing = await client.companyProfile.findUnique({ where: { id: COMPANY_ID } });
    if (existing) return existing;
    // First-load self-heal: rather than 404 if the bootstrap seed never ran,
    // create the blank singleton on demand. The id is fixed.
    return client.companyProfile.create({
      data: { id: COMPANY_ID, companyName: '' },
    });
  }

  updateCompany(
    data: Prisma.CompanyProfileUpdateInput,
    client: DbClient = this.prisma,
  ): Promise<CompanyProfile> {
    return client.companyProfile.update({ where: { id: COMPANY_ID }, data });
  }

  // ---------- Currencies ----------

  listCurrencies(): Promise<Currency[]> {
    return this.prisma.currency.findMany({
      orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
    });
  }

  findCurrencyById(id: string, client: DbClient = this.prisma): Promise<Currency | null> {
    return client.currency.findUnique({ where: { id } });
  }

  findCurrencyByCode(code: string, client: DbClient = this.prisma): Promise<Currency | null> {
    return client.currency.findUnique({ where: { code } });
  }

  findDefaultCurrency(client: DbClient = this.prisma): Promise<Currency | null> {
    return client.currency.findFirst({ where: { isDefault: true } });
  }

  createCurrency(
    data: Prisma.CurrencyCreateInput,
    client: DbClient = this.prisma,
  ): Promise<Currency> {
    return client.currency.create({ data });
  }

  updateCurrency(
    id: string,
    data: Prisma.CurrencyUpdateInput,
    client: DbClient = this.prisma,
  ): Promise<Currency> {
    return client.currency.update({ where: { id }, data });
  }

  deleteCurrency(id: string, client: DbClient = this.prisma): Promise<Currency> {
    return client.currency.delete({ where: { id } });
  }

  clearAllDefaults(client: DbClient = this.prisma): Promise<Prisma.BatchPayload> {
    return client.currency.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  }
}

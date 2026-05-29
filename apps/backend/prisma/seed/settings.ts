import type { PrismaClient } from '@prisma/client';

// Seed the initial settings rows.
//   - Iraqi Dinar (IQD) as the single, default currency. Symbol after the
//     amount, no decimal places (dinars are not fractioned in practice).
//   - A blank CompanyProfile singleton (id = "default") — the user fills it
//     in via the Settings UI.
// Idempotent: legacy SAR/USD rows are removed first, then IQD is upserted as
// the sole default so re-running the seed converges on the Iraqi setup.
export async function seedSettings(prisma: PrismaClient) {
  // Drop any previously seeded foreign currencies. Removing the old default
  // before setting IQD's avoids tripping the "single default" partial index.
  await prisma.currency.deleteMany({ where: { code: { in: ['SAR', 'USD'] } } });

  await prisma.currency.upsert({
    where: { code: 'IQD' },
    update: {
      name: 'Iraqi Dinar',
      symbol: 'د.ع',
      symbolPosition: 'AFTER',
      decimalPrecision: 0,
      thousandSeparator: ',',
      decimalSeparator: '.',
      isActive: true,
      isDefault: true,
    },
    create: {
      code: 'IQD',
      name: 'Iraqi Dinar',
      symbol: 'د.ع',
      symbolPosition: 'AFTER',
      decimalPrecision: 0,
      thousandSeparator: ',',
      decimalSeparator: '.',
      isActive: true,
      isDefault: true,
    },
  });

  await prisma.companyProfile.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default', companyName: '' },
  });
}

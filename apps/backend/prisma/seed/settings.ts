import type { PrismaClient } from '@prisma/client';

// Seed the initial settings rows.
//   - Saudi Riyal (SAR) as the default currency. RTL-friendly, matches the
//     app's primary locale.
//   - A blank CompanyProfile singleton (id = "default") — the user fills it
//     in via the Settings UI.
// Idempotent: re-running the full seed won't duplicate rows because we use
// upserts keyed by id / unique code.
export async function seedSettings(prisma: PrismaClient) {
  await prisma.currency.upsert({
    where: { code: 'SAR' },
    update: {},
    create: {
      code: 'SAR',
      name: 'Saudi Riyal',
      symbol: 'ر.س',
      symbolPosition: 'AFTER',
      decimalPrecision: 2,
      thousandSeparator: ',',
      decimalSeparator: '.',
      isActive: true,
      isDefault: true,
    },
  });

  await prisma.currency.upsert({
    where: { code: 'USD' },
    update: {},
    create: {
      code: 'USD',
      name: 'US Dollar',
      symbol: '$',
      symbolPosition: 'BEFORE',
      decimalPrecision: 2,
      thousandSeparator: ',',
      decimalSeparator: '.',
      isActive: true,
      isDefault: false,
    },
  });

  await prisma.companyProfile.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default', companyName: '' },
  });
}

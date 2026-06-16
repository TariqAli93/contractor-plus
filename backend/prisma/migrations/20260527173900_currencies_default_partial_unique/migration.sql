-- Enforce "at most one default currency" at the DB level. Prisma's schema
-- language can't express partial unique indexes, so this lives as a manual
-- migration. The service-level guard in CurrencyService is the primary
-- mechanism; this index is the belt-and-suspenders.
CREATE UNIQUE INDEX "currencies_one_default_idx"
  ON "currencies" ("isDefault")
  WHERE "isDefault" = true;

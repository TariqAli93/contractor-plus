-- One-shot bootstrap. Idempotent (ON CONFLICT DO NOTHING) so it is safe to
-- run multiple times. Provides the minimum settings rows the UI expects
-- on first load:
--   - Iraqi Dinar default (active, no decimals)
--   - Blank company profile (id = "default")

INSERT INTO "currencies" (
  "id","code","name","symbol","symbolPosition","decimalPrecision",
  "thousandSeparator","decimalSeparator","isActive","isDefault","createdAt","updatedAt"
) VALUES (
  gen_random_uuid(), 'IQD', 'Iraqi Dinar', 'د.ع', 'AFTER', 0, ',', '.', true, true, NOW(), NOW()
) ON CONFLICT ("code") DO NOTHING;

INSERT INTO "company_profile" (
  "id","companyName","createdAt","updatedAt"
) VALUES (
  'default', '', NOW(), NOW()
) ON CONFLICT ("id") DO NOTHING;

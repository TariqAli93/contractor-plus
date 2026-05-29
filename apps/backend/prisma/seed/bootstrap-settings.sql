-- One-shot bootstrap. Idempotent (ON CONFLICT DO NOTHING) so it is safe to
-- run multiple times. Provides the minimum settings rows the UI expects
-- on first load:
--   - Saudi Riyal default (active)
--   - US Dollar (active, not default)
--   - Blank company profile (id = "default")

INSERT INTO "currencies" (
  "id","code","name","symbol","symbolPosition","decimalPrecision",
  "thousandSeparator","decimalSeparator","isActive","isDefault","createdAt","updatedAt"
) VALUES (
  gen_random_uuid(), 'SAR', 'Saudi Riyal', 'ر.س', 'AFTER', 2, ',', '.', true, true, NOW(), NOW()
) ON CONFLICT ("code") DO NOTHING;

INSERT INTO "currencies" (
  "id","code","name","symbol","symbolPosition","decimalPrecision",
  "thousandSeparator","decimalSeparator","isActive","isDefault","createdAt","updatedAt"
) VALUES (
  gen_random_uuid(), 'USD', 'US Dollar', '$', 'BEFORE', 2, ',', '.', true, false, NOW(), NOW()
) ON CONFLICT ("code") DO NOTHING;

INSERT INTO "company_profile" (
  "id","companyName","createdAt","updatedAt"
) VALUES (
  'default', '', NOW(), NOW()
) ON CONFLICT ("id") DO NOTHING;

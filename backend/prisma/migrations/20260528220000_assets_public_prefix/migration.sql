-- Phase 2.5: rewrite stored asset paths to include the "public/" prefix.
-- Phase 2 wrote relative paths like "company/logos/<file>"; the storage
-- service now expects them under "public/company/logos/<file>" so the
-- world-readable assets live in a dedicated subtree separate from any
-- future private uploads.
-- Idempotent: only updates rows that haven't already been migrated.

UPDATE "company_profile"
SET "logoPath" = 'public/' || "logoPath"
WHERE "logoPath" IS NOT NULL
  AND "logoPath" NOT LIKE 'public/%';

UPDATE "company_profile"
SET "stampPath" = 'public/' || "stampPath"
WHERE "stampPath" IS NOT NULL
  AND "stampPath" NOT LIKE 'public/%';

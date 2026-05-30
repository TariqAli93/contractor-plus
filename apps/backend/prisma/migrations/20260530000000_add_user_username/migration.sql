-- Add `username` as the login identifier (email is retained as contact info).
-- Existing rows are backfilled deterministically, then the column is made
-- unique + NOT NULL. Safe to replay on an empty shadow database.

-- 1) Add the column nullable so existing rows survive the add.
ALTER TABLE "users" ADD COLUMN "username" TEXT;

-- 2) Backfill: prefer the email local-part, fall back to the sanitized
--    fullName, then a literal. Lowercase + restrict to [a-z0-9._-]. Duplicate
--    derived names get a numeric suffix (owner, owner2, owner3, ...).
WITH base AS (
  SELECT
    "id",
    COALESCE(
      NULLIF(regexp_replace(lower(split_part("email", '@', 1)), '[^a-z0-9._-]', '', 'g'), ''),
      NULLIF(regexp_replace(lower("fullName"), '[^a-z0-9._-]', '', 'g'), ''),
      'user'
    ) AS base_name
  FROM "users"
),
numbered AS (
  SELECT
    "id",
    base_name,
    ROW_NUMBER() OVER (PARTITION BY base_name ORDER BY "id") AS rn
  FROM base
)
UPDATE "users" u
SET "username" = CASE WHEN n.rn = 1 THEN n.base_name ELSE n.base_name || n.rn::text END
FROM numbered n
WHERE u."id" = n."id";

-- 3) Enforce NOT NULL + uniqueness.
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

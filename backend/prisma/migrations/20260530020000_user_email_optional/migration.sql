-- Email becomes optional contact info (username is the login identifier).
-- The existing unique index is retained; Postgres allows multiple NULLs.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;

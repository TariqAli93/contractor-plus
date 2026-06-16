-- Role display metadata. The permission set stays code-defined (static RBAC);
-- only these presentation fields are editable via the RBAC management UI.

ALTER TABLE "roles" ADD COLUMN "displayName" TEXT;
ALTER TABLE "roles" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "roles" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT true;

-- Stable ordering by the canonical role hierarchy (seed refreshes displayName).
UPDATE "roles" SET "sortOrder" = CASE "name"
  WHEN 'OWNER'      THEN 1
  WHEN 'ADMIN'      THEN 2
  WHEN 'ACCOUNTANT' THEN 3
  WHEN 'ENGINEER'   THEN 4
  WHEN 'VIEWER'     THEN 5
  ELSE 99
END;

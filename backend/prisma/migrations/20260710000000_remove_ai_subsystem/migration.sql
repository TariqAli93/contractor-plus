-- ============================================================
-- Remove the AI subsystem entirely.
--
-- Drops every table, enum, permission and setting introduced by the
-- ai-command-workflow, ai-platform, ai-assistant and estimation-template
-- (AI-generated) features. Historical migrations are left untouched so a fresh
-- database still replays the full history; this migration only rolls the schema
-- FORWARD.
--
-- Every statement is IF EXISTS / idempotent, so this applies cleanly to a
-- database at any prior state — including one provisioned before the AI tables
-- ever existed.
--
-- NOTE: this DESTROYS AI conversation history, AI audit trails and any saved
-- estimation templates. Those rows are unreachable once the feature is gone
-- (estimation templates could only ever be created through the AI draft flow).
-- Generic `audit_logs` rows are NOT touched — they are the app's immutable,
-- feature-agnostic history.
-- ============================================================

-- ----- Tables (children before parents; CASCADE clears the FKs regardless) ---
DROP TABLE IF EXISTS "estimation_audit_logs" CASCADE;
DROP TABLE IF EXISTS "estimation_template_drafts" CASCADE;
DROP TABLE IF EXISTS "estimation_template_items" CASCADE;
DROP TABLE IF EXISTS "estimation_templates" CASCADE;
DROP TABLE IF EXISTS "ai_messages" CASCADE;
DROP TABLE IF EXISTS "ai_executions" CASCADE;
DROP TABLE IF EXISTS "ai_sessions" CASCADE;
DROP TABLE IF EXISTS "ai_command_logs" CASCADE;

-- ----- Enums -----
DROP TYPE IF EXISTS "EstimationDraftStatus";
DROP TYPE IF EXISTS "EstimationMaterialResolutionStatus";
DROP TYPE IF EXISTS "AiSessionStatus";
DROP TYPE IF EXISTS "AiMessageRole";

-- ----- Orphan RBAC permissions -----
-- role_permissions first (FK), then the permission rows themselves. The RBAC
-- seeder would otherwise only mark these inactive; the feature is gone, so the
-- rows go with it.
DELETE FROM "role_permissions"
WHERE "permissionId" IN (
  SELECT "id" FROM "permissions"
  WHERE "key" LIKE 'ai.%'
     OR "key" LIKE 'estimation_templates.%'
     OR "key" = 'materials.create_from_assistant'
);

DELETE FROM "permissions"
WHERE "key" LIKE 'ai.%'
   OR "key" LIKE 'estimation_templates.%'
   OR "key" = 'materials.create_from_assistant';

-- ----- Stored AI settings (incl. the encrypted OpenRouter API key) -----
-- llm-settings.store wrote everything under the `ai.` prefix (ai.apiKeyEnc,
-- ai.enabled, ai.model, ...).
DELETE FROM "system_settings" WHERE "key" LIKE 'ai.%';

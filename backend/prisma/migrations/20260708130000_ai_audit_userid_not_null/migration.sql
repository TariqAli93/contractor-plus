-- Make the AI audit `userId` columns NOT NULL. Every audit path threads a real
-- principal.userId (no code writes NULL), and users are soft-deleted (deletedAt),
-- so a required FK never blocks a genuine user deletion. No existing NULL rows.
ALTER TABLE "ai_command_logs" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "ai_executions" ALTER COLUMN "userId" SET NOT NULL;

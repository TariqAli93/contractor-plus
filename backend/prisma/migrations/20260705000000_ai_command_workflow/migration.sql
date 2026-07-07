-- AI Command Workflow System.
--
-- Replaces the old Voice Command System: drop the voice tables + enums, add the
-- durable ai_command_logs audit trail, and carry the LLM provider/model/key
-- settings forward by renaming the `voiceAi.*` SystemSetting keys to `ai.*`
-- (so the operator does NOT have to re-enter their encrypted API key).

-- Preserve LLM settings: voiceAi.enabled/provider/model/timeoutMs/maxTokens/apiKeyEnc → ai.*
UPDATE "system_settings"
SET "key" = 'ai.' || substring("key" FROM char_length('voiceAi.') + 1)
WHERE "key" LIKE 'voiceAi.%';

-- DropTable (FKs and indexes drop with the tables)
DROP TABLE IF EXISTS "voice_command_logs";
DROP TABLE IF EXISTS "voice_sessions";

-- DropEnum
DROP TYPE IF EXISTS "VoiceCommandStatus";
DROP TYPE IF EXISTS "VoiceSessionStatus";

-- CreateTable
CREATE TABLE "ai_command_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "sessionId" UUID,
    "originalText" TEXT NOT NULL,
    "detectedIntent" TEXT,
    "confidence" DOUBLE PRECISION,
    "resultKind" TEXT NOT NULL,
    "generatedPlan" JSONB,
    "confirmationStatus" TEXT,
    "executedActions" JSONB,
    "createdEntityIds" JSONB,
    "updatedEntityIds" JSONB,
    "failedReason" TEXT,
    "provider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_command_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_command_logs_userId_idx" ON "ai_command_logs"("userId");
CREATE INDEX "ai_command_logs_sessionId_idx" ON "ai_command_logs"("sessionId");
CREATE INDEX "ai_command_logs_resultKind_idx" ON "ai_command_logs"("resultKind");
CREATE INDEX "ai_command_logs_createdAt_idx" ON "ai_command_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "ai_command_logs" ADD CONSTRAINT "ai_command_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

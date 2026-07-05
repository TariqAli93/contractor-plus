-- Voice Command System: conversational sessions + immutable per-utterance log.

-- CreateEnum
CREATE TYPE "VoiceSessionStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "VoiceCommandStatus" AS ENUM ('INTERPRETED', 'CLARIFYING', 'AWAITING_CONFIRMATION', 'EXECUTED', 'REJECTED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "voice_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "status" "VoiceSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "voice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_command_logs" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID,
    "transcript" TEXT NOT NULL,
    "normalized" TEXT,
    "intent" TEXT NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL DEFAULT 0,
    "entities" JSONB,
    "plan" JSONB,
    "status" "VoiceCommandStatus" NOT NULL,
    "resultMessage" TEXT,
    "createdEntities" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "provider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_command_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voice_sessions_userId_idx" ON "voice_sessions"("userId");
CREATE INDEX "voice_sessions_status_idx" ON "voice_sessions"("status");
CREATE INDEX "voice_command_logs_sessionId_idx" ON "voice_command_logs"("sessionId");
CREATE INDEX "voice_command_logs_userId_idx" ON "voice_command_logs"("userId");
CREATE INDEX "voice_command_logs_intent_idx" ON "voice_command_logs"("intent");
CREATE INDEX "voice_command_logs_status_idx" ON "voice_command_logs"("status");
CREATE INDEX "voice_command_logs_createdAt_idx" ON "voice_command_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voice_command_logs" ADD CONSTRAINT "voice_command_logs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "voice_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voice_command_logs" ADD CONSTRAINT "voice_command_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

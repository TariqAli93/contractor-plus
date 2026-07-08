-- CreateEnum
CREATE TYPE "AiSessionStatus" AS ENUM ('ACTIVE', 'AWAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateTable
CREATE TABLE "ai_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT,
    "status" "AiSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "activeTool" TEXT,
    "workingState" JSONB,
    "pendingPlan" JSONB,
    "contextRefs" JSONB,
    "lastIntent" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ai_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolName" TEXT,
    "intent" JSONB,
    "plan" JSONB,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_executions" (
    "id" UUID NOT NULL,
    "sessionId" UUID,
    "userId" UUID,
    "toolName" TEXT,
    "originalRequest" TEXT NOT NULL,
    "parsedIntent" JSONB,
    "plannerOutput" JSONB,
    "selectedTools" JSONB,
    "userApproval" JSONB,
    "executedActions" JSONB,
    "finalData" JSONB,
    "transactionResult" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "provider" TEXT,
    "failedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_sessions_userId_idx" ON "ai_sessions"("userId");

-- CreateIndex
CREATE INDEX "ai_sessions_status_idx" ON "ai_sessions"("status");

-- CreateIndex
CREATE INDEX "ai_sessions_expiresAt_idx" ON "ai_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "ai_sessions_activeTool_idx" ON "ai_sessions"("activeTool");

-- CreateIndex
CREATE INDEX "ai_messages_sessionId_idx" ON "ai_messages"("sessionId");

-- CreateIndex
CREATE INDEX "ai_messages_createdAt_idx" ON "ai_messages"("createdAt");

-- CreateIndex
CREATE INDEX "ai_executions_sessionId_idx" ON "ai_executions"("sessionId");

-- CreateIndex
CREATE INDEX "ai_executions_userId_idx" ON "ai_executions"("userId");

-- CreateIndex
CREATE INDEX "ai_executions_toolName_idx" ON "ai_executions"("toolName");

-- CreateIndex
CREATE INDEX "ai_executions_transactionResult_idx" ON "ai_executions"("transactionResult");

-- CreateIndex
CREATE INDEX "ai_executions_createdAt_idx" ON "ai_executions"("createdAt");

-- AddForeignKey
ALTER TABLE "ai_sessions" ADD CONSTRAINT "ai_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ai_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ai_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

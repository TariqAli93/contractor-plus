-- CreateEnum
CREATE TYPE "AiPendingActionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'EXECUTED', 'REJECTED', 'EXPIRED', 'FAILED');

-- AlterEnum
ALTER TYPE "AiOperationType" ADD VALUE 'TOOL_ACTION';

-- CreateTable
CREATE TABLE "ai_pending_actions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "toolName" TEXT NOT NULL,
    "argumentsJson" JSONB NOT NULL,
    "previewJson" JSONB NOT NULL,
    "status" "AiPendingActionStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "resultRecordId" TEXT,
    "errorCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_pending_actions_idempotencyKey_key" ON "ai_pending_actions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ai_pending_actions_userId_status_idx" ON "ai_pending_actions"("userId", "status");

-- CreateIndex
CREATE INDEX "ai_pending_actions_expiresAt_idx" ON "ai_pending_actions"("expiresAt");

-- AddForeignKey
ALTER TABLE "ai_pending_actions" ADD CONSTRAINT "ai_pending_actions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

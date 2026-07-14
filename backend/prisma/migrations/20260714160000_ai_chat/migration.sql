-- AlterEnum
ALTER TYPE "AiOperationType" ADD VALUE 'CHAT';

-- CreateTable
CREATE TABLE "ai_chat_threads" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_chat_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_chat_messages" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "toolResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_chat_threads_userId_updatedAt_idx" ON "ai_chat_threads"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ai_chat_messages_threadId_createdAt_idx" ON "ai_chat_messages"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_chat_threads" ADD CONSTRAINT "ai_chat_threads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ai_chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;


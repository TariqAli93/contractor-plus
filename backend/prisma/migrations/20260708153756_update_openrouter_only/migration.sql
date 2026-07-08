-- DropForeignKey
ALTER TABLE "ai_command_logs" DROP CONSTRAINT "ai_command_logs_userId_fkey";

-- DropForeignKey
ALTER TABLE "ai_executions" DROP CONSTRAINT "ai_executions_userId_fkey";

-- AddForeignKey
ALTER TABLE "ai_command_logs" ADD CONSTRAINT "ai_command_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

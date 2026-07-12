-- CreateEnum
CREATE TYPE "AiOperationType" AS ENUM ('REPORT_NARRATIVE', 'DUPLICATE_DETECTION', 'SAVE_GUARD', 'RECOMMENDATION', 'NL_REPORT_QUERY', 'MATERIAL_PRICE_SYNC');

-- CreateEnum
CREATE TYPE "AiApprovalState" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "material_reference_prices" (
    "id" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "referencePrice" DECIMAL(14,2) NOT NULL,
    "referenceCurrency" TEXT NOT NULL,
    "referenceSource" TEXT NOT NULL,
    "referenceRegion" TEXT,
    "referenceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_reference_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_request_logs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "operationType" "AiOperationType" NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "sourceModules" TEXT[],
    "recordIds" TEXT[],
    "tokensPrompt" INTEGER NOT NULL,
    "tokensCompletion" INTEGER NOT NULL,
    "costUsd" DECIMAL(12,6),
    "outputSummary" TEXT NOT NULL,
    "approvalState" "AiApprovalState" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "material_reference_prices_materialId_referenceUpdatedAt_idx" ON "material_reference_prices"("materialId", "referenceUpdatedAt");

-- CreateIndex
CREATE INDEX "ai_request_logs_userId_idx" ON "ai_request_logs"("userId");

-- CreateIndex
CREATE INDEX "ai_request_logs_operationType_createdAt_idx" ON "ai_request_logs"("operationType", "createdAt");

-- CreateIndex
CREATE INDEX "ai_request_logs_createdAt_idx" ON "ai_request_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "material_reference_prices" ADD CONSTRAINT "material_reference_prices_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_request_logs" ADD CONSTRAINT "ai_request_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


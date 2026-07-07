-- CreateEnum
CREATE TYPE "EstimationDraftStatus" AS ENUM ('DRAFT_GENERATED', 'CLARIFICATION_NEEDED', 'MATERIALS_PENDING', 'READY_FOR_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "EstimationMaterialResolutionStatus" AS ENUM ('MATCHED', 'PENDING_APPROVAL', 'APPROVED_CREATE', 'SKIPPED');

-- CreateTable
CREATE TABLE "estimation_template_drafts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "EstimationDraftStatus" NOT NULL DEFAULT 'DRAFT_GENERATED',
    "originalCommand" TEXT NOT NULL,
    "clarificationLog" JSONB,
    "projectType" TEXT,
    "constructionType" TEXT,
    "scopeOfWork" TEXT,
    "areaValue" DECIMAL(14,3),
    "areaUnit" TEXT,
    "wastePercentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "templateName" TEXT,
    "generatedItems" JSONB NOT NULL,
    "estimatedTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "resultTemplateId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estimation_template_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimation_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "projectType" TEXT,
    "constructionType" TEXT,
    "scopeOfWork" TEXT,
    "areaValue" DECIMAL(14,3),
    "areaUnit" TEXT,
    "wastePercentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "estimatedTotal" DECIMAL(14,2) NOT NULL,
    "isPreliminary" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "estimation_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimation_template_items" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "category" "CostCategory" NOT NULL,
    "materialId" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3),
    "unit" TEXT,
    "unitPrice" DECIMAL(14,2),
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estimation_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimation_audit_logs" (
    "id" UUID NOT NULL,
    "draftId" UUID NOT NULL,
    "userId" UUID,
    "eventType" TEXT NOT NULL,
    "originalCommand" TEXT NOT NULL,
    "parsedIntent" JSONB,
    "generatedEstimation" JSONB,
    "existingMaterialsUsed" JSONB,
    "newlyCreatedMaterials" JSONB,
    "userApproval" JSONB,
    "executedActions" JSONB,
    "finalSavedValues" JSONB,
    "failedReason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimation_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "estimation_template_drafts_resultTemplateId_key" ON "estimation_template_drafts"("resultTemplateId");

-- CreateIndex
CREATE INDEX "estimation_template_drafts_userId_idx" ON "estimation_template_drafts"("userId");

-- CreateIndex
CREATE INDEX "estimation_template_drafts_status_idx" ON "estimation_template_drafts"("status");

-- CreateIndex
CREATE INDEX "estimation_template_drafts_expiresAt_idx" ON "estimation_template_drafts"("expiresAt");

-- CreateIndex
CREATE INDEX "estimation_templates_name_idx" ON "estimation_templates"("name");

-- CreateIndex
CREATE INDEX "estimation_templates_deletedAt_idx" ON "estimation_templates"("deletedAt");

-- CreateIndex
CREATE INDEX "estimation_template_items_templateId_idx" ON "estimation_template_items"("templateId");

-- CreateIndex
CREATE INDEX "estimation_template_items_materialId_idx" ON "estimation_template_items"("materialId");

-- CreateIndex
CREATE INDEX "estimation_template_items_category_idx" ON "estimation_template_items"("category");

-- CreateIndex
CREATE INDEX "estimation_audit_logs_draftId_idx" ON "estimation_audit_logs"("draftId");

-- CreateIndex
CREATE INDEX "estimation_audit_logs_userId_idx" ON "estimation_audit_logs"("userId");

-- CreateIndex
CREATE INDEX "estimation_audit_logs_eventType_idx" ON "estimation_audit_logs"("eventType");

-- CreateIndex
CREATE INDEX "estimation_audit_logs_createdAt_idx" ON "estimation_audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "estimation_template_drafts" ADD CONSTRAINT "estimation_template_drafts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimation_template_drafts" ADD CONSTRAINT "estimation_template_drafts_resultTemplateId_fkey" FOREIGN KEY ("resultTemplateId") REFERENCES "estimation_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimation_template_items" ADD CONSTRAINT "estimation_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "estimation_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimation_template_items" ADD CONSTRAINT "estimation_template_items_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimation_audit_logs" ADD CONSTRAINT "estimation_audit_logs_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "estimation_template_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimation_audit_logs" ADD CONSTRAINT "estimation_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

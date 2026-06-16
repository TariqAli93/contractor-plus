-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('CONTRACT', 'QUOTATION', 'INVOICE', 'REPORT');

-- CreateTable
CREATE TABLE "document_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "description" TEXT,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "placeholdersJson" JSONB,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_documents" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "contractId" UUID,
    "projectId" UUID,
    "customerId" UUID,
    "filename" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "generatedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_slug_key" ON "document_templates"("slug");

-- CreateIndex
CREATE INDEX "document_templates_category_idx" ON "document_templates"("category");

-- CreateIndex
CREATE INDEX "document_templates_isActive_idx" ON "document_templates"("isActive");

-- CreateIndex
CREATE INDEX "document_templates_isDefault_idx" ON "document_templates"("isDefault");

-- CreateIndex
CREATE INDEX "document_templates_deletedAt_idx" ON "document_templates"("deletedAt");

-- CreateIndex
CREATE INDEX "generated_documents_templateId_idx" ON "generated_documents"("templateId");

-- CreateIndex
CREATE INDEX "generated_documents_contractId_idx" ON "generated_documents"("contractId");

-- CreateIndex
CREATE INDEX "generated_documents_projectId_idx" ON "generated_documents"("projectId");

-- CreateIndex
CREATE INDEX "generated_documents_customerId_idx" ON "generated_documents"("customerId");

-- CreateIndex
CREATE INDEX "generated_documents_createdAt_idx" ON "generated_documents"("createdAt");

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "document_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_generatedBy_fkey" FOREIGN KEY ("generatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ai_provider_credentials" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "lastFour" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "validatedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "systemEnabled" BOOLEAN NOT NULL DEFAULT true,
    "features" JSONB,
    "modelDefault" TEXT,
    "modelHeavy" TEXT,
    "monthlyTokenBudget" INTEGER,
    "materialPriceSources" JSONB,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ai_provider_credentials" ADD CONSTRAINT "ai_provider_credentials_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


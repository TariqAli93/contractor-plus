/**
 * Converge RBAC only — permissions catalog + default role links — WITHOUT
 * touching domain data. Unlike `prisma db seed` (which clears and re-creates
 * the whole demo dataset), this is safe on any database at any time.
 *
 * Run after adding entries to rbac.catalog.ts:
 *   pnpm --filter backend rbac:seed
 */
import { PrismaClient } from '@prisma/client';
import { seedRbac } from '../prisma/seed/rbac.js';

const prisma = new PrismaClient();
try {
  await seedRbac(prisma);
  console.log('✓ RBAC converged.');
} finally {
  await prisma.$disconnect();
}

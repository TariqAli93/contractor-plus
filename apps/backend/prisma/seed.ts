import { PrismaClient, RoleName } from '@prisma/client';
import { seedUsers, DEMO_PASSWORD } from './seed/users.js';
import { seedCustomers } from './seed/customers.js';
import { seedMaterials } from './seed/materials.js';
import { seedTemplates } from './seed/templates.js';
import { seedScenarios } from './seed/scenarios.js';
import { seedSettings } from './seed/settings.js';

const prisma = new PrismaClient();

// Full demo seed:
//   - Roles upserted (idempotent).
//   - All domain data cleared and re-created in scenario form.
//   - Tunnel singleton and roles are preserved across runs.
//
// Run with:  npm run prisma:seed
async function main() {
  console.log('▶ Roles');
  await seedRoles();

  console.log('▶ Settings (currencies + company profile)');
  await seedSettings(prisma);

  console.log('▶ Clearing existing demo data');
  await clearDemoData();

  console.log('▶ Users');
  await seedUsers(prisma);

  console.log('▶ Customers');
  const customers = await seedCustomers(prisma);

  console.log('▶ Materials');
  const materials = await seedMaterials(prisma);

  console.log('▶ Templates');
  const templates = await seedTemplates(prisma, materials);

  console.log('▶ Scenarios (contracts, projects, costs, payments)');
  await seedScenarios(prisma, customers, materials, templates);

  console.log('\n✓ Seed complete.');
  console.log(`\n  Demo accounts (login by username, password: ${DEMO_PASSWORD}):`);
  console.log('    owner       — full access');
  console.log('    admin       — full access');
  console.log('    accountant  — finance reads + writes');
  console.log('    engineer    — projects + costs');
  console.log('    viewer      — read-only');
}

async function seedRoles() {
  for (const name of Object.values(RoleName)) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`  ${Object.values(RoleName).length} roles upserted`);
}

// Order matters: children before parents. Roles and TunnelState are preserved.
async function clearDemoData() {
  await prisma.auditLog.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.projectCost.deleteMany({});
  await prisma.constructionStep.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.contractItem.deleteMany({});
  await prisma.contract.deleteMany({});
  await prisma.buildingTemplateStep.deleteMany({});
  await prisma.buildingTemplateItem.deleteMany({});
  await prisma.buildingTemplate.deleteMany({});
  await prisma.material.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.user.deleteMany({});
}

main()
  .catch((err) => {
    console.error('\n✗ Seed failed:');
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { type PrismaClient, RoleName } from '@prisma/client';
import bcrypt from 'bcrypt';

// Shared password for demo. Print it after seeding so the operator can log in.
export const DEMO_PASSWORD = 'demo1234';

// Iraqi staff. Phone format: +964 mobile (770/780 prefixes). The login
// structure (emails + roles) is unchanged so existing demo accounts keep
// working.
const DEMO_USERS: Array<{
  email: string;
  fullName: string;
  phone: string;
  role: RoleName;
}> = [
  {
    email: 'owner@contractor.demo',
    fullName: 'طارق علي',
    phone: '+9647701000001',
    role: RoleName.OWNER,
  },
  {
    email: 'admin@contractor.demo',
    fullName: 'علي جاسم',
    phone: '+9647801000002',
    role: RoleName.ADMIN,
  },
  {
    email: 'accountant@contractor.demo',
    fullName: 'محمد كريم',
    phone: '+9647701000003',
    role: RoleName.ACCOUNTANT,
  },
  {
    email: 'engineer@contractor.demo',
    fullName: 'حسين كاظم',
    phone: '+9647801000004',
    role: RoleName.ENGINEER,
  },
  {
    email: 'viewer@contractor.demo',
    fullName: 'سجاد مهدي',
    phone: '+9647701000005',
    role: RoleName.VIEWER,
  },
];

export async function seedUsers(prisma: PrismaClient) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const roles = await prisma.role.findMany();
  const roleByName = new Map(roles.map((r) => [r.name, r.id]));

  const created = [];
  for (const u of DEMO_USERS) {
    const roleId = roleByName.get(u.role);
    if (!roleId) throw new Error(`Role ${u.role} not seeded — run role seeding first`);
    const user = await prisma.user.create({
      data: {
        email: u.email,
        passwordHash,
        fullName: u.fullName,
        phone: u.phone,
        roleId,
        isActive: true,
      },
    });
    created.push(user);
  }
  console.log(`  ${created.length} users (password for all: ${DEMO_PASSWORD})`);
  return created;
}

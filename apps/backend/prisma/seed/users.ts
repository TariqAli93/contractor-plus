import { type PrismaClient, RoleName } from '@prisma/client';
import bcrypt from 'bcrypt';

// Shared password for demo. Print it after seeding so the operator can log in.
export const DEMO_PASSWORD = 'demo1234';

const DEMO_USERS: Array<{
  email: string;
  fullName: string;
  phone: string;
  role: RoleName;
}> = [
  {
    email: 'owner@contractor.demo',
    fullName: 'Khalil Owner',
    phone: '+96170100001',
    role: RoleName.OWNER,
  },
  {
    email: 'admin@contractor.demo',
    fullName: 'Sara Admin',
    phone: '+96170100002',
    role: RoleName.ADMIN,
  },
  {
    email: 'accountant@contractor.demo',
    fullName: 'Nour Accountant',
    phone: '+96170100003',
    role: RoleName.ACCOUNTANT,
  },
  {
    email: 'engineer@contractor.demo',
    fullName: 'Walid Engineer',
    phone: '+96170100004',
    role: RoleName.ENGINEER,
  },
  {
    email: 'viewer@contractor.demo',
    fullName: 'Lina Viewer',
    phone: '+96170100005',
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

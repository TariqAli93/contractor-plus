import type { PrismaClient } from '@prisma/client';

// Lebanese customer names + realistic addresses. Phone format: +961 mobile.
const CUSTOMERS = [
  {
    name: 'Ahmad Khalil',
    phone: '+96170200001',
    email: 'ahmad.khalil@example.lb',
    address: 'Beirut, Achrafieh',
    notes: 'Repeat customer — two villas to date',
  },
  {
    name: 'Sara Karam',
    phone: '+96170200002',
    email: 'sara.karam@example.lb',
    address: 'Beirut, Hamra',
    notes: 'Commercial office renovations',
  },
  {
    name: 'Hariri Construction',
    phone: '+96170200003',
    email: 'info@hariri-construction.lb',
    address: 'Saida — coastal road',
    notes: 'Bulk contractor — warehouses and depots',
  },
  {
    name: 'Mansour Family',
    phone: '+96170200004',
    email: null,
    address: 'Mount Lebanon, Bikfaya',
    notes: 'Long-term family project — multi-generational home',
  },
  {
    name: 'Mohamed Ramadan',
    phone: '+96170200005',
    email: 'm.ramadan@example.lb',
    address: 'Tripoli, Al-Mina',
    notes: 'Pays cash up-front',
  },
  {
    name: 'Abou Zeid Holdings',
    phone: '+96170200006',
    email: 'finance@abouzeid-group.lb',
    address: 'Beirut, Verdun',
    notes: 'Commercial real estate developer',
  },
  {
    name: 'Khaled Hammoud',
    phone: '+96170200007',
    email: null,
    address: 'Aley',
    notes: null,
  },
  {
    name: 'Tabbara Holdings',
    phone: '+96170200008',
    email: 'projects@tabbara.lb',
    address: 'Beirut, Downtown',
    notes: 'Large residential developer — multiple projects pipelined',
  },
  {
    name: 'Lina Saad',
    phone: '+96170200009',
    email: 'lina.saad@example.lb',
    address: 'Jounieh',
    notes: null,
  },
  {
    name: 'Walid Mokdad',
    phone: '+96170200010',
    email: null,
    address: 'Baalbek',
    notes: 'Withdrew last project — financial issues at time of signing',
  },
  {
    name: 'Maalouf Group',
    phone: '+96170200011',
    email: 'contact@maalouf-group.lb',
    address: 'Zahlé',
    notes: 'New client — first inquiry pending',
  },
];

export async function seedCustomers(prisma: PrismaClient) {
  const created = [];
  for (const c of CUSTOMERS) {
    const customer = await prisma.customer.create({ data: c });
    created.push(customer);
  }
  console.log(`  ${created.length} customers`);
  return created;
}

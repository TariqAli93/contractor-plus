import type { PrismaClient } from '@prisma/client';

// Iraqi customer names (Baghdad + Samarra) with realistic addresses.
// Phone format: +964 mobile (770/780 prefixes). Exported as constants so the
// scenario seeder can reference customers without risking name typos.
export const CUSTOMER_NAMES = {
  AHMED_ABDULAMEER: 'أحمد عبد الأمير',
  HASAN_KADHIM: 'حسن كاظم',
  ZAHRAA_ALI: 'زهراء علي',
  RAFIDAIN: 'شركة الرافدين للمقاولات',
  BAGHDAD_HADITHA: 'شركة بغداد الحديثة للاستثمار',
  MUSTAFA_SAADOUN: 'مصطفى سعدون',
  FATIMA_MOHAMMED: 'فاطمة محمد',
  HUSSEIN_MAHDI: 'حسين مهدي',
  DIJLA: 'شركة دجلة للإعمار',
  SAJJAD_ABBAS: 'سجاد عباس',
  KARRAR_JABBAR: 'كرار جبار',
} as const;

const CUSTOMERS = [
  {
    name: CUSTOMER_NAMES.AHMED_ABDULAMEER,
    phone: '+9647702000001',
    email: 'ahmed.abdulameer@example.iq',
    address: 'بغداد - الكرادة',
    notes: 'زبون متكرر — دار مكتملة ومشروع جديد قيد الدراسة',
  },
  {
    name: CUSTOMER_NAMES.HASAN_KADHIM,
    phone: '+9647802000002',
    email: null,
    address: 'سامراء - حي المعتصم',
    notes: 'دار سكنية مكتملة، استلام في الموعد',
  },
  {
    name: CUSTOMER_NAMES.ZAHRAA_ALI,
    phone: '+9647702000003',
    email: 'zahraa.ali@example.iq',
    address: 'سامراء - حي المثنى',
    notes: 'مشروع متوقف بانتظار تعديل التصميم',
  },
  {
    name: CUSTOMER_NAMES.RAFIDAIN,
    phone: '+9647802000004',
    email: 'info@rafidain-contracting.iq',
    address: 'بغداد - المنصور',
    notes: 'مقاول بالجملة — مجمعات تجارية ومخازن',
  },
  {
    name: CUSTOMER_NAMES.BAGHDAD_HADITHA,
    phone: '+9647702000005',
    email: 'finance@baghdad-haditha.iq',
    address: 'بغداد - الجادرية',
    notes: 'شركة استثمار عقاري — مشاريع تجارية',
  },
  {
    name: CUSTOMER_NAMES.MUSTAFA_SAADOUN,
    phone: '+9647802000006',
    email: 'm.saadoun@example.iq',
    address: 'بغداد - زيونة',
    notes: 'يدفع نقداً مقدماً',
  },
  {
    name: CUSTOMER_NAMES.FATIMA_MOHAMMED,
    phone: '+9647702000007',
    email: null,
    address: 'سامراء - حي القادسية',
    notes: 'دار عائلية — استلمت بالكامل',
  },
  {
    name: CUSTOMER_NAMES.HUSSEIN_MAHDI,
    phone: '+9647802000008',
    email: 'hussein.mahdi@example.iq',
    address: 'بغداد - الأعظمية',
    notes: 'دار سكنية قيد التنفيذ',
  },
  {
    name: CUSTOMER_NAMES.DIJLA,
    phone: '+9647702000009',
    email: 'projects@dijla-construction.iq',
    address: 'بغداد - بغداد الجديدة',
    notes: 'مطوّر عقاري سكني وتجاري — عدة مشاريع',
  },
  {
    name: CUSTOMER_NAMES.SAJJAD_ABBAS,
    phone: '+9647802000010',
    email: null,
    address: 'بغداد - الكرادة',
    notes: 'عميل جديد — العرض السعري قيد الدراسة',
  },
  {
    name: CUSTOMER_NAMES.KARRAR_JABBAR,
    phone: '+9647702000011',
    email: 'karrar.jabbar@example.iq',
    address: 'سامراء - مركز سامراء',
    notes: 'مزرعة سكنية قيد التنفيذ',
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

import type { Material, PrismaClient } from '@prisma/client';

// Construction materials priced at Iraqi market values (IQD). The English
// prefix is kept before the Arabic descriptor so existing lookups
// (findMaterial, by English prefix) keep working while the UI shows usable
// bilingual labels.
const MATERIALS = [
  { name: 'Portland Cement (إسمنت بورتلاندي)', unit: 'bag', defaultPrice: 12000, notes: 'كيس 50 كغم، رمادي' },
  { name: 'Sand (رمل)', unit: 'm³', defaultPrice: 45000, notes: 'رمل بناء مغسول' },
  { name: 'Gravel (حصى)', unit: 'm³', defaultPrice: 55000, notes: 'حصى مكسر 3/4 إنج' },
  { name: 'Steel rebar 12mm (حديد تسليح 12 ملم)', unit: 'ton', defaultPrice: 1150000, notes: null },
  { name: 'Steel rebar 16mm (حديد تسليح 16 ملم)', unit: 'ton', defaultPrice: 1200000, notes: null },
  { name: 'Concrete blocks (بلوك)', unit: 'piece', defaultPrice: 1500, notes: '20×20×40 سم' },
  { name: 'Red brick (طابوق)', unit: 'piece', defaultPrice: 500, notes: 'طابوق فخاري' },
  { name: 'Ceramic tiles (سيراميك)', unit: 'm²', defaultPrice: 25000, notes: 'سيراميك أرضيات' },
  { name: 'Marble (رخام)', unit: 'm²', defaultPrice: 85000, notes: 'رخام محلي' },
  { name: 'Wall paint (دهان)', unit: 'bucket', defaultPrice: 65000, notes: 'دلو 20 لتر، داخلي' },
  { name: 'Wood doors (أبواب خشب)', unit: 'piece', defaultPrice: 450000, notes: 'باب داخلي مع الإطار' },
  { name: 'Aluminum windows (شبابيك ألمنيوم)', unit: 'm²', defaultPrice: 150000, notes: 'زجاج مفرد' },
  { name: 'Electrical wiring (أسلاك كهربائية)', unit: 'meter', defaultPrice: 4000, notes: 'نحاس 2.5 ملم²' },
  { name: 'PVC piping (أنابيب PVC)', unit: 'meter', defaultPrice: 5000, notes: 'مجاري 4 إنج' },
  { name: 'Insulation (عازل حراري)', unit: 'm²', defaultPrice: 20000, notes: 'ألواح بوليسترين 5 سم' },
  { name: 'Roof tiles (قرميد)', unit: 'm²', defaultPrice: 30000, notes: 'قرميد طيني' },
];

export async function seedMaterials(prisma: PrismaClient) {
  const created: Material[] = [];
  for (const m of MATERIALS) {
    const material = await prisma.material.create({ data: m });
    created.push(material);
  }
  console.log(`  ${created.length} materials`);
  return created;
}

// Lookup helper used by template + cost seeders.
export function findMaterial(materials: Material[], englishPrefix: string): Material {
  const m = materials.find((m) => m.name.startsWith(englishPrefix));
  if (!m) throw new Error(`Material not found by prefix: ${englishPrefix}`);
  return m;
}

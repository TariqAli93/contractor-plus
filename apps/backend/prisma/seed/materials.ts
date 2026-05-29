import type { Material, PrismaClient } from '@prisma/client';

// Construction materials with Arabic descriptors after the English name so
// the UI displays usable bilingual labels. Lookup is by the English prefix.
const MATERIALS = [
  { name: 'Portland Cement (إسمنت بورتلاند)', unit: 'bag', defaultPrice: 9.5, notes: '50kg bag, gray' },
  { name: 'Sand (رمل)', unit: 'm³', defaultPrice: 30.0, notes: 'Construction sand, washed' },
  { name: 'Gravel (حصى)', unit: 'm³', defaultPrice: 35.0, notes: 'Crushed stone 3/4"' },
  { name: 'Steel rebar 12mm (حديد 12)', unit: 'ton', defaultPrice: 850.0, notes: null },
  { name: 'Steel rebar 16mm (حديد 16)', unit: 'ton', defaultPrice: 870.0, notes: null },
  { name: 'Concrete blocks (بلوك)', unit: 'piece', defaultPrice: 1.1, notes: '20×20×40cm' },
  { name: 'Red brick (طوب أحمر)', unit: 'piece', defaultPrice: 0.45, notes: null },
  { name: 'Ceramic tiles (بلاط سيراميك)', unit: 'm²', defaultPrice: 18.0, notes: 'Standard floor tiles' },
  { name: 'Marble (رخام)', unit: 'm²', defaultPrice: 55.0, notes: 'Local Lebanese marble' },
  { name: 'Wall paint (دهان جدران)', unit: 'bucket', defaultPrice: 42.0, notes: '20L bucket, interior' },
  { name: 'Wood doors (أبواب خشب)', unit: 'piece', defaultPrice: 380.0, notes: 'Standard interior door + frame' },
  { name: 'Aluminum windows (نوافذ ألمنيوم)', unit: 'm²', defaultPrice: 110.0, notes: 'Single-glazed' },
  { name: 'Electrical wiring (أسلاك كهربائية)', unit: 'meter', defaultPrice: 2.5, notes: '2.5mm² copper' },
  { name: 'PVC piping (أنابيب PVC)', unit: 'meter', defaultPrice: 3.2, notes: '4-inch sewage' },
  { name: 'Insulation (عازل حراري)', unit: 'm²', defaultPrice: 8.5, notes: 'Polystyrene boards 5cm' },
  { name: 'Roof tiles (قرميد)', unit: 'm²', defaultPrice: 22.0, notes: 'Traditional Lebanese red' },
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

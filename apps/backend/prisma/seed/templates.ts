import type { BuildingTemplate, Material, PrismaClient } from '@prisma/client';
import { findMaterial } from './materials.js';

interface ItemDef {
  englishMaterial: string;
  quantityFormula: string;
  estimatedQuantity: number;
  estimatedPrice: number;
  notes?: string;
}

interface StepDef {
  name: string;
  percentage: number;
  sortOrder: number;
  estimatedDays: number;
}

interface TemplateDef {
  name: string;
  description: string;
  estimatedDurationDays: number;
  suggestedProfitMargin: number;
  items: ItemDef[];
  steps: StepDef[];
}

// All templates are sized for the 100m² × 1-floor baseline. Estimate generation
// in contracts scales these proportionally.
const TEMPLATES: TemplateDef[] = [
  {
    name: 'House 100m² — single floor (بيت 100م طابق واحد)',
    description: 'Standard residential, finished. Used for area-scaled estimates.',
    estimatedDurationDays: 90,
    suggestedProfitMargin: 18,
    items: [
      { englishMaterial: 'Portland Cement', quantityFormula: 'area * 5',   estimatedQuantity: 500,  estimatedPrice: 4750 },
      { englishMaterial: 'Sand',            quantityFormula: 'area * 0.3', estimatedQuantity: 30,   estimatedPrice: 900 },
      { englishMaterial: 'Gravel',          quantityFormula: 'area * 0.4', estimatedQuantity: 40,   estimatedPrice: 1400 },
      { englishMaterial: 'Steel rebar 12mm', quantityFormula: 'area * 0.04', estimatedQuantity: 4,  estimatedPrice: 3400 },
      { englishMaterial: 'Concrete blocks', quantityFormula: 'area * 30',  estimatedQuantity: 3000, estimatedPrice: 3300 },
      { englishMaterial: 'Ceramic tiles',   quantityFormula: 'area * 1',   estimatedQuantity: 100,  estimatedPrice: 1800 },
      { englishMaterial: 'Wall paint',      quantityFormula: 'area * 0.1', estimatedQuantity: 10,   estimatedPrice: 420 },
      { englishMaterial: 'Wood doors',      quantityFormula: '6',          estimatedQuantity: 6,    estimatedPrice: 2280 },
      { englishMaterial: 'Aluminum windows', quantityFormula: '12',        estimatedQuantity: 12,   estimatedPrice: 1320 },
      { englishMaterial: 'Electrical wiring', quantityFormula: 'area * 4', estimatedQuantity: 400,  estimatedPrice: 1000 },
      { englishMaterial: 'PVC piping',      quantityFormula: 'area * 1.5', estimatedQuantity: 150,  estimatedPrice: 480 },
    ],
    steps: [
      { name: 'Foundation (الأساسات)',         percentage: 25, sortOrder: 1, estimatedDays: 20 },
      { name: 'Structure (الهيكل)',            percentage: 30, sortOrder: 2, estimatedDays: 25 },
      { name: 'Walls & roof (الجدران والسقف)', percentage: 20, sortOrder: 3, estimatedDays: 20 },
      { name: 'Finishing (التشطيب)',           percentage: 20, sortOrder: 4, estimatedDays: 20 },
      { name: 'Handover (التسليم)',            percentage: 5,  sortOrder: 5, estimatedDays: 5 },
    ],
  },
  {
    name: 'House 200m² — two floors (بيت 200م طابقين)',
    description: 'Two-floor residential, premium finishing. Baseline doubles the 100m² template plus structural reinforcement.',
    estimatedDurationDays: 150,
    suggestedProfitMargin: 20,
    items: [
      { englishMaterial: 'Portland Cement', quantityFormula: 'area * 5.5', estimatedQuantity: 550,  estimatedPrice: 5225 },
      { englishMaterial: 'Sand',            quantityFormula: 'area * 0.35', estimatedQuantity: 35,  estimatedPrice: 1050 },
      { englishMaterial: 'Gravel',          quantityFormula: 'area * 0.5', estimatedQuantity: 50,   estimatedPrice: 1750 },
      { englishMaterial: 'Steel rebar 16mm', quantityFormula: 'area * 0.05', estimatedQuantity: 5,  estimatedPrice: 4350 },
      { englishMaterial: 'Concrete blocks', quantityFormula: 'area * 35',  estimatedQuantity: 3500, estimatedPrice: 3850 },
      { englishMaterial: 'Marble',          quantityFormula: 'area * 0.4', estimatedQuantity: 40,   estimatedPrice: 2200, notes: 'Living spaces' },
      { englishMaterial: 'Ceramic tiles',   quantityFormula: 'area * 0.7', estimatedQuantity: 70,   estimatedPrice: 1260, notes: 'Bedrooms + utility' },
      { englishMaterial: 'Wall paint',      quantityFormula: 'area * 0.12', estimatedQuantity: 12,  estimatedPrice: 504 },
      { englishMaterial: 'Wood doors',      quantityFormula: '10',         estimatedQuantity: 10,   estimatedPrice: 3800 },
      { englishMaterial: 'Aluminum windows', quantityFormula: '18',        estimatedQuantity: 18,   estimatedPrice: 1980 },
      { englishMaterial: 'Electrical wiring', quantityFormula: 'area * 5', estimatedQuantity: 500,  estimatedPrice: 1250 },
      { englishMaterial: 'PVC piping',      quantityFormula: 'area * 2',   estimatedQuantity: 200,  estimatedPrice: 640 },
      { englishMaterial: 'Insulation',      quantityFormula: 'area * 1.5', estimatedQuantity: 150,  estimatedPrice: 1275 },
      { englishMaterial: 'Roof tiles',      quantityFormula: 'area * 0.6', estimatedQuantity: 60,   estimatedPrice: 1320 },
    ],
    steps: [
      { name: 'Foundation (الأساسات)',         percentage: 20, sortOrder: 1, estimatedDays: 25 },
      { name: 'Ground floor structure (الطابق الأرضي)', percentage: 20, sortOrder: 2, estimatedDays: 30 },
      { name: 'First floor structure (الطابق الأول)', percentage: 20, sortOrder: 3, estimatedDays: 30 },
      { name: 'Roof & external walls (السقف والواجهات)', percentage: 15, sortOrder: 4, estimatedDays: 20 },
      { name: 'Internal finishing (تشطيب داخلي)', percentage: 20, sortOrder: 5, estimatedDays: 35 },
      { name: 'Handover (التسليم)',            percentage: 5,  sortOrder: 6, estimatedDays: 10 },
    ],
  },
  {
    name: 'Commercial store (محل تجاري)',
    description: 'Single-unit commercial space, basic finish. Smaller fittings, no kitchen/plumbing fixtures.',
    estimatedDurationDays: 60,
    suggestedProfitMargin: 15,
    items: [
      { englishMaterial: 'Portland Cement', quantityFormula: 'area * 3',   estimatedQuantity: 300,  estimatedPrice: 2850 },
      { englishMaterial: 'Sand',            quantityFormula: 'area * 0.2', estimatedQuantity: 20,   estimatedPrice: 600 },
      { englishMaterial: 'Steel rebar 12mm', quantityFormula: 'area * 0.025', estimatedQuantity: 2.5, estimatedPrice: 2125 },
      { englishMaterial: 'Concrete blocks', quantityFormula: 'area * 20',  estimatedQuantity: 2000, estimatedPrice: 2200 },
      { englishMaterial: 'Ceramic tiles',   quantityFormula: 'area * 1',   estimatedQuantity: 100,  estimatedPrice: 1800 },
      { englishMaterial: 'Wall paint',      quantityFormula: 'area * 0.08', estimatedQuantity: 8,   estimatedPrice: 336 },
      { englishMaterial: 'Aluminum windows', quantityFormula: '6',         estimatedQuantity: 6,    estimatedPrice: 660, notes: 'Storefront + facade' },
      { englishMaterial: 'Electrical wiring', quantityFormula: 'area * 3', estimatedQuantity: 300,  estimatedPrice: 750 },
    ],
    steps: [
      { name: 'Foundation & slab (الأساسات والبلاطة)', percentage: 25, sortOrder: 1, estimatedDays: 12 },
      { name: 'Walls & enclosure (الجدران والإغلاق)', percentage: 35, sortOrder: 2, estimatedDays: 18 },
      { name: 'Finishing (التشطيب)',                percentage: 30, sortOrder: 3, estimatedDays: 22 },
      { name: 'Handover (التسليم)',                 percentage: 10, sortOrder: 4, estimatedDays: 8 },
    ],
  },
  {
    name: 'Skeleton only (هيكل فقط)',
    description: 'Structural shell only — no finishing, no fixtures. For commercial / industrial / customer-finished projects.',
    estimatedDurationDays: 45,
    suggestedProfitMargin: 12,
    items: [
      { englishMaterial: 'Portland Cement', quantityFormula: 'area * 4',   estimatedQuantity: 400,  estimatedPrice: 3800 },
      { englishMaterial: 'Sand',            quantityFormula: 'area * 0.3', estimatedQuantity: 30,   estimatedPrice: 900 },
      { englishMaterial: 'Gravel',          quantityFormula: 'area * 0.4', estimatedQuantity: 40,   estimatedPrice: 1400 },
      { englishMaterial: 'Steel rebar 16mm', quantityFormula: 'area * 0.045', estimatedQuantity: 4.5, estimatedPrice: 3915 },
      { englishMaterial: 'Concrete blocks', quantityFormula: 'area * 25',  estimatedQuantity: 2500, estimatedPrice: 2750 },
    ],
    steps: [
      { name: 'Foundation (الأساسات)',     percentage: 35, sortOrder: 1, estimatedDays: 15 },
      { name: 'Columns & beams (الأعمدة والجسور)', percentage: 40, sortOrder: 2, estimatedDays: 20 },
      { name: 'Walls & roof slab (الجدران والسقف)', percentage: 25, sortOrder: 3, estimatedDays: 10 },
    ],
  },
];

export async function seedTemplates(prisma: PrismaClient, materials: Material[]) {
  const created: BuildingTemplate[] = [];
  for (const t of TEMPLATES) {
    const template = await prisma.buildingTemplate.create({
      data: {
        name: t.name,
        description: t.description,
        estimatedDurationDays: t.estimatedDurationDays,
        suggestedProfitMargin: t.suggestedProfitMargin,
        isActive: true,
        items: {
          create: t.items.map((i) => {
            const mat = findMaterial(materials, i.englishMaterial);
            return {
              materialId: mat.id,
              quantityFormula: i.quantityFormula,
              estimatedQuantity: i.estimatedQuantity,
              estimatedPrice: i.estimatedPrice,
              notes: i.notes ?? null,
            };
          }),
        },
        steps: { create: t.steps },
      },
    });
    created.push(template);
  }
  console.log(`  ${created.length} templates`);
  return created;
}

// Lookup helper used by scenarios.
export function findTemplate(templates: BuildingTemplate[], englishPrefix: string): BuildingTemplate {
  const t = templates.find((t) => t.name.startsWith(englishPrefix));
  if (!t) throw new Error(`Template not found by prefix: ${englishPrefix}`);
  return t;
}

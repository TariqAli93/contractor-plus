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

// Exported template names. Scenario seeding references these directly so the
// (Arabic) names stay in one place and lookups can't drift.
export const TEMPLATE_NAMES = {
  HOUSE_50: 'بيت 50 متر — طابق واحد',
  HOUSE_75: 'بيت 75 متر — طابق واحد',
  HOUSE_100_A: 'بيت 100 متر طابقين — واجهة 6.25 نزال 16',
  HOUSE_100_B: 'بيت 100 متر طابقين — واجهة 5 نزال 20',
  HOUSE_100_C: 'بيت 100 متر طابقين — واجهة 8 نزال 12.5',
  HOUSE_150_A: 'بيت 150 متر طابقين — واجهة 7.5 نزال 20',
  HOUSE_150_B: 'بيت 150 متر طابقين — واجهة 9.37 نزال 16',
  HOUSE_150_C: 'بيت 150 متر طابقين — واجهة 10 نزال 15',
  HOUSE_200_A: 'بيت 200 متر طابقين — واجهة 10 نزال 20',
  HOUSE_200_B: 'بيت 200 متر طابقين — واجهة 20 نزال 10',
  HOUSE_300: 'بيت 300 متر طابقين — واجهة 15 نزال 20',
  FARM: 'مزرعة سكنية',
} as const;

// ----- Reusable material baskets (sized for a 100 m² built-area baseline;
// contract estimate generation scales these proportionally) -----

// Single-floor finished house.
const ITEMS_SINGLE_FLOOR: ItemDef[] = [
  { englishMaterial: 'Portland Cement', quantityFormula: 'area * 5',    estimatedQuantity: 500,  estimatedPrice: 6000000 },
  { englishMaterial: 'Sand',            quantityFormula: 'area * 0.3',  estimatedQuantity: 30,   estimatedPrice: 1350000 },
  { englishMaterial: 'Gravel',          quantityFormula: 'area * 0.4',  estimatedQuantity: 40,   estimatedPrice: 2200000 },
  { englishMaterial: 'Steel rebar 12mm', quantityFormula: 'area * 0.04', estimatedQuantity: 4,   estimatedPrice: 4600000 },
  { englishMaterial: 'Concrete blocks', quantityFormula: 'area * 30',   estimatedQuantity: 3000, estimatedPrice: 4500000 },
  { englishMaterial: 'Ceramic tiles',   quantityFormula: 'area * 1',    estimatedQuantity: 100,  estimatedPrice: 2500000 },
  { englishMaterial: 'Wall paint',      quantityFormula: 'area * 0.1',  estimatedQuantity: 10,   estimatedPrice: 650000 },
  { englishMaterial: 'Wood doors',      quantityFormula: '6',           estimatedQuantity: 6,    estimatedPrice: 2700000 },
  { englishMaterial: 'Aluminum windows', quantityFormula: '12',         estimatedQuantity: 12,   estimatedPrice: 1800000 },
  { englishMaterial: 'Electrical wiring', quantityFormula: 'area * 4',  estimatedQuantity: 400,  estimatedPrice: 1600000 },
  { englishMaterial: 'PVC piping',      quantityFormula: 'area * 1.5',  estimatedQuantity: 150,  estimatedPrice: 750000 },
];

// Two-floor premium house (adds reinforcement, marble, insulation, roof tiles).
const ITEMS_TWO_FLOOR: ItemDef[] = [
  { englishMaterial: 'Portland Cement', quantityFormula: 'area * 5.5',  estimatedQuantity: 550,  estimatedPrice: 6600000 },
  { englishMaterial: 'Sand',            quantityFormula: 'area * 0.35', estimatedQuantity: 35,   estimatedPrice: 1575000 },
  { englishMaterial: 'Gravel',          quantityFormula: 'area * 0.5',  estimatedQuantity: 50,   estimatedPrice: 2750000 },
  { englishMaterial: 'Steel rebar 16mm', quantityFormula: 'area * 0.05', estimatedQuantity: 5,   estimatedPrice: 6000000 },
  { englishMaterial: 'Concrete blocks', quantityFormula: 'area * 35',   estimatedQuantity: 3500, estimatedPrice: 5250000 },
  { englishMaterial: 'Marble',          quantityFormula: 'area * 0.4',  estimatedQuantity: 40,   estimatedPrice: 3400000, notes: 'المناطق المعيشية' },
  { englishMaterial: 'Ceramic tiles',   quantityFormula: 'area * 0.7',  estimatedQuantity: 70,   estimatedPrice: 1750000, notes: 'غرف النوم والخدمات' },
  { englishMaterial: 'Wall paint',      quantityFormula: 'area * 0.12', estimatedQuantity: 12,   estimatedPrice: 780000 },
  { englishMaterial: 'Wood doors',      quantityFormula: '10',          estimatedQuantity: 10,   estimatedPrice: 4500000 },
  { englishMaterial: 'Aluminum windows', quantityFormula: '18',         estimatedQuantity: 18,   estimatedPrice: 2700000 },
  { englishMaterial: 'Electrical wiring', quantityFormula: 'area * 5',  estimatedQuantity: 500,  estimatedPrice: 2000000 },
  { englishMaterial: 'PVC piping',      quantityFormula: 'area * 2',    estimatedQuantity: 200,  estimatedPrice: 1000000 },
  { englishMaterial: 'Insulation',      quantityFormula: 'area * 1.5',  estimatedQuantity: 150,  estimatedPrice: 3000000 },
  { englishMaterial: 'Roof tiles',      quantityFormula: 'area * 0.6',  estimatedQuantity: 60,   estimatedPrice: 1800000 },
];

// Farm house — single floor plus boundary wall + brick + irrigation runs.
const ITEMS_FARM: ItemDef[] = [
  { englishMaterial: 'Portland Cement', quantityFormula: 'area * 5.5',  estimatedQuantity: 550,  estimatedPrice: 6600000 },
  { englishMaterial: 'Sand',            quantityFormula: 'area * 0.35', estimatedQuantity: 35,   estimatedPrice: 1575000 },
  { englishMaterial: 'Gravel',          quantityFormula: 'area * 0.45', estimatedQuantity: 45,   estimatedPrice: 2475000 },
  { englishMaterial: 'Steel rebar 12mm', quantityFormula: 'area * 0.04', estimatedQuantity: 4,   estimatedPrice: 4600000 },
  { englishMaterial: 'Concrete blocks', quantityFormula: 'area * 40',   estimatedQuantity: 4000, estimatedPrice: 6000000, notes: 'سياج المزرعة' },
  { englishMaterial: 'Red brick',       quantityFormula: 'area * 20',   estimatedQuantity: 2000, estimatedPrice: 1000000 },
  { englishMaterial: 'Ceramic tiles',   quantityFormula: 'area * 0.9',  estimatedQuantity: 90,   estimatedPrice: 2250000 },
  { englishMaterial: 'Wall paint',      quantityFormula: 'area * 0.1',  estimatedQuantity: 10,   estimatedPrice: 650000 },
  { englishMaterial: 'Wood doors',      quantityFormula: '6',           estimatedQuantity: 6,    estimatedPrice: 2700000 },
  { englishMaterial: 'Aluminum windows', quantityFormula: '12',         estimatedQuantity: 12,   estimatedPrice: 1800000 },
  { englishMaterial: 'Electrical wiring', quantityFormula: 'area * 4.5', estimatedQuantity: 450, estimatedPrice: 1800000 },
  { englishMaterial: 'PVC piping',      quantityFormula: 'area * 2',    estimatedQuantity: 200,  estimatedPrice: 1000000, notes: 'ري وصرف' },
];

const STEPS_SINGLE_FLOOR: StepDef[] = [
  { name: 'الأساسات',                    percentage: 25, sortOrder: 1, estimatedDays: 18 },
  { name: 'الهيكل الخرساني',             percentage: 30, sortOrder: 2, estimatedDays: 22 },
  { name: 'بناء الجدران (طابوق وبلوك)',  percentage: 18, sortOrder: 3, estimatedDays: 16 },
  { name: 'التمديدات والتشطيبات',        percentage: 22, sortOrder: 4, estimatedDays: 22 },
  { name: 'التسليم',                     percentage: 5,  sortOrder: 5, estimatedDays: 5 },
];

const STEPS_TWO_FLOOR: StepDef[] = [
  { name: 'الأساسات',              percentage: 18, sortOrder: 1, estimatedDays: 22 },
  { name: 'الطابق الأرضي',         percentage: 20, sortOrder: 2, estimatedDays: 28 },
  { name: 'الطابق الأول',          percentage: 20, sortOrder: 3, estimatedDays: 28 },
  { name: 'السقف والواجهة',        percentage: 15, sortOrder: 4, estimatedDays: 18 },
  { name: 'التشطيبات الداخلية',    percentage: 22, sortOrder: 5, estimatedDays: 32 },
  { name: 'التسليم',               percentage: 5,  sortOrder: 6, estimatedDays: 8 },
];

const STEPS_FARM: StepDef[] = [
  { name: 'تسوية الأرض والأساسات',  percentage: 25, sortOrder: 1, estimatedDays: 16 },
  { name: 'الهيكل الخرساني',         percentage: 28, sortOrder: 2, estimatedDays: 20 },
  { name: 'بناء الجدران والسياج',    percentage: 22, sortOrder: 3, estimatedDays: 18 },
  { name: 'التمديدات والتشطيبات',    percentage: 20, sortOrder: 4, estimatedDays: 20 },
  { name: 'التسليم',                 percentage: 5,  sortOrder: 5, estimatedDays: 5 },
];

// ----- The 12 Iraqi residential templates -----
const TEMPLATES: TemplateDef[] = [
  {
    name: TEMPLATE_NAMES.HOUSE_50,
    description: 'بيت بطابق واحد، مساحة 50 م². واجهة 5 م، نزال 10 م.',
    estimatedDurationDays: 60,
    suggestedProfitMargin: 15,
    items: ITEMS_SINGLE_FLOOR,
    steps: STEPS_SINGLE_FLOOR,
  },
  {
    name: TEMPLATE_NAMES.HOUSE_75,
    description: 'بيت بطابق واحد، مساحة 75 م². واجهة 5 م، نزال 15 م.',
    estimatedDurationDays: 75,
    suggestedProfitMargin: 16,
    items: ITEMS_SINGLE_FLOOR,
    steps: STEPS_SINGLE_FLOOR,
  },
  {
    name: TEMPLATE_NAMES.HOUSE_100_A,
    description: 'بيت طابقين، مساحة الأرض 100 م². واجهة 6.25 م، نزال 16 م.',
    estimatedDurationDays: 110,
    suggestedProfitMargin: 18,
    items: ITEMS_TWO_FLOOR,
    steps: STEPS_TWO_FLOOR,
  },
  {
    name: TEMPLATE_NAMES.HOUSE_100_B,
    description: 'بيت طابقين، مساحة الأرض 100 م². واجهة 5 م، نزال 20 م.',
    estimatedDurationDays: 110,
    suggestedProfitMargin: 18,
    items: ITEMS_TWO_FLOOR,
    steps: STEPS_TWO_FLOOR,
  },
  {
    name: TEMPLATE_NAMES.HOUSE_100_C,
    description: 'بيت طابقين، مساحة الأرض 100 م². واجهة 8 م، نزال 12.5 م.',
    estimatedDurationDays: 110,
    suggestedProfitMargin: 18,
    items: ITEMS_TWO_FLOOR,
    steps: STEPS_TWO_FLOOR,
  },
  {
    name: TEMPLATE_NAMES.HOUSE_150_A,
    description: 'بيت طابقين, مساحة الأرض 150 م². واجهة 7.5 م، نزال 20 م.',
    estimatedDurationDays: 130,
    suggestedProfitMargin: 19,
    items: ITEMS_TWO_FLOOR,
    steps: STEPS_TWO_FLOOR,
  },
  {
    name: TEMPLATE_NAMES.HOUSE_150_B,
    description: 'بيت طابقين، مساحة الأرض 150 م². واجهة 9.37 م، نزال 16 م.',
    estimatedDurationDays: 130,
    suggestedProfitMargin: 19,
    items: ITEMS_TWO_FLOOR,
    steps: STEPS_TWO_FLOOR,
  },
  {
    name: TEMPLATE_NAMES.HOUSE_150_C,
    description: 'بيت طابقين، مساحة الأرض 150 م². واجهة 10 م، نزال 15 م.',
    estimatedDurationDays: 130,
    suggestedProfitMargin: 19,
    items: ITEMS_TWO_FLOOR,
    steps: STEPS_TWO_FLOOR,
  },
  {
    name: TEMPLATE_NAMES.HOUSE_200_A,
    description: 'بيت طابقين، مساحة الأرض 200 م². واجهة 10 م، نزال 20 م.',
    estimatedDurationDays: 150,
    suggestedProfitMargin: 20,
    items: ITEMS_TWO_FLOOR,
    steps: STEPS_TWO_FLOOR,
  },
  {
    name: TEMPLATE_NAMES.HOUSE_200_B,
    description: 'بيت طابقين، مساحة الأرض 200 م². واجهة 20 م، نزال 10 م.',
    estimatedDurationDays: 150,
    suggestedProfitMargin: 20,
    items: ITEMS_TWO_FLOOR,
    steps: STEPS_TWO_FLOOR,
  },
  {
    name: TEMPLATE_NAMES.HOUSE_300,
    description: 'بيت طابقين، مساحة الأرض 300 م². واجهة 15 م، نزال 20 م.',
    estimatedDurationDays: 180,
    suggestedProfitMargin: 21,
    items: ITEMS_TWO_FLOOR,
    steps: STEPS_TWO_FLOOR,
  },
  {
    name: TEMPLATE_NAMES.FARM,
    description: 'مزرعة سكنية، مساحة الأرض 1125 م². بيت داخل المزرعة 200 م² بطابق واحد.',
    estimatedDurationDays: 160,
    suggestedProfitMargin: 17,
    items: ITEMS_FARM,
    steps: STEPS_FARM,
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

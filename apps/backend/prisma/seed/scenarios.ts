import {
  type BuildingTemplate,
  type Customer,
  type Material,
  type PrismaClient,
  ContractStatus,
  CostCategory,
  PaymentMethod,
  PaymentStatus,
  ProjectStatus,
} from '@prisma/client';
import { daysAgo, daysFromNow } from './helpers.js';
import { findMaterial } from './materials.js';
import { findTemplate } from './templates.js';

// ----- Scenario types -----

interface CostEntry {
  category: CostCategory;
  englishMaterial?: string;
  description: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  totalAmount: number;
  daysAgo: number;
}

interface PaymentEntry {
  amount: number;
  dueDaysAgo: number; // negative = future
  paymentDaysAgo?: number; // present → PAID
  status: PaymentStatus;
  method?: PaymentMethod;
  reference?: string;
  notes?: string;
}

interface ScenarioDef {
  // Contract
  contractNumber: string;
  customerEnglishName: string;
  templateEnglishPrefix: string | null;
  buildingArea: number;
  floors: number;
  meterPrice: number;
  expectedProfitMargin: number | null;
  contractStatus: ContractStatus;
  signedDaysAgo: number | null;
  contractNotes: string | null;
  // Whether to create contract items (skip for DRAFT/CANCELLED-pre-approval)
  withItems: boolean;

  // Project (omitted for scenarios that don't have one)
  project?: {
    name: string;
    status: ProjectStatus;
    startDaysAgo: number | null;
    deliveryDaysAgo: number | null;
    progressPercentage: number;
    notes: string | null;
  };

  costs: CostEntry[];
  payments: PaymentEntry[];
}

// ----- Scenarios (operationally meaningful spread) -----

const SCENARIOS: ScenarioDef[] = [
  // 1. COMPLETED + fully paid + profitable (Khalil Villa, completed 6 months ago)
  {
    contractNumber: 'CT-2024-001',
    customerEnglishName: 'Ahmad Khalil',
    templateEnglishPrefix: 'House 200m²',
    buildingArea: 200,
    floors: 2,
    meterPrice: 480,
    expectedProfitMargin: 22,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 365,
    contractNotes: 'Family villa — completed and handed over',
    withItems: true,
    project: {
      name: 'Khalil Villa — Achrafieh',
      status: ProjectStatus.COMPLETED,
      startDaysAgo: 350,
      deliveryDaysAgo: 180,
      progressPercentage: 100,
      notes: 'Delivered on schedule. Customer satisfied — referenced new project.',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'Cement — foundation pour', quantity: 600, unit: 'bag', unitPrice: 9.4, totalAmount: 5640, daysAgo: 345 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Steel rebar 16mm', description: 'Rebar — structural', quantity: 6, unit: 'ton', unitPrice: 880, totalAmount: 5280, daysAgo: 340 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Concrete blocks', description: 'Blocks — walls', quantity: 4500, unit: 'piece', unitPrice: 1.1, totalAmount: 4950, daysAgo: 310 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Marble', description: 'Marble — living areas', quantity: 50, unit: 'm²', unitPrice: 55, totalAmount: 2750, daysAgo: 250 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Wood doors', description: 'Interior doors', quantity: 10, totalAmount: 3800, daysAgo: 230 },
      { category: CostCategory.LABOR, description: 'Labor — months 1-3', totalAmount: 22000, daysAgo: 320 },
      { category: CostCategory.LABOR, description: 'Labor — months 4-6', totalAmount: 18000, daysAgo: 230 },
      { category: CostCategory.MACHINERY, description: 'Crane rental + mixer', totalAmount: 6500, daysAgo: 300 },
      { category: CostCategory.TRANSPORT, description: 'Material deliveries (full project)', totalAmount: 3200, daysAgo: 280 },
      { category: CostCategory.MISC, description: 'Permits + insurance', totalAmount: 2800, daysAgo: 360 },
    ],
    payments: [
      { amount: 57600,  dueDaysAgo: 360, paymentDaysAgo: 358, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-KHL-001', notes: '30% deposit on signing' },
      { amount: 57600,  dueDaysAgo: 280, paymentDaysAgo: 275, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-KHL-002', notes: '30% structure milestone' },
      { amount: 57600,  dueDaysAgo: 210, paymentDaysAgo: 200, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-KHL-003', notes: '30% finishing milestone' },
      { amount: 19200,  dueDaysAgo: 180, paymentDaysAgo: 178, status: PaymentStatus.PAID, method: PaymentMethod.CHECK,         reference: 'CHK-2024-991', notes: '10% on handover' },
    ],
  },

  // 2. COMPLETED + fully paid + profitable (Hammoud Villa, completed 4 months ago)
  {
    contractNumber: 'CT-2024-002',
    customerEnglishName: 'Khaled Hammoud',
    templateEnglishPrefix: 'House 100m²',
    buildingArea: 180,
    floors: 1,
    meterPrice: 500,
    expectedProfitMargin: 18,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 240,
    contractNotes: null,
    withItems: true,
    project: {
      name: 'Hammoud Residence — Aley',
      status: ProjectStatus.COMPLETED,
      startDaysAgo: 230,
      deliveryDaysAgo: 120,
      progressPercentage: 100,
      notes: 'On-time delivery',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'Cement — full job', quantity: 850, unit: 'bag', unitPrice: 9.5, totalAmount: 8075, daysAgo: 225 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Concrete blocks', description: 'Blocks — walls', quantity: 5200, unit: 'piece', unitPrice: 1.1, totalAmount: 5720, daysAgo: 200 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Ceramic tiles', description: 'Tiles — floors', quantity: 180, unit: 'm²', unitPrice: 18, totalAmount: 3240, daysAgo: 160 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Aluminum windows', description: 'Windows', quantity: 22, unit: 'm²', unitPrice: 110, totalAmount: 2420, daysAgo: 150 },
      { category: CostCategory.LABOR, description: 'Labor — full project', totalAmount: 28000, daysAgo: 180 },
      { category: CostCategory.MACHINERY, description: 'Mixer + scaffolding', totalAmount: 3200, daysAgo: 200 },
      { category: CostCategory.TRANSPORT, description: 'Deliveries', totalAmount: 1800, daysAgo: 180 },
      { category: CostCategory.MISC, description: 'Permits', totalAmount: 1500, daysAgo: 235 },
    ],
    payments: [
      { amount: 27000, dueDaysAgo: 235, paymentDaysAgo: 233, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-HMD-001', notes: '30% deposit' },
      { amount: 36000, dueDaysAgo: 170, paymentDaysAgo: 166, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-HMD-002', notes: '40% structure' },
      { amount: 27000, dueDaysAgo: 125, paymentDaysAgo: 120, status: PaymentStatus.PAID, method: PaymentMethod.CASH,          reference: 'CASH-HMD-001', notes: '30% handover' },
    ],
  },

  // 3. IN_PROGRESS — on track, partial payments, profitable (Karam Office)
  {
    contractNumber: 'CT-2025-001',
    customerEnglishName: 'Sara Karam',
    templateEnglishPrefix: 'Commercial store',
    buildingArea: 150,
    floors: 1,
    meterPrice: 400,
    expectedProfitMargin: 16,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 95,
    contractNotes: 'Renovation of existing space — interior only',
    withItems: true,
    project: {
      name: 'Karam Office Renovation — Hamra',
      status: ProjectStatus.IN_PROGRESS,
      startDaysAgo: 90,
      deliveryDaysAgo: -60,
      progressPercentage: 45,
      notes: 'On schedule — 45% complete, structure done',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'Cement', quantity: 400, unit: 'bag', unitPrice: 9.5, totalAmount: 3800, daysAgo: 85 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Ceramic tiles', description: 'Tiles', quantity: 150, unit: 'm²', unitPrice: 18, totalAmount: 2700, daysAgo: 45 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Wall paint', description: 'Paint buckets', quantity: 14, unit: 'bucket', unitPrice: 42, totalAmount: 588, daysAgo: 25 },
      { category: CostCategory.LABOR, description: 'Labor — month 1', totalAmount: 4200, daysAgo: 60 },
      { category: CostCategory.LABOR, description: 'Labor — month 2', totalAmount: 4200, daysAgo: 30 },
      { category: CostCategory.LABOR, description: 'Labor — month 3 (current)', totalAmount: 3800, daysAgo: 5 },
      { category: CostCategory.MACHINERY, description: 'Mixer rental', totalAmount: 900, daysAgo: 70 },
      { category: CostCategory.TRANSPORT, description: 'Deliveries — Q1', totalAmount: 650, daysAgo: 50 },
      { category: CostCategory.MISC, description: 'Building permit', totalAmount: 1200, daysAgo: 90 },
    ],
    payments: [
      { amount: 24000, dueDaysAgo: 90, paymentDaysAgo: 88, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-KRM-001', notes: '40% deposit' },
      { amount: 24000, dueDaysAgo: -10, status: PaymentStatus.PENDING, method: PaymentMethod.BANK_TRANSFER, reference: 'INV-KRM-002', notes: '40% mid-project' },
      { amount: 12000, dueDaysAgo: -50, status: PaymentStatus.PENDING, reference: 'INV-KRM-003', notes: '20% final on handover' },
    ],
  },

  // 4. IN_PROGRESS — delayed + overdue payment (Hariri Warehouse)
  {
    contractNumber: 'CT-2024-003',
    customerEnglishName: 'Hariri Construction',
    templateEnglishPrefix: 'Skeleton only',
    buildingArea: 500,
    floors: 1,
    meterPrice: 350,
    expectedProfitMargin: 14,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 210,
    contractNotes: 'Warehouse — structural shell only',
    withItems: true,
    project: {
      name: 'Hariri Warehouse — Saida',
      status: ProjectStatus.IN_PROGRESS,
      startDaysAgo: 195,
      deliveryDaysAgo: 30, // was due 30 days ago — delayed
      progressPercentage: 70,
      notes: 'DELAYED — supplier delays on steel pushed roof slab by 6 weeks',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'Cement — foundations', quantity: 1800, unit: 'bag', unitPrice: 9.6, totalAmount: 17280, daysAgo: 180 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Steel rebar 16mm', description: 'Rebar — columns', quantity: 18, unit: 'ton', unitPrice: 890, totalAmount: 16020, daysAgo: 160 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Concrete blocks', description: 'Blocks — perimeter', quantity: 12000, unit: 'piece', unitPrice: 1.1, totalAmount: 13200, daysAgo: 100 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Sand', description: 'Sand — bulk', quantity: 130, unit: 'm³', unitPrice: 30, totalAmount: 3900, daysAgo: 165 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Gravel', description: 'Gravel — bulk', quantity: 170, unit: 'm³', unitPrice: 35, totalAmount: 5950, daysAgo: 165 },
      { category: CostCategory.LABOR, description: 'Labor — months 1-3', totalAmount: 28000, daysAgo: 150 },
      { category: CostCategory.LABOR, description: 'Labor — months 4-6', totalAmount: 26000, daysAgo: 60 },
      { category: CostCategory.MACHINERY, description: 'Crane + mixers (6 months)', totalAmount: 12500, daysAgo: 120 },
      { category: CostCategory.TRANSPORT, description: 'Deliveries — bulk materials', totalAmount: 4800, daysAgo: 130 },
      { category: CostCategory.MISC, description: 'Permits + insurance + site overhead', totalAmount: 3800, daysAgo: 200 },
    ],
    payments: [
      { amount: 52500, dueDaysAgo: 205, paymentDaysAgo: 200, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-HRR-001', notes: '30% deposit' },
      { amount: 52500, dueDaysAgo: 120, paymentDaysAgo: 115, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-HRR-002', notes: '30% structure' },
      { amount: 52500, dueDaysAgo: 45,  status: PaymentStatus.PENDING, reference: 'INV-HRR-003', notes: '30% — OVERDUE pending invoice approval' },
      { amount: 17500, dueDaysAgo: -30, status: PaymentStatus.PENDING, reference: 'INV-HRR-004', notes: '10% on handover' },
    ],
  },

  // 5. IN_PROGRESS — losing money + overdue payment (Abou Zeid Commercial)
  {
    contractNumber: 'CT-2025-002',
    customerEnglishName: 'Abou Zeid Holdings',
    templateEnglishPrefix: 'House 200m²',
    buildingArea: 280,
    floors: 4,
    meterPrice: 480,
    expectedProfitMargin: 18,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 155,
    contractNotes: 'Mixed-use building — cost overruns due to scope creep',
    withItems: true,
    project: {
      name: 'Abou Zeid Commercial — Verdun',
      status: ProjectStatus.IN_PROGRESS,
      startDaysAgo: 150,
      deliveryDaysAgo: -90,
      progressPercentage: 55,
      notes: 'COST OVERRUN — material price increases not in original quote. Watch profit margin.',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'Cement — bulk', quantity: 2400, unit: 'bag', unitPrice: 10.2, totalAmount: 24480, daysAgo: 140 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Steel rebar 16mm', description: 'Rebar — 4 floors', quantity: 28, unit: 'ton', unitPrice: 920, totalAmount: 25760, daysAgo: 130, notes: 'Price spike vs quote' },
      { category: CostCategory.MATERIAL, englishMaterial: 'Concrete blocks', description: 'Blocks', quantity: 16000, unit: 'piece', unitPrice: 1.2, totalAmount: 19200, daysAgo: 100 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Marble', description: 'Marble — lobbies', quantity: 220, unit: 'm²', unitPrice: 60, totalAmount: 13200, daysAgo: 70 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Aluminum windows', description: 'Windows — full building', quantity: 180, unit: 'm²', unitPrice: 115, totalAmount: 20700, daysAgo: 60 },
      { category: CostCategory.LABOR, description: 'Labor — months 1-3', totalAmount: 48000, daysAgo: 100 },
      { category: CostCategory.LABOR, description: 'Labor — months 4-5 + scope extension', totalAmount: 52000, daysAgo: 30, notes: 'Extra crew for delays' },
      { category: CostCategory.MACHINERY, description: 'Crane + mixers (5 months)', totalAmount: 18500, daysAgo: 100 },
      { category: CostCategory.TRANSPORT, description: 'Deliveries — bulk', totalAmount: 6200, daysAgo: 90 },
      { category: CostCategory.MISC, description: 'Permits + scope-change fees', totalAmount: 9500, daysAgo: 120 },
    ],
    payments: [
      { amount: 161280, dueDaysAgo: 150, paymentDaysAgo: 145, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-ABZ-001', notes: '30% deposit' },
      { amount: 161280, dueDaysAgo: 40,  status: PaymentStatus.PENDING, reference: 'INV-ABZ-002', notes: 'OVERDUE — disputing scope-creep charges' },
      { amount: 161280, dueDaysAgo: -45, status: PaymentStatus.PENDING, reference: 'INV-ABZ-003', notes: '30% — finishing' },
      { amount: 53760,  dueDaysAgo: -90, status: PaymentStatus.PENDING, reference: 'INV-ABZ-004', notes: '10% — handover' },
    ],
  },

  // 6. IN_PROGRESS — fully paid in advance (small fast job)
  {
    contractNumber: 'CT-2025-003',
    customerEnglishName: 'Mohamed Ramadan',
    templateEnglishPrefix: 'Commercial store',
    buildingArea: 80,
    floors: 1,
    meterPrice: 600,
    expectedProfitMargin: 22,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 60,
    contractNotes: 'Premium finishing — customer paid in two installments up-front',
    withItems: true,
    project: {
      name: 'Ramadan Apartment Renovation — Tripoli',
      status: ProjectStatus.IN_PROGRESS,
      startDaysAgo: 55,
      deliveryDaysAgo: -30,
      progressPercentage: 65,
      notes: 'On track. Cash position positive.',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'Cement', quantity: 220, unit: 'bag', unitPrice: 9.5, totalAmount: 2090, daysAgo: 50 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Marble', description: 'Marble — bathrooms + kitchen', quantity: 45, unit: 'm²', unitPrice: 55, totalAmount: 2475, daysAgo: 25 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Wood doors', description: 'Premium doors', quantity: 5, unit: 'piece', unitPrice: 420, totalAmount: 2100, daysAgo: 15 },
      { category: CostCategory.LABOR, description: 'Labor — month 1', totalAmount: 5400, daysAgo: 35 },
      { category: CostCategory.LABOR, description: 'Labor — month 2', totalAmount: 5400, daysAgo: 5 },
      { category: CostCategory.MACHINERY, description: 'Tools + small equipment', totalAmount: 1200, daysAgo: 40 },
      { category: CostCategory.MISC, description: 'Permits', totalAmount: 800, daysAgo: 58 },
    ],
    payments: [
      { amount: 24000, dueDaysAgo: 60, paymentDaysAgo: 60, status: PaymentStatus.PAID, method: PaymentMethod.CASH, reference: 'CASH-RMD-001', notes: '50% on signing — cash' },
      { amount: 24000, dueDaysAgo: 20, paymentDaysAgo: 18, status: PaymentStatus.PAID, method: PaymentMethod.CASH, reference: 'CASH-RMD-002', notes: '50% mid-project — cash' },
    ],
  },

  // 7. PAUSED — with overdue payment (Mansour Family Villa)
  {
    contractNumber: 'CT-2025-004',
    customerEnglishName: 'Mansour Family',
    templateEnglishPrefix: 'House 200m²',
    buildingArea: 300,
    floors: 3,
    meterPrice: 520,
    expectedProfitMargin: 19,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 130,
    contractNotes: 'Multi-generational home — paused after structure completion pending design changes',
    withItems: true,
    project: {
      name: 'Mansour Family Villa — Bikfaya',
      status: ProjectStatus.PAUSED,
      startDaysAgo: 125,
      deliveryDaysAgo: -60,
      progressPercentage: 30,
      notes: 'PAUSED — owner requested 2nd-floor redesign. Payment held up. Resume target: 4 weeks.',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'Cement — foundations', quantity: 900, unit: 'bag', unitPrice: 9.5, totalAmount: 8550, daysAgo: 115 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Steel rebar 16mm', description: 'Rebar — ground floor', quantity: 7, unit: 'ton', unitPrice: 870, totalAmount: 6090, daysAgo: 105 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Concrete blocks', description: 'Blocks — partial walls', quantity: 6000, unit: 'piece', unitPrice: 1.1, totalAmount: 6600, daysAgo: 80 },
      { category: CostCategory.LABOR, description: 'Labor — months 1-3', totalAmount: 32000, daysAgo: 90 },
      { category: CostCategory.LABOR, description: 'Labor — month 4 (partial, before pause)', totalAmount: 8500, daysAgo: 45 },
      { category: CostCategory.MACHINERY, description: 'Crane + mixers', totalAmount: 8800, daysAgo: 90 },
      { category: CostCategory.TRANSPORT, description: 'Deliveries', totalAmount: 2400, daysAgo: 100 },
      { category: CostCategory.MISC, description: 'Permits', totalAmount: 2200, daysAgo: 128 },
    ],
    payments: [
      { amount: 140400, dueDaysAgo: 125, paymentDaysAgo: 122, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-MNS-001', notes: '30% deposit' },
      { amount: 140400, dueDaysAgo: 50,  status: PaymentStatus.PENDING, reference: 'INV-MNS-002', notes: 'OVERDUE — held pending design approval' },
      { amount: 140400, dueDaysAgo: -30, status: PaymentStatus.PENDING, reference: 'INV-MNS-003', notes: '30% — finishing' },
      { amount: 46800,  dueDaysAgo: -75, status: PaymentStatus.PENDING, reference: 'INV-MNS-004', notes: '10% — handover' },
    ],
  },

  // 8. PLANNED — approved but not started (Saad Residence)
  {
    contractNumber: 'CT-2025-005',
    customerEnglishName: 'Lina Saad',
    templateEnglishPrefix: 'House 100m²',
    buildingArea: 120,
    floors: 1,
    meterPrice: 500,
    expectedProfitMargin: 18,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 7,
    contractNotes: 'Just signed last week. Site prep starts in 3 weeks.',
    withItems: true,
    project: {
      name: 'Saad Family Residence — Jounieh',
      status: ProjectStatus.PLANNED,
      startDaysAgo: -21,
      deliveryDaysAgo: -111,
      progressPercentage: 0,
      notes: 'Awaiting site clearance from municipality',
    },
    costs: [],
    payments: [
      { amount: 18000, dueDaysAgo: -7,  status: PaymentStatus.PENDING, reference: 'INV-SAD-001', notes: '30% deposit — due on site start' },
      { amount: 24000, dueDaysAgo: -55, status: PaymentStatus.PENDING, reference: 'INV-SAD-002', notes: '40% — structure milestone' },
      { amount: 18000, dueDaysAgo: -90, status: PaymentStatus.PENDING, reference: 'INV-SAD-003', notes: '30% — handover' },
    ],
  },

  // 9. CANCELLED project (Tabbara — was started then cancelled)
  {
    contractNumber: 'CT-2024-004',
    customerEnglishName: 'Tabbara Holdings',
    templateEnglishPrefix: 'House 200m²',
    buildingArea: 600,
    floors: 5,
    meterPrice: 500,
    expectedProfitMargin: 18,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 140,
    contractNotes: 'Cancelled mid-execution — investor pulled out',
    withItems: true,
    project: {
      name: 'Tabbara Apartments — Downtown',
      status: ProjectStatus.CANCELLED,
      startDaysAgo: 130,
      deliveryDaysAgo: -240,
      progressPercentage: 20,
      notes: 'Cancelled by mutual agreement. 1st-floor structure stays in place; site mothballed.',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'Cement — sunk', quantity: 1200, unit: 'bag', unitPrice: 9.5, totalAmount: 11400, daysAgo: 120 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Steel rebar 16mm', description: 'Rebar — sunk', quantity: 10, unit: 'ton', unitPrice: 880, totalAmount: 8800, daysAgo: 115 },
      { category: CostCategory.LABOR, description: 'Labor — months 1-2', totalAmount: 32000, daysAgo: 100 },
      { category: CostCategory.MACHINERY, description: 'Crane rental — sunk', totalAmount: 14000, daysAgo: 100 },
      { category: CostCategory.MISC, description: 'Permits + cancellation processing', totalAmount: 8500, daysAgo: 135 },
    ],
    payments: [
      { amount: 450000, dueDaysAgo: 135, paymentDaysAgo: 130, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-TBR-001', notes: '30% deposit — applied to sunk costs' },
      { amount: 450000, dueDaysAgo: -60, status: PaymentStatus.CANCELLED, reference: 'INV-TBR-002', notes: 'Cancelled with contract' },
      { amount: 450000, dueDaysAgo: -150, status: PaymentStatus.CANCELLED, reference: 'INV-TBR-003', notes: 'Cancelled with contract' },
      { amount: 150000, dueDaysAgo: -240, status: PaymentStatus.CANCELLED, reference: 'INV-TBR-004', notes: 'Cancelled with contract' },
    ],
  },

  // 10. DRAFT contract (Maalouf — in planning)
  {
    contractNumber: 'CT-2026-001',
    customerEnglishName: 'Maalouf Group',
    templateEnglishPrefix: 'House 100m²',
    buildingArea: 220,
    floors: 2,
    meterPrice: 510,
    expectedProfitMargin: null,
    contractStatus: ContractStatus.DRAFT,
    signedDaysAgo: null,
    contractNotes: 'Initial inquiry — pricing and material list under review',
    withItems: false,
    costs: [],
    payments: [],
  },

  // 11. CANCELLED contract (Mokdad — never approved)
  {
    contractNumber: 'CT-2025-006',
    customerEnglishName: 'Walid Mokdad',
    templateEnglishPrefix: 'Commercial store',
    buildingArea: 100,
    floors: 1,
    meterPrice: 400,
    expectedProfitMargin: 16,
    contractStatus: ContractStatus.CANCELLED,
    signedDaysAgo: null,
    contractNotes: 'Customer withdrew before signing — financial difficulties',
    withItems: false,
    costs: [],
    payments: [],
  },
];

// ----- Helpers -----

function findCustomer(customers: Customer[], englishName: string): Customer {
  const c = customers.find((c) => c.name === englishName);
  if (!c) throw new Error(`Customer not found: ${englishName}`);
  return c;
}

interface TemplateWithRelations extends BuildingTemplate {
  items: Array<{
    materialId: string;
    quantityFormula: string;
    estimatedQuantity: import('@prisma/client').Prisma.Decimal;
    estimatedPrice: import('@prisma/client').Prisma.Decimal;
    notes: string | null;
    material: { unit: string };
  }>;
  steps: Array<{
    name: string;
    percentage: import('@prisma/client').Prisma.Decimal;
    sortOrder: number;
  }>;
}

// ----- Main seed function -----

export async function seedScenarios(
  prisma: PrismaClient,
  customers: Customer[],
  materials: Material[],
  templates: BuildingTemplate[],
) {
  // Pre-load templates with their items + steps for project step copying.
  const templatesWithRelations: TemplateWithRelations[] = await prisma.buildingTemplate.findMany({
    where: { id: { in: templates.map((t) => t.id) } },
    include: {
      items: { include: { material: { select: { unit: true } } } },
      steps: true,
    },
  });
  const templatesById = new Map(templatesWithRelations.map((t) => [t.id, t]));

  let contractCount = 0;
  let projectCount = 0;
  let costCount = 0;
  let paymentCount = 0;

  for (const sc of SCENARIOS) {
    const customer = findCustomer(customers, sc.customerEnglishName);
    const template = sc.templateEnglishPrefix
      ? findTemplate(templates, sc.templateEnglishPrefix)
      : null;
    const fullTemplate = template ? templatesById.get(template.id)! : null;

    const totalPrice = round2(sc.buildingArea * sc.floors * sc.meterPrice);

    // ---- Contract ----
    const contract = await prisma.contract.create({
      data: {
        contractNumber: sc.contractNumber,
        customerId: customer.id,
        templateId: template?.id ?? null,
        buildingArea: sc.buildingArea,
        floors: sc.floors,
        meterPrice: sc.meterPrice,
        totalPrice,
        expectedProfitMargin: sc.expectedProfitMargin,
        status: sc.contractStatus,
        signedAt: sc.signedDaysAgo !== null ? daysAgo(sc.signedDaysAgo) : null,
        notes: sc.contractNotes,
      },
    });
    contractCount += 1;

    // ---- Contract items (only for non-DRAFT, non-pre-approval-CANCELLED) ----
    if (sc.withItems && fullTemplate) {
      const scaleFactor = (sc.buildingArea * sc.floors) / 100;
      await prisma.contractItem.createMany({
        data: fullTemplate.items.map((item) => ({
          contractId: contract.id,
          materialId: item.materialId,
          quantity: round3(Number(item.estimatedQuantity) * scaleFactor),
          unit: item.material.unit,
          estimatedPrice: round2(Number(item.estimatedPrice) * scaleFactor),
          notes: item.notes,
        })),
      });
    }

    // ---- Project ----
    if (sc.project) {
      const project = await prisma.project.create({
        data: {
          contractId: contract.id,
          name: sc.project.name,
          startDate: sc.project.startDaysAgo !== null ? daysAgo(sc.project.startDaysAgo) : null,
          deliveryDate:
            sc.project.deliveryDaysAgo !== null ? daysAgo(sc.project.deliveryDaysAgo) : null,
          progressPercentage: sc.project.progressPercentage,
          status: sc.project.status,
          notes: sc.project.notes,
        },
      });
      projectCount += 1;

      // Copy template steps onto the project.
      if (fullTemplate && fullTemplate.steps.length > 0) {
        await prisma.constructionStep.createMany({
          data: fullTemplate.steps.map((s) => ({
            projectId: project.id,
            name: s.name,
            percentage: Number(s.percentage),
            sortOrder: s.sortOrder,
          })),
        });
      }

      // ---- Costs ----
      for (const cost of sc.costs) {
        const materialId = cost.englishMaterial
          ? findMaterial(materials, cost.englishMaterial).id
          : null;
        await prisma.projectCost.create({
          data: {
            projectId: project.id,
            category: cost.category,
            materialId,
            description: cost.description,
            quantity: cost.quantity ?? null,
            unit: cost.unit ?? null,
            unitPrice: cost.unitPrice ?? null,
            totalAmount: cost.totalAmount,
            date: daysAgo(cost.daysAgo),
            notes: null,
          },
        });
        costCount += 1;
      }

      // ---- Payments ----
      for (const p of sc.payments) {
        await prisma.payment.create({
          data: {
            projectId: project.id,
            amount: p.amount,
            dueDate: daysAgo(p.dueDaysAgo),
            paymentDate: p.paymentDaysAgo !== undefined ? daysAgo(p.paymentDaysAgo) : null,
            status: p.status,
            method: p.method ?? null,
            reference: p.reference ?? null,
            notes: p.notes ?? null,
          },
        });
        paymentCount += 1;
      }
    }
  }

  console.log(
    `  ${contractCount} contracts, ${projectCount} projects, ${costCount} costs, ${paymentCount} payments`,
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

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
import { CUSTOMER_NAMES } from './customers.js';
import { daysAgo } from './helpers.js';
import { findMaterial } from './materials.js';
import { findTemplate, TEMPLATE_NAMES } from './templates.js';

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

// ----- Scenarios (Iraqi projects across Baghdad + Samarra, amounts in IQD) -----
//   Completed × 5, In Progress × 3, Paused × 1, Cancelled × 1, Draft × 2.

const SCENARIOS: ScenarioDef[] = [
  // 1. COMPLETED + fully paid + profitable (Baghdad villa, handed over 6 months ago)
  {
    contractNumber: 'CT-2023-001',
    customerEnglishName: CUSTOMER_NAMES.AHMED_ABDULAMEER,
    templateEnglishPrefix: TEMPLATE_NAMES.HOUSE_200_A,
    buildingArea: 200,
    floors: 2,
    meterPrice: 450000,
    expectedProfitMargin: 22,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 365,
    contractNotes: 'دار سكنية — مكتملة ومُسلّمة',
    withItems: true,
    project: {
      name: 'دار سكني الكرادة',
      status: ProjectStatus.COMPLETED,
      startDaysAgo: 350,
      deliveryDaysAgo: 180,
      progressPercentage: 100,
      notes: 'تم التسليم في الموعد. الزبون راضٍ — أحال مشروعاً جديداً.',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'إسمنت — صبّ الأساسات', quantity: 1500, unit: 'bag', unitPrice: 12000, totalAmount: 18000000, daysAgo: 345 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Steel rebar 16mm', description: 'حديد تسليح — الهيكل', quantity: 12, unit: 'ton', unitPrice: 1200000, totalAmount: 14400000, daysAgo: 340 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Concrete blocks', description: 'بلوك — الجدران', quantity: 9000, unit: 'piece', unitPrice: 1500, totalAmount: 13500000, daysAgo: 310 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Marble', description: 'رخام — المناطق المعيشية', quantity: 100, unit: 'm²', unitPrice: 85000, totalAmount: 8500000, daysAgo: 250 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Wood doors', description: 'أبواب داخلية', quantity: 14, totalAmount: 6300000, daysAgo: 230 },
      { category: CostCategory.LABOR, description: 'أجور العمال — الأشهر 1-3', totalAmount: 24000000, daysAgo: 320 },
      { category: CostCategory.LABOR, description: 'أجور العمال — الأشهر 4-6', totalAmount: 21000000, daysAgo: 230 },
      { category: CostCategory.MACHINERY, description: 'إيجار رافعة وخلاطة', totalAmount: 12000000, daysAgo: 300 },
      { category: CostCategory.TRANSPORT, description: 'نقل المواد (كامل المشروع)', totalAmount: 5000000, daysAgo: 280 },
      { category: CostCategory.MISC, description: 'إجازات بناء وتأمين', totalAmount: 4000000, daysAgo: 360 },
    ],
    payments: [
      { amount: 54000000, dueDaysAgo: 360, paymentDaysAgo: 358, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-KRD-001', notes: 'دفعة مقدمة 30٪ عند التوقيع' },
      { amount: 54000000, dueDaysAgo: 280, paymentDaysAgo: 275, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-KRD-002', notes: 'دفعة الهيكل 30٪' },
      { amount: 54000000, dueDaysAgo: 210, paymentDaysAgo: 200, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-KRD-003', notes: 'دفعة التشطيب 30٪' },
      { amount: 18000000, dueDaysAgo: 180, paymentDaysAgo: 178, status: PaymentStatus.PAID, method: PaymentMethod.CHECK,         reference: 'CHK-2023-991', notes: 'دفعة التسليم 10٪' },
    ],
  },

  // 2. COMPLETED + fully paid (Samarra residence, completed 4 months ago)
  {
    contractNumber: 'CT-2023-002',
    customerEnglishName: CUSTOMER_NAMES.HASAN_KADHIM,
    templateEnglishPrefix: TEMPLATE_NAMES.HOUSE_150_C,
    buildingArea: 150,
    floors: 2,
    meterPrice: 420000,
    expectedProfitMargin: 18,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 240,
    contractNotes: null,
    withItems: true,
    project: {
      name: 'دار سكني حي المعتصم',
      status: ProjectStatus.COMPLETED,
      startDaysAgo: 230,
      deliveryDaysAgo: 120,
      progressPercentage: 100,
      notes: 'تسليم في الموعد المحدد',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'إسمنت — كامل العمل', quantity: 1100, unit: 'bag', unitPrice: 12000, totalAmount: 13200000, daysAgo: 225 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Steel rebar 16mm', description: 'حديد تسليح', quantity: 8, unit: 'ton', unitPrice: 1200000, totalAmount: 9600000, daysAgo: 210 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Concrete blocks', description: 'بلوك — الجدران', quantity: 6500, unit: 'piece', unitPrice: 1500, totalAmount: 9750000, daysAgo: 200 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Ceramic tiles', description: 'سيراميك — الأرضيات', quantity: 220, unit: 'm²', unitPrice: 25000, totalAmount: 5500000, daysAgo: 160 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Aluminum windows', description: 'شبابيك', quantity: 40, unit: 'm²', unitPrice: 150000, totalAmount: 6000000, daysAgo: 150 },
      { category: CostCategory.LABOR, description: 'أجور العمال — كامل المشروع', totalAmount: 38000000, daysAgo: 180 },
      { category: CostCategory.MACHINERY, description: 'خلاطة وسقالات', totalAmount: 7000000, daysAgo: 200 },
      { category: CostCategory.TRANSPORT, description: 'نقل المواد', totalAmount: 3000000, daysAgo: 180 },
      { category: CostCategory.MISC, description: 'إجازات البناء', totalAmount: 2000000, daysAgo: 235 },
    ],
    payments: [
      { amount: 37800000, dueDaysAgo: 235, paymentDaysAgo: 233, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-MTM-001', notes: 'دفعة مقدمة 30٪' },
      { amount: 50400000, dueDaysAgo: 170, paymentDaysAgo: 166, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-MTM-002', notes: 'دفعة الهيكل 40٪' },
      { amount: 37800000, dueDaysAgo: 125, paymentDaysAgo: 120, status: PaymentStatus.PAID, method: PaymentMethod.CASH,          reference: 'CASH-MTM-001', notes: 'دفعة التسليم 30٪' },
    ],
  },

  // 3. COMPLETED + fully paid (Baghdad small two-floor house)
  {
    contractNumber: 'CT-2023-003',
    customerEnglishName: CUSTOMER_NAMES.MUSTAFA_SAADOUN,
    templateEnglishPrefix: TEMPLATE_NAMES.HOUSE_100_C,
    buildingArea: 100,
    floors: 2,
    meterPrice: 400000,
    expectedProfitMargin: 18,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 200,
    contractNotes: 'الزبون يدفع نقداً مقدماً',
    withItems: true,
    project: {
      name: 'دار سكني الجادرية',
      status: ProjectStatus.COMPLETED,
      startDaysAgo: 190,
      deliveryDaysAgo: 95,
      progressPercentage: 100,
      notes: 'تسليم سلس — لا ملاحظات',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'إسمنت', quantity: 750, unit: 'bag', unitPrice: 12000, totalAmount: 9000000, daysAgo: 185 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Steel rebar 12mm', description: 'حديد تسليح', quantity: 4, unit: 'ton', unitPrice: 1150000, totalAmount: 4600000, daysAgo: 180 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Concrete blocks', description: 'بلوك', quantity: 4000, unit: 'piece', unitPrice: 1500, totalAmount: 6000000, daysAgo: 160 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Ceramic tiles', description: 'سيراميك', quantity: 150, unit: 'm²', unitPrice: 25000, totalAmount: 3750000, daysAgo: 120 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Aluminum windows', description: 'شبابيك', quantity: 28, unit: 'm²', unitPrice: 150000, totalAmount: 4200000, daysAgo: 110 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Wood doors', description: 'أبواب', quantity: 7, totalAmount: 3150000, daysAgo: 100 },
      { category: CostCategory.LABOR, description: 'أجور العمال — كامل المشروع', totalAmount: 24000000, daysAgo: 140 },
      { category: CostCategory.MACHINERY, description: 'خلاطة', totalAmount: 4500000, daysAgo: 160 },
      { category: CostCategory.TRANSPORT, description: 'نقل المواد', totalAmount: 2000000, daysAgo: 150 },
      { category: CostCategory.MISC, description: 'إجازات البناء', totalAmount: 1500000, daysAgo: 195 },
    ],
    payments: [
      { amount: 32000000, dueDaysAgo: 195, paymentDaysAgo: 193, status: PaymentStatus.PAID, method: PaymentMethod.CASH,          reference: 'CASH-JDR-001', notes: 'دفعة مقدمة 40٪ — نقداً' },
      { amount: 24000000, dueDaysAgo: 130, paymentDaysAgo: 126, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-JDR-002', notes: 'دفعة الهيكل 30٪' },
      { amount: 24000000, dueDaysAgo: 100, paymentDaysAgo: 96,  status: PaymentStatus.PAID, method: PaymentMethod.CASH,          reference: 'CASH-JDR-002', notes: 'دفعة التسليم 30٪' },
    ],
  },

  // 4. COMPLETED + fully paid (Samarra residence)
  {
    contractNumber: 'CT-2023-004',
    customerEnglishName: CUSTOMER_NAMES.FATIMA_MOHAMMED,
    templateEnglishPrefix: TEMPLATE_NAMES.HOUSE_150_A,
    buildingArea: 150,
    floors: 2,
    meterPrice: 380000,
    expectedProfitMargin: 18,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 300,
    contractNotes: 'دار عائلية',
    withItems: true,
    project: {
      name: 'دار سكني حي القادسية',
      status: ProjectStatus.COMPLETED,
      startDaysAgo: 290,
      deliveryDaysAgo: 200,
      progressPercentage: 100,
      notes: 'مكتملة ومُسلّمة بالكامل',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'إسمنت', quantity: 1050, unit: 'bag', unitPrice: 12000, totalAmount: 12600000, daysAgo: 285 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Steel rebar 16mm', description: 'حديد تسليح', quantity: 7, unit: 'ton', unitPrice: 1200000, totalAmount: 8400000, daysAgo: 280 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Concrete blocks', description: 'بلوك', quantity: 6200, unit: 'piece', unitPrice: 1500, totalAmount: 9300000, daysAgo: 250 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Ceramic tiles', description: 'سيراميك', quantity: 200, unit: 'm²', unitPrice: 25000, totalAmount: 5000000, daysAgo: 210 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Aluminum windows', description: 'شبابيك', quantity: 36, unit: 'm²', unitPrice: 150000, totalAmount: 5400000, daysAgo: 205 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Wood doors', description: 'أبواب', quantity: 9, totalAmount: 4050000, daysAgo: 200 },
      { category: CostCategory.LABOR, description: 'أجور العمال — كامل المشروع', totalAmount: 35000000, daysAgo: 240 },
      { category: CostCategory.MACHINERY, description: 'رافعة وخلاطة', totalAmount: 6000000, daysAgo: 260 },
      { category: CostCategory.TRANSPORT, description: 'نقل المواد', totalAmount: 2500000, daysAgo: 250 },
      { category: CostCategory.MISC, description: 'إجازات البناء', totalAmount: 1800000, daysAgo: 295 },
    ],
    payments: [
      { amount: 34200000, dueDaysAgo: 295, paymentDaysAgo: 292, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-QDS-001', notes: 'دفعة مقدمة 30٪' },
      { amount: 45600000, dueDaysAgo: 230, paymentDaysAgo: 226, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-QDS-002', notes: 'دفعة الهيكل 40٪' },
      { amount: 34200000, dueDaysAgo: 205, paymentDaysAgo: 200, status: PaymentStatus.PAID, method: PaymentMethod.CASH,          reference: 'CASH-QDS-001', notes: 'دفعة التسليم 30٪' },
    ],
  },

  // 5. COMMERCIAL — COMPLETED + fully paid (Samarra shops complex, no template)
  {
    contractNumber: 'CT-2023-005',
    customerEnglishName: CUSTOMER_NAMES.RAFIDAIN,
    templateEnglishPrefix: null,
    buildingArea: 400,
    floors: 2,
    meterPrice: 550000,
    expectedProfitMargin: 25,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 330,
    contractNotes: 'مجمع محلات تجارية — تنفيذ كامل بدون قالب',
    withItems: false,
    project: {
      name: 'مجمع محلات مركز سامراء',
      status: ProjectStatus.COMPLETED,
      startDaysAgo: 320,
      deliveryDaysAgo: 150,
      progressPercentage: 100,
      notes: 'مجمع تجاري مكتمل — تم تأجير المحلات',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'إسمنت — بالجملة', quantity: 3000, unit: 'bag', unitPrice: 12000, totalAmount: 36000000, daysAgo: 310 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Steel rebar 16mm', description: 'حديد تسليح — الهيكل', quantity: 25, unit: 'ton', unitPrice: 1200000, totalAmount: 30000000, daysAgo: 300 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Concrete blocks', description: 'بلوك', quantity: 18000, unit: 'piece', unitPrice: 1500, totalAmount: 27000000, daysAgo: 270 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Ceramic tiles', description: 'سيراميك — أرضيات المحلات', quantity: 600, unit: 'm²', unitPrice: 25000, totalAmount: 15000000, daysAgo: 200 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Aluminum windows', description: 'واجهات المحلات', quantity: 200, unit: 'm²', unitPrice: 150000, totalAmount: 30000000, daysAgo: 190 },
      { category: CostCategory.LABOR, description: 'أجور العمال — الأشهر 1-3', totalAmount: 60000000, daysAgo: 280 },
      { category: CostCategory.LABOR, description: 'أجور العمال — الأشهر 4-6', totalAmount: 50000000, daysAgo: 180 },
      { category: CostCategory.MACHINERY, description: 'رافعة وخلاطات (6 أشهر)', totalAmount: 35000000, daysAgo: 260 },
      { category: CostCategory.TRANSPORT, description: 'نقل المواد بالجملة', totalAmount: 12000000, daysAgo: 240 },
      { category: CostCategory.MISC, description: 'إجازات وتأمين', totalAmount: 15000000, daysAgo: 320 },
    ],
    payments: [
      { amount: 132000000, dueDaysAgo: 325, paymentDaysAgo: 320, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-MRK-001', notes: 'دفعة مقدمة 30٪' },
      { amount: 132000000, dueDaysAgo: 250, paymentDaysAgo: 245, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-MRK-002', notes: 'دفعة الهيكل 30٪' },
      { amount: 132000000, dueDaysAgo: 180, paymentDaysAgo: 175, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-MRK-003', notes: 'دفعة التشطيب 30٪' },
      { amount: 44000000,  dueDaysAgo: 150, paymentDaysAgo: 148, status: PaymentStatus.PAID, method: PaymentMethod.CHECK,         reference: 'CHK-2023-880', notes: 'دفعة التسليم 10٪' },
    ],
  },

  // 6. IN_PROGRESS — on track, partial payments (Baghdad villa)
  {
    contractNumber: 'CT-2025-001',
    customerEnglishName: CUSTOMER_NAMES.HUSSEIN_MAHDI,
    templateEnglishPrefix: TEMPLATE_NAMES.HOUSE_200_B,
    buildingArea: 200,
    floors: 2,
    meterPrice: 420000,
    expectedProfitMargin: 20,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 95,
    contractNotes: 'دار سكنية طابقين — قيد التنفيذ',
    withItems: true,
    project: {
      name: 'دار سكني المنصور',
      status: ProjectStatus.IN_PROGRESS,
      startDaysAgo: 90,
      deliveryDaysAgo: -60,
      progressPercentage: 45,
      notes: 'ضمن الجدول الزمني — 45٪ مكتملة، الهيكل منجز',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'إسمنت', quantity: 800, unit: 'bag', unitPrice: 12000, totalAmount: 9600000, daysAgo: 85 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Steel rebar 16mm', description: 'حديد تسليح', quantity: 7, unit: 'ton', unitPrice: 1200000, totalAmount: 8400000, daysAgo: 80 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Concrete blocks', description: 'بلوك', quantity: 5000, unit: 'piece', unitPrice: 1500, totalAmount: 7500000, daysAgo: 55 },
      { category: CostCategory.LABOR, description: 'أجور العمال — الشهر 1', totalAmount: 8000000, daysAgo: 60 },
      { category: CostCategory.LABOR, description: 'أجور العمال — الشهر 2', totalAmount: 8000000, daysAgo: 30 },
      { category: CostCategory.LABOR, description: 'أجور العمال — الشهر 3 (الحالي)', totalAmount: 7000000, daysAgo: 5 },
      { category: CostCategory.MACHINERY, description: 'إيجار خلاطة', totalAmount: 5000000, daysAgo: 70 },
      { category: CostCategory.TRANSPORT, description: 'نقل المواد', totalAmount: 2500000, daysAgo: 50 },
      { category: CostCategory.MISC, description: 'إجازة البناء', totalAmount: 3000000, daysAgo: 90 },
    ],
    payments: [
      { amount: 50400000, dueDaysAgo: 90,  paymentDaysAgo: 88, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-MNS-001', notes: 'دفعة مقدمة 30٪' },
      { amount: 67200000, dueDaysAgo: -10, status: PaymentStatus.PENDING, method: PaymentMethod.BANK_TRANSFER, reference: 'INV-MNS-002', notes: 'دفعة منتصف المشروع 40٪' },
      { amount: 50400000, dueDaysAgo: -50, status: PaymentStatus.PENDING, reference: 'INV-MNS-003', notes: 'دفعة التسليم 30٪' },
    ],
  },

  // 7. COMMERCIAL — IN_PROGRESS, delayed + overdue payment (Baghdad warehouse, no template)
  {
    contractNumber: 'CT-2024-001',
    customerEnglishName: CUSTOMER_NAMES.BAGHDAD_HADITHA,
    templateEnglishPrefix: null,
    buildingArea: 600,
    floors: 1,
    meterPrice: 350000,
    expectedProfitMargin: 14,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 210,
    contractNotes: 'مخزن صناعي — هيكل ضخم بطابق واحد',
    withItems: false,
    project: {
      name: 'مخزن صناعي أبو غريب',
      status: ProjectStatus.IN_PROGRESS,
      startDaysAgo: 195,
      deliveryDaysAgo: 30, // كان مستحقاً قبل 30 يوماً — متأخر
      progressPercentage: 70,
      notes: 'متأخر — تأخر تجهيز الحديد أخّر صبّ السقف 6 أسابيع',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'إسمنت — الأساسات', quantity: 1800, unit: 'bag', unitPrice: 12000, totalAmount: 21600000, daysAgo: 180 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Steel rebar 16mm', description: 'حديد تسليح — الأعمدة', quantity: 18, unit: 'ton', unitPrice: 1200000, totalAmount: 21600000, daysAgo: 160 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Concrete blocks', description: 'بلوك — المحيط', quantity: 12000, unit: 'piece', unitPrice: 1500, totalAmount: 18000000, daysAgo: 100 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Sand', description: 'رمل — بالجملة', quantity: 130, unit: 'm³', unitPrice: 45000, totalAmount: 5850000, daysAgo: 165 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Gravel', description: 'حصى — بالجملة', quantity: 170, unit: 'm³', unitPrice: 55000, totalAmount: 9350000, daysAgo: 165 },
      { category: CostCategory.LABOR, description: 'أجور العمال — الأشهر 1-3', totalAmount: 30000000, daysAgo: 150 },
      { category: CostCategory.LABOR, description: 'أجور العمال — الأشهر 4-6', totalAmount: 28000000, daysAgo: 60 },
      { category: CostCategory.MACHINERY, description: 'رافعة وخلاطات (6 أشهر)', totalAmount: 18000000, daysAgo: 120 },
      { category: CostCategory.TRANSPORT, description: 'نقل المواد بالجملة', totalAmount: 7000000, daysAgo: 130 },
      { category: CostCategory.MISC, description: 'إجازات وتأمين وإدارة الموقع', totalAmount: 5000000, daysAgo: 200 },
    ],
    payments: [
      { amount: 63000000, dueDaysAgo: 205, paymentDaysAgo: 200, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-MKZ-001', notes: 'دفعة مقدمة 30٪' },
      { amount: 63000000, dueDaysAgo: 120, paymentDaysAgo: 115, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-MKZ-002', notes: 'دفعة الهيكل 30٪' },
      { amount: 63000000, dueDaysAgo: 45,  status: PaymentStatus.PENDING, reference: 'INV-MKZ-003', notes: 'متأخرة — بانتظار اعتماد الفاتورة 30٪' },
      { amount: 21000000, dueDaysAgo: -30, status: PaymentStatus.PENDING, reference: 'INV-MKZ-004', notes: 'دفعة التسليم 10٪' },
    ],
  },

  // 8. IN_PROGRESS — paid in advance (Samarra residential farm)
  {
    contractNumber: 'CT-2025-002',
    customerEnglishName: CUSTOMER_NAMES.KARRAR_JABBAR,
    templateEnglishPrefix: TEMPLATE_NAMES.FARM,
    buildingArea: 200,
    floors: 1,
    meterPrice: 450000,
    expectedProfitMargin: 17,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 60,
    contractNotes: 'مزرعة سكنية — دُفعت على قسطين مقدماً',
    withItems: true,
    project: {
      name: 'مزرعة سكنية سامراء',
      status: ProjectStatus.IN_PROGRESS,
      startDaysAgo: 55,
      deliveryDaysAgo: -30,
      progressPercentage: 65,
      notes: 'ضمن الجدول. الوضع المالي إيجابي.',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'إسمنت', quantity: 500, unit: 'bag', unitPrice: 12000, totalAmount: 6000000, daysAgo: 50 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Concrete blocks', description: 'بلوك — سياج المزرعة', quantity: 4000, unit: 'piece', unitPrice: 1500, totalAmount: 6000000, daysAgo: 40 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Marble', description: 'رخام — حمامات ومطبخ', quantity: 30, unit: 'm²', unitPrice: 85000, totalAmount: 2550000, daysAgo: 25 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Wood doors', description: 'أبواب', quantity: 6, totalAmount: 2700000, daysAgo: 15 },
      { category: CostCategory.LABOR, description: 'أجور العمال — الشهر 1', totalAmount: 7000000, daysAgo: 35 },
      { category: CostCategory.LABOR, description: 'أجور العمال — الشهر 2', totalAmount: 7000000, daysAgo: 5 },
      { category: CostCategory.MACHINERY, description: 'معدات وأدوات', totalAmount: 3000000, daysAgo: 40 },
      { category: CostCategory.MISC, description: 'إجازة وحفر بئر', totalAmount: 2500000, daysAgo: 58 },
    ],
    payments: [
      { amount: 45000000, dueDaysAgo: 60, paymentDaysAgo: 60, status: PaymentStatus.PAID, method: PaymentMethod.CASH, reference: 'CASH-MZR-001', notes: 'دفعة 50٪ عند التوقيع — نقداً' },
      { amount: 45000000, dueDaysAgo: 20, paymentDaysAgo: 18, status: PaymentStatus.PAID, method: PaymentMethod.CASH, reference: 'CASH-MZR-002', notes: 'دفعة 50٪ منتصف المشروع — نقداً' },
    ],
  },

  // 9. PAUSED — with overdue payment (Samarra large villa)
  {
    contractNumber: 'CT-2025-003',
    customerEnglishName: CUSTOMER_NAMES.ZAHRAA_ALI,
    templateEnglishPrefix: TEMPLATE_NAMES.HOUSE_300,
    buildingArea: 300,
    floors: 2,
    meterPrice: 480000,
    expectedProfitMargin: 19,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 130,
    contractNotes: 'دار كبيرة — متوقفة بعد إنجاز الهيكل بانتظار تعديل التصميم',
    withItems: true,
    project: {
      name: 'دار سكني حي المثنى',
      status: ProjectStatus.PAUSED,
      startDaysAgo: 125,
      deliveryDaysAgo: -60,
      progressPercentage: 30,
      notes: 'متوقف — طلب المالك إعادة تصميم الطابق الثاني. الدفعة محتجزة. الاستئناف المتوقع: 4 أسابيع.',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'إسمنت — الأساسات', quantity: 900, unit: 'bag', unitPrice: 12000, totalAmount: 10800000, daysAgo: 115 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Steel rebar 16mm', description: 'حديد تسليح — الطابق الأرضي', quantity: 7, unit: 'ton', unitPrice: 1200000, totalAmount: 8400000, daysAgo: 105 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Concrete blocks', description: 'بلوك — جدران جزئية', quantity: 6000, unit: 'piece', unitPrice: 1500, totalAmount: 9000000, daysAgo: 80 },
      { category: CostCategory.LABOR, description: 'أجور العمال — الأشهر 1-3', totalAmount: 28000000, daysAgo: 90 },
      { category: CostCategory.LABOR, description: 'أجور العمال — الشهر 4 (جزئي، قبل التوقف)', totalAmount: 7000000, daysAgo: 45 },
      { category: CostCategory.MACHINERY, description: 'رافعة وخلاطات', totalAmount: 8000000, daysAgo: 90 },
      { category: CostCategory.TRANSPORT, description: 'نقل المواد', totalAmount: 2500000, daysAgo: 100 },
      { category: CostCategory.MISC, description: 'إجازات البناء', totalAmount: 2200000, daysAgo: 128 },
    ],
    payments: [
      { amount: 86400000, dueDaysAgo: 125, paymentDaysAgo: 122, status: PaymentStatus.PAID, method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-MTH-001', notes: 'دفعة مقدمة 30٪' },
      { amount: 86400000, dueDaysAgo: 50,  status: PaymentStatus.PENDING, reference: 'INV-MTH-002', notes: 'متأخرة — محتجزة بانتظار اعتماد التصميم 30٪' },
      { amount: 86400000, dueDaysAgo: -30, status: PaymentStatus.PENDING, reference: 'INV-MTH-003', notes: 'دفعة التشطيب 30٪' },
      { amount: 28800000, dueDaysAgo: -75, status: PaymentStatus.PENDING, reference: 'INV-MTH-004', notes: 'دفعة التسليم 10٪' },
    ],
  },

  // 10. COMMERCIAL — CANCELLED project (Baghdad shops complex, no template)
  {
    contractNumber: 'CT-2024-002',
    customerEnglishName: CUSTOMER_NAMES.DIJLA,
    templateEnglishPrefix: null,
    buildingArea: 500,
    floors: 2,
    meterPrice: 600000,
    expectedProfitMargin: 18,
    contractStatus: ContractStatus.APPROVED,
    signedDaysAgo: 140,
    contractNotes: 'أُلغي أثناء التنفيذ — انسحاب المستثمر',
    withItems: false,
    project: {
      name: 'مجمع محلات بغداد الجديدة',
      status: ProjectStatus.CANCELLED,
      startDaysAgo: 130,
      deliveryDaysAgo: -240,
      progressPercentage: 20,
      notes: 'أُلغي بالتراضي. يبقى هيكل الطابق الأرضي قائماً؛ تم إيقاف الموقع.',
    },
    costs: [
      { category: CostCategory.MATERIAL, englishMaterial: 'Portland Cement', description: 'إسمنت — كلفة غارقة', quantity: 1200, unit: 'bag', unitPrice: 12000, totalAmount: 14400000, daysAgo: 120 },
      { category: CostCategory.MATERIAL, englishMaterial: 'Steel rebar 16mm', description: 'حديد تسليح — كلفة غارقة', quantity: 10, unit: 'ton', unitPrice: 1200000, totalAmount: 12000000, daysAgo: 115 },
      { category: CostCategory.LABOR, description: 'أجور العمال — الشهران 1-2', totalAmount: 30000000, daysAgo: 100 },
      { category: CostCategory.MACHINERY, description: 'إيجار رافعة — كلفة غارقة', totalAmount: 16000000, daysAgo: 100 },
      { category: CostCategory.MISC, description: 'إجازات ومعالجة الإلغاء', totalAmount: 9000000, daysAgo: 135 },
    ],
    payments: [
      { amount: 180000000, dueDaysAgo: 135, paymentDaysAgo: 130, status: PaymentStatus.PAID,      method: PaymentMethod.BANK_TRANSFER, reference: 'TXN-MHL-001', notes: 'دفعة مقدمة 30٪ — طُبّقت على الكلفة الغارقة' },
      { amount: 180000000, dueDaysAgo: -60,  status: PaymentStatus.CANCELLED, reference: 'INV-MHL-002', notes: 'أُلغيت مع العقد' },
      { amount: 180000000, dueDaysAgo: -150, status: PaymentStatus.CANCELLED, reference: 'INV-MHL-003', notes: 'أُلغيت مع العقد' },
      { amount: 60000000,  dueDaysAgo: -240, status: PaymentStatus.CANCELLED, reference: 'INV-MHL-004', notes: 'أُلغيت مع العقد' },
    ],
  },

  // 11. DRAFT contract — residential, under review (no project)
  {
    contractNumber: 'CT-2026-001',
    customerEnglishName: CUSTOMER_NAMES.SAJJAD_ABBAS,
    templateEnglishPrefix: TEMPLATE_NAMES.HOUSE_100_B,
    buildingArea: 100,
    floors: 2,
    meterPrice: 410000,
    expectedProfitMargin: null,
    contractStatus: ContractStatus.DRAFT,
    signedDaysAgo: null,
    contractNotes: 'استفسار أولي — العرض السعري وقائمة المواد قيد المراجعة',
    withItems: false,
    costs: [],
    payments: [],
  },

  // 12. DRAFT contract — commercial inquiry (no project)
  {
    contractNumber: 'CT-2026-002',
    customerEnglishName: CUSTOMER_NAMES.RAFIDAIN,
    templateEnglishPrefix: null,
    buildingArea: 350,
    floors: 1,
    meterPrice: 500000,
    expectedProfitMargin: null,
    contractStatus: ContractStatus.DRAFT,
    signedDaysAgo: null,
    contractNotes: 'عرض مجمع تجاري جديد — بانتظار اعتماد الزبون والتسعير',
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

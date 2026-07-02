// ============================================================
// Entities — the typed slots the NLU extracts from an utterance.
// Provider-agnostic: a rule-based extractor and an LLM extractor must
// both produce this same shape.
// ============================================================

export const EntityType = {
  PROJECT_TYPE: 'project_type', // بيت / عمارة / محل ...
  AREA: 'area', // المساحة (m²)
  FRONTAGE: 'frontage', // الواجهة (m)
  DEPTH: 'depth', // النزال / العمق (m)
  FLOORS: 'floors', // عدد الطوابق
  CUSTOMER_NAME: 'customer_name', // اسم العميل
  TEMPLATE_NAME: 'template_name', // اسم القالب
  PROJECT_NAME: 'project_name', // اسم المشروع
  MONEY: 'money', // مبلغ
  METER_PRICE: 'meter_price', // سعر المتر
  DATE: 'date', // تاريخ
  AUTO_MATERIALS: 'auto_materials', // "ضيف المواد المناسبة" => true
  ENTITY_REF: 'entity_ref', // إشارة لكيان (هذا/نفس/الأخير)
  CONTRACT_REF: 'contract_ref', // رقم عقد مذكور (V-2026-0004)
  ROUTE: 'route', // وجهة تنقّل
} as const;

export type EntityType = (typeof EntityType)[keyof typeof EntityType];

/** Known project archetypes, used by template matching + material suggestion. */
export const ProjectType = {
  HOUSE: 'house', // بيت / دار
  BUILDING: 'building', // عمارة / بناية
  SHOP: 'shop', // محل
  VILLA: 'villa', // فيلا
  OTHER: 'other',
} as const;

export type ProjectType = (typeof ProjectType)[keyof typeof ProjectType];

/**
 * A single extracted entity. `value` is already normalised to a primitive
 * (number for area/money, string for names, boolean for flags). `raw` keeps
 * the original surface span for audit/debugging. `confidence` lets the dialog
 * layer decide whether to re-confirm a low-certainty slot.
 */
export interface ExtractedEntity<T = unknown> {
  type: EntityType;
  value: T;
  raw: string;
  confidence: number; // 0..1
}

/** Convenience bag the handlers read from, keyed by entity type. */
export interface EntityBag {
  projectType?: ProjectType;
  area?: number;
  frontage?: number;
  depth?: number;
  floors?: number;
  customerName?: string;
  templateName?: string;
  projectName?: string;
  money?: number;
  meterPrice?: number;
  date?: string; // ISO
  autoMaterials?: boolean;
  entityRef?: string; // "this" | "last" | "same" ...
  contractRef?: string; // a spoken contract number, e.g. "V-2026-0004"
  route?: string;
}

// ============================================================
// LlmNluProvider — turns free natural speech (Iraqi dialect / MSA / messy /
// pronoun-laden) into a STRUCTURED command. It ONLY understands; it never
// executes, never touches the DB, never calls a Service, never sees customer
// data or internal prices. The prompt carries only the static vocabulary + the
// raw utterance + three booleans (does a last project/contract/customer exist,
// for "هذا/نفس" resolution). Output is validated JSON; anything unrecognised is
// dropped, so the downstream engine stays authoritative and safe.
// ============================================================

import {
  ProjectType,
  VoiceIntent,
  VOICE_INTENTS,
  type EntityBag,
} from '@contractor-plus/shared';
import { normalizeArabic } from '../normalize.js';
import type { LlmClient } from './llm-client.js';

export interface LlmContextFlags {
  hasLastProject: boolean;
  hasLastContract: boolean;
  hasLastCustomer: boolean;
}

export interface LlmInterpretation {
  intents: VoiceIntent[];
  entityBag: EntityBag;
  missingFields: string[];
  clarificationQuestion: string | null;
  normalizedCommand: string;
  confidence: number;
}

const INTENT_SET = new Set<string>(VOICE_INTENTS);
const PROJECT_TYPES = new Set<string>(Object.values(ProjectType));

const SYSTEM_PROMPT = `أنت محلّل لغوي (NLU) لتطبيق إدارة مقاولات. مهمتك الوحيدة تحويل كلام المستخدم
(لهجة عراقية أو عربية فصحى أو كلام غير مرتب) إلى JSON منظم. لا تنفّذ أي عملية، لا تخترع بيانات،
ولا تطلب الوصول لأي شيء. أعِد JSON فقط بدون أي نص إضافي.

النوايا المسموحة (intents) — استخدم هذه القيم حصراً:
- create_project: إنشاء مشروع
- create_contract: إنشاء عقد
- link_project_to_contract: ربط مشروع بعقد
- generate_materials: إضافة/حساب المواد المقترحة (مرادف add_materials)
- add_cost: تسجيل كلفة/مصروف/شراء
- add_payment: تسجيل دفعة/استلام مبلغ
- navigate: فتح/عرض صفحة
- open_entity: فتح كيان محدد
- help: مساعدة
- cancel: إلغاء
- confirm: تأكيد

حقول الكيانات (entities) — أعِد فقط ما ذُكر فعلاً:
- projectType: house | building | villa | shop  (بيت=house، عمارة/بناية=building، فيلا=villa، محل=shop)
- area: رقم (المساحة بالمتر)
- frontage: رقم (الواجهة)
- depth: رقم (النزال/العمق)
- floors: رقم (الطوابق؛ "طابقين"=2)
- customerName: نص (اسم العميل بعد "باسم/لـ")
- meterPrice: رقم (سعر المتر؛ حوّل "ألف"=×1000، "مليون"=×1000000)
- money: رقم (مبلغ كلفة أو دفعة؛ نفس قاعدة التحويل)
- autoMaterials: true إذا طلب "المواد المناسبة/التقريبية"
- entityRef: "this" إذا قال "هذا/هذه/نفس/الحالي" ، أو "last" إذا قصد آخر كيان
- contractRef: رقم العقد إن ذُكر (مثل V-2026-0004)
- route: /projects | /contracts | /customers | /materials | /costs | /payments | /reports | /  حسب الصفحة المطلوبة

قواعد:
- رتّب intents حسب منطق التنفيذ (إنشاء قبل ربط قبل دفعة).
- ضع في missingFields الحقول المطلوبة الناقصة فقط.
- إن نقص شيء، اكتب clarificationQuestion سؤالاً عربياً واحداً موجزاً، وإلا اجعله null.
- confidence رقم بين 0 و 1.
- لا تضع أرقام هواتف أو أسماء غير مذكورة.

أعِد بهذا الشكل بالضبط:
{"intents":[...],"entities":{...},"missingFields":[...],"clarificationQuestion":"... أو null","normalizedCommand":"a -> b","confidence":0.0}`;

export class LlmNluProvider {
  readonly name: string;
  constructor(private readonly client: LlmClient) {
    this.name = `llm:${client.name}`;
  }

  async interpret(transcript: string, ctx: LlmContextFlags): Promise<LlmInterpretation> {
    const user = [
      `الكلام: "${transcript}"`,
      `سياق: يوجد مشروع سابق=${ctx.hasLastProject}، عقد سابق=${ctx.hasLastContract}، عميل سابق=${ctx.hasLastCustomer}`,
    ].join('\n');

    const raw = await this.client.complete({ system: SYSTEM_PROMPT, user });
    return this.parse(raw, transcript);
  }

  private parse(raw: string, transcript: string): LlmInterpretation {
    const json = extractJson(raw);
    const obj = JSON.parse(json) as Record<string, unknown>;

    const intents = Array.isArray(obj.intents)
      ? (obj.intents
          .map((i) => normalizeIntent(String(i)))
          .filter((i): i is VoiceIntent => i !== null))
      : [];

    const entityBag = coerceEntities(
      (obj.entities ?? {}) as Record<string, unknown>,
    );

    const missingFields = Array.isArray(obj.missingFields)
      ? obj.missingFields.map((f) => String(f)).slice(0, 12)
      : [];

    const clarificationQuestion =
      typeof obj.clarificationQuestion === 'string' && obj.clarificationQuestion.trim()
        ? obj.clarificationQuestion.trim()
        : null;

    const confidence = clamp01(Number(obj.confidence));

    return {
      intents,
      entityBag,
      missingFields,
      clarificationQuestion,
      normalizedCommand:
        typeof obj.normalizedCommand === 'string'
          ? obj.normalizedCommand
          : intents.join(' -> ') || normalizeArabic(transcript),
      confidence,
    };
  }
}

// ---------- validation helpers (defensive — never trust the model) ----------

function normalizeIntent(value: string): VoiceIntent | null {
  let v = value.trim().toLowerCase();
  if (v === 'add_materials') v = VoiceIntent.ADD_MATERIALS; // alias
  return INTENT_SET.has(v) ? (v as VoiceIntent) : null;
}

function coerceEntities(raw: Record<string, unknown>): EntityBag {
  const bag: EntityBag = {};
  const numField = (k: keyof EntityBag, v: unknown) => {
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) (bag[k] as number) = n;
  };

  if (typeof raw.projectType === 'string' && PROJECT_TYPES.has(raw.projectType)) {
    bag.projectType = raw.projectType as ProjectType;
  }
  numField('area', raw.area);
  numField('frontage', raw.frontage);
  numField('depth', raw.depth);
  numField('floors', raw.floors);
  numField('meterPrice', raw.meterPrice);
  numField('money', raw.money);
  if (typeof raw.customerName === 'string' && raw.customerName.trim()) {
    bag.customerName = raw.customerName.trim().slice(0, 120);
  }
  if (raw.autoMaterials === true) bag.autoMaterials = true;
  if (typeof raw.entityRef === 'string') bag.entityRef = raw.entityRef === 'last' ? 'last' : 'this';
  if (typeof raw.contractRef === 'string' && raw.contractRef.trim()) {
    bag.contractRef = raw.contractRef.trim().slice(0, 60);
  }
  if (typeof raw.route === 'string' && raw.route.startsWith('/')) {
    bag.route = raw.route.trim().slice(0, 60);
  }
  return bag;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

/** Tolerate code fences / stray prose around the JSON object. */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('llm_no_json');
  return body.slice(start, end + 1);
}

// ============================================================
// Canned, deterministic assistant replies — produced by the pre-router WITHOUT
// any LLM call (so help/greeting/status cost nothing and never misfire as a
// command). One place to edit the assistant's "what can you do" voice.
// ============================================================

/** The standard capability intro (help reply). */
export const CAPABILITY_INTRO =
  'أكدر أساعدك بإدارة العملاء، المشاريع، العقود، الدفعات، المصاريف، قوالب التقدير، والتقارير.';

/** Example commands, shown as quick chips + appended to the help text. */
export const CAPABILITY_SUGGESTIONS = [
  'أضف عميل باسم علي',
  'سوّي مشروع جديد للعميل أحمد',
  'سجل دفعة لمشروع الزهراء',
  'شكد مصاريف مشروع دار المنصور؟',
  'أنشئ قالب تقدير لبناء بيت 200 متر',
];

/** The full help message (intro + examples) for clients that don't render chips. */
export function capabilityMessage(): string {
  return [CAPABILITY_INTRO, 'أمثلة:', ...CAPABILITY_SUGGESTIONS.map((s) => `- ${s}`)].join('\n');
}

/** Friendly greeting reply. */
export const GREETING_MESSAGE =
  'هلا بيك 👋 آني المساعد الذكي. اكتب أمرك بلغتك الطبيعية، أو اسأل «شنو تكدر تسوي».';

/** Shown when a bare confirm/cancel word arrives with no plan awaiting. */
export const NO_PENDING_MESSAGE = 'ما في خطة بانتظار التأكيد.';

/** Status reply when nothing is pending. */
export const STATUS_IDLE_MESSAGE = 'ما في شي قيد التنفيذ حالياً. اكتب أمرك وأنا حاضر.';

/** Status reply when a plan is awaiting confirmation. */
export function statusPendingMessage(summary: string | null): string {
  return summary
    ? `عندك خطة بانتظار التأكيد: ${summary}. اكتب «نعم» للتأكيد أو «لا» للإلغاء.`
    : 'عندك خطة بانتظار التأكيد. اكتب «نعم» للتأكيد أو «لا» للإلغاء.';
}

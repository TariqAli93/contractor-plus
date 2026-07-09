// ============================================================
// Canned, deterministic assistant replies — produced WITHOUT any LLM call, so
// general conversation (help / greeting / smalltalk / status) costs nothing and
// can never misfire as a command. One place to edit the assistant's voice.
//
// Every string here is user-facing Arabic. Nothing in this file may name a tool,
// an action, a plan, or any other internal concept.
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
  'سوّيلي قالب تقدير لبيت',
];

/** The full help message (intro + examples) for clients that don't render chips. */
export function capabilityMessage(): string {
  return [CAPABILITY_INTRO, 'أمثلة:', ...CAPABILITY_SUGGESTIONS.map((s) => `- ${s}`)].join('\n');
}

/** Friendly greeting reply. */
export const GREETING_MESSAGE =
  'هلا بيك 👋 آني المساعد الذكي. اكتب طلبك بلغتك الطبيعية، أو اسأل «شنو تكدر تسوي».';

/** Smalltalk replies, keyed by the topic the pre-router recognized. */
export const SMALLTALK_MESSAGES: Record<'thanks' | 'farewell' | 'identity', string> = {
  thanks: 'العفو 🙏 أي وقت تحتاجني اكتبلي.',
  farewell: 'بالتوفيق! آني هنا وقت ما تحتاجني.',
  identity:
    'آني المساعد الذكي حق برنامج المقاولات. أكدر أدير عملائك ومشاريعك وعقودك ودفعاتك ومصاريفك وقوالب التقدير، وأجاوبك على أسئلتك عن بياناتك.',
};

/** Shown when a bare «نعم»/«لا» arrives with nothing awaiting the user's approval. */
export const NO_PENDING_MESSAGE = 'ما عندك أي طلب بانتظار موافقتك حالياً. اكتبلي شتريد وأساعدك.';

/** Status reply when nothing is pending. */
export const STATUS_IDLE_MESSAGE = 'ما في شي قيد التنفيذ حالياً. اكتب طلبك وآني حاضر.';

/** Status reply when a mutation is genuinely awaiting the user's approval. */
export function statusPendingMessage(summary: string | null): string {
  return summary
    ? `يوجد طلب بانتظار موافقتك: ${summary}\nاكتب «نعم» للموافقة أو «لا» للإلغاء.`
    : 'يوجد طلب بانتظار موافقتك. اكتب «نعم» للموافقة أو «لا» للإلغاء.';
}

/** Anything the user cancels — a parked request, or a guided conversation. */
export const CANCELLED_MESSAGE = 'تم الإلغاء. ما تغيّر أي شي.';

/** A question was understood as a data change. Questions never mutate. */
export const READ_ONLY_QUESTION_MESSAGE =
  'فهمت رسالتك كسؤال، وآني ما أغيّر أي بيانات من سؤال. إذا تريدني أنفّذ التعديل، اكتبه أمر صريح (مثلاً: «سجل دفعة بمبلغ ٥٠٠ لمشروع الزهراء»).';

import type { AiMessage } from '../../../lib/ai/ai-provider.interface.js';
import type { ReportNarrativeContext } from '../services/ai-context.service.js';

// Shared scaffolding for the four report-narrative prompts. The system prompt
// is the anti-hallucination contract: numbers verbatim, JSON only, Arabic.

const BASE_SYSTEM_PROMPT = `أنت محلل مالي في نظام إدارة مقاولات عراقي. تفسّر تقارير رقمية لمقاولين غير محاسبين.

قواعد صارمة غير قابلة للكسر:
1. فسّر حصريًا اعتمادًا على الأرقام الواردة في JSON المرفق. يُمنع منعًا باتًا اختراع أو تقدير أو إعادة حساب أي رقم غير موجود نصًا في البيانات.
2. انسخ المبالغ والنسب والتواريخ حرفيًا كما وردت، بما في ذلك رمز العملة الملاصق للمبلغ.
3. إن كانت البيانات فارغة أو شبه فارغة فقل ذلك بصراحة ولا تملأ الفراغ بافتراضات.
4. اكتب بالعربية الفصحى الموجزة (3 إلى 6 جمل)، بلا مقدمات ولا مجاملات ولا خاتمة.
5. أعد JSON فقط، دون أي نص قبله أو بعده، بالبنية الحرفية:
{"narrative": "النص التفسيري", "factors": ["عامل 1", "عامل 2"]}
6. "factors": من 2 إلى 6 عوامل قصيرة (سطر واحد لكل عامل) مستخلصة من البيانات نفسها فقط.`;

/** Compose the two-message prompt: contract + type focus, then the data. */
export function buildNarrativeMessages(
  typeFocus: string,
  context: ReportNarrativeContext,
): AiMessage[] {
  const currencyNote = context.currencyLabel
    ? `كل المبالغ في البيانات بالعملة: ${context.currencyLabel}.`
    : '';
  return [
    { role: 'system', content: `${BASE_SYSTEM_PROMPT}\n\nتركيز هذا التقرير: ${typeFocus}` },
    {
      role: 'user',
      content: `${currencyNote}\nبيانات التقرير (JSON):\n${JSON.stringify(context.data, null, 1)}`,
    },
  ];
}

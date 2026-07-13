import type { AiMessage } from '../../../lib/ai/ai-provider.interface.js';

// Phase 4 — the AI layer of the save-guard. Advisory sanity notes ONLY (is
// the category logical for the description? does the scale look odd?). The
// deterministic checks in ai-recommendation.service are computed separately;
// this layer must never block anything and its failure is swallowed.

const SYSTEM_PROMPT = `أنت فاحص إدخالات محاسبية في نظام مقاولات. تصلك بيانات سجل واحد (تكلفة أو دفعة) قبل حفظه، ومهمتك رصد ما يبدو غير منطقي فيه فقط — مثل تصنيف لا يطابق الوصف، أو وحدة قياس غريبة، أو قيمة شاذة الحجم قياسًا بسياقها.

قواعد صارمة:
- لاحظ فقط ما يظهر في البيانات المرفقة؛ لا تفترض شيئًا غير موجود.
- لا تكرر فحوصًا حسابية (تجاوز الميزانية/التكرار) — تُحسب برمجيًا خارجك.
- أعد JSON فقط بالبنية: {"warnings": [{"code": "...", "severity": "info"|"warning", "message": "..."}]}
- "code" لاتيني قصير UPPER_SNAKE، و"message" عربية موجزة عملية.
- حتى 3 تحذيرات كحد أقصى؛ وإن كان كل شيء منطقيًا أعد {"warnings": []}.`;

export function buildSaveGuardMessages(
  entity: 'cost' | 'payment',
  payload: Record<string, unknown>,
): AiMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `نوع السجل: ${entity === 'cost' ? 'تكلفة مشروع' : 'دفعة مستحقة'}\nالبيانات (JSON):\n${JSON.stringify(payload, null, 1)}`,
    },
  ];
}

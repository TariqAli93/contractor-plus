import type { AiMessage } from '../../../lib/ai/ai-provider.interface.js';

// Phase 4 — enrichment layer over DETERMINISTIC findings. The model never
// discovers patterns itself (the detectors did, from public-service data,
// anonymized: no customer identifiers); it only prioritises and phrases
// actionable Arabic advice, joined back to findings by id.

const SYSTEM_PROMPT = `أنت مستشار مالي لمقاول. تصلك قائمة نتائج مكتشفة برمجيًا من بيانات مشاريعه (هوامش ربح، تحصيل متأخر، أسعار مواد). مهمتك فقط: ترتيب أولوياتها وصياغة نصيحة عملية موجزة لكل بند.

قواعد صارمة:
- استخدم الأرقام كما وردت حرفيًا؛ لا تحسب ولا تخترع أرقامًا أو بنودًا جديدة.
- أعد JSON فقط بالبنية: {"items": [{"id": "...", "priority": 1-5, "advice": "..."}]}
- "id" يجب أن يكون من قائمة البنود المرفقة حصريًا — أي id غريب يُهمل.
- "priority": 5 = عاجل جدًا، 1 = منخفض. "advice": جملة أو جملتان عمليتان بالعربية.
- رتّب العناصر في المصفوفة من الأعلى أولوية إلى الأدنى.`;

export interface AnonymizedFinding {
  id: string;
  kind: string;
  metrics: Record<string, string | number>;
}

export function buildRecommendationsMessages(
  findings: AnonymizedFinding[],
  currencyLabel: string,
): AiMessage[] {
  const currencyNote = currencyLabel ? `كل المبالغ بالعملة: ${currencyLabel}.` : '';
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${currencyNote}\nالبنود المكتشفة (JSON):\n${JSON.stringify(findings, null, 1)}`,
    },
  ];
}

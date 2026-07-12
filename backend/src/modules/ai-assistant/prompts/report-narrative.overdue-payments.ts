import type { AiMessage } from '../../../lib/ai/ai-provider.interface.js';
import type { ReportNarrativeContext } from '../services/ai-context.service.js';
import { buildNarrativeMessages } from './report-narrative.shared.js';

const FOCUS =
  'الدفعات المستحقة غير المسددة مجمّعة حسب المشروع. أبرز أكبر المبالغ المتأخرة وأقدمها، ' +
  'ودلالة تركّز التأخر في مشاريع بعينها على التحصيل.';

export function buildOverduePaymentsNarrativeMessages(
  context: ReportNarrativeContext,
): AiMessage[] {
  return buildNarrativeMessages(FOCUS, context);
}

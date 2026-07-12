import type { AiMessage } from '../../../lib/ai/ai-provider.interface.js';
import type { ReportNarrativeContext } from '../services/ai-context.service.js';
import { buildNarrativeMessages } from './report-narrative.shared.js';

const FOCUS =
  'ربحية المشاريع: قيمة العقد مقابل إجمالي المصاريف والمحصّل. أبرز المشاريع الأعلى والأدنى ربحًا، ' +
  'وأي مشروع وضعه النقدي (المحصّل ناقص المصاريف) سالب.';

export function buildProjectProfitabilityNarrativeMessages(
  context: ReportNarrativeContext,
): AiMessage[] {
  return buildNarrativeMessages(FOCUS, context);
}

import type { AiMessage } from '../../../lib/ai/ai-provider.interface.js';
import type { ReportNarrativeContext } from '../services/ai-context.service.js';
import { buildNarrativeMessages } from './report-narrative.shared.js';

const FOCUS =
  'التدفق النقدي خلال الفترة. اربط بين الإيراد المتعاقد عليه والمحصّل فعليًا، ' +
  'وبيّن دلالة الرصيد غير المحصّل وصافي التدفق (موجب أم سالب) على سيولة المقاول.';

export function buildCashFlowNarrativeMessages(context: ReportNarrativeContext): AiMessage[] {
  return buildNarrativeMessages(FOCUS, context);
}

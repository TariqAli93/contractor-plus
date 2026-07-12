import type { AiMessage } from '../../../lib/ai/ai-provider.interface.js';
import type { ReportNarrativeContext } from '../services/ai-context.service.js';
import { buildNarrativeMessages } from './report-narrative.shared.js';

const FOCUS =
  'المشاريع المتأخرة عن موعد تسليمها. أبرز أشد المشاريع تأخرًا (أيام التأخير مقابل نسبة الإنجاز)، ' +
  'وميّز بين تأخير مع تقدم شبه مكتمل وتأخير مع تقدم متدنٍ.';

export function buildDelayedProjectsNarrativeMessages(
  context: ReportNarrativeContext,
): AiMessage[] {
  return buildNarrativeMessages(FOCUS, context);
}

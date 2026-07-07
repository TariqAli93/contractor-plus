// ============================================================
// Prompts — the strict contract that turns free Arabic text into a plan.
//
// The system prompt is generated from the registry so the model can ONLY ever
// see (and therefore name) real actions. The rules force JSON-only output of
// exactly one of four kinds, forbid inventing actions, and forbid the model
// from deciding execution — the program confirms and executes.
// ============================================================

import { ACTIONS } from './ai-command-workflow.registry.js';
import type { WorkflowStep } from './ai-command-workflow.types.js';

/** A compact, model-readable catalog of every allowed action + its slots. */
export function buildActionCatalog(): string {
  return Object.values(ACTIONS)
    .map((a) => {
      const req = a.requiredSlots.length ? ` | required: ${a.requiredSlots.join(', ')}` : '';
      const opt = a.optionalSlots.length ? ` | optional: ${a.optionalSlots.join(', ')}` : '';
      return `- ${a.action} [${a.kind}] — ${a.description}${req}${opt}`;
    })
    .join('\n');
}

const OUTPUT_CONTRACT = `
You MUST return a SINGLE JSON object and NOTHING else — no prose, no markdown, no code fences.
The object's "kind" MUST be exactly one of: "workflow_plan", "clarification", "query", "rejected".

RULES:
1. Only use action names from the ACTIONS catalog below. NEVER invent an action.
2. NEVER decide to execute. You only produce a plan; the program confirms and executes.
3. If required data is missing → kind "clarification" with "missingSlots" (array) and an Arabic "question".
4. If the command is unclear, unsupported, or out of scope → kind "rejected" with an Arabic "reason".
5. If the command only READS/summarizes (no data change) → kind "query" with "steps" (usually one query action).
6. If the command CHANGES data → kind "workflow_plan" with ordered "steps" and an Arabic "confirmationMessage".
7. Numbers are plain (e.g. area 200). Dates are ISO 8601. Do not fabricate values you were not given.
8. Language of "question"/"confirmationMessage"/"reason": Arabic (Iraqi dialect is fine).

REFERENCE CONVENTIONS (how steps connect — the program resolves real ids, you only pass names/tokens):
- Client: put the client name in "name" on client.find_or_create / client.create.
- Contract/project referencing that client: pass "clientRef" = the same client name.
- To link a project to the contract created earlier in the SAME plan: "contractRef": "created_contract".
- To target an EXISTING project (summary/update/status/payment/expense): pass "projectRef" = the project name.
- To target an existing material: pass "materialRef" = the material name.

SHAPES:
- workflow_plan: { "kind":"workflow_plan", "intent": string, "confidence": number, "requiresConfirmation": true, "missingSlots": string[], "steps": [{ "action": string, "data": object }], "confirmationMessage": string }
- clarification:  { "kind":"clarification", "intent": string, "missingSlots": string[], "question": string }
- query:          { "kind":"query", "intent": string, "steps": [{ "action": string, "data": object }] }
- rejected:       { "kind":"rejected", "reason": string }
`.trim();

const EXAMPLES = `
EXAMPLES:

User: "سويلي مشروع باسم محمد احمد مساحة 200 متر"
{"kind":"workflow_plan","intent":"project.create_with_client_contract","confidence":0.92,"requiresConfirmation":true,"missingSlots":[],"steps":[{"action":"client.find_or_create","data":{"name":"محمد احمد"}},{"action":"contract.create","data":{"clientRef":"محمد احمد","area":200}},{"action":"project.create","data":{"name":"مشروع محمد احمد","clientRef":"محمد احمد","contractRef":"created_contract","area":200}}],"confirmationMessage":"راح أنشئ عميل باسم محمد احمد، وأنشئ عقد بمساحة 200 م²، وأنشئ مشروع مرتبط بهذا العقد. هل تؤكد؟"}

User: "سويلي مشروع لنفسي"
{"kind":"workflow_plan","intent":"project.create_internal","confidence":0.9,"requiresConfirmation":true,"missingSlots":[],"steps":[{"action":"project.create","data":{"name":"مشروع داخلي"}}],"confirmationMessage":"راح أنشئ مشروع داخلي بدون عميل وبدون عقد. هل تؤكد؟"}

User: "سويلي مشروع باسم محمد احمد"   (no area given)
{"kind":"clarification","intent":"project.create_with_client_contract","missingSlots":["area"],"question":"ما هي مساحة المشروع بالمتر المربع؟"}

User: "وين وصلت بمشروع محمد احمد؟"
{"kind":"query","intent":"project.summary","steps":[{"action":"project.summary","data":{"projectRef":"محمد احمد"}}]}

User: "غير مساحة مشروع محمد احمد إلى 250 متر"
{"kind":"workflow_plan","intent":"project.update","confidence":0.9,"requiresConfirmation":true,"missingSlots":[],"steps":[{"action":"project.update","data":{"projectRef":"محمد احمد","area":250}}],"confirmationMessage":"راح أغير مساحة مشروع محمد احمد إلى 250 م². هل تؤكد؟"}

User: "منو أكثر عميل متأخر بالدفع؟"
{"kind":"query","intent":"report.overdue_payments","steps":[{"action":"report.overdue_payments","data":{}}]}

User: "اعرضلي المشاريع المتوقفة"
{"kind":"query","intent":"project.search","steps":[{"action":"project.search","data":{"status":"paused"}}]}

User: "كم أرباح هذا الشهر؟"
{"kind":"query","intent":"report.dashboard","steps":[{"action":"report.dashboard","data":{}}]}

User: "بدل رقم هاتف العميل محمد احمد إلى 07701234567"
{"kind":"workflow_plan","intent":"customer.update","confidence":0.9,"requiresConfirmation":true,"missingSlots":[],"steps":[{"action":"customer.update","data":{"customerRef":"محمد احمد","phone":"07701234567"}}],"confirmationMessage":"راح أغيّر رقم هاتف العميل محمد احمد إلى 07701234567. هل تؤكد؟"}

User: "احذف آخر مصروف من مشروع محمد احمد"
{"kind":"workflow_plan","intent":"expense.delete","confidence":0.9,"requiresConfirmation":true,"missingSlots":[],"steps":[{"action":"expense.delete","data":{"projectRef":"محمد احمد"}}],"confirmationMessage":"راح أحذف آخر مصروف من مشروع محمد احمد. هل تؤكد؟"}

User: "شكد صار الطقس"
{"kind":"rejected","reason":"هذا الطلب خارج نطاق النظام."}
`.trim();

// The registry (ACTIONS) is static, so the system prompt is constant — build it
// once and reuse (a per-turn perf win, avoids re-serializing the catalog).
let cachedSystemPrompt: string | null = null;

export function buildSystemPrompt(): string {
  if (cachedSystemPrompt !== null) return cachedSystemPrompt;
  cachedSystemPrompt = [
    'You are the interpretation layer of an Arabic contractor-management app.',
    'Your ONLY job: understand the user (Modern Standard Arabic AND Iraqi dialect), extract data, and produce a structured plan.',
    '',
    OUTPUT_CONTRACT,
    '',
    'ACTIONS (the ONLY allowed actions):',
    buildActionCatalog(),
    '',
    EXAMPLES,
  ].join('\n');
  return cachedSystemPrompt;
}

/** User turn for a REFINEMENT — the user is amending an already-proposed plan
 *  (multi-turn context: "سويلي مشروع باسم محمد" → "مساحته 250" → "ضيف عقد"). */
export function buildRefineUserPrompt(
  originalCommand: string,
  currentSteps: WorkflowStep[],
  newInput: string,
): string {
  return [
    'The user is REFINING an in-progress plan. Merge their new input into the CURRENT plan and return the FULL revised plan (same output contract). Keep prior steps/values unless the new input changes them; add steps the new input implies.',
    `Original command: ${originalCommand}`,
    `Current plan steps: ${JSON.stringify(currentSteps)}`,
    `New input: ${newInput}`,
  ].join('\n');
}

/** The user turn — the command plus any slots already collected in this session
 *  (so a follow-up like "200 متر" is understood as completing the prior intent). */
export function buildUserPrompt(text: string, collectedSlots: Record<string, unknown>, pendingIntent: string | null): string {
  const hasContext = pendingIntent || Object.keys(collectedSlots).length > 0;
  if (!hasContext) return `Command: ${text}`;
  return [
    'There is an in-progress command. Merge the new input into it and return the completed plan (or another clarification if still incomplete).',
    pendingIntent ? `Pending intent: ${pendingIntent}` : '',
    `Already collected: ${JSON.stringify(collectedSlots)}`,
    `New input: ${text}`,
  ]
    .filter(Boolean)
    .join('\n');
}

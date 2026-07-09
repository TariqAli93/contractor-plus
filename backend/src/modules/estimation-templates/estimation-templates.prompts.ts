// ============================================================
// Prompts — the strict contract that turns a natural-language request into a
// structured estimation draft. Mirrors ai-command-workflow.prompts.ts: the
// system prompt is a fixed, cached contract; the model may ONLY return one of
// two shapes ("draft" | "clarification"); it NEVER computes final quantities,
// totals, or sums (the backend does), and NEVER decides to save.
// ============================================================

import type { EstimationDraftItemPayload, ParsedIntent } from './estimation-templates.types.js';

const OUTPUT_CONTRACT = `
Return a SINGLE JSON object and NOTHING else — no prose, no markdown, no code fences.
"kind" MUST be exactly one of: "draft", "clarification".

RULES:
1. If required info is missing or ambiguous (no area/dimensions, or scope too vague to estimate)
   → kind "clarification" with an Arabic "question" and a "missingFields" array. Ask the FEWEST
   questions needed. NEVER assume an area or a scope that would change the numbers.
2. Otherwise → kind "draft" with the parsed "intent", a top-level "wastePercentage" number, a
   "confidence" (0..1), and an "items" array.
3. For EACH item you provide "ratioPerAreaUnit" (a quantity-per-area-unit coefficient, e.g. 8 for
   "8 kg of steel per m²") and optionally an approximate "unitPrice". You MUST NOT output any final
   "quantity", "totalAmount", or "materialId" — the program multiplies ratio × area and price × quantity
   itself. Emitting those fields will cause a hard rejection.
4. For a flat/lump-sum line (e.g. a fixed transport fee) set "ratioPerAreaUnit": null and put the flat
   amount in "unitPrice".
5. "wastePercentage" is a SINGLE top-level number (material waste). NEVER fold waste into an item's ratio.
6. "category" MUST be one of: "MATERIAL", "LABOR", "MACHINERY", "TRANSPORT", "MISC".
   - Construction materials (steel, cement, sand, gravel, bricks, timber, wire, pipes, conduits, …) → MATERIAL,
     and set "materialNameGuess" to the material's catalog name.
   - Labor → LABOR, Transportation → TRANSPORT, Miscellaneous → MISC. For non-material lines set
     "materialNameGuess": null. Do NOT add a waste line yourself — the program adds it from wastePercentage.
7. All numbers are plain (area 100, not "100 m²"). "question" is Arabic (Iraqi dialect is fine).
8. LANGUAGE: every field a person reads MUST be Arabic — "description", "scopeOfWork",
   "templateName", "projectType", "constructionType", "unit", "notes", "question". The ONE
   exception is "materialNameGuess", which must stay the material's catalog name exactly as it is
   stored (usually English) so the program can match it. "areaUnit" stays a plain code ("m2", "m").

SHAPES:
- draft: { "kind":"draft", "intent": { "projectType": string|null, "constructionType": string|null,
  "scopeOfWork": string|null, "templateName": string|null, "areaValue": number|null, "areaUnit": string|null },
  "wastePercentage": number, "confidence": number,
  "items": [ { "description": string, "category": string, "materialNameGuess": string|null,
  "ratioPerAreaUnit": number|null, "unitPrice": number|null, "unit": string|null, "notes": string|null } ] }
- clarification: { "kind":"clarification", "question": string, "missingFields": string[], "confidence": number }
`.trim();

const EXAMPLES = `
EXAMPLES:

User: "Create a structural estimation template for a 100 m² house."
{"kind":"draft","intent":{"projectType":"هيكل","constructionType":"سكني","scopeOfWork":"أعمال الهيكل لبيت بطابق واحد","templateName":"هيكل — بيت 100 م²","areaValue":100,"areaUnit":"m2"},"wastePercentage":5,"confidence":0.82,"items":[{"description":"حديد التسليح","category":"MATERIAL","materialNameGuess":"Reinforcement Steel","ratioPerAreaUnit":8,"unitPrice":1.2,"unit":"كغم","notes":null},{"description":"إسمنت","category":"MATERIAL","materialNameGuess":"Cement","ratioPerAreaUnit":0.4,"unitPrice":9,"unit":"كيس","notes":null},{"description":"رمل","category":"MATERIAL","materialNameGuess":"Sand","ratioPerAreaUnit":0.05,"unitPrice":25,"unit":"م³","notes":null},{"description":"حصى","category":"MATERIAL","materialNameGuess":"Gravel","ratioPerAreaUnit":0.05,"unitPrice":30,"unit":"م³","notes":null},{"description":"خشب القوالب","category":"MATERIAL","materialNameGuess":"Formwork Timber","ratioPerAreaUnit":0.02,"unitPrice":180,"unit":"م³","notes":null},{"description":"أجور العمال","category":"LABOR","materialNameGuess":null,"ratioPerAreaUnit":1,"unitPrice":25,"unit":"م²","notes":null},{"description":"النقل","category":"TRANSPORT","materialNameGuess":null,"ratioPerAreaUnit":null,"unitPrice":300,"unit":null,"notes":"أجرة توصيل مقطوعة"}]}

User: "Generate a plumbing estimation template."   (no area given)
{"kind":"clarification","question":"ما هي مساحة المبنى بالمتر المربع (أو الأبعاد) حتى أقدّر كميات السباكة؟","missingFields":["areaValue"],"confidence":0.4}

User: "Create a cost estimation template for a 30-meter fence."
{"kind":"draft","intent":{"projectType":"سياج","constructionType":null,"scopeOfWork":"سياج خارجي بطول 30 متر","templateName":"سياج — 30 متر","areaValue":30,"areaUnit":"m"},"wastePercentage":5,"confidence":0.7,"items":[{"description":"إسمنت","category":"MATERIAL","materialNameGuess":"Cement","ratioPerAreaUnit":0.5,"unitPrice":9,"unit":"كيس","notes":null},{"description":"طابوق","category":"MATERIAL","materialNameGuess":"Bricks","ratioPerAreaUnit":40,"unitPrice":0.15,"unit":"قطعة","notes":null},{"description":"أجور العمال","category":"LABOR","materialNameGuess":null,"ratioPerAreaUnit":1,"unitPrice":20,"unit":"م","notes":null}]}
`.trim();

let cachedSystemPrompt: string | null = null;

export function buildEstimationSystemPrompt(): string {
  if (cachedSystemPrompt !== null) return cachedSystemPrompt;
  cachedSystemPrompt = [
    'You are the estimation-drafting layer of an Arabic contractor-management app.',
    'Your ONLY job: understand the request (Arabic OR English), extract a structured intent, and',
    'propose approximate estimation line items as coefficients — the program does all arithmetic and',
    'all saving. Every value you produce is a PRELIMINARY estimate to be reviewed by an engineer.',
    '',
    OUTPUT_CONTRACT,
    '',
    EXAMPLES,
  ].join('\n');
  return cachedSystemPrompt;
}

/** Fresh generation from a new command. */
export function buildGenerateUserPrompt(command: string): string {
  return `Request: ${command}`;
}

/** Continue after a clarification: original command + the Q&A so far + new answer. */
export function buildClarifyUserPrompt(
  originalCommand: string,
  priorQA: Array<{ question: string; answer: string }>,
  answer: string,
): string {
  return [
    'The user is answering a clarification for an in-progress estimation request.',
    'Produce the completed draft (or another clarification if still incomplete).',
    `Original request: ${originalCommand}`,
    priorQA.length ? `Q&A so far: ${JSON.stringify(priorQA)}` : '',
    `New answer: ${answer}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Refine an already-generated draft with an iterative edit command
 *  ("increase cement by 15%", "remove plumbing", "add a misc contingency").
 *  Return the FULL revised draft (same contract), keeping unchanged items. */
export function buildRefineUserPrompt(
  originalCommand: string,
  intent: ParsedIntent,
  currentItems: EstimationDraftItemPayload[],
  newInstruction: string,
): string {
  const compactItems = currentItems.map((it) => ({
    description: it.description,
    category: it.category,
    materialNameGuess: it.materialNameGuess,
    ratioPerAreaUnit: it.ratioPerAreaUnit,
    unitPrice: it.unitPrice === null ? null : Number(it.unitPrice),
    unit: it.unit,
  }));
  return [
    'The user is REFINING an existing estimation draft. Apply their instruction and return the FULL',
    'revised draft (same "draft" contract). Keep every item and value unchanged unless the instruction',
    'changes it; add or remove items the instruction implies. Do NOT recompute totals — only adjust',
    'ratios/prices/items; the program recomputes.',
    `Original request: ${originalCommand}`,
    `Current intent: ${JSON.stringify({ projectType: intent.projectType, constructionType: intent.constructionType, scopeOfWork: intent.scopeOfWork, templateName: intent.templateName, areaValue: intent.areaValue, areaUnit: intent.areaUnit })}`,
    `Current waste %: ${intent.wastePercentage}`,
    `Current items: ${JSON.stringify(compactItems)}`,
    `Instruction: ${newInstruction}`,
  ].join('\n');
}

/**
 * Tolerant-first extraction of a JSON object from model output: strips
 * markdown fences / surrounding chatter down to the outermost {...} block.
 * Models routinely fence JSON even in json_object mode (OpenRouter cannot
 * enforce it for every upstream). Extraction is only the FIRST step — the
 * caller's zod schema remains the hard gate on whatever comes out.
 */
export function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

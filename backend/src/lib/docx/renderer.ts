import { readFile } from 'node:fs/promises';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import type { PlaceholderMap } from './placeholder-map.js';

// Thin wrapper around docxtemplater. Two things matter:
//   1. We deliberately catch and re-throw with a single, structured error
//      shape so the upload service can return useful HTTP responses
//      instead of leaking docxtemplater's internal error tree.
//   2. `paragraphLoop: true` + `linebreaks: true` keep multi-line values
//      (notes, addresses) rendering as multiple paragraphs, which is what
//      Arabic users on the contractor team consistently expect.

export class DocxRenderError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'TEMPLATE_CORRUPT'
      | 'TEMPLATE_INVALID'
      | 'RENDER_FAILED',
    public readonly explanation?: string,
  ) {
    super(message);
    this.name = 'DocxRenderError';
  }
}

export interface RenderResult {
  buffer: Buffer;
}

/**
 * Render a DOCX template into a Buffer. Caller is responsible for writing
 * the result to disk + persisting metadata; this function is pure I/O →
 * I/O so it can be reused later for in-memory previews and other targets.
 */
export async function renderDocxTemplate(
  templateAbsolutePath: string,
  placeholders: PlaceholderMap,
): Promise<RenderResult> {
  let zip: PizZip;
  try {
    const file = await readFile(templateAbsolutePath);
    zip = new PizZip(file);
  } catch (err) {
    throw new DocxRenderError(
      'Template file is corrupt or unreadable',
      'TEMPLATE_CORRUPT',
      err instanceof Error ? err.message : String(err),
    );
  }

  let doc: Docxtemplater;
  try {
    doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      // Empty values render as the literal empty string instead of
      // {{token}} text leaking into the document.
      nullGetter: () => '',
      // IMPORTANT: docxtemplater defaults to single-brace delimiters
      // (`{token}`), but every placeholder in this app (PlaceholderReferenceCard,
      // extractPlaceholders regex, all docs) uses the Mustache-style
      // double braces `{{token}}`. Without this override the lexer parses
      // `{{name}}` as `{` open → `{name` content → `}` close → and then
      // raises "Duplicate close tag" on the second `}`. Forcing the
      // delimiters here is the single source of truth.
      delimiters: { start: '{{', end: '}}' },
    });
  } catch (err) {
    throw new DocxRenderError(
      'Template is not a valid DOCX document',
      'TEMPLATE_INVALID',
      err instanceof Error ? err.message : String(err),
    );
  }

  try {
    doc.render(placeholders as unknown as Record<string, string>);
  } catch (err) {
    throw new DocxRenderError(
      'Failed to render the document',
      'RENDER_FAILED',
      summarizeDocxError(err),
    );
  }

  const buffer = doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  }) as Buffer;
  return { buffer };
}

/**
 * Pull the most useful one-line message out of a docxtemplater error tree.
 *
 * The library emits two shapes:
 *   - Aggregate failure: `properties.errors: Array<{ message }>` with one
 *     entry per offending token. We surface the first three.
 *   - Single failure: `properties` carries `id`, `explanation`, and
 *     optionally `xtag` directly. We surface those — they're the
 *     human-readable bit ("The tag ending with \"name}}\" has duplicate
 *     close tags") that operators actually need.
 *
 * Logs stay one line; no stack traces, no raw buffers.
 */
function summarizeDocxError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const properties = (
    err as Error & {
      properties?: {
        errors?: Array<{ message?: string; properties?: { explanation?: string } }>;
        id?: string;
        explanation?: string;
        xtag?: string;
      };
    }
  ).properties;
  const sub = properties?.errors;
  if (Array.isArray(sub) && sub.length > 0) {
    const first = sub
      .slice(0, 3)
      .map((e) => e?.properties?.explanation ?? e?.message ?? 'unknown')
      .join('; ');
    return `${err.message} — ${first}`;
  }
  if (properties?.explanation) {
    const tag = properties.xtag ? ` (tag: "${properties.xtag}")` : '';
    return `${err.message} — ${properties.explanation}${tag}`;
  }
  return err.message;
}

/**
 * Inspect a raw DOCX buffer and extract the {{token}} names that appear in
 * it. Used at upload time to build the `placeholdersJson` cache shown in
 * the templates UI. Best-effort: failures degrade to an empty list rather
 * than blocking the upload.
 */
export function extractPlaceholders(fileBuffer: Buffer): string[] {
  let zip: PizZip;
  try {
    zip = new PizZip(fileBuffer);
  } catch {
    return [];
  }
  const tokenRegex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  const out = new Set<string>();
  for (const entryName of Object.keys(zip.files)) {
    // word/ XML parts hold the real content; ignoring assets keeps this fast.
    if (!entryName.startsWith('word/') || !entryName.endsWith('.xml')) continue;
    const entry = zip.files[entryName];
    if (!entry) continue;
    const text = entry.asText();
    for (const match of text.matchAll(tokenRegex)) {
      const token = match[1];
      if (token) out.add(token);
    }
  }
  return Array.from(out).sort();
}

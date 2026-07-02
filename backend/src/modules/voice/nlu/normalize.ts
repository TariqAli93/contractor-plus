// ============================================================
// Arabic text normalisation + number parsing.
//
// Pure, dependency-free string utilities. Everything downstream (intent
// matching, entity extraction) runs on NORMALISED tokens so that the many
// orthographic variants of Arabic (أ/إ/آ/ا, ة/ه, ى/ي, tatweel, diacritics,
// Eastern vs Western digits) collapse to one form. We keep the ORIGINAL
// tokens alongside so proper names are returned with their real spelling.
// ============================================================

/** Convert Eastern-Arabic (٠-٩) and Persian (۰-۹) digits to Western 0-9. */
export function toWesternDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/** Strip Arabic diacritics (harakat) and the tatweel (ـ) elongation mark. */
export function stripDiacritics(input: string): string {
  return input.replace(/[ؐ-ًؚ-ٰٟـ]/g, '');
}

/**
 * Full normalisation for matching:
 * - unify alef forms (أ إ آ ٱ → ا), ta marbuta (ة → ه), alef maqsura (ى → ي),
 *   hamza seats (ؤ → و, ئ → ي), standalone hamza removed
 * - drop diacritics + tatweel
 * - Eastern digits → Western
 * - collapse whitespace, trim, lowercase (for any Latin)
 */
export function normalizeArabic(input: string): string {
  let s = toWesternDigits(input);
  s = stripDiacritics(s);
  s = s
    .replace(/[أإآٱ]/g, 'ا') // أ إ آ ٱ → ا
    .replace(/ة/g, 'ه') // ة → ه
    .replace(/ى/g, 'ي') // ى → ي
    .replace(/ؤ/g, 'و') // ؤ → و
    .replace(/ئ/g, 'ي') // ئ → ي
    .replace(/ء/g, ''); // ء (standalone hamza) → drop
  s = s.replace(/[^\S\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return s;
}

/** Strip a single leading "و" (and) only when the word is long enough to be
 *  safe — dictated Arabic often glues it to the next word ("وأضف", "ونزال"). */
export function deWaw(norm: string): string {
  return norm.length > 2 && norm.startsWith('و') ? norm.slice(1) : norm;
}

export interface Token {
  /** Original surface form (for proper names). */
  original: string;
  /** Normalised form (for matching). */
  norm: string;
}

/** Split on whitespace + common Arabic/Latin punctuation, keeping original + norm. */
export function tokenize(input: string): Token[] {
  const cleaned = input.replace(/[.,،؛;:!؟?"'()\[\]{}]/g, ' ');
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.map((p) => ({ original: p, norm: normalizeArabic(p) }));
}

// ---- spoken-number words (Arabic) → value ----
const NUMBER_WORDS: Record<string, number> = {
  صفر: 0,
  واحد: 1,
  اثنين: 2,
  اثنان: 2,
  ثلاثه: 3,
  ثلاث: 3,
  اربعه: 4,
  اربع: 4,
  خمسه: 5,
  خمس: 5,
  سته: 6,
  ست: 6,
  سبعه: 7,
  سبع: 7,
  ثمانيه: 8,
  ثمان: 8,
  تسعه: 9,
  تسع: 9,
  عشره: 10,
  عشر: 10,
  عشرين: 20,
  ثلاثين: 30,
  اربعين: 40,
  خمسين: 50,
  ستين: 60,
  سبعين: 70,
  ثمانين: 80,
  تسعين: 90,
  مايه: 100,
  مئه: 100,
  ميه: 100,
  مياه: 100,
  ميتين: 200,
  مئتين: 200,
  مايتين: 200,
  الف: 1000,
  مليون: 1_000_000,
  مليونين: 2_000_000,
  مليار: 1_000_000_000,
};

/**
 * Parse a single token to a number. Handles Western digits (after Eastern
 * conversion) and a small set of common spoken-number words. Returns null when
 * the token is not numeric.
 */
export function parseNumberToken(tokenNorm: string): number | null {
  if (/^\d+(\.\d+)?$/.test(tokenNorm)) {
    const n = Number(tokenNorm);
    return Number.isFinite(n) ? n : null;
  }
  const word = NUMBER_WORDS[tokenNorm];
  return word ?? null;
}

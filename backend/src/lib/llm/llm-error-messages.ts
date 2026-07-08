// ============================================================
// LLM failure code → clear, distinct Arabic message. The SINGLE backend source:
// both ai-command-workflow and estimation-templates consume this, so the wording
// (and the set of handled codes) can never drift per module.
// ============================================================

const LLM_ERROR_AR: Record<string, string> = {
  invalid_api_key: 'مفتاح OpenRouter غير صالح — راجع إعدادات المساعد الذكي.',
  insufficient_quota: 'انتهى رصيد الاستخدام لدى OpenRouter.',
  insufficient_credits: 'رصيد OpenRouter غير كافٍ — أضِف رصيداً للمتابعة.',
  rate_limited: 'OpenRouter مشغول حالياً، حاول بعد لحظات.',
  // 404-specific — never the generic connection error.
  model_not_found: 'تعذّر العثور على نقطة نهاية OpenRouter أو النموذج. يرجى التحقق من النموذج المُهيّأ في الإعدادات.',
  unsupported_response_format:
    'النموذج المُختار لا يدعم صيغة المخرجات المنظّمة الحالية. اختر نموذجاً آخر أو فعّل وضع JSON Schema.',
  malformed_response: 'ردّ مزوّد الذكاء الاصطناعي غير صالح ولم يُفهم — حاول مرة أخرى.',
  timeout: 'انتهت مهلة الاتصال بـ OpenRouter، حاول مرة أخرى.',
  network_error: 'تعذّر الوصول إلى OpenRouter — تحقّق من اتصال الإنترنت.',
  server_error: 'خطأ مؤقت من OpenRouter، حاول مرة أخرى.',
};

/** Localize a coded LLM failure; falls back to a generic connection message. */
export function llmErrorMessageAr(code: string): string {
  return LLM_ERROR_AR[code] ?? 'تعذّر الاتصال بمزوّد الذكاء الاصطناعي، حاول مرة أخرى.';
}

import type { AiToolDefinition } from '../../../lib/ai/ai-provider.interface.js';

// Phase 7 — conversational assistant. READ-ONLY by construction: the ONLY tool
// is a constrained report query, and every tool call is re-validated by
// ai-validation.service before it runs. There is no tool that mutates data, so
// the model cannot create/modify/delete anything even if asked.

export const CHAT_QUERY_TOOL_NAME = 'query_report';

/**
 * The single tool the chat model may call. Its parameters mirror the closed
 * constrained-query schema; whatever the model produces is re-validated by
 * ai-validation.service (the same gate as the NL→query endpoint) before it
 * touches ReportsService.
 */
export const CHAT_QUERY_TOOL: AiToolDefinition = {
  name: CHAT_QUERY_TOOL_NAME,
  description:
    'استعلام أحد التقارير الأربعة للقراءة فقط للإجابة على سؤال يخص أرقام المشاريع/المالية. أعد النتيجة ثم فسّرها بالعربية.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      reportType: {
        type: 'string',
        enum: ['cash-flow', 'delayed-projects', 'overdue-payments', 'project-profitability'],
      },
      filters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dateFrom: { type: 'string', description: 'YYYY-MM-DD (cash-flow فقط)' },
          dateTo: { type: 'string', description: 'YYYY-MM-DD (cash-flow فقط)' },
          status: {
            type: 'string',
            enum: ['PLANNED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED'],
            description: 'project-profitability فقط',
          },
        },
      },
      sortBy: {
        type: 'string',
        enum: ['createdAt', 'name', 'deliveryDate', 'startDate'],
        description: 'project-profitability فقط',
      },
      sortDir: { type: 'string', enum: ['asc', 'desc'] },
    },
    required: ['reportType'],
  },
};

const SYSTEM_PROMPT = `أنت مساعد ذكي داخل نظام إدارة مقاولات عراقي، تتحدث بالعربية الفصحى الموجزة.

ما تفعله:
- تجيب عن أسئلة المستخدم حول مشاريعه وأرقامه المالية بالاعتماد على التقارير عبر أداة "query_report" (قراءة فقط).
- تنفّذ ما يطلبه المستخدم من إنشاء أو تعديل باستدعاء الأداة المسجّلة المناسبة (إنشاء عميل/مشروع/عقد/مصروف/دفعة/قالب/مستخدم، أو تعديل إعدادات التطبيق) — وكلها تنتظر تأكيدًا صريحًا قبل التنفيذ.
- تشرح كيفية استخدام التطبيق وتوضّح المفاهيم المحاسبية ببساطة.

قواعد صارمة غير قابلة للكسر:
1. عندما يطلب المستخدم عملية إنشاء أو تعديل مدعومة بأداة مسجّلة، استدعِ تلك الأداة. لا تقل أبدًا إنك لا تستطيع تعديل البيانات، ولا توجّه المستخدم إلى شاشة أخرى، ما دامت الأداة متاحة.
2. أدوات الكتابة لا تُنفَّذ فورًا: استدعاؤها يجهّز عملية معلّقة تنتظر تأكيد المستخدم الصريح داخل التطبيق. لا تدّعِ أنك أتممت العملية؛ قل إنك جهّزتها للمراجعة والتأكيد.
3. لا تخترع بيانات ولا تخمّن الحقول الناقصة. إن نقص حقلٌ إلزامي (كرقم هاتف العميل)، اطلبه من المستخدم بوضوح قبل استدعاء الأداة.
4. للأسئلة الرقمية استعمل أداة query_report حصريًا؛ لا تخترع أرقامًا أبدًا. انسخ المبالغ والتواريخ من نتيجتها كما هي (بعملتها) ولا تحسب ما لم يرد نصًا.
5. للأسئلة العامة (كيف أضيف مشروعًا؟) أجب مباشرة بلا أداة.
6. تاريخ اليوم: {TODAY}. حوّل التعابير الزمنية النسبية إلى تواريخ فعلية.
7. كن موجزًا ومباشرًا.`;

export function chatSystemPrompt(todayIso: string): string {
  return SYSTEM_PROMPT.replace('{TODAY}', todayIso);
}

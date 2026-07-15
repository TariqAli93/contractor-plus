import {
  createTemplateSchema,
  type CreateTemplateInput,
} from '../../../templates/templates.schemas.js';
import type { AiTool } from '../ai-tool.types.js';
import { parseArgs, fmtText } from '../tool-utils.js';

// إنشاء قالب بناء عبر TemplatesService. ملاحظة: قوالب مستندات الـDOCX تتطلب رفع ملف
// (MultipartFile) فلا يمكن للنموذج توليدها؛ لذلك تنشئ هذه الأداة قالب بناء
// (مواد/مراحل) القابل للإنشاء من وسائط منظّمة — تُضاف مواده ومراحله لاحقًا من الواجهة.
export const createTemplateTool: AiTool<CreateTemplateInput> = {
  name: 'create_template',
  description:
    'إنشاء قالب بناء جديد (اسم ووصف ومدة تقديرية وهامش ربح مقترح). تُضاف المواد والمراحل لاحقًا.',
  requiredPermissions: ['ai.use', 'ai.apply-suggestions', 'templates.create'],
  requiresConfirmation: true,
  parametersSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string', description: 'اسم القالب (مطلوب)' },
      description: { type: ['string', 'null'], description: 'الوصف' },
      estimatedDurationDays: { type: ['integer', 'null'], description: 'المدة التقديرية بالأيام' },
      suggestedProfitMargin: { type: ['number', 'null'], description: 'هامش الربح المقترح 0..100' },
      isActive: { type: 'boolean', description: 'مفعّل', default: true },
    },
  },

  async validate(rawArgs) {
    return parseArgs(createTemplateSchema, rawArgs);
  },

  async preview(args) {
    return {
      title: 'إنشاء قالب بناء',
      summary: `سيتم إنشاء القالب «${args.name}».`,
      fields: [
        { label: 'الاسم', value: fmtText(args.name) },
        { label: 'الوصف', value: fmtText(args.description) },
        {
          label: 'المدة التقديرية',
          value: args.estimatedDurationDays != null ? `${args.estimatedDurationDays} يوم` : '—',
        },
        {
          label: 'هامش الربح المقترح',
          value: args.suggestedProfitMargin != null ? `${args.suggestedProfitMargin}%` : '—',
        },
      ],
      warnings: ['هذا قالب بناء (مواد/مراحل)، وليس قالب مستند DOCX.'],
    };
  },

  async execute(args, ctx) {
    const created = await ctx.services.templates.create(args, ctx.actor.audit);
    return {
      recordId: created.id,
      module: 'templates',
      summary: `تم إنشاء القالب «${created.name}».`,
      data: { id: created.id, name: created.name, isActive: created.isActive },
    };
  },

  sanitizeResult(result) {
    return result.data;
  },
};

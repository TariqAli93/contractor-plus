import type { ProjectCost } from '@prisma/client';
import { createCostSchema, type CreateCostInput } from '../../../costs/costs.schemas.js';
import type { AiTool } from '../ai-tool.types.js';
import { parseArgs, fmtText, fmtMoney, fmtDate } from '../tool-utils.js';

// إنشاء مصروف/تكلفة مشروع عبر CostsService. القيم السالبة وتماسك الفئة/المادة ووجود
// المشروع يفرضها المخطط والخدمة؛ الإجمالي يُشتق من الكمية × سعر الوحدة أو يُدخَل صراحة.
export const createExpenseTool: AiTool<CreateCostInput> = {
  name: 'create_expense',
  description:
    'تسجيل مصروف/تكلفة على مشروع بالفئة والوصف والكمية وسعر الوحدة أو الإجمالي والتاريخ.',
  requiredPermissions: ['ai.use', 'ai.apply-suggestions', 'costs.create'],
  requiresConfirmation: true,
  parametersSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['projectId', 'category', 'description', 'date'],
    properties: {
      projectId: { type: 'string', description: 'معرّف المشروع' },
      category: {
        type: 'string',
        enum: ['MATERIAL', 'LABOR', 'MACHINERY', 'TRANSPORT', 'MISC'],
        description: 'فئة التكلفة',
      },
      materialId: { type: ['string', 'null'], description: 'معرّف المادة (فقط لفئة MATERIAL)' },
      description: { type: 'string', description: 'وصف المصروف' },
      quantity: { type: ['number', 'null'], description: 'الكمية (>= 0)' },
      unit: { type: ['string', 'null'], description: 'الوحدة' },
      unitPrice: { type: ['number', 'null'], description: 'سعر الوحدة (>= 0)' },
      totalAmount: { type: 'number', description: 'الإجمالي (>= 0) — يُترك فارغًا ليُحسب من الكمية × السعر' },
      date: { type: 'string', description: 'التاريخ بصيغة YYYY-MM-DD' },
      notes: { type: ['string', 'null'], description: 'ملاحظات' },
    },
  },

  async validate(rawArgs) {
    return parseArgs(createCostSchema, rawArgs);
  },

  async preview(args) {
    const derived =
      args.quantity != null && args.unitPrice != null
        ? args.quantity * args.unitPrice
        : (args.totalAmount ?? null);
    return {
      title: 'تسجيل مصروف',
      summary: `سيتم تسجيل مصروف «${args.description}».`,
      fields: [
        { label: 'المشروع', value: fmtText(args.projectId) },
        { label: 'الفئة', value: fmtText(args.category) },
        { label: 'الوصف', value: fmtText(args.description) },
        { label: 'الكمية × السعر', value: `${args.quantity ?? '—'} × ${fmtMoney(args.unitPrice)}` },
        { label: 'الإجمالي', value: fmtMoney(derived) },
        { label: 'التاريخ', value: fmtDate(args.date) },
      ],
      warnings: ['سيتم التحقق من وجود المشروع والمادة عند التنفيذ.'],
    };
  },

  async execute(args, ctx) {
    const created = await ctx.services.costs.create(args, ctx.actor.audit);
    return {
      recordId: created.id,
      module: 'costs',
      summary: `تم تسجيل مصروف بقيمة ${fmtMoney(created.totalAmount?.toString())}.`,
      data: sanitize(created),
    };
  },

  sanitizeResult(result) {
    return result.data;
  },
};

function sanitize(c: ProjectCost) {
  return {
    id: c.id,
    projectId: c.projectId,
    category: c.category,
    description: c.description,
    totalAmount: c.totalAmount?.toString() ?? null,
  };
}

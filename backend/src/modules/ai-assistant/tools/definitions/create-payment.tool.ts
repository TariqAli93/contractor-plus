import type { Payment } from '@prisma/client';
import {
  createPaymentSchema,
  type CreatePaymentInput,
} from '../../../payments/payments.schemas.js';
import type { AiTool } from '../ai-tool.types.js';
import { parseArgs, fmtText, fmtMoney, fmtDate } from '../tool-utils.js';

// إنشاء دفعة عبر PaymentsService. وجود المشروع وارتباطه بعقد شرطٌ تفرضه الخدمة
// (payments require a contract)؛ القيمة غير السالبة يفرضها المخطط.
export const createPaymentTool: AiTool<CreatePaymentInput> = {
  name: 'create_payment',
  description: 'إنشاء دفعة مستحقة على مشروع مرتبط بعقد، بالمبلغ وتاريخ الاستحقاق وطريقة الدفع.',
  requiredPermissions: ['ai.use', 'ai.apply-suggestions', 'payments.create'],
  requiresConfirmation: true,
  parametersSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['projectId', 'amount', 'dueDate'],
    properties: {
      projectId: { type: 'string', description: 'معرّف المشروع (المرتبط بعقد)' },
      amount: { type: 'number', description: 'المبلغ (>= 0)' },
      dueDate: { type: 'string', description: 'تاريخ الاستحقاق بصيغة YYYY-MM-DD' },
      method: {
        type: ['string', 'null'],
        enum: ['CASH', 'BANK_TRANSFER', 'CHECK', 'OTHER', null],
        description: 'طريقة الدفع',
      },
      reference: { type: ['string', 'null'], description: 'مرجع الدفعة' },
      notes: { type: ['string', 'null'], description: 'ملاحظات' },
    },
  },

  async validate(rawArgs) {
    return parseArgs(createPaymentSchema, rawArgs);
  },

  async preview(args) {
    return {
      title: 'إنشاء دفعة',
      summary: `سيتم إنشاء دفعة بقيمة ${fmtMoney(args.amount)}.`,
      fields: [
        { label: 'المشروع', value: fmtText(args.projectId) },
        { label: 'المبلغ', value: fmtMoney(args.amount) },
        { label: 'تاريخ الاستحقاق', value: fmtDate(args.dueDate) },
        { label: 'طريقة الدفع', value: fmtText(args.method) },
        { label: 'المرجع', value: fmtText(args.reference) },
      ],
      warnings: ['سيتم التحقق من وجود المشروع وارتباطه بعقد عند التنفيذ.'],
    };
  },

  async execute(args, ctx) {
    const created = await ctx.services.payments.create(args, ctx.actor.audit);
    return {
      recordId: created.id,
      module: 'payments',
      summary: `تم إنشاء دفعة بقيمة ${fmtMoney(created.amount?.toString())}.`,
      data: sanitize(created),
    };
  },

  sanitizeResult(result) {
    return result.data;
  },
};

function sanitize(p: Payment) {
  return {
    id: p.id,
    projectId: p.projectId,
    amount: p.amount?.toString() ?? null,
    status: p.status,
    dueDate: p.dueDate?.toISOString?.() ?? String(p.dueDate),
  };
}

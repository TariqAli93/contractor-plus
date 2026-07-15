import type { Contract } from '@prisma/client';
import {
  createContractSchema,
  type CreateContractInput,
} from '../../../contracts/contracts.schemas.js';
import type { AiTool } from '../ai-tool.types.js';
import { parseArgs, fmtText, fmtMoney } from '../tool-utils.js';

// إنشاء عقد عبر ContractsService. وجود العميل/القالب ورقم العقد الفريد يُتحقَّق منها
// داخل الخدمة عند التنفيذ. قيمة العقد تُحسب في الخدمة؛ نعرض تقديرًا في المعاينة فقط.
export const createContractTool: AiTool<CreateContractInput> = {
  name: 'create_contract',
  description:
    'إنشاء عقد جديد لعميل موجود برقم عقد ومساحة البناء وعدد الطوابق وسعر المتر، مع قالب اختياري.',
  requiredPermissions: ['ai.use', 'ai.apply-suggestions', 'contracts.create'],
  requiresConfirmation: true,
  parametersSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['contractNumber', 'customerId', 'buildingArea', 'floors', 'meterPrice'],
    properties: {
      contractNumber: { type: 'string', description: 'رقم العقد (فريد)' },
      customerId: { type: 'string', description: 'معرّف العميل الموجود' },
      templateId: { type: ['string', 'null'], description: 'معرّف قالب البناء (اختياري)' },
      buildingArea: { type: 'number', description: 'مساحة البناء بالمتر المربع (> 0)' },
      floors: { type: 'integer', description: 'عدد الطوابق (>= 1)' },
      meterPrice: { type: 'number', description: 'سعر المتر (>= 0)' },
      expectedProfitMargin: { type: ['number', 'null'], description: 'هامش الربح المتوقع 0..100' },
      notes: { type: ['string', 'null'], description: 'ملاحظات' },
    },
  },

  async validate(rawArgs) {
    return parseArgs(createContractSchema, rawArgs);
  },

  async preview(args) {
    const estimatedTotal = args.buildingArea * args.floors * args.meterPrice;
    return {
      title: 'إنشاء عقد جديد',
      summary: `سيتم إنشاء العقد رقم «${args.contractNumber}».`,
      fields: [
        { label: 'رقم العقد', value: fmtText(args.contractNumber) },
        { label: 'العميل', value: fmtText(args.customerId) },
        { label: 'القالب', value: fmtText(args.templateId) },
        { label: 'المساحة × الطوابق', value: `${args.buildingArea} × ${args.floors}` },
        { label: 'سعر المتر', value: fmtMoney(args.meterPrice) },
        { label: 'القيمة التقديرية', value: fmtMoney(estimatedTotal) },
      ],
      warnings: ['سيتم التحقق من وجود العميل والقالب وتفرّد رقم العقد عند التنفيذ.'],
    };
  },

  async execute(args, ctx) {
    const created = await ctx.services.contracts.create(args, ctx.actor.audit);
    return {
      recordId: created.id,
      module: 'contracts',
      summary: `تم إنشاء العقد رقم «${created.contractNumber}».`,
      data: sanitize(created),
    };
  },

  sanitizeResult(result) {
    return result.data;
  },
};

function sanitize(c: Contract) {
  return {
    id: c.id,
    contractNumber: c.contractNumber,
    customerId: c.customerId,
    status: c.status,
    totalPrice: c.totalPrice?.toString() ?? null,
  };
}

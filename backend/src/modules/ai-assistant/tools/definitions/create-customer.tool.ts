import type { Customer } from '@prisma/client';
import {
  createCustomerSchema,
  type CreateCustomerInput,
} from '../../../customers/customers.schemas.js';
import type { AiTool } from '../ai-tool.types.js';
import { parseArgs, fmtText } from '../tool-utils.js';

// إنشاء عميل عبر CustomersService (لا Prisma مباشر، لا تكرار منطق) — يعيد استخدام
// createCustomerSchema للتحقق، ويحذّر من التكرار عبر فحص الهاتف في الخدمة المالكة.
export const createCustomerTool: AiTool<CreateCustomerInput> = {
  name: 'create_customer',
  description: 'إنشاء عميل جديد في النظام بالاسم ورقم الهاتف والبريد الإلكتروني والعنوان.',
  requiredPermissions: ['ai.use', 'ai.apply-suggestions', 'customers.create'],
  requiresConfirmation: true,
  parametersSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string', description: 'اسم العميل (مطلوب)' },
      phone: { type: ['string', 'null'], description: 'رقم الهاتف' },
      email: { type: ['string', 'null'], description: 'البريد الإلكتروني' },
      address: { type: ['string', 'null'], description: 'العنوان' },
      notes: { type: ['string', 'null'], description: 'ملاحظات' },
    },
  },

  async validate(rawArgs) {
    return parseArgs(createCustomerSchema, rawArgs);
  },

  async preview(args, ctx) {
    const warnings: string[] = [];
    const dups = await ctx.services.customers.findDuplicatesByPhone(args.phone);
    if (dups.length > 0) {
      warnings.push(
        `يوجد بالفعل ${dups.length} عميل بنفس رقم الهاتف: ${dups.map((d) => d.name).join('، ')}.`,
      );
    }
    return {
      title: 'إنشاء عميل جديد',
      summary: `سيتم إنشاء العميل «${args.name}».`,
      fields: [
        { label: 'الاسم', value: fmtText(args.name) },
        { label: 'الهاتف', value: fmtText(args.phone) },
        { label: 'البريد', value: fmtText(args.email) },
        { label: 'العنوان', value: fmtText(args.address) },
      ],
      warnings,
    };
  },

  async execute(args, ctx) {
    const created = await ctx.services.customers.create(args, ctx.actor.audit);
    return {
      recordId: created.id,
      module: 'customers',
      summary: `تم إنشاء العميل «${created.name}».`,
      data: sanitize(created),
    };
  },

  sanitizeResult(result) {
    return result.data;
  },
};

function sanitize(c: Customer) {
  return { id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address };
}

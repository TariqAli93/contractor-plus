import type { Project } from '@prisma/client';
import {
  createProjectSchema,
  type CreateProjectInput,
} from '../../../projects/projects.schemas.js';
import type { AiTool } from '../ai-tool.types.js';
import { parseArgs, fmtText, fmtDate } from '../tool-utils.js';

// إنشاء مشروع عبر ProjectsService. التحقق من أهلية العقد/العميل ووجوده يتم داخل
// الخدمة (createWithinTx) عند التنفيذ، فتظهر رسائل عربية واضحة عند الفشل.
export const createProjectTool: AiTool<CreateProjectInput> = {
  name: 'create_project',
  description: 'إنشاء مشروع جديد بالاسم وتاريخ البداية والتسليم، مع ربطه بعقد معتمَد اختياريًا.',
  requiredPermissions: ['ai.use', 'ai.apply-suggestions', 'projects.create'],
  requiresConfirmation: true,
  parametersSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string', description: 'اسم المشروع (مطلوب)' },
      contractId: { type: ['string', 'null'], description: 'معرّف العقد المعتمَد المرتبط (اختياري)' },
      startDate: { type: ['string', 'null'], description: 'تاريخ البداية بصيغة YYYY-MM-DD' },
      deliveryDate: { type: ['string', 'null'], description: 'تاريخ التسليم بصيغة YYYY-MM-DD' },
      notes: { type: ['string', 'null'], description: 'ملاحظات' },
    },
  },

  async validate(rawArgs) {
    return parseArgs(createProjectSchema, rawArgs);
  },

  async preview(args) {
    const warnings: string[] = [];
    if (args.startDate && args.deliveryDate && args.deliveryDate < args.startDate) {
      warnings.push('تاريخ التسليم قبل تاريخ البداية.');
    }
    if (args.contractId) {
      warnings.push('سيتم التحقق من أن العقد معتمَد وغير مرتبط بمشروع آخر عند التنفيذ.');
    }
    return {
      title: 'إنشاء مشروع جديد',
      summary: `سيتم إنشاء المشروع «${args.name}».`,
      fields: [
        { label: 'الاسم', value: fmtText(args.name) },
        { label: 'العقد المرتبط', value: fmtText(args.contractId) },
        { label: 'تاريخ البداية', value: fmtDate(args.startDate) },
        { label: 'تاريخ التسليم', value: fmtDate(args.deliveryDate) },
      ],
      warnings,
    };
  },

  async execute(args, ctx) {
    const created = await ctx.services.projects.create(args, ctx.actor.audit);
    return {
      recordId: created.id,
      module: 'projects',
      summary: `تم إنشاء المشروع «${created.name}».`,
      data: sanitize(created),
    };
  },

  sanitizeResult(result) {
    return result.data;
  },
};

function sanitize(p: Project) {
  return { id: p.id, name: p.name, status: p.status, contractId: p.contractId };
}

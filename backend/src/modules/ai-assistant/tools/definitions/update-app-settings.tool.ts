import { generalSettingsSchema } from '../../../settings/settings.schemas.js';
import { ValidationError } from '../../../../shared/errors/validation.error.js';
import type { z } from 'zod';
import type { AiTool } from '../ai-tool.types.js';
import { parseArgs } from '../tool-utils.js';

// Allowlist صارمة: النموذج يعدّل الإعدادات العامة الآمنة فقط (اسم التطبيق، بداية
// السنة المالية، اللغة، صيغة التاريخ). generalSettingsSchema صارم (strict) فيرفض
// أي مفتاح آخر — مفاتيح API/كلمات المرور/SMTP/التشفير/قاعدة البيانات/الترخيص/RBAC
// ليست ضمن الإعدادات العامة أصلًا، فلا يمكن للنموذج الوصول إليها عبر هذه الأداة.
type SettingsArgs = z.infer<typeof generalSettingsSchema>;

const LABELS: Record<string, string> = {
  appName: 'اسم التطبيق',
  fiscalYearStartMonth: 'شهر بداية السنة المالية',
  defaultLocale: 'اللغة الافتراضية',
  dateFormat: 'صيغة التاريخ',
};

export const updateAppSettingsTool: AiTool<SettingsArgs> = {
  name: 'update_app_settings',
  description:
    'تعديل إعدادات التطبيق العامة المسموح بها فقط: اسم التطبيق، شهر بداية السنة المالية، اللغة، صيغة التاريخ.',
  requiredPermissions: ['ai.use', 'ai.apply-suggestions', 'ai.manage-settings', 'settings.manage'],
  requiresConfirmation: true,
  parametersSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      appName: { type: 'string', description: 'اسم التطبيق' },
      fiscalYearStartMonth: { type: 'integer', minimum: 1, maximum: 12, description: 'شهر بداية السنة المالية (1-12)' },
      defaultLocale: { type: 'string', enum: ['ar', 'en'], description: 'اللغة الافتراضية' },
      dateFormat: { type: 'string', description: 'صيغة التاريخ' },
    },
  },

  async validate(rawArgs) {
    const args = parseArgs(generalSettingsSchema, rawArgs);
    if (Object.values(args).every((v) => v === undefined)) {
      throw new ValidationError('لم تحدَّد أي إعدادات للتعديل.', { _: ['حدّد إعدادًا واحدًا على الأقل'] });
    }
    return args;
  },

  async preview(args, ctx) {
    const current = (await ctx.services.settings.getGeneral()) as unknown as Record<string, unknown>;
    const changes = (Object.keys(args) as Array<keyof SettingsArgs>)
      .filter((k) => args[k] !== undefined)
      .map((k) => ({
        label: LABELS[k as string] ?? String(k),
        oldValue: String(current[k as string] ?? '—'),
        newValue: String(args[k]),
      }));
    return {
      title: 'تعديل إعدادات التطبيق',
      summary: `سيتم تعديل ${changes.length} إعداد.`,
      fields: [],
      changes,
      warnings: ['هذه إعدادات عامة آمنة فقط — لا تشمل المفاتيح أو الأسرار أو الصلاحيات.'],
    };
  },

  async execute(args, ctx) {
    const updated = await ctx.services.settings.updateGeneral(args, ctx.actor.audit);
    return {
      recordId: null,
      module: 'settings',
      summary: 'تم تحديث إعدادات التطبيق.',
      data: updated,
    };
  },

  sanitizeResult(result) {
    return result.data;
  },
};

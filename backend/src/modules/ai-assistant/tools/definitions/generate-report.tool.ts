import { z } from 'zod';
import type { AiTool } from '../ai-tool.types.js';
import { parseArgs, fmtText } from '../tool-utils.js';

// أداة قراءة فقط: تحوّل الطلب الطبيعي إلى تقرير محدد من قائمة مغلقة عبر
// ReportsService حصريًا (لا SQL، لا استعلامات Prisma). لا تحتاج تأكيدًا.
const REPORT_TYPES = ['cash_flow', 'delayed_projects', 'overdue_payments', 'project_profitability'] as const;
type ReportType = (typeof REPORT_TYPES)[number];

const reportArgsSchema = z.object({
  reportType: z.enum(REPORT_TYPES),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  customerId: z.string().uuid().optional(),
});
type GenerateReportArgs = z.infer<typeof reportArgsSchema>;

const REPORT_LABELS: Record<ReportType, string> = {
  cash_flow: 'التدفّق النقدي',
  delayed_projects: 'المشاريع المتأخرة',
  overdue_payments: 'الدفعات المتأخرة',
  project_profitability: 'ربحية المشاريع',
};

export const generateReportTool: AiTool<GenerateReportArgs> = {
  name: 'generate_report',
  description:
    'توليد تقرير من قائمة محددة: التدفّق النقدي، المشاريع المتأخرة، الدفعات المتأخرة، أو ربحية المشاريع. قراءة فقط.',
  requiredPermissions: ['ai.use', 'ai.generate-reports', 'reports.read'],
  requiresConfirmation: false,
  parametersSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['reportType'],
    properties: {
      reportType: { type: 'string', enum: [...REPORT_TYPES], description: 'نوع التقرير' },
      dateFrom: { type: 'string', description: 'من تاريخ YYYY-MM-DD (للتدفّق النقدي)' },
      dateTo: { type: 'string', description: 'إلى تاريخ YYYY-MM-DD (للتدفّق النقدي)' },
      customerId: { type: 'string', description: 'تصفية حسب عميل (اختياري)' },
    },
  },

  async validate(rawArgs) {
    return parseArgs(reportArgsSchema, rawArgs);
  },

  async preview(args) {
    return {
      title: `تقرير: ${REPORT_LABELS[args.reportType]}`,
      summary: `عرض تقرير ${REPORT_LABELS[args.reportType]}.`,
      fields: [
        { label: 'النوع', value: REPORT_LABELS[args.reportType] },
        { label: 'العميل', value: fmtText(args.customerId) },
      ],
      warnings: [],
    };
  },

  async execute(args, ctx) {
    const reports = ctx.services.reports;
    let data: unknown;
    switch (args.reportType) {
      case 'cash_flow':
        data = await reports.getCashFlow({ dateFrom: args.dateFrom, dateTo: args.dateTo });
        break;
      case 'overdue_payments':
        data = await reports.getOverduePayments({ customerId: args.customerId });
        break;
      case 'delayed_projects':
        data = await reports.getDelayedProjects({ customerId: args.customerId });
        break;
      case 'project_profitability':
        data = await reports.listProjectProfitability({
          page: 1,
          pageSize: 50,
          sortBy: 'createdAt',
          sortDir: 'desc',
          ...(args.customerId ? { customerId: args.customerId } : {}),
        });
        break;
    }
    return {
      recordId: null,
      module: 'reports',
      summary: `تم توليد تقرير ${REPORT_LABELS[args.reportType]}.`,
      data,
    };
  },

  sanitizeResult(result) {
    return result.data;
  },
};

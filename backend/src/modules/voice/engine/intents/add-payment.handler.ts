// ============================================================
// add_payment handler — "أضف دفعة / استلم مليون / دفع الزبون مليونين".
//
// Records a PENDING payment on the shared-context project. The project MUST have
// a linked contract (enforced by PaymentsService); otherwise the create fails
// and (inside a workflow) is compensated. Amount is a required slot. The status
// is intentionally PENDING — marking a payment settled is a separate, explicit
// action (no silent financial state change).
// ============================================================

import { PaymentMethod } from '@prisma/client';
import { VoiceIntent, type EntityBag } from '@contractor-plus/shared';
import { toJsonValue } from '../../../../shared/utils/json.js';
import { firstScaledMoney } from '../../nlu/entity-extractor.js';
import { normalizeArabic } from '../../nlu/normalize.js';
import { ClarifyError } from '../clarify-error.js';
import type { PaymentsService } from '../../../payments/payments.service.js';
import type { PaymentsRepository } from '../../../payments/payments.repository.js';
import type { ProjectsRepository } from '../../../projects/projects.repository.js';
import type {
  CompensationContext,
  IntentHandler,
  Plan,
  PlanInput,
  PlanStep,
  SlotDef,
} from '../voice.types.js';

const PERMS = ['payments.create'];

export interface AddPaymentHandlerDeps {
  payments: PaymentsService;
  paymentsRepo: PaymentsRepository;
  projectsRepo: ProjectsRepository;
}

export class AddPaymentHandler implements IntentHandler {
  readonly intent = VoiceIntent.ADD_PAYMENT;

  readonly requiredSlots: SlotDef[] = [
    {
      name: 'amount',
      read: (b) => b.money,
      question: 'ما مبلغ الدفعة؟',
      fillFromAnswer: (b, u) => {
        const n = firstScaledMoney(u);
        if (n !== null) {
          b.money = n;
          return true;
        }
        return false;
      },
    },
  ];

  constructor(private readonly deps: AddPaymentHandlerDeps) {}

  async plan(input: PlanInput): Promise<Plan> {
    const { bag, context, transcript } = input;
    const projectId = context.lastProjectId;
    if (!projectId) {
      throw new ClarifyError('على أي مشروع تريد تسجيل الدفعة؟', 'project');
    }

    // المرحلة 3: don't fail silently on a contract-less project — ask the user.
    const project = await this.deps.projectsRepo.findById(projectId);
    if (project && !project.contractId) {
      throw new ClarifyError(
        'هذا المشروع غير مرتبط بعقد. هل تريد إنشاء عقد له أو ربطه بعقد موجود؟ (قل: اربط المشروع بالعقد رقم ...)',
        'contract',
      );
    }

    const amount = Number(bag.money);
    const method = pickMethod(transcript);

    const step: PlanStep = {
      description: `تسجيل دفعة بمبلغ ${amount.toLocaleString('en-US')}`,
      requiredPermissions: PERMS,
      execute: async (ctx) => {
        const payment = await this.deps.payments.createWithinTx(
          ctx.tx,
          {
            projectId,
            amount,
            dueDate: new Date(),
            method,
            reference: null,
            notes: 'أُضيفت عبر الأوامر الصوتية',
          },
          ctx.actor,
        );
        return {
          createdEntities: [
            { type: 'Payment', id: payment.id, label: amount.toLocaleString('en-US') },
          ],
          outputs: { paymentId: payment.id },
          message: `تمت إضافة دفعة بمبلغ ${amount.toLocaleString('en-US')} (بحالة معلّقة).`,
        };
      },
    };

    return {
      intent: this.intent,
      side: 'server',
      mutates: true,
      requiredPermissions: PERMS,
      steps: [step],
      summary: {
        title: 'سيتم تسجيل دفعة',
        mutates: true,
        lines: [
          { label: 'المبلغ', value: amount.toLocaleString('en-US') },
          { label: 'الحالة', value: 'معلّقة (PENDING)' },
          ...(method ? [{ label: 'طريقة الدفع', value: method }] : []),
        ],
      },
    };
  }

  summarize(bag: EntityBag): string {
    const amount = typeof bag.money === 'number' ? bag.money.toLocaleString('en-US') : '';
    return `إضافة دفعة ${amount}`.trim();
  }

  async compensate(outputs: Record<string, unknown>, ctx: CompensationContext): Promise<void> {
    const paymentId = outputs.paymentId;
    if (typeof paymentId !== 'string') return;
    await this.deps.paymentsRepo.softDelete(paymentId, ctx.tx);
    await ctx.audit.log(
      ctx.actor,
      {
        action: 'DELETE',
        entity: 'Payment',
        entityId: paymentId,
        oldValues: toJsonValue({ event: 'voice_workflow_compensation' }),
      },
      ctx.tx,
    );
  }
}

function pickMethod(transcript: string): PaymentMethod | null {
  const n = normalizeArabic(transcript);
  if (n.includes('نقد') || n.includes('كاش')) return PaymentMethod.CASH;
  if (n.includes('تحويل') || n.includes('حواله')) return PaymentMethod.BANK_TRANSFER;
  if (n.includes('صك') || n.includes('جيك')) return PaymentMethod.CHECK;
  return null;
}

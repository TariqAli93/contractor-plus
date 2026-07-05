// ============================================================
// add_cost handler — "أضف تكلفة / سجل شراء / اشتريت ... بقيمة ...".
//
// Attaches a ProjectCost to the SHARED-context project (the last project created
// or worked on this session). If no project is in context → clarify. Amount is a
// required slot. Reuses CostsService.createWithinTx (totalAmount rule preserved).
// ============================================================

import { CostCategory } from '@prisma/client';
import { VoiceIntent, type EntityBag } from '@contractor-plus/shared';
import { toJsonValue } from '../../../../shared/utils/json.js';
import { firstScaledMoney } from '../../nlu/entity-extractor.js';
import { normalizeArabic } from '../../nlu/normalize.js';
import { ClarifyError } from '../clarify-error.js';
import type { CostsService } from '../../../costs/costs.service.js';
import type { CostsRepository } from '../../../costs/costs.repository.js';
import type {
  CompensationContext,
  IntentHandler,
  Plan,
  PlanInput,
  PlanStep,
  SlotDef,
} from '../voice.types.js';

const PERMS = ['costs.create'];
const MATERIAL_HINTS = [
  'سمنت',
  'اسمنت',
  'حديد',
  'طابوق',
  'بلوك',
  'رمل',
  'حصى',
  'صبه',
  'كاشي',
  'سيراميك',
  'مواد',
  'ماده',
];

export interface AddCostHandlerDeps {
  costs: CostsService;
  costsRepo: CostsRepository;
}

export class AddCostHandler implements IntentHandler {
  readonly intent = VoiceIntent.ADD_COST;

  readonly requiredSlots: SlotDef[] = [
    {
      name: 'amount',
      read: (b) => b.money,
      question: 'ما قيمة التكلفة؟',
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

  constructor(private readonly deps: AddCostHandlerDeps) {}

  plan(input: PlanInput): Plan {
    const { bag, context, transcript } = input;
    const projectId = context.lastProjectId;
    if (!projectId) {
      throw new ClarifyError('على أي مشروع تريد تسجيل التكلفة؟', 'project');
    }
    const amount = Number(bag.money);
    const description = (transcript.trim() || 'تكلفة عبر الأوامر الصوتية').slice(0, 500);
    const category = pickCategory(transcript);

    const step: PlanStep = {
      description: `تسجيل تكلفة بقيمة ${amount.toLocaleString('en-US')}`,
      requiredPermissions: PERMS,
      execute: async (ctx) => {
        const cost = await this.deps.costs.createWithinTx(
          ctx.tx,
          {
            projectId,
            category,
            materialId: null,
            description,
            quantity: null,
            unit: null,
            unitPrice: null,
            totalAmount: amount,
            date: new Date(),
            notes: 'أُضيف عبر الأوامر الصوتية',
          },
          ctx.actor,
        );
        return {
          createdEntities: [{ type: 'ProjectCost', id: cost.id, label: description }],
          outputs: { costId: cost.id },
          message: `تمت إضافة تكلفة بقيمة ${amount.toLocaleString('en-US')}.`,
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
        title: 'سيتم تسجيل تكلفة',
        mutates: true,
        lines: [
          { label: 'الوصف', value: description },
          { label: 'القيمة', value: amount.toLocaleString('en-US') },
          { label: 'التصنيف', value: category },
        ],
      },
    };
  }

  summarize(bag: EntityBag): string {
    const amount = typeof bag.money === 'number' ? bag.money.toLocaleString('en-US') : '';
    return `إضافة تكلفة ${amount}`.trim();
  }

  async compensate(outputs: Record<string, unknown>, ctx: CompensationContext): Promise<void> {
    const costId = outputs.costId;
    if (typeof costId !== 'string') return;
    await this.deps.costsRepo.softDelete(costId, ctx.tx);
    await ctx.audit.log(
      ctx.actor,
      {
        action: 'DELETE',
        entity: 'ProjectCost',
        entityId: costId,
        oldValues: toJsonValue({ event: 'voice_workflow_compensation' }),
      },
      ctx.tx,
    );
  }
}

function pickCategory(transcript: string): CostCategory {
  const norm = normalizeArabic(transcript);
  return MATERIAL_HINTS.some((h) => norm.includes(h)) ? CostCategory.MATERIAL : CostCategory.MISC;
}

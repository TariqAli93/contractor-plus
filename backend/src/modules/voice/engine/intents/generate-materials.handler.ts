// ============================================================
// generate_materials handler (ADD_MATERIALS) — "أضف المواد / احسب المواد".
//
// Runs Material Intelligence on the shared-context contract (the last one
// created/worked on). Reuses ContractsService.generateEstimateWithinTx. In a
// compound command right after create_contract this is usually redundant (the
// contract was already estimated) but harmless — generateEstimate replaces the
// item set idempotently. No compensation: it produces no standalone entity, and
// if the parent contract is rolled back its items go with it.
// ============================================================

import { VoiceIntent } from '@contractor-plus/shared';
import { ClarifyError } from '../clarify-error.js';
import type { ContractsService } from '../../../contracts/contracts.service.js';
import type { IntentHandler, Plan, PlanInput, PlanStep, SlotDef } from '../voice.types.js';

const PERMS = ['contracts.update'];

export interface GenerateMaterialsHandlerDeps {
  contracts: ContractsService;
}

export class GenerateMaterialsHandler implements IntentHandler {
  readonly intent = VoiceIntent.ADD_MATERIALS;
  readonly requiredSlots: SlotDef[] = [];

  constructor(private readonly deps: GenerateMaterialsHandlerDeps) {}

  plan(input: PlanInput): Plan {
    const contractId = input.context.lastContractId;
    if (!contractId) {
      throw new ClarifyError('على أي عقد تريد حساب المواد؟', 'contract');
    }

    const step: PlanStep = {
      description: 'حساب وإضافة المواد المقترحة للعقد',
      requiredPermissions: PERMS,
      execute: async (ctx) => {
        const estimate = await this.deps.contracts.generateEstimateWithinTx(
          ctx.tx,
          contractId,
          ctx.actor,
        );
        return {
          createdEntities: [],
          outputs: { contractId },
          message: `تم حساب ${estimate.itemsReplaced} مادة للعقد ${estimate.contractNumber}.`,
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
        title: 'سيتم حساب المواد المقترحة',
        mutates: true,
        lines: [{ label: 'العقد', value: 'آخر عقد تم إنشاؤه' }],
      },
    };
  }

  summarize(): string {
    return 'إضافة/حساب المواد المقترحة';
  }
}

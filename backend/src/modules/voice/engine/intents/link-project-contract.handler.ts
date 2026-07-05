// ============================================================
// link_project_to_contract handler — closes the real gap from Phase 2B.
//
// Links an existing STANDALONE project to a contract so it can accept payments.
//   • "اربط هذا المشروع بالعقد"            → lastProjectId + lastContractId
//   • "اربط مشروع بيت 100 بالعقد رقم V-2026-0004" → resolve both by reference
//
// Resolution failures become clarifications (not silent errors). Conflicts
// (already-linked project, contract that already has a project, cancelled
// contract) surface as ConflictErrors → 409. The link itself runs in one
// transaction via ProjectsService.linkToContractWithinTx (audited there);
// compensation unlinks for the Saga.
// ============================================================

import { VoiceIntent, type CreatedEntityRef } from '@contractor-plus/shared';
import { ConflictError } from '../../../../shared/errors/conflict.error.js';
import { toJsonValue } from '../../../../shared/utils/json.js';
import type { ProjectsService } from '../../../projects/projects.service.js';
import type { ProjectsRepository } from '../../../projects/projects.repository.js';
import type { ContractsRepository } from '../../../contracts/contracts.repository.js';
import { ClarifyError } from '../clarify-error.js';
import type {
  CompensationContext,
  IntentHandler,
  Plan,
  PlanInput,
  PlanStep,
  SlotDef,
} from '../voice.types.js';

const PERMS = ['projects.update'];

export interface LinkProjectContractHandlerDeps {
  projects: ProjectsService;
  projectsRepo: ProjectsRepository;
  contractsRepo: ContractsRepository;
}

export class LinkProjectContractHandler implements IntentHandler {
  readonly intent = VoiceIntent.LINK_PROJECT_CONTRACT;
  readonly requiredSlots: SlotDef[] = [];

  constructor(private readonly deps: LinkProjectContractHandlerDeps) {}

  async plan(input: PlanInput): Promise<Plan> {
    const { bag, context } = input;

    // ---- resolve the contract ----
    let contract;
    if (bag.contractRef) {
      contract = await this.deps.contractsRepo.findByContractNumber(bag.contractRef);
      if (!contract) {
        throw new ClarifyError(`لم أجد عقداً بالرقم ${bag.contractRef}. ما رقم العقد؟`, 'contract');
      }
    } else if (context.lastContractId) {
      contract = await this.deps.contractsRepo.findById(context.lastContractId);
      if (!contract) throw new ClarifyError('بأي عقد تريد ربط المشروع؟', 'contract');
    } else {
      throw new ClarifyError('بأي عقد تريد ربط المشروع؟ (اذكر رقم العقد)', 'contract');
    }

    // ---- resolve the project ----
    let project;
    if (bag.area !== undefined) {
      project = await this.deps.projectsRepo.findStandaloneByName(String(bag.area));
      if (!project) {
        throw new ClarifyError('لم أجد مشروعاً مستقلاً مطابقاً للمواصفات. أي مشروع؟', 'project');
      }
    } else if (context.lastProjectId) {
      project = await this.deps.projectsRepo.findById(context.lastProjectId);
      if (!project) throw new ClarifyError('أي مشروع تريد ربطه؟', 'project');
    } else {
      throw new ClarifyError('أي مشروع تريد ربطه؟', 'project');
    }

    // Fail fast on an already-linked project (clear 409 instead of a late error).
    if (project.contractId) {
      throw new ConflictError(
        project.contractId === contract.id
          ? 'المشروع مرتبط بهذا العقد مسبقاً'
          : 'المشروع مرتبط بعقد آخر مسبقاً',
        'PROJECT_ALREADY_LINKED',
      );
    }

    const projectId = project.id;
    const projectName = project.name;
    const contractId = contract.id;
    const contractNumber = contract.contractNumber;
    const contractStatus = contract.status;

    const step: PlanStep = {
      description: `ربط المشروع "${projectName}" بالعقد ${contractNumber}`,
      requiredPermissions: PERMS,
      execute: async (ctx) => {
        await this.deps.projects.linkToContractWithinTx(ctx.tx, projectId, contractId, ctx.actor);
        const created: CreatedEntityRef[] = [
          { type: 'ProjectLink', id: projectId, label: `${projectName} ⇄ ${contractNumber}` },
        ];
        return {
          createdEntities: created,
          outputs: { projectId, contractId, contractNumber },
          message: `تم ربط المشروع "${projectName}" بالعقد ${contractNumber}.`,
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
        title: 'سيتم ربط المشروع بالعقد',
        mutates: true,
        lines: [
          { label: 'المشروع', value: projectName },
          { label: 'العقد', value: contractNumber },
          { label: 'حالة العقد', value: contractStatus },
        ],
      },
    };
  }

  summarize(): string {
    return 'ربط المشروع بالعقد';
  }

  async compensate(outputs: Record<string, unknown>, ctx: CompensationContext): Promise<void> {
    const projectId = outputs.projectId;
    if (typeof projectId !== 'string') return;
    await this.deps.projectsRepo.update(projectId, { contract: { disconnect: true } }, ctx.tx);
    await ctx.audit.log(
      ctx.actor,
      {
        action: 'UPDATE',
        entity: 'Project',
        entityId: projectId,
        newValues: toJsonValue({ event: 'voice_workflow_compensation', unlinked: true }),
      },
      ctx.tx,
    );
  }
}

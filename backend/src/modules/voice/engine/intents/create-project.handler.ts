// ============================================================
// create_project handler.
//
// The canonical SERVER intent. Demonstrates the full slice: required-slot gate
// (area) → confirmation summary → permission (projects.create) → one
// transactional step that creates the Project and writes its audit entry.
//
// Adding the contract / auto-materials sub-steps (compound command) is a matter
// of pushing more PlanStep entries here — the Executor already runs N steps
// atomically. They are intentionally deferred to Phase 2 because a Contract
// needs financial inputs (meter price, totals) that voice cannot yet supply.
// ============================================================

import { ProjectStatus } from '@prisma/client';
import { ProjectType, VoiceIntent, type EntityBag } from '@contractor-plus/shared';
import { toJsonValue } from '../../../../shared/utils/json.js';
import { firstNumber } from '../../nlu/entity-extractor.js';
import type { ProjectsRepository } from '../../../projects/projects.repository.js';
import type {
  CompensationContext,
  IntentHandler,
  Plan,
  PlanInput,
  PlanStep,
  SlotDef,
} from '../voice.types.js';

const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  [ProjectType.HOUSE]: 'بيت',
  [ProjectType.BUILDING]: 'عمارة',
  [ProjectType.VILLA]: 'فيلا',
  [ProjectType.SHOP]: 'محل',
  [ProjectType.OTHER]: 'مشروع',
};

export interface CreateProjectHandlerDeps {
  projects: ProjectsRepository;
}

export class CreateProjectHandler implements IntentHandler {
  readonly intent = VoiceIntent.CREATE_PROJECT;

  readonly requiredSlots: SlotDef[] = [
    {
      name: 'area',
      read: (bag) => bag.area,
      question: 'ما هي مساحة المشروع بالمتر المربع؟',
      fillFromAnswer: (bag, utterance) => {
        const n = firstNumber(utterance);
        if (n !== null) {
          bag.area = n;
          return true;
        }
        return false;
      },
    },
  ];

  constructor(private readonly deps: CreateProjectHandlerDeps) {}

  plan(input: PlanInput): Plan {
    const { bag, actor } = input;
    const name = deriveName(bag);
    const notes = describeSpec(bag);

    const step: PlanStep = {
      description: `إنشاء المشروع "${name}"`,
      requiredPermissions: ['projects.create'],
      execute: async (ctx) => {
        const created = await this.deps.projects.create(
          { name, notes, status: ProjectStatus.PLANNED },
          ctx.tx,
        );
        await ctx.audit.log(
          ctx.actor,
          {
            action: 'CREATE',
            entity: 'Project',
            entityId: created.id,
            newValues: toJsonValue({ ...created, source: 'voice' }),
          },
          ctx.tx,
        );
        return {
          createdEntities: [{ type: 'Project', id: created.id, label: name }],
          outputs: { projectId: created.id },
          message: `تم إنشاء المشروع "${name}".`,
        };
      },
    };

    return {
      intent: this.intent,
      side: 'server',
      mutates: true,
      requiredPermissions: ['projects.create'],
      steps: [step],
      summary: {
        title: 'سيتم إنشاء مشروع جديد',
        mutates: true,
        lines: buildSummaryLines(bag, name),
      },
      contextPatch: {}, // projectId is captured post-exec from outputs by the service
    };
  }

  summarize(bag: EntityBag): string {
    return `إنشاء مشروع: ${deriveName(bag)}`;
  }

  async compensate(outputs: Record<string, unknown>, ctx: CompensationContext): Promise<void> {
    const projectId = outputs.projectId;
    if (typeof projectId !== 'string') return;
    await this.deps.projects.softDelete(projectId, ctx.tx);
    await ctx.audit.log(
      ctx.actor,
      {
        action: 'DELETE',
        entity: 'Project',
        entityId: projectId,
        oldValues: toJsonValue({ event: 'voice_workflow_compensation' }),
      },
      ctx.tx,
    );
  }
}

function deriveName(bag: EntityBag): string {
  if (bag.projectName) return bag.projectName;
  const label = PROJECT_TYPE_LABEL[bag.projectType ?? ProjectType.OTHER];
  return bag.area ? `${label} ${bag.area}م²` : label;
}

function describeSpec(bag: EntityBag): string {
  const parts: string[] = [];
  if (bag.projectType) parts.push(`النوع: ${PROJECT_TYPE_LABEL[bag.projectType]}`);
  if (bag.area !== undefined) parts.push(`المساحة: ${bag.area}م²`);
  if (bag.frontage !== undefined) parts.push(`الواجهة: ${bag.frontage}م`);
  if (bag.depth !== undefined) parts.push(`النزال: ${bag.depth}م`);
  if (bag.floors !== undefined) parts.push(`الطوابق: ${bag.floors}`);
  parts.push('أُنشئ عبر الأوامر الصوتية');
  return parts.join(' | ');
}

function buildSummaryLines(bag: EntityBag, name: string): Plan['summary']['lines'] {
  const lines: Plan['summary']['lines'] = [{ label: 'اسم المشروع', value: name }];
  if (bag.projectType) {
    lines.push({ label: 'النوع', value: PROJECT_TYPE_LABEL[bag.projectType] });
  }
  if (bag.area !== undefined) lines.push({ label: 'المساحة', value: `${bag.area} م²` });
  if (bag.frontage !== undefined) lines.push({ label: 'الواجهة', value: `${bag.frontage} م` });
  if (bag.depth !== undefined) lines.push({ label: 'النزال', value: `${bag.depth} م` });
  if (bag.floors !== undefined) lines.push({ label: 'عدد الطوابق', value: String(bag.floors) });
  if (bag.customerName) {
    lines.push({ label: 'ملاحظة', value: `العميل "${bag.customerName}" والعقد يُضافان لاحقاً` });
  }
  return lines;
}

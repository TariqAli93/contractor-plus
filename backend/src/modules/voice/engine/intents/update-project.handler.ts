// ============================================================
// update_project handler — a mutating SERVER intent (confirmed + audited).
//
//   "أنجز مشروع فيلا أحمد"   → COMPLETED
//   "أوقف المشروع"          → PAUSED (project from session context)
//   "غيّر حالة المشروع إلى قيد التنفيذ" / "شغّل المشروع" → IN_PROGRESS
//
// Scope: the non-destructive lifecycle transitions (start / pause / resume /
// complete). Cancel is intentionally excluded (destructive — use the UI). The
// project reference + the action are parsed from the transcript, so it works
// whichever NLU provider ran. The transition is validated at PLAN time (so the
// user never confirms an action that would fail) and applied inside the
// executor's transaction via ProjectsService.changeStatusWithinTx (audited).
// ============================================================

import { VoiceIntent } from '@contractor-plus/shared';
import type { CreatedEntityRef, EntityBag } from '@contractor-plus/shared';
import { ProjectsService, type VoiceStatusAction } from '../../../projects/projects.service.js';
import type { ProjectsRepository } from '../../../projects/projects.repository.js';
import { deWaw, parseNumberToken, tokenize } from '../../nlu/normalize.js';
import { NAME_STOPWORDS } from '../../nlu/arabic-lexicon.js';
import { ClarifyError } from '../clarify-error.js';
import type { IntentHandler, Plan, PlanInput, PlanStep, SessionContext, SlotDef } from '../voice.types.js';

const PERMS = ['projects.update'];

const ACTION_AR: Record<VoiceStatusAction, string> = {
  start: 'بدء',
  pause: 'إيقاف',
  resume: 'استئناف',
  complete: 'إنجاز',
};
const STATUS_AR: Record<string, string> = {
  PLANNED: 'مخطط',
  IN_PROGRESS: 'قيد التنفيذ',
  PAUSED: 'متوقّف',
  COMPLETED: 'منجز',
  CANCELLED: 'ملغى',
};

// Normalised action cue → transition. (ابدأ/باشر are omitted from the lexicon
// to protect create_project's verbs, but recognised here for the LLM path.)
const ACTION_WORDS: Record<string, VoiceStatusAction> = {
  ابدا: 'start',
  ابدي: 'start',
  شغل: 'start',
  باشر: 'start',
  اوقف: 'pause',
  وقف: 'pause',
  علق: 'pause',
  جمد: 'pause',
  استانف: 'resume',
  انجز: 'complete',
  خلص: 'complete',
  اكمل: 'complete',
  كمل: 'complete',
  انهي: 'complete',
  منجز: 'complete',
  مكتمل: 'complete',
};
const PROJECT_NOUNS = new Set(['مشروع', 'المشروع']);
const CAPTURE_STOP = new Set<string>([...NAME_STOPWORDS, 'جديد', 'الي', 'الى', 'حاله', 'الحاله']);
const REF_LAST = new Set(['نفس', 'هذا', 'هاذا', 'الاخير', 'السابق', 'اخر', 'الحالي']);

export interface UpdateProjectHandlerDeps {
  projects: ProjectsService;
  projectsRepo: ProjectsRepository;
}

export class UpdateProjectHandler implements IntentHandler {
  readonly intent = VoiceIntent.UPDATE_PROJECT;
  readonly requiredSlots: SlotDef[] = [];

  constructor(private readonly deps: UpdateProjectHandlerDeps) {}

  async plan(input: PlanInput): Promise<Plan> {
    const { bag, context, transcript } = input;
    const action = parseAction(transcript);
    if (!action) {
      throw new ClarifyError('ما التغيير على المشروع؟ (ابدأ، أوقف، استأنف، أو أنجز)', 'action');
    }

    const project = await this.resolveProject(bag, context, transcript);
    if (!project) throw new ClarifyError('أي مشروع تقصد؟ (اذكر اسمه)', 'project');

    // Validate NOW (Arabic ConflictError) so we never ask to confirm an action
    // that would fail on execute.
    ProjectsService.transitionPatch(project, action);

    const projectId = project.id;
    const projectName = project.name;

    const step: PlanStep = {
      description: `${ACTION_AR[action]} المشروع "${projectName}"`,
      requiredPermissions: PERMS,
      execute: async (ctx) => {
        const updated = await this.deps.projects.changeStatusWithinTx(
          ctx.tx,
          projectId,
          action,
          ctx.actor,
        );
        const created: CreatedEntityRef[] = [{ type: 'Project', id: projectId, label: projectName }];
        return {
          createdEntities: created,
          outputs: { projectId },
          message: `تم ${ACTION_AR[action]} المشروع "${projectName}" — الحالة: ${STATUS_AR[updated.status] ?? updated.status}.`,
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
        title: `سيتم ${ACTION_AR[action]} المشروع`,
        mutates: true,
        lines: [
          { label: 'المشروع', value: projectName },
          { label: 'الحالة الحالية', value: STATUS_AR[project.status] ?? project.status },
          { label: 'الإجراء', value: ACTION_AR[action] },
        ],
      },
      contextPatch: { lastProjectId: projectId, lastProjectName: projectName },
    };
  }

  summarize(): string {
    return 'تحديث حالة المشروع';
  }

  private async resolveProject(bag: EntityBag, context: SessionContext, transcript: string) {
    const wantsLast = !!bag.entityRef && REF_LAST.has(deWaw(String(bag.entityRef)));
    if (wantsLast && context.lastProjectId) {
      return this.deps.projectsRepo.findById(context.lastProjectId);
    }
    const name = parseProjectName(transcript) ?? bag.projectName;
    if (name) {
      const p = await this.deps.projectsRepo.findFirstByName(name);
      if (p) return p;
    }
    if (context.lastProjectId) return this.deps.projectsRepo.findById(context.lastProjectId);
    return null;
  }
}

function parseAction(transcript: string): VoiceStatusAction | null {
  for (const tk of tokenize(transcript)) {
    const a = ACTION_WORDS[deWaw(tk.norm)] ?? ACTION_WORDS[tk.norm];
    if (a) return a;
  }
  return null;
}

function parseProjectName(transcript: string): string | undefined {
  const tokens = tokenize(transcript);
  const idx = tokens.findIndex((t) => PROJECT_NOUNS.has(t.norm) || PROJECT_NOUNS.has(deWaw(t.norm)));
  if (idx < 0) return undefined;
  const parts: string[] = [];
  for (let j = idx + 1; j < tokens.length && parts.length < 4; j++) {
    const nx = tokens[j]!;
    const nn = deWaw(nx.norm);
    if (CAPTURE_STOP.has(nn) || CAPTURE_STOP.has(nx.norm)) break;
    if (ACTION_WORDS[nn] || ACTION_WORDS[nx.norm]) break; // don't capture the action word as a name
    if (parseNumberToken(nn) !== null) break;
    parts.push(nx.original);
  }
  return parts.length ? parts.join(' ') : undefined;
}

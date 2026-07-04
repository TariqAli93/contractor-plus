// ============================================================
// open_entity handler — a CLIENT intent (read + navigate, no DB write).
//
//   "افتح العقد رقم V-2026-0004"   → resolve by contract number
//   "افتح مشروع فيلا أحمد"          → resolve a project by name
//   "افتح العميل أحمد علي"          → resolve a customer by name
//   "افتح آخر مشروع"               → the last project from session context
//
// Resolution reads the DB during planning (handlers may be async + hold repos),
// then the plan carries only a `navigate` clientAction — nothing mutates, so no
// confirmation. A miss doesn't dead-end: we navigate to the matching LIST and
// toast "not found — search here". Page-level RBAC is the SPA route guard's job,
// so no per-step permission is required (same stance as the navigate handler).
//
// NOTE: the target noun + name are parsed FROM THE TRANSCRIPT here, so this
// works regardless of which NLU provider ran (rule-based or LLM) and needs no
// change to the shared entity extractor / create-flow scoring.
// ============================================================

import { VoiceIntent } from '@contractor-plus/shared';
import type { ClientAction } from '@contractor-plus/shared';
import type { ProjectsRepository } from '../../../projects/projects.repository.js';
import type { CustomersRepository } from '../../../customers/customers.repository.js';
import type { ContractsRepository } from '../../../contracts/contracts.repository.js';
import { deWaw, parseNumberToken, tokenize } from '../../nlu/normalize.js';
import { NAME_STOPWORDS } from '../../nlu/arabic-lexicon.js';
import { ClarifyError } from '../clarify-error.js';
import type { IntentHandler, Plan, PlanInput, SlotDef } from '../voice.types.js';

type TargetType = 'project' | 'contract' | 'customer';

// Normalised entity nouns → which record type to open.
const NOUN_TO_TARGET: Record<string, TargetType> = {
  مشروع: 'project',
  المشروع: 'project',
  عقد: 'contract',
  العقد: 'contract',
  عميل: 'customer',
  العميل: 'customer',
  زبون: 'customer',
  الزبون: 'customer',
};
const LIST_ROUTE: Record<TargetType, string> = {
  project: '/projects',
  contract: '/contracts',
  customer: '/customers',
};
const DETAIL_ROUTE: Record<TargetType, (id: string) => string> = {
  project: (id) => `/projects/${id}`,
  contract: (id) => `/contracts/${id}`,
  customer: (id) => `/customers/${id}`,
};
// "this / last / current / previous" references → use the session's last id.
const REF_LAST = new Set([
  'نفس',
  'هذا',
  'هاذا',
  'الاخير',
  'السابق',
  'اخر',
  'الحالي',
  'last',
  'last_customer',
]);
// Tokens that end a captured name span (markers, not part of the name).
const CAPTURE_STOP = new Set<string>([...NAME_STOPWORDS, 'جديد', 'رقم', 'اسمه', 'باسم', 'باسمه']);

export interface OpenEntityHandlerDeps {
  projects: ProjectsRepository;
  customers: CustomersRepository;
  contractsRepo: ContractsRepository;
}

export class OpenEntityHandler implements IntentHandler {
  readonly intent = VoiceIntent.OPEN_ENTITY;
  readonly requiredSlots: SlotDef[] = [];

  constructor(private readonly deps: OpenEntityHandlerDeps) {}

  async plan(input: PlanInput): Promise<Plan> {
    const { bag, context, transcript } = input;
    const parsed = parseTarget(transcript);
    const type = parsed?.type;

    // An explicit contract number wins regardless of the parsed noun.
    if ((type === 'contract' || !type) && bag.contractRef) {
      const c = await this.deps.contractsRepo.findByContractNumber(bag.contractRef);
      return c
        ? this.nav('contract', c.id, `العقد ${c.contractNumber}`)
        : this.notFound('contract', `لم أجد عقداً بالرقم ${bag.contractRef}.`);
    }

    if (!type) {
      throw new ClarifyError(
        'ماذا تريد أن تفتح؟ (مشروع، عقد، أو عميل — اذكر الاسم أو الرقم)',
        'target',
      );
    }

    const wantsLast = !!bag.entityRef && REF_LAST.has(deWaw(String(bag.entityRef)));

    if (type === 'project') {
      if (wantsLast && context.lastProjectId) {
        return this.nav('project', context.lastProjectId, 'آخر مشروع');
      }
      const name = parsed.name ?? bag.projectName;
      if (name) {
        const p = await this.deps.projects.findFirstByName(name);
        return p
          ? this.nav('project', p.id, p.name)
          : this.notFound('project', `لم أجد مشروعاً باسم "${name}".`);
      }
      if (context.lastProjectId) return this.nav('project', context.lastProjectId, 'آخر مشروع');
      throw new ClarifyError('أي مشروع تريد أن تفتح؟ (اذكر اسمه)', 'project');
    }

    if (type === 'contract') {
      if (wantsLast && context.lastContractId) {
        return this.nav('contract', context.lastContractId, 'آخر عقد');
      }
      // Contracts are identified by number; accept a code-like parsed name too.
      const ref = bag.contractRef ?? (parsed.name && /\d/.test(parsed.name) ? parsed.name : undefined);
      if (ref) {
        const c = await this.deps.contractsRepo.findByContractNumber(ref);
        return c
          ? this.nav('contract', c.id, `العقد ${c.contractNumber}`)
          : this.notFound('contract', `لم أجد عقداً بالرقم ${ref}.`);
      }
      if (context.lastContractId) return this.nav('contract', context.lastContractId, 'آخر عقد');
      throw new ClarifyError('أي عقد تريد أن تفتح؟ (اذكر رقم العقد)', 'contract');
    }

    // customer
    if (wantsLast && context.lastCustomerId) {
      return this.nav('customer', context.lastCustomerId, 'آخر عميل');
    }
    const cname = bag.customerName ?? parsed.name;
    if (cname) {
      const matches = await this.deps.customers.findByName(cname);
      const first = matches[0];
      return first
        ? this.nav('customer', first.id, first.name)
        : this.notFound('customer', `لم أجد عميلاً باسم "${cname}".`);
    }
    if (context.lastCustomerId) return this.nav('customer', context.lastCustomerId, 'آخر عميل');
    throw new ClarifyError('أي عميل تريد أن تفتح؟ (اذكر اسمه)', 'customer');
  }

  summarize(): string {
    return 'فتح سجل';
  }

  private nav(type: TargetType, id: string, label: string): Plan {
    return {
      intent: this.intent,
      side: 'client',
      mutates: false,
      requiredPermissions: [],
      steps: [],
      clientActions: [{ type: 'navigate', to: DETAIL_ROUTE[type](id) }],
      summary: { title: 'فتح السجل', mutates: false, lines: [{ label: 'الوجهة', value: label }] },
    };
  }

  private notFound(type: TargetType, message: string): Plan {
    const actions: ClientAction[] = [
      { type: 'navigate', to: LIST_ROUTE[type] },
      { type: 'toast', level: 'info', message: `${message} فتحتُ القائمة لتبحث فيها.` },
    ];
    return {
      intent: this.intent,
      side: 'client',
      mutates: false,
      requiredPermissions: [],
      steps: [],
      clientActions: actions,
      summary: { title: 'لم أجد السجل', mutates: false, lines: [{ label: 'ملاحظة', value: message }] },
    };
  }
}

/** Find the first entity noun in the utterance and capture the name span after it. */
function parseTarget(transcript: string): { type: TargetType; name?: string } | null {
  const tokens = tokenize(transcript);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    const target = NOUN_TO_TARGET[tok.norm] ?? NOUN_TO_TARGET[deWaw(tok.norm)];
    if (!target) continue;

    const parts: string[] = [];
    for (let j = i + 1; j < tokens.length && parts.length < 4; j++) {
      const nx = tokens[j];
      if (!nx) break;
      const nn = deWaw(nx.norm);
      if (CAPTURE_STOP.has(nn) || CAPTURE_STOP.has(nx.norm)) break;
      if (parseNumberToken(nn) !== null || parseNumberToken(nx.norm) !== null) break;
      parts.push(nx.original);
    }
    return parts.length ? { type: target, name: parts.join(' ') } : { type: target };
  }
  return null;
}

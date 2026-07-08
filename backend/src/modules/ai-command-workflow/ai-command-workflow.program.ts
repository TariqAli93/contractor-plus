// ============================================================
// The deterministic "program pass" of the AI command workflow — extracted as
// PURE functions (no session, no audit, no LLM). Both the legacy service
// (`ai-command-workflow.service.ts`) and the unified assistant's CommandTool
// (`ai-assistant/command/command.tool.ts`) call these, so reference-resolution,
// slot completeness, permission gating, query execution, and confirmation-message
// building have ONE implementation.
//
// Behaviour is byte-for-byte the same as the service's former private methods —
// the only change is `this.repo`/`this.deps` became explicit parameters.
// ============================================================

import type { AiCommandRepository } from './ai-command-workflow.repository.js';
import { getAction, type ActionDeps } from './ai-command-workflow.registry.js';
import type {
  ClarificationOption,
  ExecContext,
  ExecutedActionInfo,
  PlanRefs,
  WorkflowStep,
} from './ai-command-workflow.types.js';

// ---------------------------------------------------------------------------
// Small helpers (shared by the service's interpret() and the functions below)
// ---------------------------------------------------------------------------

export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function hasSlot(data: Record<string, unknown>, slot: string): boolean {
  const v = data[slot];
  return v !== undefined && v !== null && String(v).trim() !== '';
}

const SLOT_LABELS_AR: Record<string, string> = {
  name: 'الاسم',
  area: 'المساحة (م²)',
  amount: 'المبلغ',
  status: 'الحالة',
  projectRef: 'المشروع',
  clientRef: 'العميل',
  contractRef: 'العقد',
  materialRef: 'المادة',
  description: 'الوصف',
  username: 'اسم المستخدم',
  password: 'كلمة المرور',
  roleName: 'الدور',
  dueDate: 'تاريخ الاستحقاق',
};

export function slotQuestion(missing: string[]): string {
  const labels = missing.map((s) => SLOT_LABELS_AR[s] ?? s);
  return `أحتاج معلومات إضافية: ${labels.join('، ')}؟`;
}

// ---------------------------------------------------------------------------
// Reference resolution
// ---------------------------------------------------------------------------

export interface ResolveResult {
  refs: PlanRefs;
  clarify?: { message: string; missingSlots: string[]; options?: ClarificationOption[] };
  reject?: { reason: string; message: string };
}

export async function resolveReferences(
  repo: AiCommandRepository,
  steps: WorkflowStep[],
): Promise<ResolveResult> {
  const refs: PlanRefs = {};
  const creates = (action: string) => steps.some((s) => s.action === action);
  const createsProject = creates('project.create');
  const createsContract = creates('contract.create');
  const createsMaterial = creates('material.create');

  // 1) Client (find_or_create): 0 → create, 1 → bind, >1 → clarify.
  const clientStep = steps.find(
    (s) => s.action === 'client.find_or_create' || s.action === 'client.create',
  );
  if (clientStep && clientStep.action === 'client.find_or_create') {
    const name = str(clientStep.data.name) ?? str(clientStep.data.clientRef);
    if (name) {
      const matches = await repo.findCustomersByName(name);
      if (matches.length === 1) refs.clientId = matches[0]!.id;
      else if (matches.length > 1) {
        return {
          refs,
          clarify: {
            message: `يوجد أكثر من عميل باسم "${name}". أي واحد تقصد؟`,
            missingSlots: ['clientId'],
            options: matches.map((m) => ({ slot: 'clientId', id: m.id, label: m.phone ? `${m.name} — ${m.phone}` : m.name })),
          },
        };
      } else refs.willCreateClient = true;
    }
  }

  // 1b) Existing customer target ("customerRef", e.g. customer.update) — fuzzy
  //     name/phone. Only when the plan does NOT create a client.
  if (!clientStep && !refs.clientId) {
    const custStep = steps.find((s) => str(s.data.customerRef));
    if (custStep) {
      const term = str(custStep.data.customerRef)!;
      const matches = await repo.searchCustomers(term);
      if (matches.length === 1) refs.clientId = matches[0]!.id;
      else if (matches.length === 0) {
        return { refs, clarify: { message: `لم أعثر على عميل بالاسم/الرقم "${term}".`, missingSlots: ['customerRef'] } };
      } else {
        return {
          refs,
          clarify: {
            message: `يوجد أكثر من عميل مطابق لـ "${term}". أي واحد تقصد؟`,
            missingSlots: ['clientId'],
            options: matches.map((m) => ({ slot: 'clientId', id: m.id, label: m.phone ? `${m.name} — ${m.phone}` : m.name })),
          },
        };
      }
    }
  }

  // 2) Existing project (unless the plan creates it).
  if (!createsProject) {
    const projStep = steps.find((s) => str(s.data.projectRef));
    if (projStep) {
      const name = str(projStep.data.projectRef)!;
      const matches = await repo.findProjectsByName(name);
      if (matches.length === 1) refs.projectId = matches[0]!.id;
      else if (matches.length === 0) {
        return { refs, clarify: { message: `لم أعثر على مشروع باسم "${name}". حدّد الاسم بدقة.`, missingSlots: ['projectRef'] } };
      } else {
        return {
          refs,
          clarify: {
            message: `يوجد أكثر من مشروع مشابه لـ "${name}". أي واحد تقصد؟`,
            missingSlots: ['projectId'],
            options: matches.map((p) => ({
              slot: 'projectId',
              id: p.id,
              label: p.contract ? `${p.name} — عقد ${p.contract.contractNumber}` : p.name,
            })),
          },
        };
      }
    }
  }

  // 3) Existing material (unless the plan creates it).
  if (!createsMaterial) {
    const matStep = steps.find((s) => str(s.data.materialRef));
    if (matStep) {
      const name = str(matStep.data.materialRef)!;
      const matches = await repo.findMaterialsByName(name);
      if (matches.length === 1) refs.materialId = matches[0]!.id;
      else if (matches.length === 0) {
        return { refs, clarify: { message: `لم أعثر على مادة باسم "${name}".`, missingSlots: ['materialRef'] } };
      } else {
        return {
          refs,
          clarify: {
            message: `يوجد أكثر من مادة مشابهة لـ "${name}". أي واحدة تقصد؟`,
            missingSlots: ['materialId'],
            options: matches.map((m) => ({ slot: 'materialId', id: m.id, label: `${m.name} (${m.unit})` })),
          },
        };
      }
    }
  }

  // 4) Existing contract by number (unless the plan creates it).
  if (!createsContract) {
    const cStep = steps.find((s) => {
      const ref = str(s.data.contractRef);
      return ref && ref !== 'created_contract';
    });
    if (cStep) {
      const num = str(cStep.data.contractRef)!;
      const contract = await repo.findContractByNumber(num);
      if (contract) refs.contractId = contract.id;
      else return { refs, clarify: { message: `لم أعثر على عقد رقم "${num}".`, missingSlots: ['contractRef'] } };
    }
  }

  // 5) Delete/mark targets — the most-recent cost/payment ("آخر مصروف/دفعة"),
  //    ALWAYS scoped to a resolved project. Without project context we must NOT
  //    fall back to the globally-latest record (that could delete/alter an
  //    unrelated project's data) — ask which project instead.
  if (creates('expense.delete')) {
    if (!refs.projectId) {
      return { refs, clarify: { message: 'أي مشروع؟ حدّد المشروع لحذف آخر مصروف فيه.', missingSlots: ['projectRef'] } };
    }
    const cost = await repo.lastCost(refs.projectId);
    if (!cost) return { refs, clarify: { message: 'لا يوجد مصروف للحذف.', missingSlots: ['expense'] } };
    refs.costId = cost.id;
  }
  if (creates('payment.mark_paid') || creates('payment.cancel')) {
    if (!refs.projectId) {
      return { refs, clarify: { message: 'أي مشروع؟ حدّد المشروع للتعامل مع آخر دفعة فيه.', missingSlots: ['projectRef'] } };
    }
    const payment = await repo.lastPayment(refs.projectId);
    if (!payment) return { refs, clarify: { message: 'لا توجد دفعة مطابقة.', missingSlots: ['payment'] } };
    refs.paymentId = payment.id;
  }

  return { refs };
}

// ---------------------------------------------------------------------------
// Slot completeness + permission gate + query execution
// ---------------------------------------------------------------------------

export function missingSlots(steps: WorkflowStep[], refs: PlanRefs): string[] {
  const availClient = !!refs.clientId || !!refs.willCreateClient || steps.some((s) => s.action.startsWith('client.'));
  const availContract = !!refs.contractId || steps.some((s) => s.action === 'contract.create');
  const availProject = !!refs.projectId || steps.some((s) => s.action === 'project.create');
  const availMaterial = !!refs.materialId || steps.some((s) => s.action === 'material.create');

  const missing = new Set<string>();
  for (const step of steps) {
    const def = getAction(step.action);
    if (!def) continue;
    for (const slot of def.requiredSlots) {
      if (slot === 'projectRef' && availProject) continue;
      if (slot === 'contractRef' && availContract) continue;
      if (slot === 'materialRef' && availMaterial) continue;
      if (slot === 'clientRef' && availClient) continue;
      if (slot === 'customerRef' && availClient) continue;
      if (!hasSlot(step.data, slot)) missing.add(slot);
    }
  }
  return [...missing];
}

export function missingPermissions(steps: WorkflowStep[], permissions: Set<string>): string[] {
  const missing = new Set<string>();
  for (const step of steps) {
    const def = getAction(step.action);
    if (!def) continue;
    // Data-dependent actions (e.g. project.status.change) narrow to only the
    // permission the requested data actually needs.
    const required = def.resolveRequiredPermissions?.(step.data) ?? def.requiredPermissions;
    for (const perm of required) {
      if (!permissions.has(perm)) missing.add(perm);
    }
  }
  return [...missing];
}

export async function runQueries(
  deps: ActionDeps,
  ctx: ExecContext,
  steps: WorkflowStep[],
  refs: PlanRefs,
): Promise<unknown> {
  const results: unknown[] = [];
  for (const step of steps) {
    const def = getAction(step.action);
    if (def?.runQuery) results.push(await def.runQuery(deps, ctx, step.data, refs));
  }
  return results.length === 1 ? results[0] : results;
}

/** DB-sourced old→new confirmation for project.update / customer.update /
 *  expense.delete / payment.*; otherwise the AI's message (or a generated default). */
export async function buildConfirmationMessage(
  deps: ActionDeps,
  steps: WorkflowStep[],
  refs: PlanRefs,
  aiMessage: string | undefined,
): Promise<string> {
  const updateStep = steps.find((s) => s.action === 'project.update');
  if (updateStep && refs.projectId) {
    try {
      const project = await deps.projects.getById(refs.projectId);
      const changes: string[] = [];
      const newName = str(updateStep.data.name);
      if (newName) changes.push(`الاسم من "${project.name}" إلى "${newName}"`);
      const newProgress = str(updateStep.data.progressPercentage);
      if (newProgress) changes.push(`نسبة الإنجاز من ${Number(project.progressPercentage)}% إلى ${newProgress}%`);
      const newArea = str(updateStep.data.area);
      if (newArea && project.contract) {
        const contract = await deps.contracts.getById(project.contract.id);
        changes.push(`المساحة من ${Number(contract.buildingArea)} م² إلى ${newArea} م²`);
      }
      if (changes.length > 0) {
        return `راح أغيّر لمشروع "${project.name}": ${changes.join('، ')}. هل تؤكد؟`;
      }
    } catch {
      /* fall through to default */
    }
  }

  // customer.update → show DB-sourced old→new for each changed field.
  const custStep = steps.find((s) => s.action === 'customer.update');
  if (custStep && refs.clientId) {
    try {
      const customer = await deps.prisma.customer.findUnique({ where: { id: refs.clientId } });
      if (customer) {
        const changes: string[] = [];
        const fields: Array<[string, string, string | null]> = [
          ['الاسم', str(custStep.data.name) ?? '', customer.name],
          ['الهاتف', str(custStep.data.phone) ?? '', customer.phone],
          ['البريد', str(custStep.data.email) ?? '', customer.email],
          ['العنوان', str(custStep.data.address) ?? '', customer.address],
        ];
        for (const [label, next, current] of fields) {
          if (next) changes.push(`${label} من "${current ?? '—'}" إلى "${next}"`);
        }
        if (changes.length > 0) {
          return `راح أعدّل بيانات العميل "${customer.name}": ${changes.join('، ')}. هل تؤكد؟`;
        }
      }
    } catch {
      /* fall through to default */
    }
  }

  // expense.delete → name the exact cost being removed.
  const delStep = steps.find((s) => s.action === 'expense.delete');
  if (delStep && refs.costId) {
    const cost = await deps.prisma.projectCost.findUnique({ where: { id: refs.costId } });
    if (cost) return `راح أحذف المصروف: ${cost.description} بمبلغ ${Number(cost.totalAmount)}. هل تؤكد؟`;
  }
  // payment.mark_paid / payment.cancel → name the exact payment.
  const payStep = steps.find((s) => s.action === 'payment.mark_paid' || s.action === 'payment.cancel');
  if (payStep && refs.paymentId) {
    const pay = await deps.prisma.payment.findUnique({ where: { id: refs.paymentId } });
    if (pay) {
      const verb = payStep.action === 'payment.mark_paid' ? 'أأكّد دفع' : 'ألغي';
      return `راح ${verb} الدفعة بمبلغ ${Number(pay.amount)}. هل تؤكد؟`;
    }
  }

  if (aiMessage && aiMessage.trim()) return aiMessage.trim();
  const labels = steps.map((s) => s.action).join('، ');
  return `راح أنفّذ: ${labels}. هل تؤكد؟`;
}

// ---------------------------------------------------------------------------
// Result-message builders
// ---------------------------------------------------------------------------

const ENTITY_AR: Record<string, string> = {
  Customer: 'عميل',
  Contract: 'عقد',
  Project: 'مشروع',
  Payment: 'دفعة',
  ProjectCost: 'مصروف',
  Material: 'مادة',
  User: 'مستخدم',
  Role: 'دور',
  Currency: 'عملة',
  CompanyProfile: 'بيانات الشركة',
  SystemSetting: 'الإعدادات',
};

export function buildExecutionMessage(actions: ExecutedActionInfo[]): string {
  const byOp: Record<'create' | 'update' | 'delete', Set<string>> = {
    create: new Set(),
    update: new Set(),
    delete: new Set(),
  };
  for (const a of actions) byOp[a.operation].add(ENTITY_AR[a.entity] ?? a.entity);
  const parts: string[] = [];
  if (byOp.create.size) parts.push(`تم إنشاء: ${[...byOp.create].join('، ')}`);
  if (byOp.update.size) parts.push(`تم تحديث: ${[...byOp.update].join('، ')}`);
  if (byOp.delete.size) parts.push(`تم حذف: ${[...byOp.delete].join('، ')}`);
  return parts.length ? `تم التنفيذ بنجاح. ${parts.join('. ')}.` : 'تم التنفيذ بنجاح.';
}

export function buildQueryMessage(intent: string): string {
  if (intent.includes('summary')) return 'هذا ملخص المشروع.';
  return 'هذه نتيجة الاستعلام.';
}

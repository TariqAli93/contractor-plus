// ============================================================
// Workflow Registry — the single allow-list of executable actions.
//
// The AI may ONLY name actions that exist here (the executor rejects anything
// else). Each action declares its required permissions, required/optional slots,
// whether it needs confirmation, a danger level, a Zod schema for its step data,
// and one or more runners that call the EXISTING domain services (never
// re-implementing their logic):
//   - runInTx        : a compoundable mutation, runs inside a shared $transaction
//   - runStandalone  : a single-step mutation, runs in its own $transaction
//   - runQuery       : a read-only query/summary, no mutation, no confirmation
//
// Action names use domain vocabulary (`client.*`, `expense.*`) that maps onto the
// real modules (customers, costs). Reference threading between steps is done by
// the executor via PlanRefs — the AI never supplies raw ids.
// ============================================================

import { z } from 'zod';
import { ContractStatus, CostCategory, ProjectStatus, type Prisma, type PrismaClient } from '@prisma/client';

import { CustomersService } from '../customers/customers.service.js';
import { ContractsService } from '../contracts/contracts.service.js';
import { ProjectsService, type ProjectStatusAction } from '../projects/projects.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { CostsService } from '../costs/costs.service.js';
import { MaterialsService } from '../materials/materials.service.js';
import { ReportsService } from '../reports/reports.service.js';
import { UsersService } from '../users/users.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { SettingsService } from '../settings/settings.service.js';

import { CustomersRepository } from '../customers/customers.repository.js';
import { ProjectsRepository } from '../projects/projects.repository.js';

import { listCustomersQuerySchema } from '../customers/customers.schemas.js';
import { listContractsQuerySchema } from '../contracts/contracts.schemas.js';
import { listProjectsQuerySchema } from '../projects/projects.schemas.js';
import { listPaymentsQuerySchema } from '../payments/payments.schemas.js';
import { listCostsQuerySchema } from '../costs/costs.schemas.js';
import { listMaterialsQuerySchema } from '../materials/materials.schemas.js';
import {
  cashFlowQuerySchema,
  delayedProjectsQuerySchema,
  listProjectProfitabilityQuerySchema,
  overduePaymentsQuerySchema,
} from '../reports/reports.schemas.js';
import type { UpdateCustomerInput } from '../customers/customers.schemas.js';
import type { UpdateUserInput } from '../users/users.schemas.js';
import type { UpdateRoleInput } from '../rbac/rbac.schemas.js';
import type { UpdateCompanyProfileInput } from '../settings/settings.schemas.js';

import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { ValidationError } from '../../shared/errors/validation.error.js';
import { ConflictError } from '../../shared/errors/conflict.error.js';

import type { DangerLevel, ExecContext, PlanRefs, StepOutcome } from './ai-command-workflow.types.js';

// ---------------------------------------------------------------------------
// Service bag — instantiated once per request and threaded to every runner.
// ---------------------------------------------------------------------------

export interface ActionDeps {
  prisma: PrismaClient;
  customers: CustomersService;
  contracts: ContractsService;
  projects: ProjectsService;
  payments: PaymentsService;
  costs: CostsService;
  materials: MaterialsService;
  reports: ReportsService;
  users: UsersService;
  rbac: RbacService;
  settings: SettingsService;
  customersRepo: CustomersRepository;
  projectsRepo: ProjectsRepository;
}

export function buildActionDeps(prisma: PrismaClient): ActionDeps {
  return {
    prisma,
    customers: new CustomersService(prisma),
    contracts: new ContractsService(prisma),
    projects: new ProjectsService(prisma),
    payments: new PaymentsService(prisma),
    costs: new CostsService(prisma),
    materials: new MaterialsService(prisma),
    reports: new ReportsService(prisma),
    users: new UsersService(prisma),
    rbac: new RbacService(prisma),
    settings: new SettingsService(prisma),
    customersRepo: new CustomersRepository(prisma),
    projectsRepo: new ProjectsRepository(prisma),
  };
}

// ---------------------------------------------------------------------------
// Runner types + ActionDef
// ---------------------------------------------------------------------------

type StepData = Record<string, unknown>;
type QueryRunner = (deps: ActionDeps, ctx: ExecContext, data: StepData, refs: PlanRefs) => Promise<unknown>;
type TxRunner = (
  deps: ActionDeps,
  tx: Prisma.TransactionClient,
  ctx: ExecContext,
  data: StepData,
  refs: PlanRefs,
) => Promise<StepOutcome | null>;
type StandaloneRunner = (
  deps: ActionDeps,
  ctx: ExecContext,
  data: StepData,
  refs: PlanRefs,
) => Promise<StepOutcome | null>;

export interface ActionDef {
  action: string;
  kind: 'mutation' | 'query';
  description: string;
  requiredPermissions: string[];
  requiredSlots: string[];
  optionalSlots: string[];
  requiresConfirmation: boolean;
  dangerousLevel: DangerLevel;
  schema: z.ZodTypeAny;
  runQuery?: QueryRunner;
  runInTx?: TxRunner;
  runStandalone?: StandaloneRunner;
}

// ---------------------------------------------------------------------------
// Coercion helpers — the LLM may emit "200"/"٢٠٠"/"200 متر"; be forgiving.
// ---------------------------------------------------------------------------

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
function reqStr(v: unknown): string {
  const s = str(v);
  if (!s) throw new ValidationError('قيمة نصية مطلوبة مفقودة', { value: ['required'] });
  return s;
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function reqNum(v: unknown): number {
  const n = numOrNull(v);
  if (n === null) throw new ValidationError('قيمة رقمية مطلوبة مفقودة', { value: ['required'] });
  return n;
}
function dateOrNull(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A readable, unique contract number when the user didn't dictate one. */
function generateContractNumber(): string {
  return `CT-${Date.now().toString(36).toUpperCase()}`;
}

function mapCostCategory(v: unknown): CostCategory {
  const s = (str(v) ?? '').toLowerCase();
  if (/(مواد|مادة|material)/.test(s)) return CostCategory.MATERIAL;
  if (/(عمال|أجور|اجور|labor|labour)/.test(s)) return CostCategory.LABOR;
  if (/(معدات|آلات|الات|machinery|equipment)/.test(s)) return CostCategory.MACHINERY;
  if (/(نقل|شحن|transport)/.test(s)) return CostCategory.TRANSPORT;
  return CostCategory.MISC;
}

export type StatusChange = ProjectStatusAction | 'cancel';
export function mapProjectStatusAction(v: unknown): StatusChange | null {
  const s = (str(v) ?? '').toLowerCase();
  if (/(start|ابدأ|إبدأ|ابدا|بدء|شغل|باشر)/.test(s)) return 'start';
  if (/(pause|ايقاف|إيقاف|علّق|علق|توقف)/.test(s)) return 'pause';
  if (/(resume|استئناف|استأنف|كمل|أكمل|واصل)/.test(s)) return 'resume';
  if (/(complete|مكتمل|منجز|انجاز|إنجاز|انهاء|إنهاء|خلص|تم)/.test(s)) return 'complete';
  if (/(cancel|الغاء|إلغاء|الغي|ملغي|ملغى)/.test(s)) return 'cancel';
  return null;
}

function mapProjectStatus(v: unknown): ProjectStatus | undefined {
  const s = (str(v) ?? '').toLowerCase();
  if (!s) return undefined;
  if (/(planned|مخطط|مخططة)/.test(s)) return ProjectStatus.PLANNED;
  if (/(in_progress|قيد|جاري|جارية|شغال)/.test(s)) return ProjectStatus.IN_PROGRESS;
  if (/(paused|متوقف|متوقفة|موقوف|معلق)/.test(s)) return ProjectStatus.PAUSED;
  if (/(completed|مكتمل|مكتملة|منجز|منتهي|منتهية)/.test(s)) return ProjectStatus.COMPLETED;
  if (/(cancelled|canceled|ملغى|ملغية|ملغاة)/.test(s)) return ProjectStatus.CANCELLED;
  return undefined;
}

function mapContractStatus(v: unknown): ContractStatus | undefined {
  const s = (str(v) ?? '').toLowerCase();
  if (!s) return undefined;
  if (/(draft|مسودة|مسوده)/.test(s)) return ContractStatus.DRAFT;
  if (/(approved|معتمد|معتمدة|موافق|موقع|موقّع)/.test(s)) return ContractStatus.APPROVED;
  if (/(cancelled|canceled|ملغى|ملغية|ملغاة|منتهي|منتهية)/.test(s)) return ContractStatus.CANCELLED;
  return undefined;
}

const acting = (ctx: ExecContext) => ({ id: ctx.userId, role: ctx.role, actor: ctx.actor });

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const passthrough = () => z.object({}).passthrough();

export const ACTIONS: Record<string, ActionDef> = {
  // ===================== CLIENTS (module: customers) =====================
  'client.find_or_create': {
    action: 'client.find_or_create',
    kind: 'mutation',
    description: 'Find a client by name; create one if none exists. Slots: name.',
    requiredPermissions: ['customers.create'],
    requiredSlots: ['name'],
    optionalSlots: ['phone', 'email', 'address'],
    requiresConfirmation: true,
    dangerousLevel: 'low',
    schema: z.object({ name: z.string().trim().min(1) }).passthrough(),
    runInTx: async (deps, tx, ctx, data, refs) => {
      if (refs.clientId) return null; // existing client resolved before confirmation → reuse
      const created = await deps.customers.createWithinTx(
        tx,
        { name: reqStr(data.name), phone: str(data.phone), email: str(data.email), address: str(data.address), notes: null },
        ctx.actor,
      );
      refs.clientId = created.id;
      return { entity: 'Customer', entityId: created.id, operation: 'create', refKey: 'clientId' };
    },
    runStandalone: async (deps, ctx, data, refs) => {
      if (refs.clientId) return null;
      const created = await deps.customers.create(
        { name: reqStr(data.name), phone: str(data.phone), email: str(data.email), address: str(data.address), notes: null },
        ctx.actor,
      );
      refs.clientId = created.id;
      return { entity: 'Customer', entityId: created.id, operation: 'create', refKey: 'clientId' };
    },
  },

  'client.create': {
    action: 'client.create',
    kind: 'mutation',
    description: 'Create a new client. Slots: name (required), phone, email, address.',
    requiredPermissions: ['customers.create'],
    requiredSlots: ['name'],
    optionalSlots: ['phone', 'email', 'address'],
    requiresConfirmation: true,
    dangerousLevel: 'low',
    schema: z.object({ name: z.string().trim().min(1) }).passthrough(),
    runInTx: async (deps, tx, ctx, data, refs) => {
      const created = await deps.customers.createWithinTx(
        tx,
        { name: reqStr(data.name), phone: str(data.phone), email: str(data.email), address: str(data.address), notes: str(data.notes) },
        ctx.actor,
      );
      refs.clientId = created.id;
      return { entity: 'Customer', entityId: created.id, operation: 'create', refKey: 'clientId' };
    },
    runStandalone: async (deps, ctx, data, refs) => {
      const created = await deps.customers.create(
        { name: reqStr(data.name), phone: str(data.phone), email: str(data.email), address: str(data.address), notes: str(data.notes) },
        ctx.actor,
      );
      refs.clientId = created.id;
      return { entity: 'Customer', entityId: created.id, operation: 'create', refKey: 'clientId' };
    },
  },

  'client.search': {
    action: 'client.search',
    kind: 'query',
    description: 'Search clients by name. Slots: name/query.',
    requiredPermissions: ['customers.read'],
    requiredSlots: [],
    optionalSlots: ['name', 'query'],
    requiresConfirmation: false,
    dangerousLevel: 'none',
    schema: passthrough(),
    runQuery: async (deps, _ctx, data) => {
      const query = listCustomersQuerySchema.parse({ search: str(data.name) ?? str(data.query) ?? undefined });
      return deps.customers.list(query);
    },
  },

  'customer.update': {
    action: 'customer.update',
    kind: 'mutation',
    description: 'Update a resolved customer ("حدث اسم العميل"، "بدل رقم الهاتف"). Slots: customerRef, name, phone, email, address.',
    requiredPermissions: ['customers.update'],
    requiredSlots: ['customerRef'],
    optionalSlots: ['name', 'phone', 'email', 'address'],
    requiresConfirmation: true,
    dangerousLevel: 'low',
    schema: passthrough(),
    runStandalone: async (deps, ctx, data, refs) => {
      const id = refs.clientId;
      if (!id) throw new NotFoundError('Customer', 'CUSTOMER_NOT_FOUND');
      await deps.customers.update(
        id,
        {
          ...(str(data.name) !== null && { name: str(data.name)! }),
          ...(str(data.phone) !== null && { phone: str(data.phone) }),
          ...(str(data.email) !== null && { email: str(data.email) }),
          ...(str(data.address) !== null && { address: str(data.address) }),
        } as UpdateCustomerInput,
        ctx.actor,
      );
      return { entity: 'Customer', entityId: id, operation: 'update' };
    },
  },

  // ===================== CONTRACTS =====================
  'contract.create': {
    action: 'contract.create',
    kind: 'mutation',
    description: 'Create a contract for the (found/created) client. Slots: area (required), floors, meterPrice.',
    requiredPermissions: ['contracts.create'],
    requiredSlots: ['area'],
    optionalSlots: ['floors', 'meterPrice', 'contractNumber', 'notes'],
    requiresConfirmation: true,
    dangerousLevel: 'medium',
    schema: z.object({ area: z.union([z.number(), z.string()]) }).passthrough(),
    runInTx: async (deps, tx, ctx, data, refs) => {
      const customerId = refs.clientId;
      if (!customerId) throw new ConflictError('لا يوجد عميل مرتبط لإنشاء العقد', 'NO_CLIENT_FOR_CONTRACT');
      const created = await deps.contracts.createWithinTx(
        tx,
        {
          contractNumber: str(data.contractNumber) ?? generateContractNumber(),
          customerId,
          templateId: null,
          buildingArea: reqNum(data.area),
          floors: numOrNull(data.floors) ?? 1,
          meterPrice: numOrNull(data.meterPrice) ?? 0,
          expectedProfitMargin: numOrNull(data.meterPrice) !== null ? numOrNull(data.profitMargin) : null,
          notes: str(data.notes),
        },
        ctx.actor,
      );
      refs.contractId = created.id;
      return { entity: 'Contract', entityId: created.id, operation: 'create', refKey: 'contractId' };
    },
    runStandalone: async (deps, ctx, data, refs) => {
      const customerId = refs.clientId;
      if (!customerId) throw new ConflictError('حدد العميل الذي سيُنشأ له العقد', 'NO_CLIENT_FOR_CONTRACT');
      const created = await deps.contracts.create(
        {
          contractNumber: str(data.contractNumber) ?? generateContractNumber(),
          customerId,
          templateId: null,
          buildingArea: reqNum(data.area),
          floors: numOrNull(data.floors) ?? 1,
          meterPrice: numOrNull(data.meterPrice) ?? 0,
          expectedProfitMargin: null,
          notes: str(data.notes),
        },
        ctx.actor,
      );
      refs.contractId = created.id;
      return { entity: 'Contract', entityId: created.id, operation: 'create', refKey: 'contractId' };
    },
  },

  'contract.search': {
    action: 'contract.search',
    kind: 'query',
    description: 'Search/list contracts by number/text and/or status (draft/approved/cancelled). Slots: query, contractNumber, status.',
    requiredPermissions: ['contracts.read'],
    requiredSlots: [],
    optionalSlots: ['query', 'contractNumber', 'status'],
    requiresConfirmation: false,
    dangerousLevel: 'none',
    schema: passthrough(),
    runQuery: async (deps, _ctx, data) => {
      const query = listContractsQuerySchema.parse({
        search: str(data.query) ?? str(data.contractNumber) ?? undefined,
        status: mapContractStatus(data.status),
      });
      return deps.contracts.list(query);
    },
  },

  'contract.update': {
    action: 'contract.update',
    kind: 'mutation',
    description: 'Update a DRAFT contract by resolved contract. Slots: contractRef, area, floors, meterPrice, notes.',
    requiredPermissions: ['contracts.update'],
    requiredSlots: ['contractRef'],
    optionalSlots: ['area', 'floors', 'meterPrice', 'notes'],
    requiresConfirmation: true,
    dangerousLevel: 'medium',
    schema: passthrough(),
    runStandalone: async (deps, ctx, data, refs) => {
      const id = refs.contractId;
      if (!id) throw new NotFoundError('Contract', 'CONTRACT_NOT_FOUND');
      await deps.contracts.update(
        id,
        {
          ...(numOrNull(data.area) !== null && { buildingArea: numOrNull(data.area)! }),
          ...(numOrNull(data.floors) !== null && { floors: numOrNull(data.floors)! }),
          ...(numOrNull(data.meterPrice) !== null && { meterPrice: numOrNull(data.meterPrice)! }),
          ...(str(data.notes) !== null && { notes: str(data.notes) }),
        },
        ctx.actor,
      );
      return { entity: 'Contract', entityId: id, operation: 'update' };
    },
  },

  'contract.print': {
    action: 'contract.print',
    kind: 'query',
    description: 'Prepare a contract document for printing (preliminary — surfaced in the contract page). Slots: contractRef.',
    requiredPermissions: ['contracts.generate_docx'],
    requiredSlots: ['contractRef'],
    optionalSlots: [],
    requiresConfirmation: false,
    dangerousLevel: 'none',
    schema: passthrough(),
    runQuery: async (_deps, _ctx, _data, refs) => {
      return {
        preliminary: true,
        contractId: refs.contractId ?? null,
        message: 'طباعة العقد متاحة من صفحة العقد. (سيتم ربطها بمولّد المستندات لاحقاً.)',
      };
    },
  },

  // ===================== PROJECTS =====================
  'project.create': {
    action: 'project.create',
    kind: 'mutation',
    description:
      'Create a project. Links to the just-created contract if one exists, else a standalone/internal project. Slots: name (required), area.',
    requiredPermissions: ['projects.create'],
    requiredSlots: ['name'],
    optionalSlots: ['area', 'notes', 'startDate', 'deliveryDate'],
    requiresConfirmation: true,
    dangerousLevel: 'medium',
    schema: z.object({ name: z.string().trim().min(1) }).passthrough(),
    // Create the project STANDALONE, then LINK it to the freshly-created contract.
    // (Direct create-with-contractId requires an APPROVED contract; linking is the
    // supported path for a DRAFT contract — "linking ≠ approving".)
    runInTx: async (deps, tx, ctx, data, refs) => {
      const created = await deps.projects.createWithinTx(
        tx,
        {
          contractId: null,
          name: reqStr(data.name),
          startDate: dateOrNull(data.startDate),
          deliveryDate: dateOrNull(data.deliveryDate),
          notes: str(data.notes),
        },
        ctx.actor,
      );
      if (refs.contractId) {
        await deps.projects.linkToContractWithinTx(tx, created.id, refs.contractId, ctx.actor);
      }
      refs.projectId = created.id;
      return { entity: 'Project', entityId: created.id, operation: 'create', refKey: 'projectId' };
    },
    runStandalone: async (deps, ctx, data, refs) => {
      const created = await deps.projects.create(
        {
          contractId: null,
          name: reqStr(data.name),
          startDate: dateOrNull(data.startDate),
          deliveryDate: dateOrNull(data.deliveryDate),
          notes: str(data.notes),
        },
        ctx.actor,
      );
      if (refs.contractId) {
        await deps.projects.linkToContract(created.id, refs.contractId, ctx.actor);
      }
      refs.projectId = created.id;
      return { entity: 'Project', entityId: created.id, operation: 'create', refKey: 'projectId' };
    },
  },

  'project.update': {
    action: 'project.update',
    kind: 'mutation',
    description:
      'Update a resolved project. Slots: projectRef, name, progressPercentage, notes, startDate, deliveryDate, area (routes to the linked contract).',
    requiredPermissions: ['projects.update'],
    requiredSlots: ['projectRef'],
    optionalSlots: ['name', 'progressPercentage', 'notes', 'startDate', 'deliveryDate', 'area'],
    requiresConfirmation: true,
    dangerousLevel: 'medium',
    schema: passthrough(),
    runStandalone: async (deps, ctx, data, refs) => {
      const id = refs.projectId;
      if (!id) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');

      const patch = {
        ...(str(data.name) !== null && { name: str(data.name)! }),
        ...(numOrNull(data.progressPercentage) !== null && { progressPercentage: numOrNull(data.progressPercentage)! }),
        ...(str(data.notes) !== null && { notes: str(data.notes) }),
        ...(dateOrNull(data.startDate) !== null && { startDate: dateOrNull(data.startDate) }),
        ...(dateOrNull(data.deliveryDate) !== null && { deliveryDate: dateOrNull(data.deliveryDate) }),
      };
      if (Object.keys(patch).length > 0) {
        await deps.projects.update(id, patch, ctx.actor);
      }

      // "area" lives on the linked contract, not the project — route it there.
      if (numOrNull(data.area) !== null) {
        const project = await deps.projects.getById(id);
        if (!project.contract) {
          throw new ConflictError('المشروع غير مرتبط بعقد، لا يمكن تغيير المساحة', 'PROJECT_HAS_NO_CONTRACT');
        }
        await deps.contracts.update(project.contract.id, { buildingArea: numOrNull(data.area)! }, ctx.actor);
      }
      return { entity: 'Project', entityId: id, operation: 'update' };
    },
  },

  'project.search': {
    action: 'project.search',
    kind: 'query',
    description: 'Search/list projects by name and/or status (paused/completed/cancelled/in_progress/planned). Slots: query/name, status.',
    requiredPermissions: ['projects.read'],
    requiredSlots: [],
    optionalSlots: ['query', 'name', 'status'],
    requiresConfirmation: false,
    dangerousLevel: 'none',
    schema: passthrough(),
    runQuery: async (deps, _ctx, data) => {
      const query = listProjectsQuerySchema.parse({
        search: str(data.query) ?? str(data.name) ?? undefined,
        status: mapProjectStatus(data.status),
      });
      return deps.projects.list(query);
    },
  },

  'project.summary': {
    action: 'project.summary',
    kind: 'query',
    description:
      'Full status summary of a resolved project: client, contract, area, contract value, payments, costs, materials, completion %, remaining, latest activity. Slots: projectRef.',
    requiredPermissions: ['projects.read'],
    requiredSlots: ['projectRef'],
    optionalSlots: [],
    requiresConfirmation: false,
    dangerousLevel: 'none',
    schema: passthrough(),
    runQuery: async (deps, _ctx, _data, refs) => {
      const id = refs.projectId;
      if (!id) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
      const [project, profitability, payments, costs] = await Promise.all([
        deps.projects.getById(id),
        deps.reports.getProjectProfitability(id),
        deps.payments.getProjectSummary(id),
        deps.costs.getProjectSummary(id),
      ]);
      return {
        project: {
          id: project.id,
          name: project.name,
          status: project.status,
          progressPercentage: Number(project.progressPercentage),
          startDate: project.startDate,
          deliveryDate: project.deliveryDate,
          customer: project.contract?.customer ?? null,
          contract: project.contract
            ? { id: project.contract.id, contractNumber: project.contract.contractNumber, totalPrice: profitability.contractValue }
            : null,
        },
        financials: profitability,
        payments,
        costs,
      };
    },
  },

  'project.status.change': {
    action: 'project.status.change',
    kind: 'mutation',
    description: 'Change a resolved project status: start | pause | resume | complete | cancel. Slots: projectRef, status.',
    requiredPermissions: [
      'projects.start',
      'projects.pause',
      'projects.resume',
      'projects.complete',
      'projects.cancel',
    ],
    requiredSlots: ['projectRef', 'status'],
    optionalSlots: [],
    requiresConfirmation: true,
    dangerousLevel: 'medium',
    schema: z.object({ status: z.union([z.string(), z.undefined()]) }).passthrough(),
    runStandalone: async (deps, ctx, data, refs) => {
      const id = refs.projectId;
      if (!id) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
      const change = mapProjectStatusAction(data.status);
      if (!change) throw new ValidationError('حالة غير معروفة', { status: ['unknown'] });
      switch (change) {
        case 'start':
          await deps.projects.start(id, ctx.actor);
          break;
        case 'pause':
          await deps.projects.pause(id, ctx.actor);
          break;
        case 'resume':
          await deps.projects.resume(id, ctx.actor);
          break;
        case 'complete':
          await deps.projects.complete(id, ctx.actor);
          break;
        case 'cancel':
          await deps.projects.cancel(id, { reason: str(data.reason) ?? undefined }, ctx.actor);
          break;
      }
      return { entity: 'Project', entityId: id, operation: 'update' };
    },
  },

  // ===================== PAYMENTS =====================
  'payment.create': {
    action: 'payment.create',
    kind: 'mutation',
    description: 'Record a payment for a resolved project (requires a linked contract). Slots: projectRef, amount (required), dueDate.',
    requiredPermissions: ['payments.create'],
    requiredSlots: ['projectRef', 'amount'],
    optionalSlots: ['dueDate', 'method', 'reference', 'notes'],
    requiresConfirmation: true,
    dangerousLevel: 'medium',
    schema: z.object({ amount: z.union([z.number(), z.string()]) }).passthrough(),
    runInTx: async (deps, tx, ctx, data, refs) => {
      const projectId = refs.projectId;
      if (!projectId) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
      const created = await deps.payments.createWithinTx(
        tx,
        { projectId, amount: reqNum(data.amount), dueDate: dateOrNull(data.dueDate) ?? new Date(), method: null, reference: str(data.reference), notes: str(data.notes) },
        ctx.actor,
      );
      return { entity: 'Payment', entityId: created.id, operation: 'create' };
    },
    runStandalone: async (deps, ctx, data, refs) => {
      const projectId = refs.projectId;
      if (!projectId) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
      const created = await deps.payments.create(
        { projectId, amount: reqNum(data.amount), dueDate: dateOrNull(data.dueDate) ?? new Date(), method: null, reference: str(data.reference), notes: str(data.notes) },
        ctx.actor,
      );
      return { entity: 'Payment', entityId: created.id, operation: 'create' };
    },
  },

  'payment.search': {
    action: 'payment.search',
    kind: 'query',
    description: 'List payments for a resolved project. Slots: projectRef.',
    requiredPermissions: ['payments.read'],
    requiredSlots: ['projectRef'],
    optionalSlots: [],
    requiresConfirmation: false,
    dangerousLevel: 'none',
    schema: passthrough(),
    runQuery: async (deps, _ctx, _data, refs) => {
      const projectId = refs.projectId;
      if (!projectId) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
      return deps.payments.listForProject(projectId, listPaymentsQuerySchema.parse({}));
    },
  },

  'payment.summary': {
    action: 'payment.summary',
    kind: 'query',
    description: 'Payment summary (paid, remaining, collection %) for a resolved project. Slots: projectRef.',
    requiredPermissions: ['payments.read'],
    requiredSlots: ['projectRef'],
    optionalSlots: [],
    requiresConfirmation: false,
    dangerousLevel: 'none',
    schema: passthrough(),
    runQuery: async (deps, _ctx, _data, refs) => {
      const projectId = refs.projectId;
      if (!projectId) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
      return deps.payments.getProjectSummary(projectId);
    },
  },

  'payment.mark_paid': {
    action: 'payment.mark_paid',
    kind: 'mutation',
    description: 'Mark the resolved payment (most-recent, optionally per project) as PAID. Slots: projectRef, paymentDate.',
    requiredPermissions: ['payments.mark_paid'],
    requiredSlots: [],
    optionalSlots: ['projectRef', 'paymentDate'],
    requiresConfirmation: true,
    dangerousLevel: 'medium',
    schema: passthrough(),
    runStandalone: async (deps, ctx, data, refs) => {
      const id = refs.paymentId;
      if (!id) throw new NotFoundError('Payment', 'PAYMENT_NOT_FOUND');
      await deps.payments.markPaid(id, { paymentDate: dateOrNull(data.paymentDate) ?? new Date() }, ctx.actor);
      return { entity: 'Payment', entityId: id, operation: 'update' };
    },
  },

  'payment.cancel': {
    action: 'payment.cancel',
    kind: 'mutation',
    description: 'Cancel the resolved payment (most-recent, optionally per project). Slots: projectRef.',
    requiredPermissions: ['payments.cancel'],
    requiredSlots: [],
    optionalSlots: ['projectRef', 'reason'],
    requiresConfirmation: true,
    dangerousLevel: 'medium',
    schema: passthrough(),
    runStandalone: async (deps, ctx, data, refs) => {
      const id = refs.paymentId;
      if (!id) throw new NotFoundError('Payment', 'PAYMENT_NOT_FOUND');
      await deps.payments.cancel(id, { reason: str(data.reason) ?? undefined }, ctx.actor);
      return { entity: 'Payment', entityId: id, operation: 'update' };
    },
  },

  // ===================== EXPENSES (module: costs) =====================
  'expense.create': {
    action: 'expense.create',
    kind: 'mutation',
    description: 'Add an expense/cost to a resolved project. Slots: projectRef, amount (required), description, category, date.',
    requiredPermissions: ['costs.create'],
    requiredSlots: ['projectRef', 'amount'],
    optionalSlots: ['description', 'category', 'date'],
    requiresConfirmation: true,
    dangerousLevel: 'medium',
    schema: z.object({ amount: z.union([z.number(), z.string()]) }).passthrough(),
    runInTx: async (deps, tx, ctx, data, refs) => {
      const projectId = refs.projectId;
      if (!projectId) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
      const created = await deps.costs.createWithinTx(
        tx,
        {
          projectId,
          category: mapCostCategory(data.category),
          materialId: null,
          description: str(data.description) ?? 'مصروف',
          quantity: null,
          unit: null,
          unitPrice: null,
          totalAmount: reqNum(data.amount),
          date: dateOrNull(data.date) ?? new Date(),
          notes: str(data.notes),
        },
        ctx.actor,
      );
      return { entity: 'ProjectCost', entityId: created.id, operation: 'create' };
    },
    runStandalone: async (deps, ctx, data, refs) => {
      const projectId = refs.projectId;
      if (!projectId) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
      const created = await deps.costs.create(
        {
          projectId,
          category: mapCostCategory(data.category),
          materialId: null,
          description: str(data.description) ?? 'مصروف',
          quantity: null,
          unit: null,
          unitPrice: null,
          totalAmount: reqNum(data.amount),
          date: dateOrNull(data.date) ?? new Date(),
          notes: str(data.notes),
        },
        ctx.actor,
      );
      return { entity: 'ProjectCost', entityId: created.id, operation: 'create' };
    },
  },

  'expense.search': {
    action: 'expense.search',
    kind: 'query',
    description: 'List expenses for a resolved project. Slots: projectRef.',
    requiredPermissions: ['costs.read'],
    requiredSlots: ['projectRef'],
    optionalSlots: [],
    requiresConfirmation: false,
    dangerousLevel: 'none',
    schema: passthrough(),
    runQuery: async (deps, _ctx, _data, refs) => {
      const projectId = refs.projectId;
      if (!projectId) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
      return deps.costs.listForProject(projectId, listCostsQuerySchema.parse({}));
    },
  },

  'expense.summary': {
    action: 'expense.summary',
    kind: 'query',
    description: 'Expense summary by category for a resolved project. Slots: projectRef.',
    requiredPermissions: ['costs.read'],
    requiredSlots: ['projectRef'],
    optionalSlots: [],
    requiresConfirmation: false,
    dangerousLevel: 'none',
    schema: passthrough(),
    runQuery: async (deps, _ctx, _data, refs) => {
      const projectId = refs.projectId;
      if (!projectId) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
      return deps.costs.getProjectSummary(projectId);
    },
  },

  'expense.delete': {
    action: 'expense.delete',
    kind: 'mutation',
    description: 'Delete the resolved (most-recent) expense/cost — "احذف آخر مصروف". Slots: projectRef.',
    requiredPermissions: ['costs.delete'],
    requiredSlots: [],
    optionalSlots: ['projectRef'],
    requiresConfirmation: true,
    dangerousLevel: 'medium',
    schema: passthrough(),
    runStandalone: async (deps, ctx, _data, refs) => {
      const id = refs.costId;
      if (!id) throw new NotFoundError('Cost', 'COST_NOT_FOUND');
      await deps.costs.softDelete(id, ctx.actor);
      return { entity: 'ProjectCost', entityId: id, operation: 'delete' };
    },
  },

  // ===================== MATERIALS =====================
  'material.create': {
    action: 'material.create',
    kind: 'mutation',
    description: 'Create a material in the catalog. Slots: name (required), unit, defaultPrice.',
    requiredPermissions: ['materials.create'],
    requiredSlots: ['name'],
    optionalSlots: ['unit', 'defaultPrice'],
    requiresConfirmation: true,
    dangerousLevel: 'low',
    schema: z.object({ name: z.string().trim().min(1) }).passthrough(),
    runInTx: async (deps, tx, ctx, data, refs) => {
      const created = await deps.materials.createWithinTx(
        tx,
        { name: reqStr(data.name), unit: str(data.unit) ?? 'وحدة', defaultPrice: numOrNull(data.defaultPrice), notes: str(data.notes), isActive: true },
        ctx.actor,
      );
      refs.materialId = created.id;
      return { entity: 'Material', entityId: created.id, operation: 'create', refKey: 'materialId' };
    },
    runStandalone: async (deps, ctx, data, refs) => {
      const created = await deps.materials.create(
        { name: reqStr(data.name), unit: str(data.unit) ?? 'وحدة', defaultPrice: numOrNull(data.defaultPrice), notes: str(data.notes), isActive: true },
        ctx.actor,
      );
      refs.materialId = created.id;
      return { entity: 'Material', entityId: created.id, operation: 'create', refKey: 'materialId' };
    },
  },

  'material.search': {
    action: 'material.search',
    kind: 'query',
    description: 'Search the material catalog. Slots: query/name.',
    requiredPermissions: ['materials.read'],
    requiredSlots: [],
    optionalSlots: ['query', 'name'],
    requiresConfirmation: false,
    dangerousLevel: 'none',
    schema: passthrough(),
    runQuery: async (deps, _ctx, data) => {
      const query = listMaterialsQuerySchema.parse({ search: str(data.query) ?? str(data.name) ?? undefined });
      return deps.materials.list(query);
    },
  },

  'material.assign_to_project': {
    action: 'material.assign_to_project',
    kind: 'mutation',
    description: 'Assign a resolved material to a resolved project as a MATERIAL cost. Slots: projectRef, materialRef, quantity, unitPrice.',
    requiredPermissions: ['costs.create'],
    requiredSlots: ['projectRef', 'materialRef'],
    optionalSlots: ['quantity', 'unitPrice', 'totalAmount'],
    requiresConfirmation: true,
    dangerousLevel: 'medium',
    schema: passthrough(),
    runStandalone: async (deps, ctx, data, refs) => {
      const projectId = refs.projectId;
      const materialId = refs.materialId;
      if (!projectId) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
      if (!materialId) throw new NotFoundError('Material', 'MATERIAL_NOT_FOUND');
      const quantity = numOrNull(data.quantity);
      const unitPrice = numOrNull(data.unitPrice);
      const totalAmount = numOrNull(data.totalAmount);
      const created = await deps.costs.create(
        {
          projectId,
          category: CostCategory.MATERIAL,
          materialId,
          description: str(data.description) ?? 'مادة',
          quantity,
          unit: str(data.unit),
          unitPrice,
          totalAmount: quantity !== null && unitPrice !== null ? undefined : totalAmount ?? 0,
          date: dateOrNull(data.date) ?? new Date(),
          notes: str(data.notes),
        },
        ctx.actor,
      );
      return { entity: 'ProjectCost', entityId: created.id, operation: 'create' };
    },
  },

  // ===================== REPORTS / SMART QUERIES =====================
  'report.generate': {
    action: 'report.generate',
    kind: 'query',
    description: 'Dashboard snapshot (active/delayed projects, overdue payments, monthly revenue/costs/profit). Slots: none.',
    requiredPermissions: ['reports.read'],
    requiredSlots: [],
    optionalSlots: ['type'],
    requiresConfirmation: false,
    dangerousLevel: 'none',
    schema: passthrough(),
    runQuery: async (deps) => deps.reports.getDashboard(),
  },

  'report.dashboard': {
    action: 'report.dashboard',
    kind: 'query',
    description: 'Overview + monthly profit/revenue/costs (alias of report.generate). Slots: none.',
    requiredPermissions: ['reports.read'],
    requiredSlots: [],
    optionalSlots: [],
    requiresConfirmation: false,
    dangerousLevel: 'none',
    schema: passthrough(),
    runQuery: async (deps) => deps.reports.getDashboard(),
  },

  'report.overdue_payments': {
    action: 'report.overdue_payments',
    kind: 'query',
    description: 'Overdue payments grouped by project/customer — "العملاء المتأخرين بالدفع", "أكثر عميل متأخر". Slots: none.',
    requiredPermissions: ['reports.read'],
    requiredSlots: [],
    optionalSlots: [],
    requiresConfirmation: false,
    dangerousLevel: 'none',
    schema: passthrough(),
    runQuery: async (deps) => deps.reports.getOverduePayments(overduePaymentsQuerySchema.parse({})),
  },

  'report.delayed_projects': {
    action: 'report.delayed_projects',
    kind: 'query',
    description: 'Projects past their delivery date — "المشاريع المتأخرة". Slots: none.',
    requiredPermissions: ['reports.read'],
    requiredSlots: [],
    optionalSlots: [],
    requiresConfirmation: false,
    dangerousLevel: 'none',
    schema: passthrough(),
    runQuery: async (deps) => deps.reports.getDelayedProjects(delayedProjectsQuerySchema.parse({})),
  },

  'report.cash_flow': {
    action: 'report.cash_flow',
    kind: 'query',
    description: 'Cash flow (revenue, collected, outstanding, costs, net) over an optional date range. Slots: dateFrom, dateTo.',
    requiredPermissions: ['reports.read'],
    requiredSlots: [],
    optionalSlots: ['dateFrom', 'dateTo'],
    requiresConfirmation: false,
    dangerousLevel: 'none',
    schema: passthrough(),
    runQuery: async (deps, _ctx, data) =>
      deps.reports.getCashFlow(
        cashFlowQuerySchema.parse({ dateFrom: dateOrNull(data.dateFrom) ?? undefined, dateTo: dateOrNull(data.dateTo) ?? undefined }),
      ),
  },

  'report.profitability': {
    action: 'report.profitability',
    kind: 'query',
    description: 'Per-project profitability (contract value, costs, paid, profit). Slots: none.',
    requiredPermissions: ['reports.read'],
    requiredSlots: [],
    optionalSlots: [],
    requiresConfirmation: false,
    dangerousLevel: 'none',
    schema: passthrough(),
    runQuery: async (deps) => deps.reports.listProjectProfitability(listProjectProfitabilityQuerySchema.parse({})),
  },

  'report.health': {
    action: 'report.health',
    kind: 'query',
    description: 'Health / contradiction check: delayed projects + overdue payments + loss-making projects (costs > contract value). Slots: none.',
    requiredPermissions: ['reports.read'],
    requiredSlots: [],
    optionalSlots: [],
    requiresConfirmation: false,
    dangerousLevel: 'none',
    schema: passthrough(),
    runQuery: async (deps) => {
      const [delayed, overdue, profitability] = await Promise.all([
        deps.reports.getDelayedProjects(delayedProjectsQuerySchema.parse({})),
        deps.reports.getOverduePayments(overduePaymentsQuerySchema.parse({})),
        deps.reports.listProjectProfitability(listProjectProfitabilityQuerySchema.parse({})),
      ]);
      const lossMaking = profitability.items.filter((p) => p.profit !== null && Number(p.profit) < 0);
      return {
        delayedProjects: delayed,
        overduePayments: overdue,
        lossMakingProjects: lossMaking,
        issueCount: delayed.length + overdue.length + lossMaking.length,
      };
    },
  },

  // ===================== USERS (preliminary) =====================
  'user.create': {
    action: 'user.create',
    kind: 'mutation',
    description: 'Create a user (preliminary). Slots: username, password, fullName, roleName.',
    requiredPermissions: ['users.create'],
    requiredSlots: ['username', 'password', 'fullName', 'roleName'],
    optionalSlots: ['email', 'phone'],
    requiresConfirmation: true,
    dangerousLevel: 'high',
    schema: passthrough(),
    runStandalone: async (deps, ctx, data) => {
      const created = await deps.users.create(
        {
          username: reqStr(data.username),
          password: reqStr(data.password),
          fullName: reqStr(data.fullName),
          email: str(data.email),
          phone: str(data.phone),
          roleName: reqStr(data.roleName),
          isActive: true,
        },
        acting(ctx),
      );
      return { entity: 'User', entityId: created.id, operation: 'create' };
    },
  },

  'user.disable': {
    action: 'user.disable',
    kind: 'mutation',
    description: 'Disable a user by id (preliminary). Slots: userId.',
    requiredPermissions: ['users.activate'],
    requiredSlots: ['userId'],
    optionalSlots: [],
    requiresConfirmation: true,
    dangerousLevel: 'high',
    schema: passthrough(),
    runStandalone: async (deps, ctx, data) => {
      const updated = await deps.users.setActive(reqStr(data.userId), false, acting(ctx));
      return { entity: 'User', entityId: updated.id, operation: 'update' };
    },
  },

  'user.update': {
    action: 'user.update',
    kind: 'mutation',
    description: 'Update a user by id (preliminary). Slots: userId, fullName, email, phone, roleName, isActive.',
    requiredPermissions: ['users.update'],
    requiredSlots: ['userId'],
    optionalSlots: ['fullName', 'email', 'phone', 'roleName', 'isActive'],
    requiresConfirmation: true,
    dangerousLevel: 'high',
    schema: passthrough(),
    runStandalone: async (deps, ctx, data) => {
      const updated = await deps.users.update(
        reqStr(data.userId),
        {
          ...(str(data.fullName) !== null && { fullName: str(data.fullName)! }),
          ...(str(data.email) !== null && { email: str(data.email) }),
          ...(str(data.phone) !== null && { phone: str(data.phone) }),
          ...(str(data.roleName) !== null && { roleName: str(data.roleName)! }),
          ...(typeof data.isActive === 'boolean' && { isActive: data.isActive }),
        } as UpdateUserInput,
        acting(ctx),
      );
      return { entity: 'User', entityId: updated.id, operation: 'update' };
    },
  },

  // ===================== ROLES (preliminary) =====================
  'role.create': {
    action: 'role.create',
    kind: 'mutation',
    description: 'Create a role (preliminary). Slots: name, displayName.',
    requiredPermissions: ['rbac.manage'],
    requiredSlots: ['name', 'displayName'],
    optionalSlots: ['description'],
    requiresConfirmation: true,
    dangerousLevel: 'high',
    schema: passthrough(),
    runStandalone: async (deps, ctx, data) => {
      const created = await deps.rbac.createRole(
        { name: reqStr(data.name), displayName: reqStr(data.displayName), description: str(data.description) },
        ctx.actor,
      );
      return { entity: 'Role', entityId: created.id, operation: 'create' };
    },
  },

  'role.update': {
    action: 'role.update',
    kind: 'mutation',
    description: 'Update a role by id (preliminary). Slots: roleId, displayName, description, isActive.',
    requiredPermissions: ['rbac.manage'],
    requiredSlots: ['roleId'],
    optionalSlots: ['displayName', 'description', 'isActive'],
    requiresConfirmation: true,
    dangerousLevel: 'high',
    schema: passthrough(),
    runStandalone: async (deps, ctx, data) => {
      const updated = await deps.rbac.updateRole(
        reqStr(data.roleId),
        {
          ...(str(data.displayName) !== null && { displayName: str(data.displayName)! }),
          ...(str(data.description) !== null && { description: str(data.description) }),
          ...(typeof data.isActive === 'boolean' && { isActive: data.isActive }),
        } as UpdateRoleInput,
        ctx.actor,
      );
      return { entity: 'Role', entityId: updated.id, operation: 'update' };
    },
  },

  'role.assign_permissions': {
    action: 'role.assign_permissions',
    kind: 'mutation',
    description: 'Replace a role\'s permission set by id (preliminary). Slots: roleId, permissions[].',
    requiredPermissions: ['rbac.manage'],
    requiredSlots: ['roleId', 'permissions'],
    optionalSlots: [],
    requiresConfirmation: true,
    dangerousLevel: 'high',
    schema: passthrough(),
    runStandalone: async (deps, ctx, data) => {
      const permissions = Array.isArray(data.permissions) ? data.permissions.map((p) => String(p)) : [];
      await deps.rbac.setRolePermissions(reqStr(data.roleId), { permissions }, ctx.actor);
      return { entity: 'Role', entityId: reqStr(data.roleId), operation: 'update' };
    },
  },

  // ===================== SETTINGS (preliminary) =====================
  'settings.currency.update': {
    action: 'settings.currency.update',
    kind: 'mutation',
    description: 'Update a currency by id, or set it as default (preliminary). Slots: currencyId, setDefault, name, symbol.',
    requiredPermissions: ['settings.currency.manage'],
    requiredSlots: ['currencyId'],
    optionalSlots: ['setDefault', 'name', 'symbol', 'symbolPosition'],
    requiresConfirmation: true,
    dangerousLevel: 'medium',
    schema: passthrough(),
    runStandalone: async (deps, ctx, data) => {
      const id = reqStr(data.currencyId);
      if (data.setDefault === true) {
        await deps.settings.setDefaultCurrency(id, ctx.actor);
      } else {
        await deps.settings.updateCurrency(
          id,
          { ...(str(data.name) !== null && { name: str(data.name)! }), ...(str(data.symbol) !== null && { symbol: str(data.symbol)! }) },
          ctx.actor,
        );
      }
      return { entity: 'Currency', entityId: id, operation: 'update' };
    },
  },

  'settings.company.update': {
    action: 'settings.company.update',
    kind: 'mutation',
    description: 'Update company profile fields (preliminary). Slots: companyName, phone, email, address, taxNumber.',
    requiredPermissions: ['settings.company.manage'],
    requiredSlots: [],
    optionalSlots: ['companyName', 'phone', 'email', 'address', 'taxNumber'],
    requiresConfirmation: true,
    dangerousLevel: 'medium',
    schema: passthrough(),
    runStandalone: async (deps, ctx, data) => {
      await deps.settings.updateCompany(
        {
          ...(str(data.companyName) !== null && { companyName: str(data.companyName)! }),
          ...(str(data.phone) !== null && { phone: str(data.phone) }),
          ...(str(data.email) !== null && { email: str(data.email) }),
          ...(str(data.address) !== null && { address: str(data.address) }),
          ...(str(data.taxNumber) !== null && { taxNumber: str(data.taxNumber) }),
        } as UpdateCompanyProfileInput,
        ctx.actor,
      );
      return { entity: 'CompanyProfile', entityId: 'default', operation: 'update' };
    },
  },

  'settings.contract_printing.update': {
    action: 'settings.contract_printing.update',
    kind: 'mutation',
    description: 'Update general/contract-printing settings (preliminary). Slots: appName, dateFormat, defaultLocale.',
    requiredPermissions: ['settings.manage'],
    requiredSlots: [],
    optionalSlots: ['appName', 'dateFormat', 'defaultLocale'],
    requiresConfirmation: true,
    dangerousLevel: 'low',
    schema: passthrough(),
    runStandalone: async (deps, ctx, data) => {
      await deps.settings.updateGeneral(
        {
          ...(str(data.appName) !== null && { appName: str(data.appName)! }),
          ...(str(data.dateFormat) !== null && { dateFormat: str(data.dateFormat)! }),
          ...((data.defaultLocale === 'ar' || data.defaultLocale === 'en') && { defaultLocale: data.defaultLocale }),
        },
        ctx.actor,
      );
      return { entity: 'SystemSetting', entityId: 'general', operation: 'update' };
    },
  },
};

export function getAction(name: string): ActionDef | undefined {
  return ACTIONS[name];
}

export function isRegisteredAction(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ACTIONS, name);
}

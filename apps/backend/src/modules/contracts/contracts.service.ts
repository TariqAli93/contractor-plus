import {
  ContractStatus,
  type BuildingTemplate,
  type BuildingTemplateItem,
  type BuildingTemplateStep,
  type Contract,
  type Material,
  type Prisma,
  type PrismaClient,
  type Project,
} from '@prisma/client';
import { ContractsRepository, type ContractWithRelations } from './contracts.repository.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { ConflictError } from '../../shared/errors/conflict.error.js';
import { ValidationError } from '../../shared/errors/validation.error.js';
import { toJsonValue } from '../../shared/utils/json.js';
import { buildPaginated, toSkipTake } from '../../shared/utils/pagination.js';
import type { Paginated } from '../../shared/types/pagination.js';
import type {
  ApproveContractBody,
  CancelContractBody,
  CreateContractInput,
  CreateProjectFromContractBody,
  ListContractsQuery,
  UpdateContractInput,
} from './contracts.schemas.js';
import type { ContractEstimate } from './contracts.types.js';

const CONTRACT = 'Contract';
const PROJECT = 'Project';
const TEMPLATE_BASELINE_AREA = 100; // m² — templates are conventionally sized for 100m²

// Contract status lifecycle:
//
//   DRAFT  ──/approve──►  APPROVED  ──/create-project──►  Project (status=PLANNED)
//     │                      │
//     └────────── /cancel ───┴───►  CANCELLED  (terminal)
//
// Status changes are ONLY allowed through dedicated action endpoints:
//   POST /:id/approve     — DRAFT → APPROVED
//   POST /:id/cancel      — DRAFT|APPROVED → CANCELLED (rejected if project exists)
//   POST /:id/create-project — keeps APPROVED, creates the Project
//
// PATCH /:id never touches status. DELETE is soft-delete, distinct from cancellation.

export class ContractsService {
  private readonly repo: ContractsRepository;
  private readonly audit: AuditService;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new ContractsRepository(prisma);
    this.audit = new AuditService(prisma);
  }

  // ---------- CRUD ----------

  async list(query: ListContractsQuery): Promise<Paginated<Contract>> {
    const { skip, take } = toSkipTake(query);
    const [items, total] = await Promise.all([
      this.repo.findMany({
        search: query.search,
        status: query.status,
        customerId: query.customerId,
        includeDeleted: query.includeDeleted,
        skip,
        take,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      }),
      this.repo.count({
        search: query.search,
        status: query.status,
        customerId: query.customerId,
        includeDeleted: query.includeDeleted,
      }),
    ]);
    return buildPaginated(items, total, query);
  }

  async getById(id: string): Promise<ContractWithRelations> {
    const contract = await this.repo.findByIdWithRelations(id);
    if (!contract) throw new NotFoundError('Contract', 'CONTRACT_NOT_FOUND');
    return contract;
  }

  async create(data: CreateContractInput, actor: AuditActor): Promise<Contract> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCustomerExists(tx, data.customerId);
      if (data.templateId) await this.assertTemplateExists(tx, data.templateId);
      if (await this.repo.existsByContractNumber(data.contractNumber, undefined, tx)) {
        throw new ConflictError(
          `Contract number "${data.contractNumber}" already exists`,
          'CONTRACT_NUMBER_TAKEN',
        );
      }

      const totalPrice = round2(data.buildingArea * data.floors * data.meterPrice);

      const created = await this.repo.create(
        {
          contractNumber: data.contractNumber,
          customerId: data.customerId,
          templateId: data.templateId,
          buildingArea: data.buildingArea,
          floors: data.floors,
          meterPrice: data.meterPrice,
          totalPrice,
          expectedProfitMargin: data.expectedProfitMargin,
          notes: data.notes,
          status: ContractStatus.DRAFT,
        },
        tx,
      );

      await this.audit.log(
        actor,
        { action: 'CREATE', entity: CONTRACT, entityId: created.id, newValues: toJsonValue(created) },
        tx,
      );
      return created;
    });
  }

  async update(
    id: string,
    data: UpdateContractInput,
    actor: AuditActor,
  ): Promise<Contract> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError('Contract', 'CONTRACT_NOT_FOUND');

      if (existing.status !== ContractStatus.DRAFT && this.touchesFinancials(data)) {
        throw new ConflictError(
          'Cannot modify financial fields after contract is approved',
          'CONTRACT_LOCKED',
        );
      }

      if (data.contractNumber && data.contractNumber !== existing.contractNumber) {
        if (await this.repo.existsByContractNumber(data.contractNumber, id, tx)) {
          throw new ConflictError(
            `Contract number "${data.contractNumber}" already exists`,
            'CONTRACT_NUMBER_TAKEN',
          );
        }
      }

      if (data.customerId) await this.assertCustomerExists(tx, data.customerId);
      if (data.templateId) await this.assertTemplateExists(tx, data.templateId);

      const merged = {
        buildingArea: data.buildingArea ?? Number(existing.buildingArea),
        floors: data.floors ?? existing.floors,
        meterPrice: data.meterPrice ?? Number(existing.meterPrice),
      };
      const totalPrice = round2(merged.buildingArea * merged.floors * merged.meterPrice);

      const updated = await this.repo.update(
        id,
        {
          ...(data.contractNumber !== undefined && { contractNumber: data.contractNumber }),
          ...(data.customerId !== undefined && { customerId: data.customerId }),
          ...(data.templateId !== undefined && { templateId: data.templateId }),
          ...(data.buildingArea !== undefined && { buildingArea: data.buildingArea }),
          ...(data.floors !== undefined && { floors: data.floors }),
          ...(data.meterPrice !== undefined && { meterPrice: data.meterPrice }),
          ...(data.expectedProfitMargin !== undefined && {
            expectedProfitMargin: data.expectedProfitMargin,
          }),
          ...(data.notes !== undefined && { notes: data.notes }),
          totalPrice,
        },
        tx,
      );

      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: CONTRACT,
          entityId: id,
          oldValues: toJsonValue(existing),
          newValues: toJsonValue(updated),
        },
        tx,
      );
      return updated;
    });
  }

  async softDelete(id: string, actor: AuditActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError('Contract', 'CONTRACT_NOT_FOUND');

      if (await this.repo.hasProject(id, tx)) {
        throw new ConflictError(
          'Cannot delete a contract that has a project',
          'CONTRACT_HAS_PROJECT',
        );
      }

      await this.repo.softDelete(id, tx);
      await this.audit.log(
        actor,
        { action: 'DELETE', entity: CONTRACT, entityId: id, oldValues: toJsonValue(existing) },
        tx,
      );
    });
  }

  // ---------- Generate estimate ----------

  async generateEstimate(id: string, actor: AuditActor): Promise<ContractEstimate> {
    return this.prisma.$transaction(async (tx) => {
      const contract = await this.repo.findById(id, tx);
      if (!contract) throw new NotFoundError('Contract', 'CONTRACT_NOT_FOUND');
      if (contract.status !== ContractStatus.DRAFT) {
        throw new ConflictError(
          'Estimate can only be generated for DRAFT contracts',
          'CONTRACT_NOT_DRAFT',
        );
      }
      if (!contract.templateId) {
        throw new ValidationError('Contract has no template — cannot generate estimate', {
          templateId: ['required'],
        });
      }

      const template = await tx.buildingTemplate.findFirst({
        where: { id: contract.templateId, deletedAt: null },
        include: { items: { include: { material: true } } },
      });
      if (!template) throw new NotFoundError('Template', 'TEMPLATE_NOT_FOUND');

      const buildingArea = Number(contract.buildingArea);
      const floors = contract.floors;
      const scaleFactor = (buildingArea * floors) / TEMPLATE_BASELINE_AREA;

      const newItems = template.items.map((item) => ({
        contractId: contract.id,
        materialId: item.materialId,
        quantity: round3(Number(item.estimatedQuantity) * scaleFactor),
        unit: item.material.unit,
        estimatedPrice: round2(Number(item.estimatedPrice) * scaleFactor),
        notes: item.notes,
      }));

      await this.repo.replaceItems(contract.id, newItems, tx);

      const estimatedMaterialCost = round2(
        newItems.reduce((sum, i) => sum + i.estimatedPrice, 0),
      );

      const margin =
        contract.expectedProfitMargin !== null
          ? Number(contract.expectedProfitMargin)
          : template.suggestedProfitMargin !== null
            ? Number(template.suggestedProfitMargin)
            : null;

      // Adopt template's suggested margin if contract has none yet.
      let marginPersisted = contract.expectedProfitMargin;
      if (contract.expectedProfitMargin === null && template.suggestedProfitMargin !== null) {
        const updated = await this.repo.update(
          contract.id,
          { expectedProfitMargin: template.suggestedProfitMargin },
          tx,
        );
        marginPersisted = updated.expectedProfitMargin;
      }

      const estimatedProfitAmount =
        margin !== null ? round2(estimatedMaterialCost * (margin / 100)) : null;
      const suggestedSellingPrice =
        estimatedProfitAmount !== null
          ? round2(estimatedMaterialCost + estimatedProfitAmount)
          : null;
      const suggestedMeterPrice =
        suggestedSellingPrice !== null && buildingArea > 0 && floors > 0
          ? round2(suggestedSellingPrice / (buildingArea * floors))
          : null;

      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: CONTRACT,
          entityId: contract.id,
          newValues: toJsonValue({
            event: 'estimate_generated',
            itemsReplaced: newItems.length,
            scaleFactor,
            estimatedMaterialCost,
            marginUsed: margin,
          }),
        },
        tx,
      );

      return {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        templateId: template.id,
        templateName: template.name,
        buildingArea,
        floors,
        scaleFactor: round3(scaleFactor),
        estimatedMaterialCost,
        expectedProfitMargin: marginPersisted !== null ? Number(marginPersisted) : margin,
        estimatedProfitAmount,
        suggestedSellingPrice,
        suggestedMeterPrice,
        currentTotalPrice: Number(contract.totalPrice),
        currentMeterPrice: Number(contract.meterPrice),
        itemsReplaced: newItems.length,
      };
    });
  }

  // ---------- Approve ----------

  async approve(
    id: string,
    body: ApproveContractBody,
    actor: AuditActor,
  ): Promise<Contract> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError('Contract', 'CONTRACT_NOT_FOUND');
      if (existing.status !== ContractStatus.DRAFT) {
        throw new ConflictError(
          `Cannot approve contract in status ${existing.status}`,
          'CONTRACT_NOT_DRAFT',
        );
      }

      const updated = await this.repo.update(
        id,
        {
          status: ContractStatus.APPROVED,
          signedAt: body.signedAt ?? new Date(),
        },
        tx,
      );

      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: CONTRACT,
          entityId: id,
          oldValues: toJsonValue({ status: existing.status, signedAt: existing.signedAt }),
          newValues: toJsonValue({
            event: 'approved',
            status: updated.status,
            signedAt: updated.signedAt,
          }),
        },
        tx,
      );
      return updated;
    });
  }

  // ---------- Cancel ----------

  async cancel(
    id: string,
    body: CancelContractBody,
    actor: AuditActor,
  ): Promise<Contract> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError('Contract', 'CONTRACT_NOT_FOUND');

      if (
        existing.status !== ContractStatus.DRAFT &&
        existing.status !== ContractStatus.APPROVED
      ) {
        throw new ConflictError(
          `Cannot cancel contract in status ${existing.status}`,
          'CONTRACT_NOT_CANCELLABLE',
        );
      }
      if (await this.repo.hasProject(id, tx)) {
        throw new ConflictError(
          'Cannot cancel a contract that has a project',
          'CONTRACT_HAS_PROJECT',
        );
      }

      const previousStatus = existing.status;
      const updated = await this.repo.update(id, { status: ContractStatus.CANCELLED }, tx);

      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: CONTRACT,
          entityId: id,
          oldValues: toJsonValue({ status: previousStatus }),
          newValues: toJsonValue({
            event: 'cancelled',
            reason: body.reason ?? null,
            previousStatus,
          }),
        },
        tx,
      );
      return updated;
    });
  }

  // ---------- Create project ----------

  async createProject(
    id: string,
    body: CreateProjectFromContractBody,
    actor: AuditActor,
  ): Promise<Project> {
    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.findFirst({
        where: { id, deletedAt: null },
        include: {
          template: { include: { steps: { orderBy: { sortOrder: 'asc' } } } },
        },
      });
      if (!contract) throw new NotFoundError('Contract', 'CONTRACT_NOT_FOUND');
      if (contract.status !== ContractStatus.APPROVED) {
        throw new ConflictError(
          'Project can only be created from an APPROVED contract',
          'CONTRACT_NOT_APPROVED',
        );
      }
      if (await this.repo.hasProject(id, tx)) {
        throw new ConflictError(
          'Project already exists for this contract',
          'PROJECT_ALREADY_EXISTS',
        );
      }

      const startDate = body.startDate ?? null;
      const deliveryDate =
        body.deliveryDate ??
        (startDate && contract.template?.estimatedDurationDays
          ? addDays(startDate, contract.template.estimatedDurationDays)
          : null);

      const project = await tx.project.create({
        data: {
          contractId: contract.id,
          name: body.name ?? `Project ${contract.contractNumber}`,
          startDate,
          deliveryDate,
          notes: body.notes ?? null,
        },
      });

      const templateSteps = contract.template?.steps ?? [];
      if (templateSteps.length > 0) {
        await tx.constructionStep.createMany({
          data: templateSteps.map((s) => ({
            projectId: project.id,
            name: s.name,
            percentage: s.percentage,
            sortOrder: s.sortOrder,
          })),
        });
      }

      await this.audit.log(
        actor,
        {
          action: 'CREATE',
          entity: PROJECT,
          entityId: project.id,
          newValues: toJsonValue({
            project,
            createdFromContract: contract.id,
            copiedStepsFromTemplate: templateSteps.length,
          }),
        },
        tx,
      );

      return project;
    });
  }

  // ---------- Guards ----------

  private async assertCustomerExists(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const c = await tx.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!c) throw new NotFoundError('Customer', 'CUSTOMER_NOT_FOUND');
  }

  private async assertTemplateExists(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const t = await tx.buildingTemplate.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!t) throw new NotFoundError('Template', 'TEMPLATE_NOT_FOUND');
  }

  private touchesFinancials(data: UpdateContractInput): boolean {
    return (
      data.buildingArea !== undefined ||
      data.floors !== undefined ||
      data.meterPrice !== undefined ||
      data.templateId !== undefined ||
      data.expectedProfitMargin !== undefined
    );
  }

}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

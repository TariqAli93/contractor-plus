import {
  ContractStatus,
  ProjectStatus,
  type Prisma,
  type PrismaClient,
  type Project,
} from '@prisma/client';
import { ProjectsRepository, type ProjectWithContract } from './projects.repository.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { ConflictError } from '../../shared/errors/conflict.error.js';
import { toJsonValue } from '../../shared/utils/json.js';
import { buildPaginated, toSkipTake } from '../../shared/utils/pagination.js';
import type { Paginated } from '../../shared/types/pagination.js';
import type {
  CancelProjectBody,
  CreateProjectInput,
  ListProjectsQuery,
  UpdateProjectInput,
} from './projects.schemas.js';

const PROJECT = 'Project';


// Project lifecycle:
//
//   PLANNED ──/start──► IN_PROGRESS ◄──/resume── PAUSED
//                            │   │                 │
//                            │   └──/pause────────►│
//                            │                     │
//                            └──/complete──► COMPLETED   (terminal)
//                            │
//                            └──/cancel─►   CANCELLED    (terminal)
//   PLANNED, PAUSED ─/cancel─►  CANCELLED               (terminal)
//
// Status changes happen ONLY through action endpoints:
//   POST /:id/start     PLANNED            → IN_PROGRESS
//   POST /:id/pause     IN_PROGRESS        → PAUSED
//   POST /:id/resume    PAUSED             → IN_PROGRESS
//   POST /:id/complete  IN_PROGRESS|PAUSED → COMPLETED (sets progress=100)
//   POST /:id/cancel    non-terminal       → CANCELLED
//
// PATCH /:id never touches status. DELETE is soft-delete and is rejected if
// the project already has any cost or payment rows.

export class ProjectsService {
  private readonly repo: ProjectsRepository;
  private readonly audit: AuditService;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new ProjectsRepository(prisma);
    this.audit = new AuditService(prisma);
  }

  // ---------- CRUD ----------

  async list(query: ListProjectsQuery): Promise<Paginated<ProjectWithContract>> {
    const { skip, take } = toSkipTake(query);
    const [items, total] = await Promise.all([
      this.repo.findMany({
        search: query.search,
        status: query.status,
        delayed: query.delayed,
        contractId: query.contractId,
        includeDeleted: query.includeDeleted,
        skip,
        take,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      }),
      this.repo.count({
        search: query.search,
        status: query.status,
        delayed: query.delayed,
        contractId: query.contractId,
        includeDeleted: query.includeDeleted,
      }),
    ]);
    return buildPaginated(items, total, query);
  }

  async getById(id: string): Promise<ProjectWithContract> {
    const project = await this.repo.findByIdWithContract(id);
    if (!project) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
    return project;
  }

  async create(data: CreateProjectInput, actor: AuditActor): Promise<Project> {
    return this.prisma.$transaction((tx) => this.createWithinTx(tx, data, actor));
  }

  /** Tx-aware create — lets a caller compose project creation with
   *  a customer + contract in a single all-or-nothing transaction. */
  async createWithinTx(
    tx: Prisma.TransactionClient,
    data: CreateProjectInput,
    actor: AuditActor,
  ): Promise<Project> {
    if (data.contractId) {
      await this.assertContractEligible(tx, data.contractId);
      if (await this.repo.existsByContractId(data.contractId, undefined, tx)) {
        throw new ConflictError(
          'A project already exists for this contract',
          'PROJECT_ALREADY_EXISTS',
        );
      }
    }

    const created = await this.repo.create(
      {
        contractId: data.contractId,
        name: data.name,
        startDate: data.startDate,
        deliveryDate: data.deliveryDate,
        notes: data.notes,
        status: ProjectStatus.PLANNED,
      },
      tx,
    );

    await this.audit.log(
      actor,
      { action: 'CREATE', entity: PROJECT, entityId: created.id, newValues: toJsonValue(created) },
      tx,
    );
    return created;
  }

  // ---------- Link to contract ----------
  //
  // Links an EXISTING standalone project to a contract (distinct from
  // `ContractsService.createProject`, which CREATES a project from an APPROVED
  // contract). Used by the voice `link_project_to_contract` command so a
  // voice-created standalone project can later gain a contract (and thus accept
  // payments). Guards against duplicate/conflicting links (one project ↔ one
  // contract, enforced here and by the DB @unique). A CANCELLED contract is
  // rejected; DRAFT/APPROVED are allowed (linking ≠ approving).

  async linkToContract(projectId: string, contractId: string, actor: AuditActor): Promise<Project> {
    return this.prisma.$transaction((tx) =>
      this.linkToContractWithinTx(tx, projectId, contractId, actor),
    );
  }

  async linkToContractWithinTx(
    tx: Prisma.TransactionClient,
    projectId: string,
    contractId: string,
    actor: AuditActor,
  ): Promise<Project> {
    const project = await this.repo.findById(projectId, tx);
    if (!project) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
    if (project.contractId) {
      throw new ConflictError(
        project.contractId === contractId
          ? 'Project is already linked to this contract'
          : 'Project is already linked to another contract',
        'PROJECT_ALREADY_LINKED',
      );
    }

    const contract = await tx.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true, status: true, contractNumber: true },
    });
    if (!contract) throw new NotFoundError('Contract', 'CONTRACT_NOT_FOUND');
    if (contract.status === ContractStatus.CANCELLED) {
      throw new ConflictError('Cannot link to a cancelled contract', 'CONTRACT_CANCELLED');
    }
    if (await this.repo.existsByContractId(contractId, undefined, tx)) {
      throw new ConflictError('Contract already has a linked project', 'CONTRACT_HAS_PROJECT');
    }

    const updated = await this.repo.update(
      projectId,
      { contract: { connect: { id: contractId } } },
      tx,
    );
    await this.audit.log(
      actor,
      {
        action: 'UPDATE',
        entity: PROJECT,
        entityId: projectId,
        oldValues: toJsonValue({ contractId: null }),
        newValues: toJsonValue({
          event: 'linked_to_contract',
          contractId,
          contractNumber: contract.contractNumber,
        }),
      },
      tx,
    );
    return updated;
  }

  // ---------- Unlink from contract (safe) ----------
  //
  // Audit prompt 10: safely detach a project from its contract WITHOUT deleting
  // the project, contract, costs or payments. The contract simply becomes
  // "unlinked" (project.contractId → null). A reason is required and recorded in
  // the audit log; the route restricts this to OWNER/ADMIN.
  async unlinkFromContract(
    projectId: string,
    reason: string,
    actor: AuditActor,
  ): Promise<Project> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(projectId, tx);
      if (!existing) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
      if (!existing.contractId) {
        throw new ConflictError(
          'Project is not linked to a contract',
          'PROJECT_NOT_LINKED',
        );
      }

      const previousContractId = existing.contractId;
      const updated = await this.repo.update(
        projectId,
        { contract: { disconnect: true } },
        tx,
      );
      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: PROJECT,
          entityId: projectId,
          oldValues: toJsonValue({ contractId: previousContractId }),
          newValues: toJsonValue({
            event: 'unlinked_from_contract',
            reason,
            previousContractId,
          }),
        },
        tx,
      );
      return updated;
    });
  }

  async update(
    id: string,
    data: UpdateProjectInput,
    actor: AuditActor,
  ): Promise<Project> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
      if (this.isTerminal(existing.status)) {
        throw new ConflictError(
          `Cannot edit a project in terminal status ${existing.status}`,
          'PROJECT_TERMINAL',
        );
      }

      const updated = await this.repo.update(id, data, tx);
      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: PROJECT,
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
      if (!existing) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');

      if (await this.repo.hasCostsOrPayments(id, tx)) {
        throw new ConflictError(
          'Cannot delete a project that has costs or payments',
          'PROJECT_HAS_FINANCIAL_RECORDS',
        );
      }

      await this.repo.softDelete(id, tx);
      await this.audit.log(
        actor,
        { action: 'DELETE', entity: PROJECT, entityId: id, oldValues: toJsonValue(existing) },
        tx,
      );
    });
  }

  // ---------- Actions ----------

  async start(id: string, actor: AuditActor): Promise<Project> {
    return this.transition(id, actor, 'started', (existing) => {
      if (existing.status !== ProjectStatus.PLANNED) {
        throw new ConflictError(
          `Cannot start project in status ${existing.status}`,
          'PROJECT_NOT_STARTABLE',
        );
      }
      return {
        status: ProjectStatus.IN_PROGRESS,
        ...(existing.startDate === null && { startDate: new Date() }),
      };
    });
  }

  async pause(id: string, actor: AuditActor): Promise<Project> {
    return this.transition(id, actor, 'paused', (existing) => {
      if (existing.status !== ProjectStatus.IN_PROGRESS) {
        throw new ConflictError(
          `Cannot pause project in status ${existing.status}`,
          'PROJECT_NOT_PAUSABLE',
        );
      }
      return { status: ProjectStatus.PAUSED };
    });
  }

  async resume(id: string, actor: AuditActor): Promise<Project> {
    return this.transition(id, actor, 'resumed', (existing) => {
      if (existing.status !== ProjectStatus.PAUSED) {
        throw new ConflictError(
          `Cannot resume project in status ${existing.status}`,
          'PROJECT_NOT_RESUMABLE',
        );
      }
      return { status: ProjectStatus.IN_PROGRESS };
    });
  }

  async complete(id: string, actor: AuditActor): Promise<Project> {
    return this.transition(id, actor, 'completed', (existing) => {
      if (
        existing.status !== ProjectStatus.IN_PROGRESS &&
        existing.status !== ProjectStatus.PAUSED
      ) {
        throw new ConflictError(
          `Cannot complete project in status ${existing.status}`,
          'PROJECT_NOT_COMPLETABLE',
        );
      }
      return { status: ProjectStatus.COMPLETED, progressPercentage: 100 };
    });
  }

  async cancel(id: string, body: CancelProjectBody, actor: AuditActor): Promise<Project> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
      if (this.isTerminal(existing.status)) {
        throw new ConflictError(
          `Cannot cancel project in status ${existing.status}`,
          'PROJECT_NOT_CANCELLABLE',
        );
      }

      const previousStatus = existing.status;
      const updated = await this.repo.update(id, { status: ProjectStatus.CANCELLED }, tx);

      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: PROJECT,
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

  // ---------- Helpers ----------

  private async transition(
    id: string,
    actor: AuditActor,
    event: 'started' | 'paused' | 'resumed' | 'completed',
    decide: (existing: Project) => Prisma.ProjectUpdateInput,
  ): Promise<Project> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');

      const patch = decide(existing);
      const updated = await this.repo.update(id, patch, tx);

      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: PROJECT,
          entityId: id,
          oldValues: toJsonValue({
            status: existing.status,
            startDate: existing.startDate,
            progressPercentage: existing.progressPercentage,
          }),
          newValues: toJsonValue({
            event,
            status: updated.status,
            startDate: updated.startDate,
            progressPercentage: updated.progressPercentage,
            previousStatus: existing.status,
          }),
        },
        tx,
      );
      return updated;
    });
  }

  private isTerminal(status: ProjectStatus): boolean {
    return status === ProjectStatus.COMPLETED || status === ProjectStatus.CANCELLED;
  }

  private async assertContractEligible(
    tx: Prisma.TransactionClient,
    contractId: string,
  ): Promise<void> {
    const contract = await tx.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!contract) throw new NotFoundError('Contract', 'CONTRACT_NOT_FOUND');
    if (contract.status !== ContractStatus.APPROVED) {
      throw new ConflictError(
        'Project can only be linked to an APPROVED contract',
        'CONTRACT_NOT_APPROVED',
      );
    }
  }
}

// ============================================================
// Repository — durable AiCommandLog audit + read-only lookups used to resolve
// entity references (client/project/material/contract) before confirmation.
//
// Lookups reuse the existing module repositories / Prisma models; nothing here
// re-implements domain logic. The audit write is append-only.
// ============================================================

import type {
  Contract,
  Customer,
  Material,
  Payment,
  PrismaClient,
  Prisma,
  Project,
  ProjectCost,
} from '@prisma/client';
import { CustomersRepository } from '../customers/customers.repository.js';
import type { ProjectWithContract } from '../projects/projects.repository.js';
import { toJsonValue } from '../../shared/utils/json.js';

const CONTRACT_SUMMARY_SELECT = {
  id: true,
  contractNumber: true,
  totalPrice: true,
  status: true,
  signedAt: true,
  customer: { select: { id: true, name: true } },
} as const;

export interface AiCommandLogInput {
  userId: string | null;
  sessionId: string | null;
  originalText: string;
  detectedIntent: string | null;
  confidence: number | null;
  resultKind: string;
  confirmationStatus: string | null;
  failedReason: string | null;
  provider: string | null;
  generatedPlan?: unknown;
  executedActions?: unknown;
  createdEntityIds?: unknown;
  updatedEntityIds?: unknown;
}

export class AiCommandRepository {
  private readonly customersRepo: CustomersRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.customersRepo = new CustomersRepository(prisma);
  }

  // ---------- reference resolution lookups ----------

  /** Exact (case-insensitive) client name match — all matches, so the caller can
   *  find-or-create or disambiguate. */
  findCustomersByName(name: string): Promise<Customer[]> {
    return this.customersRepo.findByName(name);
  }

  /** Fuzzy project name match (with contract + customer summary) for resolving a
   *  spoken project reference; multiple matches trigger clarification. */
  findProjectsByName(name: string): Promise<ProjectWithContract[]> {
    return this.prisma.project.findMany({
      where: { deletedAt: null, name: { contains: name, mode: 'insensitive' } },
      include: { contract: { select: CONTRACT_SUMMARY_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }) as Promise<ProjectWithContract[]>;
  }

  findMaterialsByName(name: string): Promise<Material[]> {
    return this.prisma.material.findMany({
      where: { deletedAt: null, name: { contains: name, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }

  /** Fuzzy customer lookup — partial name OR phone (the term may be either). */
  searchCustomers(term: string): Promise<Customer[]> {
    return this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: [{ name: { contains: term, mode: 'insensitive' } }, { phone: { contains: term } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }

  /** Most recent project — resolves "آخر مشروع". */
  lastProject(): Promise<Project | null> {
    return this.prisma.project.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
  }

  /** Most recent cost — resolves "احذف آخر مصروف" (optionally scoped to a project). */
  lastCost(projectId?: string): Promise<ProjectCost | null> {
    return this.prisma.projectCost.findFirst({
      where: { deletedAt: null, ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Most recent payment — resolves "آخر دفعة" (optionally scoped to a project). */
  lastPayment(projectId?: string): Promise<Payment | null> {
    return this.prisma.payment.findFirst({
      where: { deletedAt: null, ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  findContractByNumber(contractNumber: string): Promise<Contract | null> {
    return this.prisma.contract.findFirst({
      where: { deletedAt: null, contractNumber: { equals: contractNumber, mode: 'insensitive' } },
    });
  }

  // ---------- audit ----------

  async log(input: AiCommandLogInput): Promise<string> {
    const data: Prisma.AiCommandLogUncheckedCreateInput = {
      userId: input.userId,
      sessionId: input.sessionId,
      originalText: input.originalText,
      detectedIntent: input.detectedIntent,
      confidence: input.confidence,
      resultKind: input.resultKind,
      confirmationStatus: input.confirmationStatus,
      failedReason: input.failedReason,
      provider: input.provider,
      ...(input.generatedPlan !== undefined && { generatedPlan: toJsonValue(input.generatedPlan) }),
      ...(input.executedActions !== undefined && { executedActions: toJsonValue(input.executedActions) }),
      ...(input.createdEntityIds !== undefined && { createdEntityIds: toJsonValue(input.createdEntityIds) }),
      ...(input.updatedEntityIds !== undefined && { updatedEntityIds: toJsonValue(input.updatedEntityIds) }),
    };
    const row = await this.prisma.aiCommandLog.create({ data, select: { id: true } });
    return row.id;
  }
}

// ============================================================
// Repository — pure data access for the estimation-builder feature. Mirrors
// materials.repository.ts: every write accepts an optional
// `client: PrismaClient | Prisma.TransactionClient` so the final-confirm
// transaction can compose draft + material + template + item + audit writes into
// ONE atomic unit. Material candidate search reuses the same case-insensitive
// name match the materials module already uses.
// ============================================================

import type {
  EstimationTemplate,
  EstimationTemplateDraft,
  Material,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { toJsonValue } from '../../shared/utils/json.js';
import type { EstimationAuditLogInput } from './estimation-templates.types.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface ListTemplatesArgs {
  search?: string;
  skip: number;
  take: number;
  sortBy: 'name' | 'createdAt' | 'estimatedTotal';
  sortDir: 'asc' | 'desc';
}

export class EstimationTemplatesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------- drafts ----------

  createDraft(
    data: Prisma.EstimationTemplateDraftUncheckedCreateInput,
    client: DbClient = this.prisma,
  ): Promise<EstimationTemplateDraft> {
    return client.estimationTemplateDraft.create({ data });
  }

  findDraftById(id: string, client: DbClient = this.prisma): Promise<EstimationTemplateDraft | null> {
    return client.estimationTemplateDraft.findUnique({ where: { id } });
  }

  updateDraft(
    id: string,
    data: Prisma.EstimationTemplateDraftUncheckedUpdateInput,
    client: DbClient = this.prisma,
  ): Promise<EstimationTemplateDraft> {
    return client.estimationTemplateDraft.update({ where: { id }, data });
  }

  // ---------- material lookup (read-only; never mutates the catalog) ----------

  /** Case-insensitive name match against the active catalog — the same match
   *  style materials.repository.ts uses. The service picks the best candidate. */
  findMaterialCandidates(nameGuess: string, client: DbClient = this.prisma): Promise<Material[]> {
    return client.material.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        name: { contains: nameGuess, mode: 'insensitive' },
      },
      orderBy: { name: 'asc' },
      take: 10,
    });
  }

  // ---------- confirmed template writes (used inside the confirm tx) ----------

  createTemplate(
    data: Prisma.EstimationTemplateUncheckedCreateInput,
    client: DbClient = this.prisma,
  ): Promise<EstimationTemplate> {
    return client.estimationTemplate.create({ data });
  }

  createTemplateItem(
    data: Prisma.EstimationTemplateItemUncheckedCreateInput,
    client: DbClient = this.prisma,
  ) {
    return client.estimationTemplateItem.create({ data });
  }

  // ---------- confirmed template reads / management ----------

  findTemplateByIdWithItems(id: string, client: DbClient = this.prisma) {
    return client.estimationTemplate.findFirst({
      where: { id, deletedAt: null },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  listTemplates(args: ListTemplatesArgs, client: DbClient = this.prisma): Promise<EstimationTemplate[]> {
    return client.estimationTemplate.findMany({
      where: this.buildTemplateWhere(args.search),
      orderBy: { [args.sortBy]: args.sortDir },
      skip: args.skip,
      take: args.take,
    });
  }

  countTemplates(search: string | undefined, client: DbClient = this.prisma): Promise<number> {
    return client.estimationTemplate.count({ where: this.buildTemplateWhere(search) });
  }

  updateTemplate(
    id: string,
    data: Prisma.EstimationTemplateUncheckedUpdateInput,
    client: DbClient = this.prisma,
  ): Promise<EstimationTemplate> {
    return client.estimationTemplate.update({ where: { id }, data });
  }

  softDeleteTemplate(id: string, client: DbClient = this.prisma): Promise<EstimationTemplate> {
    return client.estimationTemplate.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private buildTemplateWhere(search: string | undefined): Prisma.EstimationTemplateWhereInput {
    const where: Prisma.EstimationTemplateWhereInput = { deletedAt: null };
    if (search) where.name = { contains: search, mode: 'insensitive' };
    return where;
  }

  // ---------- narrative audit (append-only) ----------

  logEvent(input: EstimationAuditLogInput, client: DbClient = this.prisma) {
    // Optional Json columns are omitted when absent — Prisma stores NULL for an
    // omitted `Json?` field, which avoids needing the Prisma.JsonNull value import.
    const data: Prisma.EstimationAuditLogUncheckedCreateInput = {
      draftId: input.draftId,
      userId: input.userId,
      eventType: input.eventType,
      originalCommand: input.originalCommand,
      failedReason: input.failedReason ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    };
    if (input.parsedIntent != null) data.parsedIntent = toJsonValue(input.parsedIntent);
    if (input.generatedEstimation != null) data.generatedEstimation = toJsonValue(input.generatedEstimation);
    if (input.existingMaterialsUsed != null) data.existingMaterialsUsed = toJsonValue(input.existingMaterialsUsed);
    if (input.newlyCreatedMaterials != null) data.newlyCreatedMaterials = toJsonValue(input.newlyCreatedMaterials);
    if (input.userApproval != null) data.userApproval = toJsonValue(input.userApproval);
    if (input.executedActions != null) data.executedActions = toJsonValue(input.executedActions);
    if (input.finalSavedValues != null) data.finalSavedValues = toJsonValue(input.finalSavedValues);
    return client.estimationAuditLog.create({ data });
  }
}

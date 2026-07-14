import type {
  AiApprovalState,
  AiProviderCredential,
  AiRequestLog,
  AiSetting,
  MaterialReferencePrice,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import type {
  CreateAiRequestLogInput,
  InsertReferencePriceInput,
  SaveCredentialInput,
  UpdateAiSettingInput,
} from './ai-assistant.types.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

/** Fixed id for the credential + settings singletons. */
const SINGLETON_ID = 'default';

/** MaterialReferencePrice joined with the minimal material fields the UI needs. */
export type ReferencePriceWithMaterial = MaterialReferencePrice & {
  material: { id: string; name: string; unit: string };
};

const MATERIAL_SELECT = { id: true, name: true, unit: true } as const;

// The ONLY place in the codebase allowed to touch the ai-assistant tables
// (ai_request_logs, material_reference_prices). Reading OTHER modules' data
// happens exclusively through their public services — never through Prisma
// here (binding rule #1).
export class AiAssistantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  createRequestLog(
    data: CreateAiRequestLogInput,
    client: DbClient = this.prisma,
  ): Promise<AiRequestLog> {
    return client.aiRequestLog.create({
      data: {
        userId: data.userId,
        operationType: data.operationType,
        modelUsed: data.modelUsed,
        sourceModules: data.sourceModules,
        recordIds: data.recordIds,
        tokensPrompt: data.tokensPrompt,
        tokensCompletion: data.tokensCompletion,
        costUsd: data.costUsd,
        outputSummary: data.outputSummary,
        approvalState: data.approvalState ?? 'NONE',
      },
    });
  }

  findRequestLogById(id: string, client: DbClient = this.prisma): Promise<AiRequestLog | null> {
    return client.aiRequestLog.findUnique({ where: { id } });
  }

  /**
   * The dedupe lookup for applicable suggestions: one PENDING suggestion per
   * target record — refreshing the recommendations list never spawns twins.
   */
  findPendingSuggestionByRecordId(
    recordId: string,
    client: DbClient = this.prisma,
  ): Promise<AiRequestLog | null> {
    return client.aiRequestLog.findFirst({
      where: {
        operationType: 'RECOMMENDATION',
        approvalState: 'PENDING',
        recordIds: { has: recordId },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  updateApprovalState(
    id: string,
    approvalState: AiApprovalState,
    client: DbClient = this.prisma,
  ): Promise<AiRequestLog> {
    return client.aiRequestLog.update({ where: { id }, data: { approvalState } });
  }

  // ---------- Phase 5: material reference prices (append-only history) ----------

  /** Append a reference-price row. History is preserved — nothing is updated. */
  insertReferencePrice(
    data: InsertReferencePriceInput,
    client: DbClient = this.prisma,
  ): Promise<MaterialReferencePrice> {
    return client.materialReferencePrice.create({
      data: {
        materialId: data.materialId,
        referencePrice: data.referencePrice,
        referenceCurrency: data.referenceCurrency,
        referenceSource: data.referenceSource,
        referenceRegion: data.referenceRegion ?? null,
        referenceUpdatedAt: data.referenceUpdatedAt,
      },
    });
  }

  /** Most recent reference price for one material (by the source's date). */
  findLatestReferencePrice(
    materialId: string,
    client: DbClient = this.prisma,
  ): Promise<ReferencePriceWithMaterial | null> {
    return client.materialReferencePrice.findFirst({
      where: { materialId },
      orderBy: [{ referenceUpdatedAt: 'desc' }, { createdAt: 'desc' }],
      include: { material: { select: MATERIAL_SELECT } },
    });
  }

  /**
   * Reference-price rows updated on/after `since`, newest first, with the
   * material joined — the change-detection query. Volume is small (a handful
   * per material per sync); grouping/limiting happens in the service.
   */
  findRecentReferencePrices(
    since: Date,
    client: DbClient = this.prisma,
  ): Promise<ReferencePriceWithMaterial[]> {
    return client.materialReferencePrice.findMany({
      where: { referenceUpdatedAt: { gte: since } },
      orderBy: [{ materialId: 'asc' }, { referenceUpdatedAt: 'desc' }, { createdAt: 'desc' }],
      include: { material: { select: MATERIAL_SELECT } },
    });
  }

  // ---------- Phase 6: token-usage governance ----------

  /** Total prompt/completion tokens + request count logged on/after `since`. */
  async sumTokensSince(
    since: Date,
    client: DbClient = this.prisma,
  ): Promise<{ prompt: number; completion: number; count: number }> {
    const r = await client.aiRequestLog.aggregate({
      where: { createdAt: { gte: since } },
      _sum: { tokensPrompt: true, tokensCompletion: true },
      _count: { _all: true },
    });
    return {
      prompt: r._sum.tokensPrompt ?? 0,
      completion: r._sum.tokensCompletion ?? 0,
      count: r._count._all,
    };
  }

  /** Per-operation token totals since `since` — the settings breakdown. */
  async usageByOperationSince(
    since: Date,
    client: DbClient = this.prisma,
  ): Promise<Array<{ operationType: string; tokens: number; count: number }>> {
    const rows = await client.aiRequestLog.groupBy({
      by: ['operationType'],
      where: { createdAt: { gte: since } },
      _sum: { tokensPrompt: true, tokensCompletion: true },
      _count: { _all: true },
    });
    return rows.map((r) => ({
      operationType: r.operationType,
      tokens: (r._sum.tokensPrompt ?? 0) + (r._sum.tokensCompletion ?? 0),
      count: r._count._all,
    }));
  }

  // ---------- Phase 2.5: encrypted credential (singleton) ----------

  /** The active encrypted credential, or null. NEVER contains the raw key. */
  findActiveCredential(client: DbClient = this.prisma): Promise<AiProviderCredential | null> {
    return client.aiProviderCredential.findFirst({ where: { id: SINGLETON_ID, isActive: true } });
  }

  /** Store/replace the singleton credential (already-encrypted fields only). */
  saveCredential(
    data: SaveCredentialInput,
    client: DbClient = this.prisma,
  ): Promise<AiProviderCredential> {
    const fields = {
      ciphertext: data.ciphertext,
      iv: data.iv,
      authTag: data.authTag,
      lastFour: data.lastFour,
      isActive: true,
      validatedAt: data.validatedAt ?? null,
      createdById: data.createdById ?? null,
    };
    return client.aiProviderCredential.upsert({
      where: { id: SINGLETON_ID },
      update: fields,
      create: { id: SINGLETON_ID, ...fields },
    });
  }

  /** Remove the DB credential entirely (env key, if any, still works). */
  async deleteCredential(client: DbClient = this.prisma): Promise<void> {
    await client.aiProviderCredential.deleteMany({ where: { id: SINGLETON_ID } });
  }

  // ---------- Phase 2.5: control-panel settings (singleton) ----------

  /** The settings row, or null when none exists yet (→ all defaults apply). */
  findSettings(client: DbClient = this.prisma): Promise<AiSetting | null> {
    return client.aiSetting.findUnique({ where: { id: SINGLETON_ID } });
  }

  /** Upsert the settings singleton with only the provided fields. */
  saveSettings(data: UpdateAiSettingInput, client: DbClient = this.prisma): Promise<AiSetting> {
    // Cast to the unchecked shapes: our fields map 1:1 to columns (scalar
    // `updatedById` + Json `features`/`materialPriceSources`), which the
    // relation-based checked types don't accept directly.
    const update = { ...data, updatedAt: new Date() } as Prisma.AiSettingUncheckedUpdateInput;
    const create = { id: SINGLETON_ID, ...data } as Prisma.AiSettingUncheckedCreateInput;
    return client.aiSetting.upsert({ where: { id: SINGLETON_ID }, update, create });
  }
}

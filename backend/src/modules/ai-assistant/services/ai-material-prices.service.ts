import { money, round, toMoneyString } from '../../../lib/money.js';
import type { MaterialPriceSource } from '../../../config/app-config.js';
import {
  MaterialPriceSourceClient,
  type MaterialPriceRow,
} from '../../../lib/ai/material-price-source.js';
import type { AuditActor, AuditService } from '../../audit/audit.service.js';
import type { MaterialsService } from '../../materials/materials.service.js';
import type { AiAssistantRepository, ReferencePriceWithMaterial } from '../ai-assistant.repository.js';
import type {
  MaterialPriceChangeDto,
  ReferencePriceDto,
  SyncPricesResult,
} from '../ai-assistant.types.js';

// Phase 5 — external material reference prices. Runs INSIDE the backend
// process (dev tsx or the Windows Service), never Electron. LLM-free: fetch a
// structured JSON source, validate, and APPEND to MaterialReferencePrice
// (history preserved — nothing is overwritten). Offline-tolerant: a failed
// source is logged and skipped, never aborting the run or breaking a screen.

const CHANGE_WINDOW_DAYS = 180;
const CHANGE_LIMIT = 20;
const AUDIT_ENTITY = 'MaterialPriceSync';
/** Stable, greppable audit entityId — the sync summarises many sources. */
const AUDIT_ENTITY_ID = 'material-prices';

export interface AiMaterialPricesServiceDeps {
  repo: AiAssistantRepository;
  materials: MaterialsService;
  audit: AuditService;
  /** Resolves the active sources (DB wins over env, Phase 2.5). */
  resolveSources: () => Promise<MaterialPriceSource[]>;
  /** Injected so tests can supply a fake fetch; production uses the default. */
  sourceClient?: MaterialPriceSourceClient;
}

export class AiMaterialPricesService {
  private readonly client: MaterialPriceSourceClient;

  constructor(private readonly deps: AiMaterialPricesServiceDeps) {
    this.client = deps.sourceClient ?? new MaterialPriceSourceClient();
  }

  /** True when at least one source is configured (drives the scheduler). */
  async hasConfiguredSources(): Promise<boolean> {
    return (await this.deps.resolveSources()).length > 0;
  }

  /**
   * Fetch every configured source, match rows to known materials by name, and
   * append a reference-price row per match. Writes ONE audit summary. Safe to
   * call with no sources (no-op) and safe offline (per-source failures are
   * collected, not thrown).
   */
  async syncPrices(actor: AuditActor): Promise<SyncPricesResult> {
    const ranAt = new Date();
    const sources = await this.deps.resolveSources();
    const result: SyncPricesResult = {
      enabled: sources.length > 0,
      sources: sources.length,
      fetched: 0,
      matched: 0,
      inserted: 0,
      skippedUnmatched: 0,
      errors: [],
      ranAt: ranAt.toISOString(),
    };

    if (sources.length === 0) {
      await this.auditSync(actor, result);
      return result;
    }

    // Build the name→material index once, from the PUBLIC materials service.
    const materials = await this.deps.materials.list({
      page: 1,
      pageSize: 1000,
      sortBy: 'name',
      sortDir: 'asc',
    });
    const byName = new Map<string, { id: string }>();
    for (const m of materials.items) byName.set(normalizeName(m.name), { id: m.id });

    for (const source of sources) {
      const outcome = await this.client.fetchSource(source);
      if (!outcome.ok) {
        result.errors.push({ source: source.name, message: outcome.message });
        continue;
      }
      for (const row of outcome.result.rows) {
        result.fetched += 1;
        const match = byName.get(normalizeName(row.material));
        if (!match) {
          result.skippedUnmatched += 1;
          continue;
        }
        result.matched += 1;
        await this.deps.repo.insertReferencePrice({
          materialId: match.id,
          referencePrice: normalizePrice(row.price),
          referenceCurrency: row.currency.trim(),
          referenceSource: source.name,
          referenceRegion: source.region ?? null,
          referenceUpdatedAt: parseSourceDate(row.updatedAt, ranAt),
        });
        result.inserted += 1;
      }
    }

    await this.auditSync(actor, result);
    return result;
  }

  /** Latest reference price for one material — form/column display. */
  async getLatestForMaterial(materialId: string): Promise<ReferencePriceDto | null> {
    const row = await this.deps.repo.findLatestReferencePrice(materialId);
    return row ? toReferencePriceDto(row) : null;
  }

  /**
   * Reference-price movements for the dashboard card: latest vs prior row for
   * each material, SAME currency only (rule #5 — never compare across
   * currencies). Sorted by magnitude, capped.
   */
  async getRecentPriceChanges(): Promise<MaterialPriceChangeDto[]> {
    const since = new Date();
    since.setDate(since.getDate() - CHANGE_WINDOW_DAYS);
    const rows = await this.deps.repo.findRecentReferencePrices(since);

    // rows are ordered by (materialId asc, referenceUpdatedAt desc): the first
    // two rows of each materialId group are latest + prior.
    const changes: MaterialPriceChangeDto[] = [];
    for (let i = 0; i < rows.length; i++) {
      const current = rows[i]!;
      const prev = rows[i + 1];
      if (!prev || prev.materialId !== current.materialId) continue; // no prior in window
      // Only the first (latest) pair of each material, and only same currency.
      if (i > 0 && rows[i - 1]!.materialId === current.materialId) continue;
      if (current.referenceCurrency !== prev.referenceCurrency) continue;

      const currentPrice = money(current.referencePrice);
      const previousPrice = money(prev.referencePrice);
      if (previousPrice.lte(0) || currentPrice.eq(previousPrice)) continue;

      const changePercent = Number(
        currentPrice.minus(previousPrice).div(previousPrice).times(100).toFixed(1),
      );
      changes.push({
        materialId: current.materialId,
        materialName: current.material.name,
        unit: current.material.unit,
        currency: current.referenceCurrency,
        currentPrice: toMoneyString(currentPrice),
        previousPrice: toMoneyString(previousPrice),
        changePercent,
        direction: currentPrice.gt(previousPrice) ? 'up' : 'down',
        source: current.referenceSource,
        referenceUpdatedAt: current.referenceUpdatedAt.toISOString(),
      });
    }

    changes.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
    return changes.slice(0, CHANGE_LIMIT);
  }

  private async auditSync(actor: AuditActor, result: SyncPricesResult): Promise<void> {
    await this.deps.audit.log(actor, {
      action: 'CREATE',
      entity: AUDIT_ENTITY,
      entityId: AUDIT_ENTITY_ID,
      newValues: {
        enabled: result.enabled,
        sources: result.sources,
        fetched: result.fetched,
        matched: result.matched,
        inserted: result.inserted,
        skippedUnmatched: result.skippedUnmatched,
        errorCount: result.errors.length,
        // Source NAMES + reasons only — no fetched content is persisted.
        errors: result.errors,
      },
    });
  }
}

// ---------- pure helpers ----------

/** Case/space-insensitive name key for matching source rows to materials. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePrice(price: string): string {
  return toMoneyString(round(money(price)));
}

/** Accept an ISO-ish date; fall back to the run time when absent/unparsable. */
function parseSourceDate(raw: string | undefined, fallback: Date): Date {
  if (!raw) return fallback;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function toReferencePriceDto(row: ReferencePriceWithMaterial): ReferencePriceDto {
  return {
    materialId: row.materialId,
    price: toMoneyString(money(row.referencePrice)),
    currency: row.referenceCurrency,
    source: row.referenceSource,
    region: row.referenceRegion,
    referenceUpdatedAt: row.referenceUpdatedAt.toISOString(),
    fetchedAt: row.createdAt.toISOString(),
  };
}

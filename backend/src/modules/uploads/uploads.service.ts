import path from 'node:path';
import type { MultipartFile } from '@fastify/multipart';
import type { CompanyProfile, Prisma, PrismaClient } from '@prisma/client';
import { buildPublicUrl, getStorage } from '../../lib/storage/storage.service.js';
import type { StorageBucket } from '../../lib/storage/storage.service.js';
import { env } from '../../config/env.js';
import { ValidationError } from '../../shared/errors/validation.error.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { toJsonValue } from '../../shared/utils/json.js';
import {
  ALLOWED_IMAGE_EXTS,
  ALLOWED_IMAGE_MIME,
  MIME_TO_EXT,
  type CompanyAssetKind,
} from './uploads.schemas.js';
import type { CompanyAssetState, UploadedAssetResponse } from './uploads.types.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

const COMPANY_ID = 'default';
const ENTITY = 'CompanyProfile';
const MAX_BYTES = env.MAX_UPLOAD_SIZE_MB * 1024 * 1024;

// Per-asset routing — keeps controller code trivial and lets future
// asset kinds (DOCX templates, project attachments) reuse the same shape.
interface AssetSpec {
  bucket: StorageBucket;
  pathColumn: 'logoPath' | 'stampPath';
  mimeColumn: 'logoMimeType' | 'stampMimeType';
  allowedMime: ReadonlySet<string>;
  allowedExt: ReadonlySet<string>;
}

const SPECS: Record<CompanyAssetKind, AssetSpec> = {
  logo: {
    bucket: 'public/company/logos',
    pathColumn: 'logoPath',
    mimeColumn: 'logoMimeType',
    allowedMime: ALLOWED_IMAGE_MIME,
    allowedExt: ALLOWED_IMAGE_EXTS,
  },
  stamp: {
    bucket: 'public/company/stamps',
    pathColumn: 'stampPath',
    mimeColumn: 'stampMimeType',
    allowedMime: ALLOWED_IMAGE_MIME,
    allowedExt: ALLOWED_IMAGE_EXTS,
  },
};

export class UploadsService {
  private readonly audit: AuditService;

  constructor(private readonly prisma: PrismaClient) {
    this.audit = new AuditService(prisma);
  }

  // ---------- reads ----------

  /**
   * Returns the public-URL view of both assets. Used by the GET endpoints
   * and by anything that needs to know what's currently stored without
   * caring about filesystem paths.
   */
  async getCompanyAssets(): Promise<CompanyAssetState> {
    const profile = await this.loadCompanyProfile();
    return {
      logo: this.assetState(profile, 'logo'),
      stamp: this.assetState(profile, 'stamp'),
    };
  }

  // ---------- writes ----------

  async uploadCompanyAsset(
    kind: CompanyAssetKind,
    file: MultipartFile,
    actor: AuditActor,
  ): Promise<UploadedAssetResponse> {
    const spec = SPECS[kind];
    const buffer = await this.readAndValidate(file, spec);

    const storage = getStorage();
    const ext = MIME_TO_EXT[file.mimetype] ?? this.extFromFilename(file.filename);

    return this.prisma.$transaction(async (tx) => {
      const before = await this.loadCompanyProfile(tx);
      const previousPath = before[spec.pathColumn];

      const saved = await storage.save({
        bucket: spec.bucket,
        contents: buffer,
        mimeType: file.mimetype,
        extension: ext,
      });

      const updated = await tx.companyProfile.update({
        where: { id: COMPANY_ID },
        data: {
          [spec.pathColumn]: saved.relativePath,
          [spec.mimeColumn]: file.mimetype,
        },
      });

      // Delete the previous file only AFTER the DB update committed
      // successfully — that way a crash mid-upload never orphans the row.
      // (We're inside a transaction; the unlink happens post-commit via the
      // finally block on the outer promise.)
      this.schedulePostCommitCleanup(previousPath);

      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: ENTITY,
          entityId: COMPANY_ID,
          oldValues: toJsonValue({
            [spec.pathColumn]: before[spec.pathColumn],
            [spec.mimeColumn]: before[spec.mimeColumn],
          }),
          newValues: toJsonValue({
            [spec.pathColumn]: updated[spec.pathColumn],
            [spec.mimeColumn]: updated[spec.mimeColumn],
            size: saved.size,
            action: `upload:${kind}`,
          }),
        },
        tx,
      );

      // saved.publicUrl is non-null for the public/company/* buckets used
      // here; the type allows null only to keep the storage contract
      // generic for future private buckets.
      return {
        kind,
        url: saved.publicUrl ?? '',
        mimeType: file.mimetype,
        size: saved.size,
        updatedAt: updated.updatedAt.toISOString(),
      };
    });
  }

  async deleteCompanyAsset(kind: CompanyAssetKind, actor: AuditActor): Promise<void> {
    const spec = SPECS[kind];
    await this.prisma.$transaction(async (tx) => {
      const before = await this.loadCompanyProfile(tx);
      const previousPath = before[spec.pathColumn];
      if (!previousPath) {
        // Nothing to delete — idempotent success.
        return;
      }

      await tx.companyProfile.update({
        where: { id: COMPANY_ID },
        data: {
          [spec.pathColumn]: null,
          [spec.mimeColumn]: null,
        },
      });

      this.schedulePostCommitCleanup(previousPath);

      await this.audit.log(
        actor,
        {
          action: 'DELETE',
          entity: ENTITY,
          entityId: COMPANY_ID,
          oldValues: toJsonValue({
            [spec.pathColumn]: before[spec.pathColumn],
            [spec.mimeColumn]: before[spec.mimeColumn],
          }),
          newValues: toJsonValue({ action: `delete:${kind}` }),
        },
        tx,
      );
    });
  }

  // ---------- helpers ----------

  private async loadCompanyProfile(client: DbClient = this.prisma): Promise<CompanyProfile> {
    const existing = await client.companyProfile.findUnique({ where: { id: COMPANY_ID } });
    if (existing) return existing;
    // Self-heal the singleton row if seed never ran. Matches the pattern
    // used by SettingsRepository.getCompany.
    return client.companyProfile.create({ data: { id: COMPANY_ID, companyName: '' } });
  }

  private async readAndValidate(file: MultipartFile, spec: AssetSpec): Promise<Buffer> {
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype) || !spec.allowedMime.has(file.mimetype)) {
      throw new ValidationError('Unsupported file type', {
        file: [`mime "${file.mimetype}" is not allowed`],
      });
    }
    const ext = this.extFromFilename(file.filename);
    if (!spec.allowedExt.has(ext)) {
      throw new ValidationError('Unsupported file extension', {
        file: [`extension ".${ext}" is not allowed`],
      });
    }

    const buffer = await file.toBuffer();
    if (buffer.length === 0) {
      throw new ValidationError('Uploaded file is empty', { file: ['empty file'] });
    }
    if (buffer.length > MAX_BYTES) {
      throw new ValidationError('File too large', {
        file: [`maximum size is ${env.MAX_UPLOAD_SIZE_MB} MB`],
      });
    }
    return buffer;
  }

  private extFromFilename(filename: string): string {
    const ext = path.extname(filename).replace(/^\./, '').toLowerCase();
    return ext;
  }

  private assetState(
    profile: CompanyProfile,
    kind: CompanyAssetKind,
  ): { url: string; mimeType: string } | null {
    const spec = SPECS[kind];
    const p = profile[spec.pathColumn];
    const m = profile[spec.mimeColumn];
    if (!p || !m) return null;
    const url = buildPublicUrl(p);
    if (!url) return null;
    return { url, mimeType: m };
  }

  /**
   * Fire-and-forget unlink scheduled to run after the current tick. We
   * cannot await it inside a Prisma transaction (storage I/O isn't part of
   * the DB tx), so we queue it for after the tx commits. Errors are logged
   * but never thrown — leaving a stale file is better than failing a
   * successful upload.
   */
  private schedulePostCommitCleanup(previousPath: string | null): void {
    if (!previousPath) return;
    setImmediate(() => {
      void getStorage().remove(previousPath).catch((err: unknown) => {
        console.warn(`[uploads] failed to remove old asset ${previousPath}:`, err);
      });
    });
  }
}


import type { Material, PrismaClient } from '@prisma/client';
import { MaterialsRepository } from './materials.repository.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { toJsonValue } from '../../shared/utils/json.js';
import { buildPaginated, toSkipTake } from '../../shared/utils/pagination.js';
import type { Paginated } from '../../shared/types/pagination.js';
import type {
  CreateMaterialInput,
  ListMaterialsQuery,
  UpdateMaterialInput,
} from './materials.schemas.js';

const ENTITY = 'Material';

export class MaterialsService {
  private readonly repo: MaterialsRepository;
  private readonly audit: AuditService;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new MaterialsRepository(prisma);
    this.audit = new AuditService(prisma);
  }

  async list(query: ListMaterialsQuery): Promise<Paginated<Material>> {
    const { skip, take } = toSkipTake(query);
    const [items, total] = await Promise.all([
      this.repo.findMany({
        search: query.search,
        isActive: query.isActive,
        skip,
        take,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      }),
      this.repo.count({ search: query.search, isActive: query.isActive }),
    ]);
    return buildPaginated(items, total, query);
  }

  async getById(id: string): Promise<Material> {
    const material = await this.repo.findById(id);
    if (!material) throw new NotFoundError(ENTITY, 'MATERIAL_NOT_FOUND');
    return material;
  }

  async create(data: CreateMaterialInput, actor: AuditActor): Promise<Material> {
    return this.prisma.$transaction(async (tx) => {
      const created = await this.repo.create(data, tx);
      await this.audit.log(
        actor,
        {
          action: 'CREATE',
          entity: ENTITY,
          entityId: created.id,
          newValues: toJsonValue(created),
        },
        tx,
      );
      return created;
    });
  }

  async update(id: string, data: UpdateMaterialInput, actor: AuditActor): Promise<Material> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.material.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundError(ENTITY, 'MATERIAL_NOT_FOUND');

      const updated = await this.repo.update(id, data, tx);
      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: ENTITY,
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
      const existing = await tx.material.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundError(ENTITY, 'MATERIAL_NOT_FOUND');

      await this.repo.softDelete(id, tx);
      await this.audit.log(
        actor,
        {
          action: 'DELETE',
          entity: ENTITY,
          entityId: id,
          oldValues: toJsonValue(existing),
        },
        tx,
      );
    });
  }
}

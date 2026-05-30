import { RoleName } from '@contractor-plus/shared';
import { type PrismaClient } from '@prisma/client';
import { UsersRepository, type UserWithRole } from './users.repository.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { ConflictError } from '../../shared/errors/conflict.error.js';
import { ForbiddenError } from '../../shared/errors/forbidden.error.js';
import { hashPassword } from '../../lib/password.js';
import { toJsonValue } from '../../shared/utils/json.js';
import { buildPaginated, toSkipTake } from '../../shared/utils/pagination.js';
import type { Paginated } from '../../shared/types/pagination.js';
import type {
  CreateUserInput,
  ListUsersQuery,
  ResetPasswordInput,
  UpdateUserInput,
} from './users.schemas.js';
import type { UserDto } from './users.types.js';

const ENTITY = 'User';

// The acting principal — needed for self-rules and OWNER-protection on top of
// the route-level OWNER/ADMIN guard.
export interface ActingUser {
  id: string;
  role: string;
  actor: AuditActor;
}

export class UsersService {
  private readonly repo: UsersRepository;
  private readonly audit: AuditService;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new UsersRepository(prisma);
    this.audit = new AuditService(prisma);
  }

  async list(query: ListUsersQuery): Promise<Paginated<UserDto>> {
    const { skip, take } = toSkipTake(query);
    const args = {
      search: query.search,
      role: query.role,
      isActive: query.isActive,
      skip,
      take,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    };
    const [items, total] = await Promise.all([this.repo.findMany(args), this.repo.count(args)]);
    return buildPaginated(items.map(toDto), total, query);
  }

  async getById(id: string): Promise<UserDto> {
    const user = await this.repo.findById(id);
    if (!user) throw new NotFoundError(ENTITY, 'USER_NOT_FOUND');
    return toDto(user);
  }

  async create(data: CreateUserInput, acting: ActingUser): Promise<UserDto> {
    // Only OWNER may create OWNER users.
    assertCanTargetRole(acting.role, data.roleName);

    return this.prisma.$transaction(async (tx) => {
      const role = await this.repo.findRoleByName(data.roleName, tx);
      if (!role) throw new NotFoundError('Role', 'ROLE_NOT_FOUND');

      if (await this.repo.findByUsername(data.username, tx)) {
        throw new ConflictError('Username already taken', 'USERNAME_TAKEN');
      }
      if (data.email && (await this.repo.findByEmail(data.email, tx))) {
        throw new ConflictError('Email already in use', 'EMAIL_TAKEN');
      }

      const passwordHash = await hashPassword(data.password);
      const created = await this.repo.create(
        {
          username: data.username,
          email: data.email,
          phone: data.phone,
          fullName: data.fullName,
          isActive: data.isActive,
          passwordHash,
          roleId: role.id,
        },
        tx,
      );
      await this.audit.log(
        acting.actor,
        { action: 'CREATE', entity: ENTITY, entityId: created.id, newValues: toJsonValue(toDto(created)) },
        tx,
      );
      return toDto(created);
    });
  }

  async update(id: string, data: UpdateUserInput, acting: ActingUser): Promise<UserDto> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError(ENTITY, 'USER_NOT_FOUND');

      // ADMIN cannot modify an OWNER user.
      assertCanTargetRole(acting.role, existing.role.name);

      const isSelf = acting.id === id;
      const data2: Record<string, unknown> = {
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
      };

      // Role change.
      if (data.roleName && data.roleName !== existing.role.name) {
        if (isSelf) throw new ForbiddenError('Cannot change your own role', 'SELF_ROLE_CHANGE');
        // Promoting/assigning OWNER requires OWNER.
        assertCanTargetRole(acting.role, data.roleName);
        const role = await this.repo.findRoleByName(data.roleName, tx);
        if (!role) throw new NotFoundError('Role', 'ROLE_NOT_FOUND');
        data2.roleId = role.id;
      }

      // isActive change — cannot deactivate self.
      if (data.isActive !== undefined && data.isActive !== existing.isActive) {
        if (isSelf && data.isActive === false) {
          throw new ForbiddenError('Cannot deactivate yourself', 'SELF_DEACTIVATE');
        }
        data2.isActive = data.isActive;
      }

      if (data.email && data.email !== existing.email) {
        const clash = await this.repo.findByEmail(data.email, tx);
        if (clash && clash.id !== id) throw new ConflictError('Email already in use', 'EMAIL_TAKEN');
      }

      const updated = await this.repo.update(id, data2, tx);
      await this.audit.log(
        acting.actor,
        {
          action: 'UPDATE',
          entity: ENTITY,
          entityId: id,
          oldValues: toJsonValue(toDto(existing)),
          newValues: toJsonValue(toDto(updated)),
        },
        tx,
      );
      return toDto(updated);
    });
  }

  async softDelete(id: string, acting: ActingUser): Promise<void> {
    if (acting.id === id) throw new ForbiddenError('Cannot delete yourself', 'SELF_DELETE');
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError(ENTITY, 'USER_NOT_FOUND');
      assertCanTargetRole(acting.role, existing.role.name);

      await this.repo.softDelete(id, tx);
      await this.audit.log(
        acting.actor,
        { action: 'DELETE', entity: ENTITY, entityId: id, oldValues: toJsonValue(toDto(existing)) },
        tx,
      );
    });
  }

  async setActive(id: string, isActive: boolean, acting: ActingUser): Promise<UserDto> {
    if (acting.id === id && !isActive) {
      throw new ForbiddenError('Cannot deactivate yourself', 'SELF_DEACTIVATE');
    }
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError(ENTITY, 'USER_NOT_FOUND');
      assertCanTargetRole(acting.role, existing.role.name);

      const updated = await this.repo.update(id, { isActive }, tx);
      await this.audit.log(
        acting.actor,
        {
          action: 'UPDATE',
          entity: ENTITY,
          entityId: id,
          oldValues: toJsonValue({ isActive: existing.isActive }),
          newValues: toJsonValue({ isActive: updated.isActive, event: isActive ? 'activated' : 'deactivated' }),
        },
        tx,
      );
      return toDto(updated);
    });
  }

  async resetPassword(id: string, data: ResetPasswordInput, acting: ActingUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError(ENTITY, 'USER_NOT_FOUND');
      assertCanTargetRole(acting.role, existing.role.name);

      const passwordHash = await hashPassword(data.newPassword);
      await this.repo.update(id, { passwordHash }, tx);
      // Force re-login everywhere for the target user.
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(
        acting.actor,
        {
          action: 'UPDATE',
          entity: ENTITY,
          entityId: id,
          newValues: toJsonValue({ event: 'password_reset' }),
        },
        tx,
      );
    });
  }
}

// OWNER users (and assigning the OWNER role) can only be touched by an OWNER.
function assertCanTargetRole(actorRole: string, targetRole: string): void {
  if (targetRole === RoleName.OWNER && actorRole !== RoleName.OWNER) {
    throw new ForbiddenError('Only an owner can manage owner accounts', 'OWNER_PROTECTED');
  }
}

function toDto(user: UserWithRole): UserDto {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    roleId: user.roleId,
    role: user.role.name,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    deletedAt: user.deletedAt,
  };
}

import { Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error.js';
import { ConflictError } from '../../shared/errors/conflict.error.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { TimeoutError } from '../../shared/errors/timeout.error.js';
import { InternalError } from '../../shared/errors/internal.error.js';

/**
 * A friendly, stable app-error identity for a specific unique constraint. Later
 * phases register these per repository so a violation of `uq_contracts_number`
 * becomes `CONTRACT_NUMBER_TAKEN` rather than the generic code (BACKEND.md §14.3).
 */
export interface UniqueConstraintMapping {
  readonly code: string;
  readonly message: string;
}

export interface PrismaErrorMapOptions {
  /** Map from a Prisma constraint target (joined by `_`) to a friendly error. */
  readonly uniqueConstraints?: Readonly<Record<string, UniqueConstraintMapping>>;
}

/**
 * Translate a Prisma error into an {@link AppError} WITHOUT leaking Prisma or
 * database detail to the wire.
 *
 * The mapper never places the raw Prisma message, the SQL, the constraint name,
 * or the model name into the returned error's `message` or `details`. For
 * anything it does not recognise it returns a generic 500 carrying the original
 * as `cause` — visible in logs, invisible to the client (SECURITY.md §14.3).
 *
 * This is the sole boundary at which Prisma error types are inspected; the
 * domain and application rings never see them.
 */
export function mapPrismaError(error: unknown, options: PrismaErrorMapOptions = {}): AppError {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        // Unique constraint violation. Resolve a friendly identity from the
        // constraint target if the caller registered one; otherwise stay generic.
        // The target is used only to LOOK UP a code — it is never echoed back.
        const target = normaliseTarget(error.meta?.target);
        const mapped = target ? options.uniqueConstraints?.[target] : undefined;
        return new ConflictError(
          mapped?.message ?? 'A record with these values already exists.',
          mapped?.code ?? 'UNIQUE_VIOLATION',
        );
      }
      case 'P2025':
        return new NotFoundError('Record', 'NOT_FOUND');
      case 'P2003':
        return new ConflictError(
          'A referenced record does not exist.',
          'REFERENCED_ENTITY_MISSING',
        );
      case 'P2034':
        // Write conflict / deadlock — the transaction can be retried.
        return new ConflictError(
          'The record was modified concurrently. Please retry.',
          'STALE_WRITE',
          true,
        );
      case 'P2028':
        return new TimeoutError('The database transaction timed out.', 'DB_TX_TIMEOUT');
      default:
        // Any other known code — including a fired CHECK constraint surfaced by
        // the engine — is a server-side fault, not bad input. 500, logged via
        // `cause`, generic to the client.
        return new InternalError('Internal server error', error);
    }
  }

  if (
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return new InternalError('Internal server error', error);
  }

  // Already an AppError (e.g. thrown by the domain inside a transaction): pass
  // it through untouched so its status and code survive.
  if (error instanceof AppError) return error;

  return new InternalError('Internal server error', error);
}

function normaliseTarget(target: unknown): string | undefined {
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) return target.map(String).join('_');
  return undefined;
}

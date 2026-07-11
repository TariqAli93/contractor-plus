import { ForbiddenError } from '../../shared/errors/forbidden.error.js';

/** The canonical name of the built-in super-admin role. */
export const OWNER_ROLE = 'OWNER';

/**
 * Principal — "who is asking", the Shared Kernel of the whole system
 * (ARCHITECTURE.md §3.2). Built once per request by the auth plugin, and passed
 * EXPLICITLY into every use case.
 *
 * WHY EXPLICIT AND NOT AMBIENT (`AsyncLocalStorage`): a use case whose
 * authorization depends on invisible ambient state cannot be unit-tested without
 * a request, cannot be called by the job runner, and cannot be called by the AI
 * executor — which is the "one door" the architecture depends on (BACKEND.md
 * §12.2). Ambient storage carries the trace id for LOGGING and nothing that
 * affects a decision.
 *
 * WHY PERMISSIONS ARE LOADED, NOT CARRIED IN THE JWT: a revoked permission must
 * take effect on the next request, not the next token refresh (the live-role
 * re-check, ARCHITECTURE.md §5.2). The auth layer builds this object fresh each
 * request from the role's current grants.
 */
export class Principal {
  private constructor(
    readonly userId: string | null,
    readonly roleName: string,
    private readonly permissions: ReadonlySet<string>,
    readonly context: PrincipalContext,
  ) {}

  /** Is this the built-in super-admin? */
  get isOwner(): boolean {
    return this.roleName === OWNER_ROLE;
  }

  /** A human principal, built from an authenticated request. */
  static user(args: {
    userId: string;
    roleName: string;
    permissions: Iterable<string>;
    context: PrincipalContext;
  }): Principal {
    return new Principal(
      args.userId,
      args.roleName,
      new Set(args.permissions),
      args.context,
    );
  }

  /**
   * A non-human principal for jobs, projectors, and the automation runner.
   *
   * It is NOT a super-user (AUTOMATION.md §8.1): it holds only the grants it is
   * given, so a job that records price history must be handed `price-history.*`
   * explicitly. Its writes are attributed with `actor_type = SYSTEM` in the audit
   * log, so "who did this" resolves to the reason, not to a person.
   */
  static system(reason: string, grants: Iterable<string> = []): Principal {
    return new Principal(null, 'SYSTEM', new Set(grants), {
      traceId: `system:${reason}`,
      ipAddress: null,
      userAgent: null,
    });
  }

  /** Does this principal hold `permissionKey` (or is it the owner)? */
  can(permissionKey: string): boolean {
    return this.isOwner || this.permissions.has(permissionKey);
  }

  /**
   * Assert `permissionKey`, the authoritative authorization decision.
   *
   * This runs INSIDE the use case, not only in a route guard, because the AI
   * executor and the job runner never pass through an HTTP pre-handler
   * (BACKEND.md §12.3). The route guard is a fast rejection; this is the gate.
   *
   * @throws {ForbiddenError} if the permission is not held.
   */
  require(permissionKey: string): void {
    if (!this.can(permissionKey)) {
      throw new ForbiddenError(
        `Missing permission: ${permissionKey}`,
        'INSUFFICIENT_PERMISSION',
      );
    }
  }
}

/** Request-scoped provenance carried by a {@link Principal}, for audit and logs. */
export interface PrincipalContext {
  readonly traceId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

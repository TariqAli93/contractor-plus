/**
 * Desktop ⇄ backend contract version.
 *
 * Bump this whenever the request/response shapes exchanged between the Electron
 * desktop client and the backend service change in a way that an older client
 * (or an older service) cannot safely talk to. The desktop client reads the
 * backend's `GET /version` and refuses to load the app when the returned
 * `protocol` differs from this value — preventing a stale UI from driving a
 * newer service after an in-place update, or vice-versa (the standard's
 * "prevent Version Mismatch between Frontend and Backend" rule).
 */
export const PROTOCOL_VERSION = 1;

/** Shape returned by the backend `GET /version` handshake endpoint. */
export interface VersionInfo {
  /** Backend package version (semver). */
  app: string;
  /** Latest applied Prisma migration name, or null if unknown/DB unreachable. */
  schema: string | null;
  /** Contract version — compared against {@link PROTOCOL_VERSION} by the client. */
  protocol: number;
}

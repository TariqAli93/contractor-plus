import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';

/**
 * Centralised auth-cookie helpers. The refresh token used to be returned in the
 * response body and persisted in the SPA's localStorage (XSS-exfiltratable). It
 * now lives only in an HttpOnly cookie the browser manages, paired with a CSRF
 * double-submit token. Both the auth controller (login/refresh/logout) and the
 * profile controller (change-password "keep this session") share this module so
 * the cookie names/options never drift.
 */

/** HttpOnly cookie carrying the opaque refresh token. Never readable by JS. */
export const REFRESH_COOKIE = 'cp_refresh_token';
/** Readable cookie carrying the CSRF token (double-submit); echoed in X-XSRF-TOKEN. */
export const CSRF_TOKEN_COOKIE = 'XSRF-TOKEN';
/** HttpOnly cookie holding the CSRF validating secret (set by @fastify/csrf-protection). */
export const CSRF_SECRET_COOKIE = '_csrf';

// Scoped to the API namespace so the refresh token reaches the auth endpoints
// (/api/v1/auth/*) AND the change-password endpoint (/api/v1/profile/*, which
// keeps the current session alive) — but never the static SPA/asset routes.
const REFRESH_COOKIE_PATH = '/api/v1';

function refreshMaxAgeSeconds(): number {
  return env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;
}

/**
 * Plant the refresh token as an HttpOnly cookie and (re)issue the CSRF token.
 *
 * - `HttpOnly`        — JS, and therefore XSS, can never read the token.
 * - `SameSite=Strict` — the browser never attaches it to a cross-site request:
 *                       our primary CSRF defence.
 * - `Secure`          — honoured over https (the tunnel) and over the desktop's
 *                       http://127.0.0.1 (Chromium treats loopback as secure).
 */
export function setAuthCookies(reply: FastifyReply, refreshToken: string): void {
  const maxAge = refreshMaxAgeSeconds();

  reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge,
  });

  // generateCsrf() stores the validating secret in the HttpOnly `_csrf` cookie
  // and returns the token; mirror it into a readable cookie the SPA echoes back
  // in the X-XSRF-TOKEN header to complete the double-submit check.
  const csrfToken = reply.generateCsrf();
  reply.setCookie(CSRF_TOKEN_COOKIE, csrfToken, {
    httpOnly: false,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge,
  });
}

/** Remove all three auth cookies (logout / forced revocation). */
export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  reply.clearCookie(CSRF_TOKEN_COOKIE, { path: '/' });
  reply.clearCookie(CSRF_SECRET_COOKIE, { path: '/' });
}

/** The raw refresh token from the request cookie, or undefined when absent. */
export function readRefreshCookie(request: FastifyRequest): string | undefined {
  return request.cookies[REFRESH_COOKIE];
}

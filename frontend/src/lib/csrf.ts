// Reads the readable XSRF-TOKEN cookie the backend sets alongside the HttpOnly
// refresh cookie. Its value is echoed back in the X-XSRF-TOKEN header so the
// server can complete the CSRF double-submit check on the cookie-authenticated
// endpoints (/auth/refresh, /auth/logout). Its presence also serves as the
// "might have an active session" signal on app boot - the refresh token itself
// is HttpOnly and deliberately unreadable from JS.

const XSRF_COOKIE = 'XSRF-TOKEN';

export function readXsrfToken(): string | null {
  try {
    const cookies = globalThis.document?.cookie;
    if (!cookies) return null;
    const prefix = `${XSRF_COOKIE}=`;
    const match = cookies.split('; ').find((row) => row.startsWith(prefix));
    return match ? decodeURIComponent(match.slice(prefix.length)) : null;
  } catch {
    return null;
  }
}

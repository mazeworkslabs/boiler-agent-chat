# Security Enhancements Plan

Current auth is functional and covers all routes. These are improvements to consider over time.

## Current State

- All pages and API routes require authentication (Directus CMS, httpOnly cookies)
- WebSocket validates token against Directus on connection
- Sessions are isolated per user email
- Cookies: httpOnly, secure (production), sameSite: lax

## Public endpoints (by design)

- `/api/health` — Docker/monitoring health check
- `/api/auth/directus-proxy-login` — login endpoint
- `/login` — login page

## Enhancements to consider

### 1. Validate tokens on upload/serve-file (low priority)
`/api/upload` and `/api/serve-file/[id]` currently check that the `access_token` cookie exists but don't re-validate it against Directus. Could be tightened by calling Directus `/users/me` to confirm the token is still valid.

### 2. Next.js middleware for server-side auth (medium priority)
Auth on `/` is client-side (`useAuth()` hook redirects to `/login`). The HTML is served before the check runs. Adding a `src/middleware.ts` that inspects the cookie and redirects server-side would prevent any unauthenticated page render.

### 3. WebSocket re-validation (low priority)
WebSocket connections validate the token only at connection time. A long-lived connection survives a logout. Could add periodic token checks or listen for logout events to close stale connections.

### 4. CSRF tokens (low priority)
Currently relies on httpOnly + sameSite cookies for CSRF protection. Adding explicit CSRF tokens would be defense-in-depth but is not strictly necessary for modern browsers with sameSite: lax.

### 5. Rate limiting (medium priority)
No rate limiting on login or API endpoints. Consider adding rate limiting to `/api/auth/directus-proxy-login` to prevent brute-force attacks.

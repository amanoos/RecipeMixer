# Plan: Authentication, Hardening and Cloud Guide (RecipeMixer Phase 8)

## Summary
Until now RecipeMixer protects itself by refusing to listen anywhere but loopback. This phase lets it be reached from a phone away from home, safely: a single shared password (from an environment variable, as the PRD decided) protects the whole API and every photo; sessions are random tokens kept hashed in SQLite and sent in a locked-down cookie; login is throttled; every state-changing request is checked against cross-site forgery; and nothing private can be cached by a proxy or CDN. The startup guard becomes: a non-loopback address needs a strong password (or the existing explicit opt-in for the loopback-only Docker mapping). The phase also delivers the PRD's remaining items: an independent security review (including the Phase 5 URL fetcher, which is still unreviewed), a final public-repo sweep, and a deployment guide with $0 options that were checked today.

## User Story
As the owner of a recipe library, I want to reach it from my phone anywhere without anyone else being able to read or change it, so that I can look up what to cook while shopping without giving up privacy.

## Problem → Solution
Anyone who can reach the port can read, change or delete everything (safe today only because it is loopback-only) → a login with a strong password, hardened sessions, throttling, forgery checks and private caching make a public or tailnet deployment reasonable.

## Metadata
- **Complexity**: Large (security-critical, touches every route, one migration, new web gate, docs)
- **Source PRD**: `.claude/PRPs/prds/recipe-mixer.prd.md`
- **PRD Phase**: 8 - Hardening and deployment
- **Estimated Files**: ~35 (server ~16 incl. tests, web ~10 incl. tests, docs and deployment files, plan and report)

---

## Current state (read from the code)

| Area | Today |
|---|---|
| Startup guard | `loadConfig` refuses a non-loopback `HOST` unless `ALLOW_INSECURE_NO_AUTH=true` (`server/src/config.ts`) |
| Routes | all open: `/api/health`, `/api/recipes*`, `/api/cuisines`, `/api/match`, `/api/ingredients/suggest`, `/api/import/preview`, `/api/images/:file`, plus the static web app |
| Global protections | helmet (strict CSP), 300 requests a minute per IP, multipart limits, error handler that never leaks internals, log redaction of `authorization` and `cookie` |
| Client IP | `req.ip` from the socket; no `trustProxy`, so behind a reverse proxy every client would share the proxy's address |
| Caching | stored photos are served `public, max-age=31536000, immutable` (unsafe behind a shared cache once data is private); API responses carry no cache header |
| Docker | non-root, read-only root, `127.0.0.1` port mapping, `ALLOW_INSECURE_NO_AUTH=true` in compose |
| Health | public, returns the schema version |
| Known gaps | Phase 5 fetcher not independently reviewed; stray test output with a local path remains in git history (not user data) |

## Design decisions (for the author to confirm when reviewing the plan)

| # | Decision | Choice | Why / alternative |
|---|---|---|---|
| 1 | Sessions | Random 32-byte token in an `HttpOnly` cookie; only its SHA-256 is stored in a new `session` table | Revocable (logout, password change) unlike a stateless signed cookie; a leaked database does not leak live sessions |
| 2 | Password | One shared secret from `APP_PASSWORD` or a file named by `APP_PASSWORD_FILE`; at least 12 characters; a few obvious values refused | PRD decision. The file form works with Docker and cloud secrets so the password need not sit in an env listing |
| 3 | Password check | SHA-256 both sides, `timingSafeEqual` | Constant time, no length leak; the secret is not stored in the database, so a slow hash adds nothing; online guessing is limited by throttling |
| 4 | What is protected | Every `/api/*` route and every stored photo, except `GET /api/health` and the session routes; unknown `/api/*` paths answer 401 (not 404) when logged out | Fail closed: a new route cannot be forgotten, and paths cannot be probed |
| 5 | Cookie | `HttpOnly`, `SameSite=Strict`, path `/`, `Secure` over HTTPS (with the `__Host-` prefix when secure); 7-day idle and 30-day absolute lifetime | Strict blocks cross-site sending; `__Host-` blocks subdomain overwrite |
| 6 | Forgery | On POST, PUT, PATCH, DELETE: reject if `Sec-Fetch-Site` is not `same-origin` or `none`, or if `Origin` is present and does not match the request host | Defence in depth on top of SameSite; requests without either header (curl, scripts) still work with a valid cookie |
| 7 | Login throttle | Per client address: 5 failures in 15 minutes locks that address out for 15 minutes (`429` with `Retry-After`); also the route rate limit | Per address (not global) so an attacker cannot lock the owner out; correct only if the client address is real, hence `TRUST_PROXY` |
| 8 | Proxy | `TRUST_PROXY` env: unset or `false` (default) or a number of proxy hops; never a blanket `true` | Trusting `X-Forwarded-For` blindly lets anyone spoof an address and dodge the throttle |
| 9 | Caching | `Cache-Control: private, no-store` on API JSON; photos `private, max-age=31536000, immutable` | A CDN or proxy must never keep a copy of private data |
| 10 | Health | Public, but returns only `{status}` to a logged-out caller when auth is on | Docker and uptime checks keep working; the schema version is not advertised |
| 11 | Independent review | Run the security-reviewer agent over the fetcher and the new auth code before the final commit and fix what it finds | The PRD's success signal is "no open high-severity issue"; the Phase 5 fetcher is still unreviewed |
| 12 | Git history | Report the stray test output (a local folder path, no secrets, no user data) but do not rewrite history | A force-push changes every clone of a public repo; the author's call |

## Targets (acceptance)
- With a password set, **no** `/api/*` route and no photo answers a logged-out caller, except `GET /api/health` (status only) and the three session routes. Enforced by a table test over every route and by the fail-closed hook.
- The app **refuses to start** on a non-loopback address without a strong password or the explicit opt-in; refuses a weak password; tells the user how to make a strong one.
- Login: wrong password gives the same generic error and takes the same path as unknown cases; 5 failures lock the address; a good password after the lock expires works; the password never appears in logs or responses.
- Sessions: logout revokes; changing the password invalidates every session; expiry works; cookie flags verified (HttpOnly, SameSite=Strict, Secure and `__Host-` over HTTPS).
- Cross-site writes are rejected, same-origin writes work, scripts without those headers work.
- No private response is cacheable by a shared cache.
- The web app shows a login page when needed, never flashes it when auth is off, offers log out, and recovers cleanly when a session expires mid-use.
- Security review: no open high-severity finding; medium findings fixed or recorded with a reason.
- A deployment guide whose facts were checked on the day, with commands that were run locally (reverse proxy with HTTPS, proxy headers, the Secure cookie).
- All earlier behaviour unchanged when no password is set on loopback (the default).

---

## Mandatory Reading

| Priority | File | Why |
|---|---|---|
| P0 | `server/src/config.ts` and `server/test/config.test.ts` | the startup guard and its tests; new settings go here |
| P0 | `server/src/app.ts`, `server/src/plugins/security.ts` | hook order (security, compress, routes), rate limit, error handler, logging redaction, static serving |
| P0 | `server/src/routes/*.ts` | every route to protect and to table-test; `images.ts` for photo headers |
| P0 | `server/src/errors.ts` | `HttpError` helpers (add 401, 403) |
| P0 | `server/src/db/migrate.ts`, `db/migrations/*.sql` | migration pattern for `005_session.sql` |
| P1 | `server/test/helpers.ts`, `test/security.test.ts`, `test/health.test.ts` | test patterns (`makeApp`, `testConfig`, `app.inject`) |
| P1 | `web/src/lib/api.ts`, `App.tsx`, `main.tsx`, `components/Layout.tsx`, `ServerStatus.tsx` | request wrapper (401 handling), where the gate goes, header logout button, health display |
| P1 | `Dockerfile`, `docker-compose.yml`, `.env.example`, `.github/workflows/ci.yml` | deployment surface and CI |
| P2 | `SECURITY.md`, `README.md` | rewrite the threat model and add the guide |

## External Documentation (checked 2026-10-17; the free-tier facts come from third-party summaries and must be re-verified on each provider's own page when writing the guide)

| Topic | Finding | Applies to |
|---|---|---|
| OWASP session management and CSRF cheat sheets | opaque random ids, server-side revocation, `HttpOnly`/`Secure`/`SameSite`, fetch metadata checks | design 1, 5, 6 |
| `@fastify/cookie` (MIT) | official cookie parsing and signing helpers; no manual cookie parsing | Task 3 |
| Tailscale | the free Personal plan covers up to 6 users with unlimited devices (older pages say 3 users and 100 devices); `tailscale serve` puts local HTTPS in front of the app without public exposure; needs MagicDNS and HTTPS certificates enabled | guide: private access from the phone, recommended |
| Cloudflare Tunnel and Access | free Zero Trust plan reported at up to 50 users; the tunnel makes an outbound connection so no port is opened; needs a domain on Cloudflare | guide: public hostname with an extra login in front |
| Google Cloud Always Free | one `e2-micro` in `us-west1`, `us-central1` or `us-east1`; 30 GB-months of **standard** persistent disk (the default disk type is not free); about 1 GB egress a month | guide: free VM |
| Oracle Cloud Always Free | block storage 200 GB total in the home region; Arm allowance reported as halved in mid-2026 (sources disagree on the date and figures); two AMD micro VMs | guide: free VM, verify first |
| Fly.io | no free allowance for new accounts in 2026 (short trial, then pay as you go; volumes about $0.15 per GB-month) | guide: not free, listed for completeness |

---

## Patterns to Mirror
- **Routes and plugins**: `FastifyPluginAsync` with injected dependencies, registered in `buildApp` (`server/src/routes/recipes.ts`).
- **Errors**: `HttpError` helpers with messages safe to show; never echo input (`server/src/errors.ts`); the global handler passes `HttpError` through at any status.
- **Validation**: zod schema plus `parseOrThrow` (`server/src/schemas/recipe.ts`); strict objects.
- **Config**: zod env schema with transforms, errors thrown at startup with a helpful message (`server/src/config.ts`).
- **Migrations**: numbered SQL files copied at build (`server/src/db/migrations`, `scripts/copy-migrations.mjs`).
- **Tests**: `makeApp(overrides)`, `app.inject`, in-memory database, exact status and header assertions; web tests with `stubFetch` and role queries.
- **Mutation checks**: for each security control, break it temporarily and watch its test fail (done for the Phase 5 fetcher).

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `server/src/config.ts` (+ test) | UPDATE | `appPassword`, `trustProxy`, `cookieSecure`; strong-password rule; new startup guard |
| `server/src/services/password.ts` (+ test) | CREATE | strength rules, `APP_PASSWORD_FILE` reading, fingerprint, constant-time check |
| `server/src/db/migrations/005_session.sql` | CREATE | `session` table (token hash, created, last seen, expires, password fingerprint) |
| `server/src/db/sessions.ts` (+ test) | CREATE | create, validate (with idle and absolute expiry and fingerprint), touch, revoke, purge |
| `server/src/services/login-throttle.ts` (+ test) | CREATE | per-address failure counting and lockout with an injectable clock |
| `server/src/plugins/auth.ts` (+ tests) | CREATE | cookie handling, the fail-closed `onRequest` hook with its public allow-list, forgery check |
| `server/src/routes/session.ts` (+ tests) | CREATE | `GET`, `POST`, `DELETE /api/session` |
| `server/src/routes/health.ts`, `images.ts` | UPDATE | minimal health for logged-out callers; private photo caching |
| `server/src/plugins/security.ts` | UPDATE | `Cache-Control: private, no-store` for API JSON, `Permissions-Policy`, log redaction of `set-cookie` |
| `server/src/app.ts` | UPDATE | `trustProxy`, register cookie and auth before routes, purge expired sessions |
| `server/src/index.ts` | UPDATE | periodic purge, clear startup message of the auth mode |
| `server/src/errors.ts` | UPDATE | `unauthorized` (401), `forbidden` (403) |
| `server/package.json`, lockfile | UPDATE | `@fastify/cookie` (MIT) |
| `server/test/route-protection.test.ts` | CREATE | every route against a logged-out caller; unknown paths; allow-list |
| `web/src/lib/api.ts` (+ test) | UPDATE | session calls; a 401 from any call tells the app to show the login |
| `web/src/components/AuthGate.tsx`, `LoginPage.tsx` (+ tests) | CREATE | session check, login form, no flash, expiry recovery |
| `web/src/components/Layout.tsx`, `ServerStatus.tsx` | UPDATE | log out button (only when auth is on), health without schema version |
| `web/src/main.tsx` or `App.tsx` | UPDATE | wrap the app in the gate |
| `docs/DEPLOYMENT.md` | CREATE | the guide: options, steps, checklist, backups, updates |
| `deploy/Caddyfile`, `deploy/docker-compose.caddy.yml` | CREATE | HTTPS reverse proxy example, run and verified locally |
| `docker-compose.yml`, `.env.example`, `Dockerfile` | UPDATE | password and proxy settings documented; healthcheck unchanged |
| `SECURITY.md`, `README.md` | UPDATE | threat model, protections, reporting, how to expose safely |
| `.claude/PRPs/reports/auth-hardening-report.md` | CREATE | results, review findings, what was not verified |

## NOT Building
- Accounts, registration, roles, several users, password reset by email, "forgot password" (change the environment variable and restart).
- Single sign-on, OAuth, passkeys or two-factor codes (the guide points to Tailscale or Cloudflare Access as an extra layer).
- TLS inside the app (a reverse proxy or tunnel does that; the guide shows how).
- A password-change screen, an audit-log screen, device management.
- A web application firewall, bot detection, geo blocking.
- Rewriting git history.

---

## Step-by-Step Tasks

### Task 1: Settings and the startup guard
- **ACTION**: add `APP_PASSWORD`, `APP_PASSWORD_FILE` (exactly one may be set; the file is read once at startup and trimmed), `TRUST_PROXY` (`false`, or an integer from 1 to 5), `COOKIE_SECURE` (`auto` default, or `true`). New guard: loopback with no password is fine; a non-loopback host needs a valid password **or** `ALLOW_INSECURE_NO_AUTH=true`; setting both is allowed (the password wins and is enforced); a weak or too-short password is refused at startup with the reason and the command that makes a good one.
- **GOTCHA**: error messages must never print the password. Strength rules: at least 12 characters, not entirely one repeated character, not on a short deny list (`password`, `changeme`, `recipemixer`, and similar, compared case-insensitively and with digits stripped).
- **MIRROR**: `server/src/config.ts`, `config.test.ts`.
- **VALIDATE**: config tests for every combination in the guard matrix, the file form (missing file, empty file, both set), weak passwords, `TRUST_PROXY` values.

### Task 2: Password service and sessions
- **ACTION**: `password.ts` (rules, `passwordMatches(candidate)` via SHA-256 and `timingSafeEqual`, `fingerprint()` = SHA-256 of the password with a fixed label). Migration `005_session.sql` and `sessions.ts`: `createSession(db, fingerprint, now)` returns the raw token (only its hash is stored), `findSession(db, token, fingerprint, now)` enforces the 7-day idle and 30-day absolute limits and the fingerprint, updates `last_seen_at` at most once a minute, deletes a session that fails any check; `revokeSession`, `purgeExpired`.
- **GOTCHA**: never store or log the raw token; compare hashes; the clock is a parameter so tests are exact.
- **VALIDATE**: unit tests for each expiry edge, fingerprint change, revoke, purge, token not recoverable from the table.

### Task 3: Login throttle, cookie and the protection hook
- **ACTION**: `login-throttle.ts`; `auth.ts` plugin registering `@fastify/cookie`, an `onRequest` hook that, when a password is configured, rejects with 401 any `/api/*` request lacking a valid session except the public allow-list (`GET /api/health`, `GET|POST|DELETE /api/session`); a second hook that rejects unsafe-method requests failing the fetch-metadata and `Origin` checks with 403. Cookie options per decision 5, with `Secure` decided by the request protocol (via `trustProxy`) or `COOKIE_SECURE=true`.
- **GOTCHA**: the allow-list is matched on method and exact path after normalisation (no prefix matching, no trailing-slash or case tricks, no `..` or encoded segments); anything that is not a known public route needs a session. Static files (the web app itself) stay public. The hook must run for 404s on unknown API paths too.
- **VALIDATE**: plugin tests with a tiny test app, then the route-protection table test (Task 5).

### Task 4: Session routes and health
- **ACTION**: `GET /api/session` → `{ authRequired, authenticated }`; `POST /api/session` with `{ password }` (strict schema, max length 200) → 204 and cookie, or 401 `Incorrect password` (always the same text), or 429 with `Retry-After` while locked; `DELETE /api/session` → 204, revokes and clears the cookie (idempotent). When no password is configured these report `authRequired: false` and login is a no-op 204. Health returns only `{status:'ok'}` to a logged-out caller when auth is on.
- **GOTCHA**: a successful login rotates (creates) a new session and purges expired ones; failures are logged at `warn` without the candidate; the rate limit on the route is separate from the lockout.
- **VALIDATE**: route tests for every outcome, the lockout and its expiry (fake clock), cookie flags, logout revocation, password change invalidating old sessions, logs containing no password.

### Task 5: Prove nothing is left open
- **ACTION**: `route-protection.test.ts`: with auth on, a table of **every** route method and path (recipes CRUD, rating, image upload and delete, image from URL, cuisines, match, suggest, import preview, images) must answer 401 without a cookie and work with one; unknown `/api/*` paths and odd forms (`/api//recipes`, `/API/recipes`, `/api/recipes/../health`, trailing slashes, encoded slashes) must not reach a handler; the public set is exactly the allow-list. Add a guard test that fails when a route exists in the app but not in the table (collect routes with an `onRoute` hook during the test build).
- **VALIDATE**: mutation check: remove the hook, watch the table fail.

### Task 6: Forgery and caching headers
- **ACTION**: tests and fixes for cross-site `Origin` and `Sec-Fetch-Site` on every unsafe method; `Cache-Control: private, no-store` on API JSON; photos `private, max-age=31536000, immutable`; `Permissions-Policy`; `set-cookie` redacted from logs.
- **VALIDATE**: header assertions on each route family; cross-origin POST without a cookie still gets 401 first, with a cookie gets 403.

### Task 7: Web login
- **ACTION**: `AuthGate` calls `GET /api/session` on load; shows nothing but a small loading state (no flash of the login form when auth is off, no flash of the app when it is on); renders `LoginPage` when required; any API call that returns 401 flips the gate back to the login (preserving the page the user was on); `Layout` shows "Log out" only when auth is on. `LoginPage`: one labelled password field (`autocomplete="current-password"`), clear errors for wrong password and for lockout (with the wait), keyboard friendly, page title, 44 px targets.
- **GOTCHA**: never put the password in a URL or in the browser history state; the password field is cleared after a failure; use the existing design system, CSP unchanged.
- **VALIDATE**: web tests for each state and transition; browser check at phone width.

### Task 8: Deployment files and guide
- **ACTION**: `docs/DEPLOYMENT.md`: (1) local Docker (default, unchanged); (2) private access from the phone with Tailscale Serve (recommended for $0); (3) a public hostname with Cloudflare Tunnel plus Access; (4) a free VM (Google Cloud `e2-micro` with a **standard** disk, Oracle Always Free) with Caddy for HTTPS; (5) what is not free (Fly.io). For each: steps, the settings to use (`APP_PASSWORD_FILE`, `TRUST_PROXY=1`, `HOST`, `ALLOW_INSECURE_NO_AUTH` not needed), a checklist (HTTPS only, strong password, backups of the data folder, updating, what to do if the password leaks), and the date the provider facts were checked with a link to the provider's own page. `deploy/` holds the Caddy example and compose override.
- **GOTCHA**: do not present third-party claims as verified; say what was checked and when. Every command in the guide is run at least once locally before it is written down.
- **VALIDATE**: run the Caddy compose example locally (HTTPS on `localhost` with Caddy's internal CA); `curl -k` login, cookie is `Secure` and `__Host-`, `X-Forwarded-For` is honoured only with `TRUST_PROXY`, health works for the Docker check.

### Task 9: Independent security review and fixes
- **ACTION**: run the security-reviewer agent (and, for the fetcher, the security-auditor agent) over: the Phase 5 fetcher and routes, the new auth plugin, session store, throttle, config guard, headers, Docker and compose, the deployment files. Triage findings by severity, fix high and medium, record the rest with a reason.
- **GOTCHA**: reviewers read code; they do not replace the live tests. Each fix gets a regression test.
- **VALIDATE**: re-review of the fixes by the same agent; the report lists findings and outcomes verbatim in summary.

### Task 10: Final public-repo sweep and docs
- **ACTION**: scan the working tree **and the full git history** for secrets and personal data (gitleaks if available, otherwise regex sweeps for keys, tokens, emails, local paths, data files); list tracked files that should not be public; confirm `.gitignore` covers data, images, `.env`, demo data; check `SECURITY.md` reporting instructions and enable private vulnerability reporting on the repository (the author's click: report the exact setting). Rewrite `SECURITY.md` (threat model, what is protected, what is not, reporting) and update README (how to turn on the password, link to the guide, roadmap 8 done).
- **VALIDATE**: sweep output pasted into the report; docs reviewed for claims that are no longer true.

### Task 11: Full validation and report
- **ACTION**: lint, typecheck, tests, build, audit, licences; Docker run with `APP_PASSWORD_FILE` (read-only root, non-root user, healthcheck passing while logged out); real-browser walk: login, use the app, expiry, log out, wrong password, lockout; Lighthouse accessibility on the login page; the report with security review results.
- **VALIDATE**: all commands below; every acceptance criterion ticked or its shortfall reported.

---

## Testing Strategy

| Test | Input | Expected | Edge? |
|---|---|---|---|
| Startup guard matrix | loopback or not, password or not, opt-in or not, both | refuse or start exactly as the table says | yes |
| Password rules | short, repeated, deny-listed, with spaces, file forms | accepted or refused; password never in the message | yes |
| Session store | create, find, idle expiry, absolute expiry, fingerprint, revoke, purge | exact edges with a fake clock | yes |
| Throttle | 4 failures, 5th, wait, success after lock, two addresses | lock only that address; expiry restores | yes |
| Route protection | every route and odd path, with and without cookie | 401 or success, never a handler for odd paths | yes |
| Forgery | cross-site, same-site, same-origin, none, missing headers, bad `Origin` | 403 or allowed as designed | yes |
| Cookie flags | http, https via proxy header, forced secure | HttpOnly, SameSite=Strict, Path=/, Secure and `__Host-` when secure | |
| Caching | every route family | `private, no-store` or private immutable; never `public` | |
| Logging | failed login, successful login | no password, token or cookie in logs | |
| Web gate | auth off, on logged out, on logged in, 401 mid-use, lockout | no flashes, login shown or hidden correctly, recovery works | yes |

### Edge Cases Checklist
- [ ] Password with spaces, unicode, very long (rejected over 200 characters at login)
- [ ] Two clients behind one proxy address with and without `TRUST_PROXY`
- [ ] Clock changes and expired sessions found after a restart
- [ ] Database restored from an older backup (sessions gone, passwords unaffected)
- [ ] Concurrent logins; logout in another tab
- [ ] `APP_PASSWORD` changed while sessions exist
- [ ] Photos requested directly when logged out
- [ ] Docker healthcheck while auth is on

---

## Validation Commands
```bash
npm run lint && npm run typecheck
npm test
npm run build
npm audit --omit=dev
npm run audit:licenses
```
EXPECT: all clean; the new dependency (`@fastify/cookie`) is MIT and audited.

### Live checks
1. Docker with `APP_PASSWORD_FILE` on a throwaway project: logged-out `curl` of every route family gives 401 except health; login, cookie flags, logout; wrong password five times then lockout; restart keeps sessions; changing the password invalidates them.
2. Caddy example with HTTPS on localhost: cookie is `Secure` and `__Host-`; real client address reaches the throttle only with `TRUST_PROXY=1`.
3. Real browser: login page, wrong password, lockout message, normal use, expiry, log out; Lighthouse on the login page.
4. Security review findings and their fixes re-reviewed.

## Acceptance Criteria
- [ ] Every target above met, or the shortfall reported with numbers
- [ ] No route outside the allow-list answers a logged-out caller, proven by a table test that also fails on unlisted routes
- [ ] Security review has no open high-severity finding
- [ ] Deployment guide commands were all run, provider facts dated and linked
- [ ] Final sweep of the working tree and the full history reported
- [ ] Behaviour with no password on loopback unchanged

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A route left unprotected | M | High | fail-closed hook, table test with a route-collection guard, mutation check |
| Throttle bypass through spoofed addresses | M | High | `TRUST_PROXY` off by default, hop count only, documented, tested with and without |
| Owner locked out by an attacker | L | M | lock per address, not global; password change and restart always works |
| CSRF in a case SameSite misses | L | M | fetch-metadata and `Origin` checks as a second layer |
| Secure cookie not set behind a proxy | M | M | `COOKIE_SECURE=true` option, tested with the Caddy example |
| Guide advice goes stale | H | L | dated facts, provider links, "verify first" wording |
| Reviewer finds a deep issue in the fetcher | M | M | time is reserved for fixes and re-review |
| Migration on an existing database | L | M | additive table only; migration test on a populated database |

## Notes
- Because the web app (HTML, scripts, styles) stays public so the login page can load, it contains no data; all data lives behind `/api`.
- Rate limiting in memory resets on restart, which is acceptable for a single-user app; the lockout is a deterrent, the real protection is a strong password plus HTTPS.
- A password in an environment variable is visible to anyone who can inspect the process; the `APP_PASSWORD_FILE` form and the guide's host-hardening advice address that.
- Tailscale is recommended as the first choice for $0: the app is never exposed to the public internet at all.

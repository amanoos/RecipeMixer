# Implementation Report: Authentication, Hardening and Cloud Guide (RecipeMixer Phase 8)

## Summary
RecipeMixer can now be reached from a phone away from home without handing the library to anyone else. A single shared password (from `APP_PASSWORD_FILE` or `APP_PASSWORD`) protects every recipe, search, import and photo; sessions are random tokens in a locked-down cookie; guessing is limited; other websites cannot act through your browser; and nothing private can be kept by a proxy or CDN. The startup rule is now: a non-loopback address needs a strong password (or the explicit opt-in for the loopback-only Docker mapping). With no password nothing changes for local use, and it is now also safe against DNS rebinding. The phase also delivered the PRD's other items: a deployment guide (Tailscale, Caddy with HTTPS, free virtual machines, Cloudflare Tunnel), an independent security review of the new code and of the Phase 5 URL fetcher, a repository sweep, and a rewritten `SECURITY.md`.

Two independent reviewers found one high-severity problem in each area, plus smaller ones. All were fixed and re-reviewed; at the end no high or medium issue is open.

Nothing is committed. The work is on branch `feat/auth-hardening`, created from `main` after Phase 6 was merged.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large (matched, then some: two review rounds and their fixes) |
| Files Changed | ~35 | 56 |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Settings and startup guard | Done | `APP_PASSWORD`, `APP_PASSWORD_FILE`, `TRUST_PROXY`, `COOKIE_SECURE`, `ALLOWED_HOSTS`; weak or empty passwords refused with a helpful message |
| 2 | Password service and sessions | Done | keyed-hash session store (migration 005), constant-time check |
| 3 | Throttle, cookie and the protection hook | Done | fail-closed hook, exact public list, cross-site check |
| 4 | Session routes and health | Done | `GET`, `POST`, `DELETE /api/session`; minimal health when logged out |
| 5 | Prove nothing is left open | Done | route table test with a collection guard, odd paths, raw-socket request forms |
| 6 | Forgery and caching headers | Done | `private, no-store` on the API, private photos, permissions policy, `Clear-Site-Data` on logout |
| 7 | Web login | Done | `AuthGate`, `LoginPage`, Log out button, expiry recovery |
| 8 | Deployment files and guide | Done | `docs/DEPLOYMENT.md`, `deploy/` Caddy example (built and tested), compose and `.env.example` updates |
| 9 | Independent security review and fixes | Done | two reviewers, two review rounds each, plus a final check |
| 10 | Final public-repo sweep and docs | Done | see below; `SECURITY.md` rewritten, README updated |
| 11 | Full validation and report | Done | |

## Security review (Task 9)

Two read-only reviewers: a security reviewer for all the login and hardening code, and a security auditor for the URL fetcher that was merged in Phase 5 and never reviewed. Each finding was reproduced or reasoned through, fixed with a test, and re-checked; where a test could be isolated it was shown to fail when the fix was removed.

| Area | Severity | Finding | Outcome |
|---|---|---|---|
| Login | **High** | A request line holding a full address (`GET http://host/api/recipes`) skipped the login check and returned the recipe list with no password; the same form let a write through with its cross-site check skipped. Reproduced. | Fixed: any request target that is not a plain path counts as private. New tests send raw HTTP over a real socket (22 tests fail without the fix) |
| Login | Medium | Password rules accepted `123456789012`, `abcdefghijkl` and similar | Fixed: digits only, repeated patterns, alphabet and keyboard runs, wider common-word rule |
| Login | Medium | Lockout counted each IPv6 address separately, so a /64 range never hit it | Fixed: one count per /64 network; plus a global slow-down (never a lockout); the request limiter already groups IPv6 by itself |
| Login | Low | Wrong or missing `TRUST_PROXY` silently weakened the lockout and the cookie flags | One-time warning in the log; docs state the condition |
| Login | Low | Photos stay in the browser cache after logout | The browser is asked to clear its cache on logout |
| Login | Low | `chmod 444` on the password file in the guide | Guide now says `chmod 400` and the container's owner |
| Login | Low | Parallel guesses could slip past the lockout during the slow-down (found in the re-check) | Fixed: the lockout is checked again after the wait; test fails without it |
| Login | Low | Page stays in browser memory behind the login after a session expires | Accepted on purpose (protects unsaved edits), documented |
| Fetcher | **High** | A crafted 2 MB page froze the whole server for many seconds (slow tag-stripping pattern; a second, worse pattern with `<br` and spaces took 44 s, found only in the re-check) | Fixed: one linear pass, bounded list scanning, capped script tags; tests with 2 MB of hostile input (they fail with the old patterns) |
| Fetcher | Medium | Azure's internal host service address and special-purpose ranges not blocked | Fixed: `168.63.129.16`, AS112 and the IETF protocol-assignment IPv6 block are refused |
| Fetcher | Low | A stuck DNS lookup keeps one of Node's four helper threads busy | Docker image sets `UV_THREADPOOL_SIZE=16`; guide covers non-Docker runs |
| Fetcher | Low | Decoding many large images at once can use a lot of memory | At most two decodes at a time (a leaked slot is detected by a test) |
| Fetcher | Low | Search queue growth in the parser | Capped |
| Fetcher | Accepted | No shorter timeout per address (availability only); hosts behind NAT64 cannot import; own public address allowed; import on by default with no password | Listed in `SECURITY.md` |

What both reviewers found sound: no way to reach loopback, private, link-local or cloud-metadata addresses through any address encoding, redirect, DNS or proxy trick; path normalisation variants all fail closed; sessions, cookie handling, constant-time comparison, no password in logs, CSRF and DNS rebinding checks.

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `eslint .` clean; `tsc` clean for server and web |
| Unit Tests | Pass | 1,104 tests: 896 server, 208 web |
| Build | Pass | server and web |
| Audit and licences | Pass | `npm audit --omit=dev`: 0 vulnerabilities; licence check passes with the new MIT dependency `@fastify/cookie` |
| Mutation checks | Pass | for each security control, the behaviour was broken on purpose and a test failed (login hook, public list, cross-site check, host guard, path recognition, throttle, session expiry, cache headers, cookie flags, proxy trust, address grouping, slow-down, recheck, slot leak, parser patterns, address ranges, password rules, web gate behaviours). One redundant layer (whitespace collapse before the script-type check) is covered only through the cap that bounds it |
| Integration (Docker, Caddy HTTPS) | Pass | `deploy/docker-compose.caddy.yml`: HTTPS login sets the `__Host-` Secure cookie; the app's port is not reachable from the host; a faked `X-Forwarded-For` is replaced by Caddy and the app records the real address; five wrong passwords lock that address; sessions survive an app restart; the password is not in the logs or the container's environment; read-only container healthy |
| Integration (Docker, default) | Pass | local use works by `127.0.0.1` and `localhost`; a foreign `Host` is refused with an explanation; a cross-site write is refused; `/api/session` reports no login needed |
| Browser | Pass | login page (Lighthouse accessibility, best practices and SEO all 100), wrong password announced and field emptied, correct password opens the page that was asked for, Log out returns to the login and the API then answers "Login required" |

## Repository sweep (Task 10)

- Working tree and git history scanned: no secret-shaped strings, only example email addresses, no credentials in the current tree, no database, image or `.env` files ever committed (gitleaks itself is not installed here; CI runs it).
- **One known item in history:** two test-output files from Phase 2 (`server/.vitest/json/output.json`, `web/.vitest/json/output.json`) contain the project's local folder path (no user name). They were removed in a later commit and are ignored now. History was **not** rewritten (a force-push changes every clone of a public repository); that is your decision.
- **Found and fixed:** `.dockerignore` did not exclude `deploy/secrets` or `demo-data`, so the password file would have been sent to Docker as build context (it was never copied into the image). Both are excluded now.
- **Needs you:** GitHub **private vulnerability reporting is switched off** for the repository, but `SECURITY.md` tells people to use it, so a report would have nowhere to go. Turn it on in the repository settings (Settings, then Code security, then Private vulnerability reporting). I did not change repository settings.

## Files Changed (56)

| Area | Files |
|---|---|
| Server source (new) | `plugins/auth.ts`, `routes/session.ts`, `db/sessions.ts`, `db/migrations/005_session.sql`, `services/password.ts`, `services/login-throttle.ts`, `services/request-path.ts` |
| Server source (updated) | `config.ts`, `app.ts`, `errors.ts`, `index.ts`, `plugins/security.ts`, `routes/health.ts`, `routes/images.ts`, `services/images.ts`, `services/ip-guard.ts`, `services/recipe-jsonld.ts`, `package.json`, lockfile |
| Server tests (new) | `auth-routes`, `route-protection`, `config-auth`, `password`, `sessions`, `login-throttle`, `request-path`; updated `recipe-jsonld`, `ip-guard`, `images-service`, `config`, `health`, `migrate`, `helpers` |
| Web (new) | `components/AuthGate.tsx`, `LoginPage.tsx`, `lib/auth.ts` and tests; updated `lib/api.ts`, `Layout.tsx`, `ServerStatus.tsx`, `main.tsx` and tests |
| Deployment and docs | `docs/DEPLOYMENT.md`, `deploy/Caddyfile`, `deploy/docker-compose.caddy.yml`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.gitignore`, `.env.example`, `SECURITY.md`, `README.md`, PRD, plan and this report |

## Tests Written

| Test file | Tests |
|---|---|
| `server/test/config-auth.test.ts` | 39 |
| `server/test/password.test.ts` | 38 |
| `server/test/sessions.test.ts` | 15 |
| `server/test/login-throttle.test.ts` | 18 |
| `server/test/auth-routes.test.ts` | 69 |
| `server/test/route-protection.test.ts` | 58 |
| `server/test/request-path.test.ts` | 39 |
| `server/test/recipe-jsonld.test.ts` (extended) | 41 total |
| `server/test/ip-guard.test.ts` (extended) | 75 total |
| `server/test/images-service.test.ts` (extended) | 29 total |
| `web` `AuthGate`, `LoginPage`, `Layout`, `api` | 10, 8, 7, 29 total |

## Deviations from Plan

1. **`TRUST_PROXY` takes the proxy's address, not a hop count.** The Fastify version in use disables hop-count trust on purpose (it lets a direct client fake its address), so the setting is an IP, a range, or `loopback`/`linklocal`/`uniquelocal`; `true` and numbers are refused.
2. **Sessions are tied to the password through a keyed hash.** The session id is HMAC(key from the password, token), so nothing derived from the password is stored and changing the password still ends every session.
3. **A DNS-rebinding guard was added** (not in the plan): with no password, only `localhost`, `127.0.0.1` and `::1` (plus `ALLOWED_HOSTS`) are answered. This is a behaviour change for anyone who opened a no-password app by a LAN address; the error says exactly what to set.
4. **The Caddy example trusts the private ranges** instead of a fixed subnet: the fixed subnet I first chose collided with an existing Docker network on the test machine.
5. **Added after review:** IPv6 /64 grouping and a global slow-down for the lockout, stronger password rules, a warning for untrusted proxy headers, `Clear-Site-Data` on logout, a hidden username field so password managers file the login, two-at-a-time image decoding, `UV_THREADPOOL_SIZE=16`, wider blocked ranges, and the `.dockerignore` fix.
6. **Test hooks in `buildApp`** (`logStream`, `onRoute`) so tests can prove the log never holds a secret and that every route is accounted for.
7. **Redundant code removed:** my own IPv6 key generators for the request limiter, after finding the limiter library already groups IPv6 by network.

## Issues Encountered

- My first tests could not see the high-severity bypass because `app.inject` only builds well-formed request lines; the reviewer's raw-socket probe found it, and the new tests use real sockets.
- Several of my own fixes were incomplete until the re-review (a second slow pattern next to the one I fixed; a malformed Dockerfile line from a scripted edit; lost backslashes in a regex three times). Lesson applied: patterns with backslashes are written as raw strings, timings include whitespace-heavy inputs, and every fix is mutation-checked.
- A mutation check reported "MISSED" once because my harness could not launch a shell script on Windows, not because a test was missing; confirmed by running that mutation by hand.
- The write-gate hook bounced the first write of many files; each was redone after stating the facts it asked for.

## Not Verified

- **Tailscale, Cloudflare Tunnel, Google Cloud and Oracle steps** in the guide were not run (no tailnet, no accounts). Provider facts for Google Cloud and Oracle were read from the providers' own pages; Cloudflare's free-plan terms were not confirmed.
- **Certificate issuance for a real domain and Caddy's automatic HTTP-to-HTTPS redirect** were not tested (the test used Caddy's local certificate).
- **Session expiry mid-use and the lockout message in a real browser** were covered by unit tests only; login, wrong password, log out and the deep-link return were checked in a real browser.
- Keyboard-only and screen-reader use of the login page by a person; a real phone; browsers other than Chrome; the throttled match-page trace from Phase 6.
- **CI on this branch.**
- Behaviour through real nginx, Traefik or Cloudflare, and Docker networking on other hosts.

## Next Steps
- [ ] Enable private vulnerability reporting in the repository settings
- [ ] Decide whether to rewrite git history to remove the two Phase 2 test-output files (not required; they hold only a folder path)
- [ ] Commit on `feat/auth-hardening` and open a PR; merge after CI
- [ ] Phase 7 (optional data sources) is the only phase left in the PRD

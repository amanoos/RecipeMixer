# Implementation Report: Foundation & Security Scaffold (RecipeMixer Phase 1)

## Summary
Built the project base: an MIT-licensed npm-workspaces repo with a Fastify + TypeScript server (config with a network-exposure guard, SQLite via better-sqlite3 with a transactional migration runner and base schema, helmet CSP, rate limiting, health route, static serving with SPA fallback), a React + Vite + Tailwind v4 + shadcn/ui web shell (live health status, persisted dark mode), a hardened non-root Docker image and compose file, CI, Dependabot, a local pre-commit secret scan, and README/SECURITY/CONTRIBUTING docs.

Nothing is committed. The work is on branch `feat/foundation-security-scaffold` (no commits yet).

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large (matched) |
| Confidence | 8/10 | Held. Surprises: port 3000 already in use on the host, Docker install-script failure, lint-config hook, audit and licence findings. All resolved or documented. |
| Files Changed | ~45 | 57 files that would be added (including lockfile, planning docs and this report) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Init repo and hygiene files | Done | Copyright holder set to "RecipeMixer contributors" (no personal name) |
| 2 | Root workspace, TS, ESLint | Done | TypeScript 6.0.3 (see deviations) |
| 3 | Server config with exposure guard | Done | Default port 3210 (deviation) |
| 4 | SQLite connection and migrations | Done | |
| 5 | Fastify app, security, health | Done | |
| 6 | Server build scripts and smoke run | Done | Verified live: headers, JSON 404, DB created |
| 7 | Web shell | Done | shadcn "radix-nova" preset, Geist font self-hosted |
| 8 | Web smoke test | Done | |
| 9 | Dockerfile and compose | Done | Built, healthy, non-root, read-only rootfs, data persisted across recreate |
| 10 | CI, hooks, dependabot | Done (not executed) | Workflow not run: no remote repo yet |
| 11 | Docs and final sweep | Done | gitleaks not run locally (see issues) |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `eslint .` clean; `tsc` clean for server and web |
| Unit Tests | Pass | 48 tests (42 server, 6 web) |
| Build | Pass | server (tsc + migrations copy) and web (Vite) |
| Integration | Pass | Docker: healthy, `/api/health` ok, page served, SPA fallback 200, missing asset 404, uid 1000, read-only fs, data survived `down`/`up`; browser pane: no console errors, only first-party requests |
| Edge Cases | Pass | Exposure guard, bad env values, rollback of failing migration, FK/CHECK constraints, rate limit 429, generic 500, path traversal attempt, localStorage throwing |
| Security/licence | Partial | `npm audit --omit=dev`: 0 vulnerabilities. Licence check passes with the extended allowlist. gitleaks not run locally; regex sweep clean |

## Files Changed

Everything is new (greenfield). Main groups:

| Area | Files |
|---|---|
| Repo hygiene | `.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc`, `.dockerignore`, `.env.example`, `LICENSE` |
| Root tooling | `package.json`, `package-lock.json`, `tsconfig.base.json`, `eslint.config.js` |
| Server | `server/src/{config,app,index}.ts`, `db/{connection,migrate}.ts`, `db/migrations/001_init.sql`, `plugins/security.ts`, `routes/health.ts`, `scripts/copy-migrations.mjs`, `vitest.config.ts`, tsconfigs, 5 test files |
| Web | Vite config and tsconfigs, `index.html`, `src/{main,App,test-setup}.ts(x)`, `App.test.tsx`, `index.css`, shadcn `components.json`, `lib/utils.ts`, `components/ui/{button,card,badge}.tsx` |
| Deploy/CI | `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.githooks/pre-commit` |
| Docs | `README.md`, `SECURITY.md`, `CONTRIBUTING.md` |

## Deviations from Plan

1. **Default port 3210, not 3000.** Port 3000 was already in use by an unrelated application on the author's machine, so a clone would clash. Updated code, tests, `.env.example`, compose, Dockerfile and docs.
2. **TypeScript 6.0.3, not 7.** The Vite template pins `~6.0`, which also avoids the TypeScript 7 / typescript-eslint risk the plan flagged. `baseUrl` was dropped (deprecated in TS 6); the `@/*` alias works via `paths` alone.
3. **React-hooks ESLint rules not enabled.** The plan did not require them, but I tried to add them and a config-protection hook blocked editing `eslint.config.js`. I did not bypass it and removed the unused plugin. Vite's own `oxlint` was dropped in favour of the root ESLint config.
4. **`npm ci --ignore-scripts` in Docker and CI.** Inside the image, better-sqlite3's install script runs `node-gyp rebuild` and fails without a compiler; the bundled prebuilt binary works without it. The deps stage also verifies the native module loads.
5. **Audit scope.** `shadcn` (a CLI) was moved to devDependencies. Seven high advisories remain in its dev-only dependency chain (`braces` / `fast-glob`); none is in the shipped bundle or Docker image. CI blocks on `npm audit --omit=dev` and runs the full audit as informational.
6. **Licence allowlist extended** with OFL-1.1 (Geist font), CC-BY-4.0 and CC-BY-3.0 (data packages), MIT-0, and two compound expressions. All are open licences.
7. **Plan file sanitised**: removed the author's local path and an email fragment from the plan text so `.claude/` can be published.

## Issues Encountered

- GateGuard hooks required fact statements for first writes of each file, which doubled many writes. Resolved by stating facts and retrying.
- gitleaks is not installed locally and I did not pull a container image to run it; a regex sweep for keys, tokens and personal strings found nothing. CI will run gitleaks on full history.
- A test recipe row created while verifying Docker persistence was removed by deleting the throwaway volume.
- The first smoke test hit a different app on port 3000 (see deviation 1); no other process was touched.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `server/test/config.test.ts` | 21 | Defaults, exposure guard, opt-in, invalid values, loopback detection |
| `server/test/migrate.test.ts` | 10 | Idempotence, ordering, rollback, cascade, CHECK, FK, NOT NULL |
| `server/test/health.test.ts` | 8 | Health, JSON 404, generic 500, static serving, SPA fallback, traversal |
| `server/test/security.test.ts` | 3 | CSP and headers, 404 headers, rate limit |
| `web/src/App.test.tsx` | 6 | Health ok/error/non-OK, theme toggle, stored theme, storage failure |

## Next Steps
- [ ] Review with `/code-review`
- [ ] Set the executable bit on `.githooks/pre-commit` when staging: `git update-index --chmod=+x .githooks/pre-commit`
- [ ] Commit with `/prp-commit`, push, and watch the first CI run (gitleaks and docker jobs have never executed)
- [ ] Run `/prp-plan` for Phase 2 (recipes and images)

# Plan: Foundation & Security Scaffold (RecipeMixer Phase 1)

## Summary
Create the empty-but-production-shaped base of RecipeMixer: an MIT-licensed npm-workspaces repo with a Fastify + TypeScript server, a SQLite database with migrations, a React + Vite + Tailwind v4 + shadcn/ui web shell, a hardened non-root Docker image and compose file, and CI that enforces tests, secret scanning, dependency audit and an open-source licence check. No recipe features yet; this phase exists so every later phase lands on a secure, reproducible base.

## User Story
As the author of a public hobby repo, I want a secure, reproducible project base with CI and Docker, so that later features (recipes, search, import) are built safely and anyone who clones the repo cannot leak data or expose an open server by accident.

## Problem → Solution
Empty folder (not even a git repo) → a runnable repo where `docker compose up` serves a styled placeholder UI and `/api/health`, CI is green, the SQLite schema is migrated on start, and the server refuses unsafe network exposure.

## Metadata
- **Complexity**: Large (greenfield, ~45 files, many small ones; no novel logic)
- **Source PRD**: `.claude/PRPs/prds/recipe-mixer.prd.md`
- **PRD Phase**: 1 - Foundation & security scaffold
- **Estimated Files**: ~45

---

## UX Design

### Before
N/A — nothing exists.

### After
```
┌──────────────────────────────────────────────┐
│  RecipeMixer                      [dark/light]│
├──────────────────────────────────────────────┤
│                                              │
│   ┌────────────────────────────────────┐     │
│   │  Welcome to RecipeMixer            │     │
│   │  Server status: ● ok  (db v1)      │     │
│   │  [ Button ]  (shadcn component)    │     │
│   └────────────────────────────────────┘     │
│                                              │
└──────────────────────────────────────────────┘
```
The page calls `GET /api/health` and shows the result. This proves UI → API → DB wiring and the shadcn/Tailwind pipeline.

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Browser at `http://127.0.0.1:3000` | nothing | placeholder page with live health status | Served by Fastify from `web/dist` |
| `GET /api/health` | nothing | `{status:"ok", schemaVersion:1}` | No data leakage; no auth needed |

---

## Mandatory Reading

Greenfield: there are no existing files to read. Before starting, the implementer must read these external pages (not in the repo):

| Priority | Source | Why |
|---|---|---|
| P0 | https://ui.shadcn.com/docs/installation/vite | Exact current `shadcn init` flow; flags and alias setup change between versions |
| P0 | https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html | Docker hardening checklist |
| P1 | https://fastify.dev/docs/latest/ | Plugin and TypeScript conventions |
| P1 | https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md | Pragmas, transactions, `exec` |
| P2 | https://github.com/gitleaks/gitleaks-action | CI secret scanning usage and licence terms |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Local toolchain | `node -v` etc. on this machine | Node v24.19.0, npm 11.17.0, Docker 29.8.2, git 2.52.0 are installed |
| Package versions (checked via `npm view` on 2026-10-16) | npm | better-sqlite3 13.0.3 (engines node>=22), fastify 5.12.7, @fastify/helmet 13.2.0, @fastify/rate-limit 11.2.1, @fastify/static 10.1.6, vite 8.3.4, @vitejs/plugin-react 6.1.2, tailwindcss + @tailwindcss/vite 4.3.3, vitest 5.0.5, typescript 7.0.2, react 19.3.1, eslint 10.13.0, typescript-eslint 8.71.2, tsx 4.23.15, shadcn 4.22.0 |
| better-sqlite3 install | search results (third-party, unverified) | v12+ ships Node 24 binaries; v13 moved to N-API with prebuilt binaries bundled, so a C++ toolchain should not be needed on Windows. Verify with a clean `npm install`. |
| Tailwind v4 + shadcn + Vite | third-party guides | Use `@tailwindcss/vite` plugin (not PostCSS); CSS entry is `@import "tailwindcss";`; no `tailwind.config.js`; `tw-animate-css` replaces `tailwindcss-animate`; the `@/` path alias must be set in BOTH `tsconfig.json` and `tsconfig.app.json` plus `vite.config.ts` |
| Fastify v5 | search results | Requires Node >= 20; register `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/static` as plugins |
| Vite 8 | search results | Needs Node 20.19+ / 22.12+ (satisfied by Node 24) |

KEY_INSIGHT: package versions above were looked up live; re-run `npm view <pkg> version` only if install fails.
GOTCHA: TypeScript 7.0.2 is brand new relative to typescript-eslint 8.71.2. If `npm install` reports a peer-dependency conflict or lint crashes, pin `typescript` to the highest version the installed typescript-eslint supports (check its `peerDependencies`) and note it in the README.

---

## Patterns to Mirror

There is no existing code, so this phase **defines** the conventions that later phases must follow. Record them as written below; do not invent alternatives.

### NAMING_CONVENTION
```
Files:        kebab-case.ts (server), PascalCase.tsx for React components, camelCase for hooks (useThing.ts)
Identifiers:  camelCase functions/variables, PascalCase types/components, SCREAMING_SNAKE env vars
DB:           snake_case tables (singular) and columns, e.g. recipe, recipe_ingredient, created_at
Imports:      ESM only ("type":"module"), explicit ".js" extension on relative server imports (NodeNext)
Web alias:    "@/..." -> web/src/...
```

### ERROR_HANDLING
```ts
// server/src/app.ts  (to create)
// Never leak stack traces or internals to clients; log the detail server-side.
app.setErrorHandler((err, req, reply) => {
  req.log.error({ err }, 'request failed');
  const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
  reply.status(status).send({
    error: status === 500 ? 'Internal Server Error' : err.message,
  });
});
```

### LOGGING_PATTERN
```ts
// Fastify's built-in pino logger. JSON in production, readable in dev; never log secrets, request bodies or full URLs with credentials.
const app = Fastify({
  logger: {
    level: config.logLevel,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  },
});
```

### CONFIG_PATTERN
```ts
// server/src/config.ts  (to create) — all env parsed and validated once, at startup, with zod.
export interface Config {
  host: string; port: number; dataDir: string; webDist: string;
  allowInsecureNoAuth: boolean; logLevel: string; isProduction: boolean;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config { /* parse + defaults */ }
```
Defaults: `HOST=127.0.0.1`, `PORT=3000`, `DATA_DIR=./data`, `LOG_LEVEL=info`.

### REPOSITORY_PATTERN
```ts
// server/src/db/connection.ts  (to create)
// One synchronous better-sqlite3 handle, opened with safe pragmas, passed into route modules; all SQL parameterised.
const db = new Database(path.join(dataDir, 'recipemixer.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
```

### SERVICE_PATTERN
```ts
// Routes are Fastify plugins that receive dependencies via options; no globals.
export const healthRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.get('/api/health', async () => ({ status: 'ok', schemaVersion: getSchemaVersion(db) }));
};
```

### TEST_STRUCTURE
```ts
// server/test/health.test.ts  (to create) — build the app in-memory, use app.inject(), no real port.
import { describe, it, expect, afterEach } from 'vitest';
describe('GET /api/health', () => {
  it('returns ok', async () => {
    const app = await buildApp({ config: testConfig(), db: openMemoryDb() });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
```
Tests live in `server/test/*.test.ts` and `web/src/**/*.test.tsx`. Use temp directories for any on-disk DB; never touch `./data`.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `.gitignore`, `.gitattributes`, `.dockerignore`, `.nvmrc`, `.editorconfig` | CREATE | Repo hygiene; ignore `data/`, `.env*` (except `.env.example`), `*.db*`, uploads, `node_modules`, `dist`; force LF |
| `LICENSE` | CREATE | MIT, author as copyright holder |
| `.env.example` | CREATE | Documented, secret-free config |
| `package.json` (root) | CREATE | npm workspaces `server`, `web`; scripts |
| `tsconfig.base.json` | CREATE | Shared strict compiler options |
| `eslint.config.js` | CREATE | Flat config for server + web |
| `server/package.json`, `server/tsconfig.json` | CREATE | Server package |
| `server/src/config.ts` | CREATE | Env parsing + exposure guard |
| `server/src/db/connection.ts`, `server/src/db/migrate.ts` | CREATE | DB open + migration runner |
| `server/src/db/migrations/001_init.sql` | CREATE | Base schema |
| `server/src/plugins/security.ts` | CREATE | helmet (CSP), rate limit |
| `server/src/routes/health.ts` | CREATE | Health endpoint |
| `server/src/app.ts`, `server/src/index.ts` | CREATE | App factory and entry point |
| `server/test/*.test.ts` | CREATE | Config, migration, health, security-header tests |
| `server/vitest.config.ts` | CREATE | Test config |
| `web/package.json`, `web/tsconfig*.json`, `web/vite.config.ts`, `web/index.html` | CREATE | Vite + React + TS |
| `web/components.json`, `web/src/lib/utils.ts`, `web/src/components/ui/*` | CREATE | shadcn/ui |
| `web/src/main.tsx`, `web/src/App.tsx`, `web/src/index.css` | CREATE | Shell, health status, theme |
| `web/src/App.test.tsx` | CREATE | UI smoke test |
| `Dockerfile`, `docker-compose.yml` | CREATE | Hardened image, loopback-only publish |
| `.github/workflows/ci.yml`, `.github/dependabot.yml` | CREATE | CI + dependency updates |
| `.githooks/pre-commit` | CREATE | Local gitleaks check |
| `README.md`, `SECURITY.md`, `CONTRIBUTING.md` (short) | CREATE | Run, deploy and security docs |

## NOT Building

- Recipe CRUD, image upload, search, ingredient matching, URL import (Phases 2-5).
- Password auth (Phase 8). Phase 1 only adds the startup guard that refuses public binding without an explicit insecure opt-in.
- FTS5 tables (Phase 3), seed data (Phase 7), cloud deployment guide beyond a short README note (Phase 8).
- Prettier or a heavy formatting toolchain; ESLint plus `.editorconfig` is enough.

---

## Step-by-Step Tasks

### Task 1: Initialise repo and hygiene files
- **ACTION**: In the repository root, `git init -b main`, then create `.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc` (`24`), `LICENSE` (MIT), `.env.example`.
- **IMPLEMENT**: `.gitignore` must ignore: `node_modules/`, `dist/`, `data/`, `*.db`, `*.db-wal`, `*.db-shm`, `*.sqlite*`, `.env`, `.env.*` with `!.env.example`, `uploads/`, `images/`, `coverage/`, `*.log`, `.DS_Store`, `.claude/settings.local.json`. `.gitattributes`: `* text=auto eol=lf`. `.env.example` lists `HOST`, `PORT`, `DATA_DIR`, `LOG_LEVEL`, `ALLOW_INSECURE_NO_AUTH` with comments and NO real values.
- **MIRROR**: NAMING_CONVENTION.
- **IMPORTS**: none.
- **GOTCHA**: Windows autocrlf will otherwise corrupt shell scripts and the Dockerfile; `.gitattributes` fixes it. Do not commit anything under `data/`. Confirm the author's preferred copyright-holder name before writing `LICENSE`.
- **VALIDATE**: `git status --short` lists only intended files; `git check-ignore -v data/x.db .env` reports both ignored; `git check-ignore .env.example` reports NOT ignored.

### Task 2: Root workspace, TypeScript and ESLint config
- **ACTION**: Create root `package.json` (`"private": true`, `"type": "module"`, `"workspaces": ["server","web"]`, `"engines": {"node": ">=22"}`), `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), `eslint.config.js`.
- **IMPLEMENT**: Root scripts: `dev` (concurrently server+web), `build` (web then server), `start` (`node server/dist/index.js`), `lint`, `typecheck`, `test`, `audit:licenses`, `secrets:scan`. Dev dependencies at root: `typescript`, `eslint`, `typescript-eslint`, `concurrently`, `license-checker-rseidelsohn`.
- **MIRROR**: NAMING_CONVENTION.
- **IMPORTS**: n/a.
- **GOTCHA**: See the TypeScript 7 / typescript-eslint peer-dependency note above. Run `npm install` and read any `ERESOLVE` output rather than using `--force`.
- **VALIDATE**: `npm install` succeeds with no peer errors; `npx tsc -v` prints a version; `npx eslint --version` works.

### Task 3: Server config with exposure guard (test first)
- **ACTION**: Write `server/test/config.test.ts`, then `server/src/config.ts`.
- **IMPLEMENT**: `loadConfig(env)` validates with zod (`npm i zod -w server`). Add `isLoopbackHost(host)` (`127.0.0.1`, `::1`, `localhost`). Rule: if the host is NOT loopback and `ALLOW_INSECURE_NO_AUTH !== 'true'`, throw `Error('Refusing to bind to <host> without authentication...')`. Resolve `dataDir` and `webDist` to absolute paths.
- **MIRROR**: CONFIG_PATTERN.
- **IMPORTS**: `import { z } from 'zod'`, `node:path`.
- **GOTCHA**: Phase 8 will add `APP_PASSWORD` auth that also satisfies this guard. Until then, `APP_PASSWORD` must NOT be treated as sufficient, or users get false security. Note this in a code comment and the README.
- **VALIDATE**: `npm test -w server -- config` passes. Cases: defaults are loopback; `HOST=0.0.0.0` throws; `HOST=0.0.0.0` with `ALLOW_INSECURE_NO_AUTH=true` passes; invalid `PORT` throws.

### Task 4: SQLite connection and migrations (test first)
- **ACTION**: Write `server/test/migrate.test.ts`, then `server/src/db/connection.ts`, `server/src/db/migrate.ts`, `server/src/db/migrations/001_init.sql`.
- **IMPLEMENT**: `openDatabase(dataDir)` creates the directory (mode 0o700) and opens the DB with WAL, `foreign_keys=ON`, `busy_timeout`. `migrate(db)` reads `*.sql` files sorted by name, records applied versions in `schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT)`, runs each unapplied file inside a transaction. `getSchemaVersion(db)` returns the highest applied version. `001_init.sql` creates: `recipe(id INTEGER PK, title TEXT NOT NULL, cuisine TEXT, description TEXT, source_url TEXT, image_path TEXT, rating INTEGER CHECK(rating BETWEEN 1 AND 5), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`, `recipe_ingredient(id, recipe_id REFERENCES recipe ON DELETE CASCADE, position INTEGER, raw_text TEXT NOT NULL, name_normalized TEXT, quantity REAL, unit TEXT)` with indexes on `name_normalized` and `recipe_id`, and `recipe_step(id, recipe_id REFERENCES recipe ON DELETE CASCADE, position INTEGER, text TEXT NOT NULL)`.
- **MIRROR**: REPOSITORY_PATTERN.
- **IMPORTS**: `better-sqlite3` (`npm i better-sqlite3 -w server`; `npm i -D @types/better-sqlite3 -w server`), `node:fs`, `node:path`, `node:url`.
- **GOTCHA**: Migration SQL files must be copied into `dist` on build (a copy step in the server build script); verify with the Docker build. Use `db.exec` only for static SQL files, never for strings built from user input. `:memory:` DBs are used in tests.
- **VALIDATE**: `npm test -w server -- migrate` passes: running `migrate` twice is idempotent; version is 1; deleting a recipe cascades to ingredients; rating 6 is rejected; foreign key violations are rejected.

### Task 5: Fastify app, security plugin, health route (test first)
- **ACTION**: Write `server/test/health.test.ts` and `server/test/security.test.ts`, then `server/src/plugins/security.ts`, `server/src/routes/health.ts`, `server/src/app.ts`, `server/src/index.ts`.
- **IMPLEMENT**: `npm i fastify @fastify/helmet @fastify/rate-limit @fastify/static -w server`. `buildApp({config, db})` returns a configured instance: logger with redaction, error handler (ERROR_HANDLING), helmet with CSP `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'`, rate limit 300 requests/minute per IP, health route, static serving of `config.webDist` at `/` with SPA fallback (`setNotFoundHandler` returns `index.html` for non-`/api` GET requests, JSON 404 for `/api/*`). `index.ts` loads config, opens DB, migrates, builds the app, listens on `config.host:config.port`, and closes the app and DB cleanly on SIGINT/SIGTERM.
- **MIRROR**: SERVICE_PATTERN, ERROR_HANDLING, LOGGING_PATTERN, TEST_STRUCTURE.
- **IMPORTS**: `fastify`, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/static`.
- **GOTCHA**: The data directory must never be inside the statically served directory. Do not serve `config.dataDir` at all in this phase (images get a dedicated validated route in Phase 2). Do not use `trustProxy` by default (it would let clients spoof IPs for rate limiting); document it as a Phase 8 setting for cloud proxies. Static serving must tolerate a missing `web/dist` in tests (skip registration when absent).
- **VALIDATE**: `npm test -w server` passes. Cases: `/api/health` returns 200 and `{status:'ok', schemaVersion:1}`; response has `content-security-policy`, `x-content-type-options: nosniff`, no `x-powered-by`; unknown `/api/nope` returns JSON 404; a thrown error returns a generic 500 without a stack trace; the 301st request in a minute returns 429.

### Task 6: Server build scripts and manual smoke run
- **ACTION**: Add `server/package.json` scripts (`dev` with `tsx watch src/index.ts`, `build` with `tsc -p tsconfig.json` plus copy of `src/db/migrations` to `dist/db/migrations`, `start`, `test`, `typecheck`).
- **IMPLEMENT**: `tsconfig.json` extends the base with `module: NodeNext`, `outDir: dist`, `rootDir: src`.
- **MIRROR**: NAMING_CONVENTION.
- **IMPORTS**: n/a.
- **GOTCHA**: On Windows use a small Node script (`fs.cpSync`) for the copy step, not `cp -r`, so `npm run build` works in PowerShell and CI alike.
- **VALIDATE**: `npm run build -w server && node server/dist/index.js` starts; in another shell `curl http://127.0.0.1:3000/api/health` returns the health JSON; `data/recipemixer.db` appears and is git-ignored; Ctrl+C exits cleanly.

### Task 7: Web shell (Vite, React, Tailwind v4, shadcn/ui)
- **ACTION**: Scaffold `web/` (`npm create vite@latest web -- --template react-ts`, then remove the demo content), install Tailwind v4 (`npm i tailwindcss @tailwindcss/vite -w web`), add the `tailwindcss()` plugin to `vite.config.ts`, set `index.css` to `@import "tailwindcss";`, add the `@/` alias to `vite.config.ts`, `tsconfig.json` and `tsconfig.app.json`, then run `npx shadcn@latest init` inside `web/` (follow the current docs page from Mandatory Reading) and `npx shadcn@latest add button card badge`.
- **IMPLEMENT**: `vite.config.ts` dev server proxies `/api` to `http://127.0.0.1:3000`. `App.tsx` renders a header with title and a dark-mode toggle (class strategy, persisted in `localStorage`, default follows `prefers-color-scheme`), and a Card showing the result of `fetch('/api/health')` with loading and error states, plus a Button. No inline `<style>` or inline scripts (CSP). Use `lang="en"`, a viewport meta, and a descriptive `<title>`.
- **MIRROR**: NAMING_CONVENTION (PascalCase components, `@/` imports).
- **IMPORTS**: `@/components/ui/button`, `@/components/ui/card`.
- **GOTCHA**: The alias must exist in both tsconfig files or `shadcn init` fails. Do not add Google Fonts or any CDN (privacy, and blocked by CSP); use the system font stack or self-hosted fonts later. The built output must not contain inline scripts. Tailwind v4 has no `tailwind.config.js`; do not create one.
- **VALIDATE**: `npm run dev` (root) opens the UI at the Vite port with a styled card showing `ok`; `npm run build -w web` succeeds; the built `web/dist/index.html` contains no inline script body.

### Task 8: Web smoke test
- **ACTION**: Add `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom` to `web`, configure the `test` block in `vite.config.ts`, write `web/src/App.test.tsx`.
- **IMPLEMENT**: Mock `fetch` to resolve `{status:'ok',schemaVersion:1}` and assert the status text appears; mock rejection and assert an error message appears; assert the theme toggle flips the `dark` class on `document.documentElement`.
- **MIRROR**: TEST_STRUCTURE (behaviour-focused, accessible queries such as `getByRole`).
- **IMPORTS**: `@testing-library/react`, `vitest`.
- **GOTCHA**: Guard `localStorage` access with try/catch in the app so tests and private-browsing modes do not crash.
- **VALIDATE**: `npm test -w web` passes.

### Task 9: Dockerfile and compose
- **ACTION**: Create `Dockerfile`, `.dockerignore`, `docker-compose.yml`.
- **IMPLEMENT**: Multi-stage build on `node:24-bookworm-slim` (glibc, so the better-sqlite3 prebuilt binary applies; avoid Alpine). Stage 1 installs all dependencies with `npm ci` and builds web and server. Stage 2 installs production dependencies only (`npm ci --omit=dev`), copies `server/dist` and `web/dist`, sets `ENV NODE_ENV=production HOST=0.0.0.0 DATA_DIR=/data WEB_DIST=/app/web/dist`, creates `/data` owned by `node`, `USER node`, `EXPOSE 3000`, and a `HEALTHCHECK` using `node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"` (no curl in slim images). Compose: build `.`, `ports: ["127.0.0.1:3000:3000"]`, named volume `recipemixer-data:/data`, `read_only: true`, `tmpfs: [/tmp]`, `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`, `restart: unless-stopped`, and `ALLOW_INSECURE_NO_AUTH=true` with a prominent comment: "Safe ONLY because the port is published on 127.0.0.1. If you change the port mapping to expose the app, you must add authentication (Phase 8)."
- **MIRROR**: CONFIG_PATTERN (env-driven config).
- **IMPORTS**: n/a.
- **GOTCHA**: Inside the container the app must bind `0.0.0.0` for Docker's port publishing to work; the loopback protection comes from the compose port mapping, which is why the explicit opt-in flag exists. A named volume inherits ownership from the image path only if `/data` exists and is owned by `node` in the image, otherwise SQLite cannot write. `.dockerignore` must exclude `.git`, `node_modules`, `data`, `.env*`, and `.claude`.
- **VALIDATE**: `docker compose build` succeeds; `docker compose up -d`; `curl http://127.0.0.1:3000/api/health` returns ok; `docker compose ps` shows `healthy`; `docker compose exec app id` shows non-root; `docker compose down && docker compose up -d` keeps the DB (volume persists); the UI loads in the browser at `http://127.0.0.1:3000`.

### Task 10: CI, dependency updates, secret scanning, licence check
- **ACTION**: Create `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.githooks/pre-commit`, and add `permissions: contents: read` at workflow level.
- **IMPLEMENT**: CI jobs on push and pull request: (1) `check`: `actions/checkout`, `actions/setup-node` (Node 24, npm cache), `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`; (2) `security`: `npm audit --audit-level=high`, `npm run audit:licenses` (fails on anything outside MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, CC0-1.0, MPL-2.0, Python-2.0), and gitleaks with full history (`fetch-depth: 0`); (3) `docker`: `docker build .` smoke test. Dependabot weekly for `npm`, `github-actions` and `docker`. `.githooks/pre-commit` runs `gitleaks protect --staged` when gitleaks is installed, otherwise prints a warning and exits 0; README documents `git config core.hooksPath .githooks`.
- **MIRROR**: n/a (new).
- **IMPORTS**: n/a.
- **GOTCHA**: `gitleaks/gitleaks-action` is free for personal accounts but needs a licence key for organisations; if that becomes a problem, run the gitleaks binary directly. Pin third-party actions to a full commit SHA in a later hardening pass. `npm audit` may flag dev-only dependencies; scope with `--omit=dev` only if noise blocks CI and document the decision.
- **VALIDATE**: `npm run audit:licenses` passes locally; `npm audit --audit-level=high` exits 0; the workflow YAML parses (push to a branch and observe the run, or use a YAML linter); a deliberately planted fake secret in a scratch file is caught by `gitleaks detect --no-git`, then removed before the first real commit.

### Task 11: Documentation and final sweep
- **ACTION**: Write `README.md`, `SECURITY.md`, `CONTRIBUTING.md`; run the public-repo sweep.
- **IMPLEMENT**: README: what the app is, roadmap, quick start (`npm install && npm run dev`), Docker start (`docker compose up -d`), non-Docker production (`npm run build && npm start`), configuration table, data location and backup note, MIT licence, third-party data note (user-imported recipe content and images belong to their owners and are never committed). SECURITY.md: how to report a vulnerability privately (GitHub private vulnerability reporting), threat model summary (single user, loopback default, SSRF protections arriving in Phase 5, auth arriving in Phase 8, do not expose publicly until then).
- **MIRROR**: n/a.
- **IMPORTS**: n/a.
- **GOTCHA**: Do not put the author's email, machine paths or hostnames in any committed file unless the author chooses to publish them. Check `package.json` `author` and `LICENSE`.
- **VALIDATE**: `git grep -nIE "(C:\\\\Users|/Users/|@gmail)"` returns nothing in tracked files except an intentional copyright line; `gitleaks detect --no-git` is clean; `git ls-files | grep -E "\.(db|sqlite|png|jpg|jpeg|webp)$"` returns nothing; the README commands work from a fresh clone in a temp folder.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Config defaults | empty env | host `127.0.0.1`, port 3000 | No |
| Config exposure guard | `HOST=0.0.0.0`, no flag | throws | Yes |
| Config opt-in | `HOST=0.0.0.0`, `ALLOW_INSECURE_NO_AUTH=true` | accepted | Yes |
| Config bad port | `PORT=abc` / `70000` | throws | Yes |
| Migration idempotence | run `migrate` twice | version stays 1 | Yes |
| Cascade delete | delete recipe | ingredients/steps removed | No |
| Rating constraint | rating 0 / 6 | insert rejected | Yes |
| Foreign key enforcement | ingredient with missing recipe | insert rejected | Yes |
| Health route | GET `/api/health` | 200, status ok, schemaVersion 1 | No |
| Security headers | any response | CSP, nosniff, no `x-powered-by` | No |
| Error handler | route throws | 500 generic JSON, no stack | Yes |
| Rate limit | 301 requests/min | 429 | Yes |
| API 404 | GET `/api/nope` | JSON 404, not HTML | Yes |
| UI health ok | fetch resolves ok | status text visible | No |
| UI health failure | fetch rejects | error message visible | Yes |
| Theme toggle | click toggle | `dark` class toggles; survives `localStorage` throwing | Yes |

### Edge Cases Checklist
- [ ] Empty input (empty env, data dir created on demand)
- [ ] Maximum size input (default 1 MB body limit retained)
- [ ] Invalid types (bad env values)
- [ ] Concurrent access (WAL mode, busy timeout)
- [ ] Network failure (UI shows error state when API is down)
- [ ] Permission denied (data directory not writable gives a clear startup error)
- [ ] Missing `web/dist` (server starts and serves API only)

---

## Validation Commands

### Static Analysis
```bash
npm run typecheck && npm run lint
```
EXPECT: Zero type errors, zero lint errors

### Unit Tests
```bash
npm test -w server && npm test -w web
```
EXPECT: All tests pass

### Full Test Suite
```bash
npm test && npm run build
```
EXPECT: No regressions, both builds succeed

### Database Validation
```bash
node server/dist/index.js   # then in another shell:
curl http://127.0.0.1:3000/api/health
```
EXPECT: `{"status":"ok","schemaVersion":1}` and `data/recipemixer.db` created (git-ignored)

### Security and Licence Checks
```bash
npm audit --audit-level=high && npm run audit:licenses && gitleaks detect --no-banner
```
EXPECT: No high vulnerabilities, only allowed licences, no leaked secrets

### Docker Validation
```bash
docker compose up -d --build && docker compose ps && curl http://127.0.0.1:3000/api/health
```
EXPECT: container `healthy`, runs as non-root, health JSON returned, data survives `docker compose down` then `up`

### Browser Validation
Open `http://127.0.0.1:3000` (and the `npm run dev` Vite URL).
EXPECT: styled placeholder with live server status, working dark-mode toggle, no console errors, no CSP violations

### Manual Validation
- [ ] `HOST=0.0.0.0 npm start` refuses to start with a clear message
- [ ] Browser devtools Network tab shows no third-party requests
- [ ] Response headers include CSP and `nosniff`
- [ ] Fresh clone into a temp folder: README quick start works end to end

---

## Acceptance Criteria
- [ ] All tasks completed
- [ ] All validation commands pass
- [ ] Tests written and passing
- [ ] No type errors
- [ ] No lint errors
- [ ] Matches UX design
- [ ] CI workflow green on a pushed branch
- [ ] PRD Phase 1 success signal: `docker compose up` serves the UI, CI green, gitleaks clean

## Completion Checklist
- [ ] Code follows the conventions defined in Patterns to Mirror
- [ ] Errors never leak internals
- [ ] Logging redacts sensitive headers
- [ ] Tests use temp/in-memory databases only
- [ ] No hardcoded secrets or paths
- [ ] README and SECURITY.md written
- [ ] No Phase 2+ scope added
- [ ] Self-contained: next phase can start without re-deciding stack or layout

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| TypeScript 7 conflicts with typescript-eslint or other tooling | M | M | Check peer ranges; pin TypeScript to the highest supported version and record it |
| better-sqlite3 needs a compiler on this Windows machine | L | M | Prebuilt binaries expected for v13; otherwise install VS Build Tools, or use Docker for dev |
| shadcn CLI flow differs from the documented steps | M | L | Follow the live docs page; shadcn CLI version is 4.22.0 |
| Compose insecure-flag misread as "safe to expose" | M | H | Loud comments in compose, README and SECURITY.md; Phase 8 adds real auth; guard message explains the risk |
| Migration SQL files missing from the Docker image | M | H | Build copies them; Docker validation starts the container and checks schema version |
| gitleaks-action licence terms | L | L | Fall back to running the binary directly |
| Accidentally committing personal data or `.claude` plans with paths | L | M | Final sweep grep; decide explicitly whether `.claude/` is public |

## Notes
- `git init` has not been run yet; the folder is not a repository. Task 1 does it. Make the first commit only after the sweep in Task 11, so history never contains stray secrets.
- `.claude/PRPs/` (PRD and plans) contains no secrets but is project-planning material; the author should decide whether to publish it. Default in this plan: keep it tracked, since it documents design decisions, but ignore `.claude/settings.local.json`.
- Auth is deliberately deferred to Phase 8; the startup guard is the interim control.
- Decision to confirm before coding: Fastify (chosen for its security plugins and typed plugin model) versus Hono. The plan assumes Fastify.
- Confidence for one-pass implementation: 8/10. The main uncertainties are TypeScript 7 tooling compatibility and shadcn CLI drift, both detectable early in Tasks 2 and 7.

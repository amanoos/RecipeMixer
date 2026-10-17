# Plan: Recipes & Images (RecipeMixer Phase 2)

## Summary
Add the first real feature: store, view, edit and delete recipes (title, cuisine, description, source URL, own 1-5 rating, ingredient lines, steps) with an optional image per recipe. The server gains a validated JSON CRUD API and a hardened image pipeline (type allowlist, size and pixel limits, re-encode to WebP, strip metadata, content-addressed files on disk). The web app gains a recipe list, detail page and create/edit form with image upload. Search, ingredient matching and URL import are later phases.

## User Story
As a home cook, I want to save my recipes with a photo and see them in a list, so that I have my own searchable collection to cook from.

## Problem → Solution
The app can only show a health check; there is no way to store anything → recipes and images persist in SQLite plus `DATA_DIR/images`, survive restarts, and can be created, edited and deleted from the UI.

## Metadata
- **Complexity**: Large (~35 files; new server layers, image pipeline, three UI pages)
- **Source PRD**: `.claude/PRPs/prds/recipe-mixer.prd.md`
- **PRD Phase**: 2 - Recipes & images
- **Estimated Files**: ~35 (about 20 new server/test, 15 web)

---

## UX Design

### Before
```
┌──────────────────────────────────────────────┐
│  RecipeMixer                      [dark/light]│
├──────────────────────────────────────────────┤
│  Welcome to RecipeMixer                      │
│  [online] Server is running (schema v1)      │
└──────────────────────────────────────────────┘
```

### After
```
┌──────────────────────────────────────────────┐
│  RecipeMixer                [+ New] [dark]   │
├──────────────────────────────────────────────┤
│  ┌───────┐ ┌───────┐ ┌───────┐               │
│  │ photo │ │ photo │ │ (none)│   Recipe cards│
│  │ Soup  │ │ Curry │ │ Salad │   (title,     │
│  │ ★★★★☆ │ │ ★★★★★ │ │       │    cuisine,   │
│  └───────┘ └───────┘ └───────┘    rating)    │
│  [Load more]                                 │
├──────────────────────────────────────────────┤
│  ● server online · schema v2   (footer)      │
└──────────────────────────────────────────────┘

/recipes/:id        photo, meta, ingredients list, steps, [Edit] [Delete]
/recipes/new        form: title*, cuisine, description, source URL, stars,
/recipes/:id/edit         ingredients (one per line), steps (one per line), image
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| `/` | Welcome card with health status | Recipe grid, empty state with "Add your first recipe" | Health moves to a small footer indicator |
| Create/edit | none | Form with client and server validation | Image uploaded after the recipe is saved |
| Delete | none | Confirmation dialog, then removes recipe and its image file if unused | Irreversible, so always confirm |
| Image | none | JPEG/PNG/WebP up to 5 MB, shown as 1600px WebP | EXIF/GPS stripped server-side |

---

## Mandatory Reading

Files that MUST be read before implementing (all exist today):

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `server/src/app.ts` | 24-60 | App factory: logger, error handler, plugin registration, not-found/SPA handler |
| P0 | `server/src/routes/health.ts` | 1-10 | Route-as-plugin pattern with injected `db` |
| P0 | `server/src/db/migrate.ts` | 16-50 | Migration runner (file naming `NNN_name.sql`, one transaction each) |
| P0 | `server/src/db/migrations/001_init.sql` | all | Existing schema to build on |
| P0 | `server/src/config.ts` | all | Env parsing with zod and the `Config` interface to extend |
| P0 | `server/test/helpers.ts` | 10-34 | `testConfig`, `makeApp`, `makeTempDir` test helpers |
| P1 | `server/src/plugins/security.ts` | 12-35 | CSP (`img-src 'self' data:`) and rate limit |
| P1 | `server/test/health.test.ts` | 1-30 | Test style with `app.inject` |
| P1 | `web/src/App.tsx` | 20-71 | Guarded localStorage, fetch with AbortController, theme toggle |
| P1 | `web/src/App.test.tsx` | 1-40 | Fetch stubbing and RTL patterns |
| P2 | `web/src/components/ui/{button,card,badge}.tsx` | all | shadcn components already installed |
| P2 | `Dockerfile`, `docker-compose.yml` | all | Install flags (`--ignore-scripts`), read-only rootfs, `/data` volume |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Image library | npm `sharp` 0.35.5 (Apache-2.0) | No install script; prebuilt binaries arrive as `optionalDependencies` (`@img/sharp-*`), so `npm ci --ignore-scripts` works. Its bundled `@img/sharp-libvips-*` packages are **LGPL-3.0-or-later** (open source; add to the licence allowlist). |
| sharp usage | sharp docs (via search) | `.rotate()` with no argument applies EXIF orientation; omitting `.withMetadata()` strips metadata; `resize({fit:'inside', withoutEnlargement:true})`; `.webp()` then `.toBuffer()`. Set `limitInputPixels` explicitly. |
| Multipart | npm `@fastify/multipart` 10.1.4 (MIT) | Defaults: fileSize 1 MiB. Versions below 10.1.1 had a CVE (truncated file part could hang the request), so require `>=10.1.1`. Over-limit throws a `RequestFileTooLargeError`; verify `toBuffer` on the file object against the installed README. |
| Router | npm `react-router` 8.4.0 (MIT) | v8 needs Node >= 22.22 and React >= 19.2.7 (we have Node 24, React 19.3.1). Single package `react-router` (not `react-router-dom`). Confirm the declarative `BrowserRouter`/`Routes`/`Route` imports against the v8 docs before coding; search results did not confirm them. |
| Upload hardening | OWASP File Upload Cheat Sheet | Never trust client MIME or filename; generate names server-side; re-encode; limit size. |

GOTCHA: SVG. sharp can read SVG, which is an XSS and external-reference risk. Decide the type from `sharp(...).metadata().format` and allow only `jpeg`, `png`, `webp`; reject everything else.
GOTCHA: `blob:` URLs are blocked by the CSP (`img-src 'self' data:`). Use `FileReader.readAsDataURL` for the upload preview rather than `URL.createObjectURL`, so the CSP stays strict.

---

## Patterns to Mirror

Real snippets from Phase 1. Follow them exactly.

### NAMING_CONVENTION
// SOURCE: server/src/routes/health.ts:5-10, server/src/config.ts
```ts
export const healthRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => { ... };
// files: kebab-case.ts; functions camelCase; env vars SCREAMING_SNAKE (HOST, PORT, DATA_DIR)
// relative imports end in .js (NodeNext): import { getSchemaVersion } from '../db/migrate.js';
// DB: snake_case tables/columns (recipe, recipe_ingredient, created_at). API JSON: camelCase.
```

### ERROR_HANDLING
// SOURCE: server/src/app.ts:32-39
```ts
app.setErrorHandler((err: FastifyError, req, reply) => {
  req.log.error({ err }, 'request failed');
  const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
  void reply.status(status).send({
    error: status === 500 ? 'Internal Server Error' : err.message,
  });
});
```
Any error with `statusCode < 500` has its message sent to the client, so new code throws `HttpError` (with a `statusCode`) for 400/404/413/415 and never puts internals in the message.

### LOGGING_PATTERN
// SOURCE: server/src/app.ts:25-30
```ts
const app = Fastify({
  logger: { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] },
});
// use req.log.info / req.log.error; never log file contents or full user text
```

### REPOSITORY_PATTERN
// SOURCE: server/src/db/connection.ts:11-16, server/src/db/migrate.ts (transaction usage)
```ts
// Synchronous better-sqlite3 handle, parameterised statements only, multi-row writes in a transaction:
db.transaction(() => {
  db.exec(sql);
  db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
})();
```

### SERVICE_PATTERN
// SOURCE: server/src/routes/health.ts:5-10, server/src/app.ts:41-42
```ts
await app.register(healthRoutes, { db });   // routes are plugins that receive dependencies via options
```

### TEST_STRUCTURE
// SOURCE: server/test/health.test.ts:1-20, server/test/helpers.ts:23-34
```ts
let app: FastifyInstance;
afterEach(async () => { await app?.close(); });
it('returns ok', async () => {
  app = await makeApp();
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  expect(res.statusCode).toBe(200);
});
// helpers: testConfig(overrides), makeApp(overrides, rateLimitMax), makeTempDir(prefix)
```

### WEB_STORAGE_AND_FETCH_PATTERN
// SOURCE: web/src/App.tsx:21-65
```tsx
// every localStorage access is wrapped in try/catch; fetch uses an AbortController cleaned up in the effect
const controller = new AbortController();
fetch('/api/health', { signal: controller.signal }).then(...).catch(() => { if (!controller.signal.aborted) ... });
return () => controller.abort();
```

### WEB_TEST_PATTERN
// SOURCE: web/src/App.test.tsx:1-29
```tsx
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({...}) }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
// queries by role/text: await screen.findByText(...), userEvent.setup()
```

---

## Files to Change

### Server
| File | Action | Justification |
|---|---|---|
| `package.json` (root) | UPDATE | `engines.node >=22.22`; licence allowlist add `LGPL-3.0-or-later` |
| `server/package.json` | UPDATE | add `sharp`, `@fastify/multipart` (via npm install) |
| `server/src/config.ts` | UPDATE | add `imagesDir` (= `dataDir/images`) to `Config` and `loadConfig` |
| `server/src/errors.ts` | CREATE | `HttpError` with `statusCode` |
| `server/src/db/migrations/002_recipe_indexes.sql` | CREATE | indexes on `recipe(created_at)` and `recipe(image_path)` |
| `server/src/schemas/recipe.ts` | CREATE | zod input schemas and output types |
| `server/src/db/recipes.ts` | CREATE | recipe repository (list, get, create, update, delete, set image, count image refs) |
| `server/src/services/images.ts` | CREATE | `processImage` and `createImageStore` |
| `server/src/routes/recipes.ts` | CREATE | recipe CRUD and image upload/delete routes |
| `server/src/routes/images.ts` | CREATE | `GET /api/images/:filename` |
| `server/src/app.ts` | UPDATE | register multipart, image store, new routes |
| `server/test/helpers.ts` | UPDATE | `imagesDir` in `testConfig`, per-app temp images dir, `multipartBody` and `tinyPng` helpers |
| `server/test/health.test.ts`, `server/test/migrate.test.ts` | UPDATE | schema version 1 → 2 (health:18; migrate:23,28,29,30) |
| `server/test/{errors,recipes-repo,recipes-routes,images-service,images-routes}.test.ts` | CREATE | new coverage |
| `Dockerfile` | UPDATE | verify `sharp` loads in the deps stage |

### Web
| File | Action | Justification |
|---|---|---|
| `web/package.json` | UPDATE | add `react-router`; shadcn adds Radix packages |
| `web/src/components/ui/{input,textarea,label,alert-dialog,skeleton}.tsx` | CREATE | via `npx shadcn@latest add` |
| `web/src/lib/api.ts`, `web/src/lib/types.ts` | CREATE | typed API client and shared types |
| `web/src/components/{Layout,RecipeCard,StarRating,ImagePicker,ServerStatus}.tsx` | CREATE | shared UI |
| `web/src/pages/{RecipeListPage,RecipeDetailPage,RecipeFormPage}.tsx` | CREATE | the three screens |
| `web/src/App.tsx` | UPDATE | router and layout; health indicator moves into `ServerStatus` |
| `web/src/main.tsx` | UPDATE | wrap in the router |
| `web/src/App.test.tsx` | UPDATE | health and theme tests now target `ServerStatus`/`Layout`; wrap with `MemoryRouter` |
| `web/src/**/*.test.tsx`, `web/src/lib/api.test.ts` | CREATE | new coverage |

### Docs
| File | Action | Justification |
|---|---|---|
| `README.md`, `SECURITY.md` | UPDATE | features now available; upload protections; `DATA_DIR/images` |

## NOT Building

- Search, filters, sorting by rating (Phase 3); the list is newest-first with simple pagination only.
- Ingredient parsing/normalisation (Phase 4): ingredient lines are stored as raw text, `name_normalized`, `quantity`, `unit` stay NULL.
- URL import and remote image download (Phase 5): `sourceUrl` is only stored and shown as a link, never fetched.
- Thumbnails or multiple image sizes, image cropping, multiple images per recipe, animated images.
- Authentication (Phase 8), bulk import/export, tags, categories.

---

## Step-by-Step Tasks

### Task 1: Dependencies, config and licence policy
- **ACTION**: Install libraries and extend configuration.
- **IMPLEMENT**:
  - `npm install -w server sharp @fastify/multipart` (confirm versions: sharp 0.35.x, multipart `>=10.1.1`).
  - `npm install -w web react-router`; `cd web && npx shadcn@latest add input textarea label alert-dialog skeleton -y`.
  - Root `package.json`: `"engines": {"node": ">=22.22.0"}` (React Router v8); append `;LGPL-3.0-or-later` to the `audit:licenses` allowlist (libvips, dynamically linked prebuilt binary, open source).
  - `config.ts`: add `imagesDir: string` to `Config`; `imagesDir: path.join(dataDir, 'images')` in the return value.
  - `server/test/helpers.ts`: add an `imagesDir` default in `testConfig` that is a fresh temp dir (not the shared tmp path), and change the stale `port: 3000` to `3210`.
- **MIRROR**: CONFIG pattern in `server/src/config.ts`; test helpers in `server/test/helpers.ts:10-34`.
- **IMPORTS**: none new in code yet.
- **GOTCHA**: npm 11 prints "allow-scripts" warnings for packages with install scripts; sharp has none. `sharp` must stay in `dependencies` (runtime). Keep `npm ci --ignore-scripts` working: run `npm ci --ignore-scripts` in a clean clone/temp dir to prove it.
- **VALIDATE**: `node -e "require('sharp')({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer().then(b=>console.log(b.length))"` prints a number; `npm run audit:licenses` passes; `npm run typecheck -w server` passes.

### Task 2: Migration 002 and version assertions
- **ACTION**: Add indexes and update tests that pin the schema version.
- **IMPLEMENT**: `002_recipe_indexes.sql`: `CREATE INDEX idx_recipe_created ON recipe (created_at DESC, id DESC); CREATE INDEX idx_recipe_image_path ON recipe (image_path);`. Update `health.test.ts:18` to `schemaVersion: 2` and `migrate.test.ts:23,28,29,30` to 2 (line 53 uses a custom temp dir and stays 1). Add a test that migration 002's indexes exist.
- **MIRROR**: `server/src/db/migrations/001_init.sql` style (header comment, snake_case names).
- **IMPORTS**: none.
- **GOTCHA**: `scripts/copy-migrations.mjs` already copies the whole folder, so no build change. Never edit `001_init.sql`.
- **VALIDATE**: `npm test -w server -- migrate health` passes.

### Task 3: HttpError and zod schemas (test first)
- **ACTION**: Write `server/test/errors.test.ts`, then `server/src/errors.ts` and `server/src/schemas/recipe.ts`.
- **IMPLEMENT**:
  - `class HttpError extends Error { constructor(readonly statusCode: number, message: string) }` plus helpers `badRequest`, `notFound`, `payloadTooLarge`, `unsupportedMediaType`.
  - `recipeInputSchema` (zod): `title` trimmed 1-200; `cuisine` trimmed ≤80 optional/nullable (empty string → null); `description` ≤5000 nullable; `sourceUrl` ≤2048, must parse with `new URL` and protocol `http:`/`https:` else rejected, nullable; `rating` integer 1-5 nullable; `ingredients` array (max 100) of trimmed non-empty strings ≤200; `steps` array (max 100) of trimmed non-empty strings ≤2000. Unknown keys rejected (`.strict()`).
  - `listQuerySchema`: `limit` coerced int 1-100 default 24; `offset` coerced int ≥0 default 0.
  - `parseOrThrow(schema, data)` returns data or throws `badRequest` with a short message built from the first issue path and message.
  - Output types: `RecipeSummary`, `RecipeDetail`.
- **MIRROR**: zod usage in `server/src/config.ts:19-32` (schema, `safeParse`, message join).
- **IMPORTS**: `import { z } from 'zod'`.
- **GOTCHA**: zod v4 API (`z.url()` exists but does not restrict schemes the way we need; check protocol manually). Do not echo user-supplied values in error messages.
- **VALIDATE**: `npm test -w server -- errors` passes: valid input accepted; empty title, rating 6, `javascript:` URL, 101 ingredients, unknown key all rejected with 400 messages.

### Task 4: Recipe repository (test first)
- **ACTION**: Write `server/test/recipes-repo.test.ts`, then `server/src/db/recipes.ts`.
- **IMPLEMENT** (all synchronous, parameterised, taking `db`):
  - `createRecipe(db, input): number` inserts recipe, ingredients (`position` = index, `raw_text`) and steps in one `db.transaction`.
  - `getRecipe(db, id): RecipeDetail | undefined` (ingredients and steps ordered by `position`).
  - `listRecipes(db, {limit, offset}): {items: RecipeSummary[], total: number}` ordered `created_at DESC, id DESC`.
  - `updateRecipe(db, id, input): boolean` updates fields, sets `updated_at = datetime('now')`, replaces ingredient/step rows (delete then insert) in one transaction; returns false if missing.
  - `deleteRecipe(db, id): string | null` returns the removed `image_path` (or null) so the caller can clean up the file.
  - `setRecipeImage(db, id, filename | null): { updated: boolean; previous: string | null }`.
  - `countImageReferences(db, filename): number`.
  - Map DB rows to camelCase; `imageUrl` = `filename ? '/api/images/' + filename : null`.
- **MIRROR**: REPOSITORY_PATTERN; naming from NAMING_CONVENTION.
- **IMPORTS**: `import type { Db } from './connection.js'`.
- **GOTCHA**: SQLite `datetime('now')` has second resolution, so tests that check ordering must not rely on identical timestamps (order ties by `id DESC`). Use `.get() as {...}` casts like `migrate.ts` does. Keep SQL strings static.
- **VALIDATE**: `npm test -w server -- recipes-repo` passes: create then get round-trips order of ingredients/steps; update replaces them; delete cascades and returns image path; pagination and total correct; `countImageReferences` counts shared files.

### Task 5: Recipe CRUD routes (test first)
- **ACTION**: Write `server/test/recipes-routes.test.ts`, then `server/src/routes/recipes.ts` (CRUD part).
- **IMPLEMENT**: Plugin `recipeRoutes: FastifyPluginAsync<{ db: Db; images: ImageStore }>`:
  - `GET /api/recipes?limit&offset` → `{items,total}`.
  - `POST /api/recipes` → 201 with `RecipeDetail`.
  - `GET /api/recipes/:id` → 200 or 404 `{error:'Recipe not found'}`.
  - `PUT /api/recipes/:id` (full replace) → 200 detail or 404.
  - `DELETE /api/recipes/:id` → 204; after deletion, remove the image file only if `countImageReferences` is 0.
  - `:id` must be a positive integer, else 404 (do not leak parsing errors).
  - All bodies validated with `parseOrThrow`; JSON body limit stays at Fastify's 1 MB default.
- **MIRROR**: SERVICE_PATTERN, ERROR_HANDLING (throw `HttpError`), TEST_STRUCTURE.
- **IMPORTS**: `import { recipeInputSchema, listQuerySchema, parseOrThrow } from '../schemas/recipe.js'`; repository functions; `HttpError` helpers.
- **GOTCHA**: Wire an `images` store parameter now (type from Task 6) or stub it; if Task 6 is not done yet, accept `images` as optional and add the cleanup call in Task 7. Return 204 with no body (`reply.status(204).send()`).
- **VALIDATE**: `npm test -w server -- recipes-routes` passes: create/list/get/update/delete happy paths; 400 for invalid bodies and bad `limit`; 404 for unknown and non-numeric ids; delete is idempotent-safe (second delete 404); stored script text comes back unchanged as plain JSON string.

### Task 6: Image service (test first)
- **ACTION**: Write `server/test/images-service.test.ts`, then `server/src/services/images.ts`.
- **IMPLEMENT**:
  - `MAX_IMAGE_BYTES = 5 * 1024 * 1024`, `MAX_INPUT_PIXELS = 40_000_000`, `MAX_EDGE = 1600`.
  - `processImage(input: Buffer, opts?: { maxInputPixels?: number }): Promise<{ data: Buffer; filename: string }>`: `const img = sharp(input, { limitInputPixels, failOn: 'error', animated: false }); const meta = await img.metadata();` reject unless `meta.format` is `jpeg|png|webp` (throw `unsupportedMediaType`); then `img.rotate().resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()`; `filename = sha256(output).hex + '.webp'`. Corrupt or oversize-pixel input → `badRequest('Unsupported or corrupt image')`. No `.withMetadata()`.
  - `createImageStore(dir)` returns `{ save(filename, data), remove(filename), exists(filename), pathFor(filename) }`: creates `dir` (mode 0o700) lazily; `save` writes to a temp name then `rename`s (atomic) and skips if the file already exists; every method validates `filename` against `/^[a-f0-9]{64}\.webp$/` and throws otherwise (defence in depth against traversal); `remove` ignores ENOENT.
- **MIRROR**: ERROR_HANDLING (throw `HttpError`), naming from NAMING_CONVENTION, `fs` use like `server/src/db/connection.ts:16-19` (`mkdirSync` with mode).
- **IMPORTS**: `sharp`, `node:crypto`, `node:fs/promises`, `node:path`.
- **GOTCHA**: Generate test images with sharp itself (`sharp({create:{...}}).png().toBuffer()`), no binary fixtures in the repo. SVG and GIF test inputs: build a tiny SVG string and a text file named `.png`. Identical input must give the identical filename (content-addressed), which is what lets two recipes share a file; reference counting protects against premature deletion. `limitInputPixels` must be injectable so the pixel-limit test can use a tiny limit instead of a giant image.
- **VALIDATE**: `npm test -w server -- images-service` passes: PNG and JPEG become WebP no larger than 1600px; EXIF (e.g. a Copyright or GPS tag set with `withExif`) is absent from the output metadata; EXIF-rotated input comes out upright; SVG, text and truncated files are rejected; pixel limit enforced; filename is 64 hex + `.webp` and deterministic; store rejects `../x.webp`; remove of a missing file does not throw.

### Task 7: Image routes and app wiring (test first)
- **ACTION**: Write `server/test/images-routes.test.ts`; extend `routes/recipes.ts`; create `routes/images.ts`; update `app.ts`.
- **IMPLEMENT**:
  - `app.ts`: `await app.register(multipart, { limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 1 } })`; `const images = createImageStore(config.imagesDir)`; register `recipeRoutes` with `{db, images}` and `imageRoutes` with `{images}` before the static/not-found setup.
  - `PUT /api/recipes/:id/image`: 404 if recipe missing; `if (!req.isMultipart()) throw unsupportedMediaType`; `const file = await req.file()`; none → 400; `const buf = await file.toBuffer()` (over-limit → 413 `Image too large (max 5 MB)`); `processImage`; `images.save`; `setRecipeImage`; delete the previous file when `countImageReferences(previous) === 0`; respond 200 with the updated `RecipeDetail`.
  - `DELETE /api/recipes/:id/image`: clears the column, removes the file if unreferenced, 200 with detail.
  - In `DELETE /api/recipes/:id` (Task 5) call the same cleanup helper.
  - `routes/images.ts`: `GET /api/images/:filename` → 404 unless the name matches `/^[a-f0-9]{64}\.webp$/` and exists; reply `Content-Type: image/webp`, `Cache-Control: public, max-age=31536000, immutable`, stream with `fs.createReadStream` (do NOT use `@fastify/static` or `sendFile` for the data dir).
- **MIRROR**: SERVICE_PATTERN, ERROR_HANDLING, security headers already applied globally (`server/src/plugins/security.ts`).
- **IMPORTS**: `@fastify/multipart`, `node:fs`, image service and repository functions.
- **GOTCHA**: Register multipart AFTER `registerSecurity` so headers and rate limiting wrap it. Check the recipe exists before consuming the body. Always consume or `await` the file stream or the request can hang (this is the class of bug in the multipart CVE; stay on `>=10.1.1`). `fields: 0` means any extra text fields cause an error; the web client sends only the file. Confirm exact error class and `toBuffer` location against the installed README. `app.inject` multipart needs a hand-built body: add `multipartBody(field, filename, contentType, data)` returning `{ payload, headers }` to `server/test/helpers.ts`.
- **VALIDATE**: `npm test -w server` passes. Cases: upload PNG → 200 with `imageUrl`, `GET` that URL returns `image/webp`, immutable cache header, `nosniff`; second upload replaces and removes the old file; 6 MB upload → 413; text file → 400/415; SVG → 415; non-multipart → 415; missing recipe → 404; `GET /api/images/..%2f..%2fpackage.json` → 404; two recipes sharing one image keep the file until both are deleted; deleting a recipe removes its unshared image; rate limit still applies.

### Task 8: Container and CI adjustments
- **ACTION**: Make sure the native image library works in the hardened image.
- **IMPLEMENT**: In the `Dockerfile` deps stage, extend the existing verification with a tiny `sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer()` call so the build fails if the native binary is missing. No other Docker change (`/data` volume holds `images/`; `read_only` rootfs and `/tmp` tmpfs are already set).
- **MIRROR**: existing `RUN npm ci ... && node -e "new (require('better-sqlite3'))(':memory:').close()"` in the Dockerfile.
- **IMPORTS**: none.
- **GOTCHA**: `--ignore-scripts` is fine for sharp. If Docker's `npm ci` omits the linux binary because the lockfile was produced on Windows, run `npm install` so all `@img/*` optionals are recorded in `package-lock.json`; verify by building.
- **VALIDATE**: `docker compose build` succeeds; `docker compose up -d`; an image upload via `curl -F` (see Docker Validation) returns 200 inside the container; `docker compose ps` shows healthy.

### Task 9: Web API client and types (test first)
- **ACTION**: Write `web/src/lib/api.test.ts`, then `web/src/lib/types.ts` and `web/src/lib/api.ts`.
- **IMPLEMENT**: Types mirror the API (`RecipeSummary`, `RecipeDetail`, `RecipeInput`, `RecipeList`). `ApiError extends Error { status }`. Functions: `listRecipes({limit,offset,signal})`, `getRecipe(id,signal)`, `createRecipe(input)`, `updateRecipe(id,input)`, `deleteRecipe(id)`, `uploadImage(id,file)` (FormData, field `image`, no manual Content-Type), `deleteImage(id)`. A shared `request()` parses `{error}` bodies into `ApiError` with that message, falls back to a generic message on non-JSON.
- **MIRROR**: WEB_STORAGE_AND_FETCH_PATTERN (AbortController, `response.ok` check as in `web/src/App.tsx:55-60`), WEB_TEST_PATTERN.
- **IMPORTS**: none (native `fetch`, `FormData`).
- **GOTCHA**: Do not set `Content-Type` for FormData (the browser adds the boundary). Treat 204 as no body. Never put user text in URLs beyond numeric ids.
- **VALIDATE**: `npm test -w web -- api` passes: success paths parse JSON; 400/404 become `ApiError` with the server message; network failure rejects; upload sends a `FormData` with an `image` file.

### Task 10: Web components, pages and routing (test first where practical)
- **ACTION**: Build UI and wire the router.
- **IMPLEMENT**:
  - `main.tsx` wraps `<App/>` in the declarative browser router; `App.tsx` renders `Layout` plus `Routes`: `/` list, `/recipes/new`, `/recipes/:id`, `/recipes/:id/edit`, and a friendly not-found route.
  - `Layout`: header (title link, "New recipe" button, theme toggle moved from the old `App.tsx:67-71`), `<Outlet/>`, footer `ServerStatus` (the old health fetch from `App.tsx:53-65`, now a component).
  - `RecipeListPage`: fetch with pagination ("Load more" appends), loading skeletons, error state with retry, empty state with link to create.
  - `RecipeCard`: image (`<img loading="lazy" alt="">` or a placeholder), title, cuisine badge, `StarRating` read-only.
  - `StarRating`: 5 buttons with `aria-label`s ("Rate 3 out of 5"), `aria-pressed`, keyboard accessible; read-only variant; clicking the active star again clears.
  - `RecipeDetailPage`: image, meta, description, ingredients `<ul>`, steps `<ol>`, source URL as a link only when it starts with `http://` or `https://` (`rel="noopener noreferrer" target="_blank"`), Edit link, Delete with `AlertDialog` confirmation, navigates to `/` after delete.
  - `RecipeFormPage` (create and edit): fields with labels and inline errors; ingredients and steps as one-per-line textareas (split on newlines, trim, drop empties); `StarRating`; `ImagePicker`; on submit create/update, then upload the chosen image, then navigate to the detail page; show server errors; disable the button while saving; edit mode loads the existing recipe and allows "Remove image".
  - `ImagePicker`: `accept="image/jpeg,image/png,image/webp"`, client-side checks (type, ≤5 MB) with a clear message, preview via `FileReader.readAsDataURL`.
- **MIRROR**: shadcn component usage and Tailwind classes in `web/src/App.tsx:73-120`; guarded storage and abort patterns as above.
- **IMPORTS**: `react-router` (confirm names in v8 docs), `lucide-react` icons (`Star`, `Plus`, `Pencil`, `Trash2`, `ImagePlus`), `@/components/ui/*`, `@/lib/api`.
- **GOTCHA**: Never use `dangerouslySetInnerHTML`. Keep all styling in classes (CSP forbids inline `style` attributes; Radix portals/animations may add inline styles, so verify no CSP violations in the browser console, and if a Radix component requires inline style, prefer an alternative component instead of loosening `style-src`). The existing `App.test.tsx` renders `<App />` without a router: wrap it in `MemoryRouter` and point health assertions at the footer. Image URLs come from the API as `/api/images/<hash>.webp` (same origin, CSP-safe).
- **VALIDATE**: `npm run typecheck -w web && npm test -w web` pass. Tests cover: list loading/empty/error/pagination; card rendering; form validation messages and successful submit calling create then upload; edit pre-fill; delete dialog cancel and confirm; detail hides non-http source links; image picker rejects a 6 MB file and a `.txt`; star rating keyboard and `aria-pressed`; theme and footer health tests still pass after the move.

### Task 11: Documentation
- **ACTION**: Update docs.
- **IMPLEMENT**: README: move "recipes with images" from planned to available, mention supported image types/size, the `DATA_DIR/images` folder in the backup note, and the API summary table (routes above). SECURITY.md: add the upload protections (type allowlist via decoded content, 5 MB and 40 MP limits, re-encode to WebP, metadata stripped, random content-hash filenames, no SVG, images served only by validated filename). Update the roadmap list.
- **MIRROR**: existing README and SECURITY.md structure and tone; date the SECURITY "Last reviewed" line.
- **IMPORTS**: none.
- **GOTCHA**: No personal paths or example data with real names.
- **VALIDATE**: Re-read both files; every command in them works.

### Task 12: End-to-end validation
- **ACTION**: Run everything and exercise the real app.
- **IMPLEMENT**: Run the validation commands below, including Docker restart persistence with an image, and a browser walkthrough.
- **MIRROR**: Phase 1 validation steps in `.claude/PRPs/reports/foundation-security-scaffold-report.md`.
- **IMPORTS**: none.
- **GOTCHA**: Clean up test recipes/volumes you create (delete the throwaway Docker volume afterwards). Port 3210 is the default; port 3000 may be taken on this machine.
- **VALIDATE**: All acceptance criteria below.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Recipe schema valid | full valid body | parsed object | No |
| Recipe schema bad title/rating/URL | `''`, `6`, `javascript:alert(1)` | 400 | Yes |
| Recipe schema limits | 101 ingredients, 2001-char step, unknown key | 400 | Yes |
| Repo create/get | recipe with 3 ingredients, 2 steps | same order back | No |
| Repo update | new ingredient list | old rows replaced | No |
| Repo delete | recipe with image | returns image filename, children gone | Yes |
| Repo pagination | 30 recipes, limit 10 offset 25 | 5 items, total 30 | Yes |
| API create → get | valid JSON | 201 then identical detail | No |
| API 404s | unknown and non-numeric id | 404 `{error}` | Yes |
| API list query | `limit=0`, `limit=101`, `offset=-1` | 400 | Yes |
| Image process PNG/JPEG | 3000×2000 image | WebP, long edge 1600 | No |
| Image EXIF | JPEG with GPS/Copyright | output has no EXIF | Yes |
| Image orientation | EXIF-rotated JPEG | output upright | Yes |
| Image rejects | SVG, text, truncated, over pixel limit | 415/400 | Yes |
| Image filename | same input twice | identical 64-hex name | Yes |
| Store traversal | `../x.webp`, `a/b.webp` | throws | Yes |
| Upload happy path | PNG multipart | 200, `imageUrl`, file served as webp | No |
| Upload too large | 6 MB body | 413 | Yes |
| Upload not multipart | JSON to image route | 415 | Yes |
| Shared image | two recipes, same image, delete one | file kept; deleted after second | Yes |
| Serve traversal | `/api/images/..%2f..%2fpackage.json` | 404 | Yes |
| Web API client | 400 JSON error body | `ApiError` with message | Yes |
| Form flow | fill and submit | create then upload then navigate | No |
| Delete dialog | cancel then confirm | no call, then delete call | Yes |
| Source link safety | `ftp://x` or `javascript:` stored | rendered as text, not a link | Yes |
| Image picker | 6 MB file, `.txt` | inline error, no upload | Yes |

### Edge Cases Checklist
- [ ] Empty input (empty lists, recipe with no ingredients or steps, no image)
- [ ] Maximum size input (5 MB image, 100 ingredients, 5000-char description)
- [ ] Invalid types (non-image bytes with an image extension, SVG, GIF)
- [ ] Concurrent access (two uploads of the same image at once do not corrupt the file: temp-then-rename)
- [ ] Network failure (UI error states and retry)
- [ ] Permission denied (images directory not writable returns a generic 500 and logs the cause)
- [ ] Unicode titles and emoji round-trip

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
EXPECT: All tests pass (Phase 1's 48 tests still pass after the version/health updates, plus the new ones)

### Full Test Suite
```bash
npm test && npm run build
```
EXPECT: No regressions; both builds succeed

### Security and Licence Checks
```bash
npm audit --omit=dev --audit-level=high && npm run audit:licenses
```
EXPECT: 0 production vulnerabilities; licences pass with `LGPL-3.0-or-later` allowed

### Database Validation
```bash
npm run build -w server && node server/dist/index.js   # other shell:
curl -s http://127.0.0.1:3210/api/health
```
EXPECT: `{"status":"ok","schemaVersion":2}`

### Docker Validation
```bash
docker compose up -d --build && docker compose ps
# create a recipe and upload an image from the host:
curl -s -X POST http://127.0.0.1:3210/api/recipes -H "Content-Type: application/json" -d '{"title":"Test soup","ingredients":["1 onion"],"steps":["Chop"]}'
curl -s -X PUT http://127.0.0.1:3210/api/recipes/1/image -F "image=@some-test-image.png"
docker compose down && docker compose up -d   # then GET /api/recipes/1 and its imageUrl again
```
EXPECT: container healthy; recipe and image survive the restart; image served as `image/webp`

### Browser Validation
Open `http://127.0.0.1:3210`, create a recipe with an image, edit it, delete it.
EXPECT: no console errors or CSP violations; only first-party requests; layout works at mobile width; keyboard-only flow works

### Manual Validation
- [ ] Upload a phone photo (with GPS EXIF): the stored file has no EXIF (`sharp(file).metadata()`)
- [ ] Upload an SVG and a renamed text file: both rejected with a clear message
- [ ] Delete a recipe: its image file disappears from `DATA_DIR/images`
- [ ] Dark mode and footer server status still work
- [ ] Remove the throwaway Docker volume and any test data afterwards

---

## Acceptance Criteria
- [ ] All tasks completed
- [ ] All validation commands pass
- [ ] Tests written and passing
- [ ] No type errors
- [ ] No lint errors
- [ ] Matches UX design
- [ ] PRD Phase 2 success signal: a recipe with an image can be created, edited, viewed and deleted, and survives a container restart

## Completion Checklist
- [ ] Code follows the conventions in Patterns to Mirror
- [ ] Errors never leak internals; 4xx messages are generic and safe
- [ ] Logging redacts sensitive headers and never logs file contents
- [ ] Tests use in-memory databases and temp directories only
- [ ] No hardcoded paths or secrets
- [ ] README and SECURITY.md updated
- [ ] No Phase 3+ scope added (no search, no ingredient parsing, no URL fetching)
- [ ] Self-contained: the next phases can build on `recipe`, `recipe_ingredient`, and the repository module

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Malicious or malformed image (decompression bomb, polyglot, SVG) | M | H | Type from decoded content, allowlist, pixel and byte limits, re-encode to WebP, random content-hash names |
| Multipart request hangs or oversized body exhausts memory | M | M | `@fastify/multipart >= 10.1.1`, `fileSize`/`files`/`parts` limits, always consume the stream, global rate limit |
| sharp native binary missing in Docker or CI with `--ignore-scripts` | M | H | Optional platform packages come with the lockfile; verify in the Docker deps stage and CI build |
| React Router v8 declarative API differs from assumptions | M | L | Check the v8 docs first; fall back to `react-router` v7 if needed (keep the pin documented) |
| CSP blocks Radix/shadcn inline styles or `blob:` previews | M | M | `FileReader` data URLs for previews; test in the browser; replace offending components rather than loosening CSP |
| Existing tests pinned to schema version 1 or the welcome card break | H | L | Explicit update tasks (Task 2, Task 10) |
| LGPL libvips in an MIT repo | L | L | Binary is a separate prebuilt dependency installed by npm, not vendored in the repo; documented and allow-listed |
| Content-addressed files orphaned if the process dies between save and DB update | L | L | Harmless (same bytes reused next time); optional cleanup script is out of scope |

## Notes
- Decision: images are stored as `DATA_DIR/images/<sha256>.webp` and the `recipe.image_path` column holds only that filename (no directories), matching the PRD's "files on disk, hash in the database".
- Ingredient lines are raw text for now; Phase 4 will add parsing and fill `name_normalized`, `quantity` and `unit` (the columns already exist).
- Phase 3 will add FTS5 over `recipe` title/cuisine/ingredients with triggers; the `002` indexes are independent of that.
- Phases 3, 4 and 5 can run in parallel after this one (they touch search, matching and import respectively), though all three will touch `server/src/app.ts` and `server/src/db/recipes.ts` lightly, so expect small merge conflicts.
- Confidence for one-pass implementation: 7/10. The main uncertainties are the exact `@fastify/multipart` and React Router v8 APIs and Radix inline-style behaviour under the strict CSP; each has an early validation step.

# Plan: Optional data sources (starter recipes and TheMealDB)

## Summary
Give a fresh install something to cook with, without compromising the project's openness. Part one is a small set of **original starter recipes written for this project and released as CC0**, loaded on request from the empty-library screen or by a command. Part two is an **optional, off-by-default TheMealDB importer** that searches the service's official API and feeds results into the existing import preview and save flow, with a clear notice that TheMealDB is not open source and what its terms restrict.

## User Story
As a new user with an empty library, I want to load a set of starter recipes with one click, and optionally pull recipes from TheMealDB, so that I can try ingredient matching straight away.

## Problem → Solution
Empty library, nothing to match against until the user types or imports recipes → one click loads ~40 licence-clean recipes; the user can opt in to browsing TheMealDB for more.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/recipe-mixer.prd.md`
- **PRD Phase**: 7 - Optional data sources
- **Estimated Files**: ~28

## Decisions already made with the user (2026-10-17)
1. Seed source: **original recipes written for the project** (not Wikibooks, not a scraped dataset). Reason: no licence doubt, nothing to attribute, can be bundled in an MIT repo as CC0.
2. TheMealDB importer: **yes, off by default.**

---

## UX Design

### Before
```
Empty library: "No recipes yet" + [Add a recipe] [Import from a link]
```

### After
```
Empty library: "No recipes yet" + [Add a recipe] [Import from a link] [Load starter recipes]
Import page, when MEALDB_ENABLED=true:
  second section "Find on TheMealDB": search box -> list (title, cuisine, category)
  -> [Review] opens the normal recipe form pre-filled (same as URL import); notice below the section
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Empty list page | Two buttons | Third button, loads starter set, then shows the list | Button only on the empty state; idempotent on the server |
| Import page | URL box only | URL box plus TheMealDB search when enabled | Section absent when disabled; server routes answer 404 when disabled |
| Recipe detail | Source link shown | Same; TheMealDB recipes link back to `themealdb.com/meal/<id>` | Satisfies "link back / keep notices" |

---

## Mandatory Reading
| Priority | File | Why |
|---|---|---|
| P0 | `server/src/routes/import.ts` | Route shape, rate limit, concurrency cap, 404-when-disabled pattern to mirror |
| P0 | `server/src/services/safe-fetch.ts` | All outbound requests must go through it; `fetchPage` only accepts HTML, so JSON needs a new method |
| P0 | `server/src/schemas/import.ts`, `server/src/schemas/recipe.ts` | `ExtractedRecipe`/`ImportPreview` shapes and `recipeInputSchema` limits (title 200, 100 ingredients of 200 chars, 100 steps of 2000) |
| P0 | `server/src/db/recipes.ts` | `createRecipe`, `findRecipeIdBySourceUrl` |
| P1 | `server/src/services/recipe-images.ts`, image route in `routes/import.ts` | Attaching a downloaded photo goes through `processImage` |
| P1 | `server/scripts/demo-data.ts`, `server/test/demo-data.test.ts` | Existing seeding code and how it is tested |
| P1 | `server/src/config.ts`, `server/test/helpers.ts` (`testConfig`) | New settings and test config |
| P1 | `server/src/routes/session.ts`, `web/src/lib/api.ts` | Where the web app learns what the server offers |
| P1 | `server/test/route-protection.test.ts` | Every new route must be listed or the test fails |
| P2 | `web/src/pages/ImportPage.tsx`, `RecipeListPage.tsx` | Where the new UI goes |
| P2 | `SECURITY.md`, `docs/DEPLOYMENT.md` | Docs to update |

## External Documentation
| Topic | Source (read 2026-10-17) | Key takeaway |
|---|---|---|
| TheMealDB terms | https://www.themealdb.com/terms_of_use.php (last updated 01/07/2025) | Content may be copied and modified if the **official endpoints** are used ("Please do not scrape our website"); copyright and trademark notices must not be removed; free API use is for development projects and "You cannot publish apps to an appstore unless you are a paid subscriber"; artwork is mostly user-created, must not be passed off as one's own, should link back; `strCreativeCommons` marks CC-licensed artwork; no reselling |
| TheMealDB API | https://www.themealdb.com/api.php | Test key `1` is for development or educational use; v1 endpoints `search.php?s=`, `lookup.php?i=`, `filter.php?...`, `list.php`; multi-ingredient filter and full listing are paid; thumbnails by appending `/small`, `/medium`, `/large` to the image URL |
| TheMealDB agent guide | https://www.themealdb.com/AGENTS.md | Use lookup (not filter) for full recipes; preserve measures and instructions; link the meal to `https://www.themealdb.com/meal/{idMeal}`; credit TheMealDB as the data and image source |
| Meal record shape | live response of `lookup.php?i=52772` | `idMeal`, `strMeal`, `strCategory`, `strArea`, `strInstructions` (CRLF-separated), `strMealThumb`, `strSource`, `strIngredient1..20` and `strMeasure1..20` (empty string or null when unused), `strTags`, `strYoutube` |

Consequence for the design: this project is a self-hosted personal tool, so the free key is within its terms for the owner's own use. A public deployment serving other people, or any distribution of a build with a baked-in key, is the "appstore"/paid territory, so the key is **never** shipped in the repo or image, the feature is off by default, and the notice says so.

---

## Patterns to Mirror

### ROUTES_DISABLED_MEANS_404 (`server/src/routes/import.ts`)
```ts
export const importRoutes: FastifyPluginAsync<ImportRouteDeps> = async (app, { db, images, fetcher, enabled }) => {
  // When the feature is off the routes do not exist, so both addresses answer 404.
  if (!enabled) return;
```

### RATE_LIMIT_AND_CONCURRENCY (`server/src/routes/import.ts`)
```ts
const MAX_CONCURRENT_IMPORTS = 2;
const IMPORT_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };
```
New routes reuse the same limit and the same "running" counter (extract `limited` into a small shared helper rather than copying it).

### VALIDATE_INPUT (`server/src/schemas/recipe.ts`)
`parseOrThrow(schema, data)`; strict zod objects; errors never echo values.

### CONFIG_FLAG (`server/src/config.ts`)
```ts
URL_IMPORT_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
```

### TEST_HELPERS (`server/test/helpers.ts`)
`makeApp(overrides, ...)`, `testConfig(overrides)`; fake fetchers are passed through `AppDeps.fetcher` as in `import-routes.test.ts`.

---

## Files to Change
| File | Action | Why |
|---|---|---|
| `server/data/starter-recipes.json` | CREATE | The ~40 original recipes (CC0), data only |
| `server/data/LICENSE-starter-recipes.txt` | CREATE | CC0 1.0 dedication for that file |
| `server/src/services/starter-recipes.ts` | CREATE | Load, validate and insert; skip titles already present |
| `server/src/routes/starter.ts` | CREATE | `POST /api/starter-recipes` |
| `server/src/services/mealdb.ts` | CREATE | Pure mapping from a meal record to a recipe draft, plus search result mapping |
| `server/src/routes/mealdb.ts` | CREATE | `GET /api/mealdb/search`, `GET /api/mealdb/meals/:id`; the photo is saved by the existing image-from-URL route |
| `server/src/services/safe-fetch.ts` | UPDATE | Add `fetchJson(url)` (JSON content type, 1 MB cap) using the same guard |
| `server/src/config.ts` | UPDATE | `MEALDB_ENABLED` (default false), `MEALDB_API_KEY` (default `1`) |
| `server/src/app.ts` | UPDATE | Register the two route files |
| `server/src/routes/session.ts` | UPDATE | Add `features: { mealdb: boolean }` to the public GET answer |
| `server/scripts/copy-migrations.mjs` | UPDATE | Also copy `data/` into `dist` |
| `server/scripts/seed-starter.ts`, `server/package.json` | CREATE/UPDATE | `npm run seed:starter -- --dir <folder>` for people who prefer a command |
| `server/test/*` | CREATE/UPDATE | See Testing |
| `web/src/lib/api.ts`, `types.ts` | UPDATE | `loadStarterRecipes`, `searchMealDb`, `previewMealDb`, `features` |
| `web/src/pages/RecipeListPage.tsx` | UPDATE | Third empty-state button |
| `web/src/pages/ImportPage.tsx` (+ new `MealDbSearch.tsx`) | UPDATE/CREATE | Search section and notice |
| `docs/DATA-SOURCES.md` | CREATE | Every source, its licence, what is and is not bundled |
| `.env.example`, `docker-compose.yml`, `README.md`, `SECURITY.md`, `docs/DEPLOYMENT.md` | UPDATE | New settings, notice, outbound-request statement |
| `.claude/PRPs/prds/recipe-mixer.prd.md` | UPDATE | Phase 7 status and links; answer the two Open Questions |

## NOT Building
- Bundled copies of Wikibooks, tastyR, Kaggle, RecipeNLG, TheMealDB or any scraped data.
- Bundled photos for starter recipes (cards already have a placeholder; avoids image licensing entirely).
- A TheMealDB key in the repo, the image or the compose file; any paid-tier features (multi-ingredient filter, full listing); bulk "import everything" from TheMealDB (stays one reviewed recipe at a time, which also respects its limits).
- Scraping themealdb.com web pages (terms forbid it); only the official JSON endpoints and the photo address the API returns.
- Any other third-party API (Spoonacular, Edamam).

---

## Step-by-Step Tasks

### Task 1: Starter recipe data
- **ACTION**: Write ~40 original recipes covering many cuisines (rating `null`, `sourceUrl` `null`).
- **IMPLEMENT**: `server/data/starter-recipes.json` as an array of `{title, cuisine, description, ingredients[], steps[]}`; plain, common dishes in my own wording (ingredient lines in the same style as `server/scripts/example-sets.json` so the matcher parses them); plus `LICENSE-starter-recipes.txt` stating CC0 1.0 and a note in `docs/DATA-SOURCES.md`.
- **GOTCHA**: Do not copy recipe text from any book or site; keep wording original. Use only ingredients the normaliser handles, and include shared staples (onion, garlic, eggs, rice, tomato) so matching has overlap between recipes.
- **VALIDATE**: Task 2 test parses every entry with `recipeInputSchema`.

### Task 2: Starter loader and route
- **ACTION**: `loadStarterRecipes(db)` returns `{added, skipped}`.
- **IMPLEMENT**: read the JSON (path relative to the module, works from `src` and `dist`), validate each entry with `recipeInputSchema`, skip a recipe whose title already exists (case-insensitive), insert in one transaction via `createRecipe`. `POST /api/starter-recipes` (no body) returns `{added, skipped}`; rate-limited like import; behind login like everything else.
- **GOTCHA**: A second click must add nothing. The build must copy `server/data` to `dist/data` (the Docker image runs from `dist`). No network use.
- **VALIDATE**: unit test (valid, unique titles, ingredient indexing happened, second call adds 0), route test, Docker run later.

### Task 3: Settings
- **ACTION**: Add `MEALDB_ENABLED` and `MEALDB_API_KEY`.
- **IMPLEMENT**: enabled default `false`; key default `1`, must match `^[A-Za-z0-9_-]{1,64}$` (it goes into a URL path, so nothing else is allowed); `Config` fields `mealdbEnabled`, `mealdbApiKey`. Startup log line says whether it is on. Never log the key.
- **VALIDATE**: config tests (default off, bad key refused with a message that does not echo the key).

### Task 4: JSON fetch through the guard
- **ACTION**: Add `fetchJson` to `SafeFetcher`.
- **IMPLEMENT**: same `guardedGet`, `Accept: application/json`, content type must be JSON, cap 1 MB; `JSON.parse` in the caller, failure becomes the generic "could not fetch" (502) so internals do not leak.
- **MIRROR**: `fetchPage`/`fetchImage` options.
- **GOTCHA**: The base address is fixed in code (`https://www.themealdb.com/api/json/v1/<key>/`); only the query value comes from the user and is encoded with `encodeURIComponent`. Still use the guarded fetcher (public-address check, timeout, size limit) rather than raw `fetch`.
- **VALIDATE**: safe-fetch tests for JSON accepted, HTML refused, oversized refused.

### Task 5: Meal mapping
- **ACTION**: Pure functions in `services/mealdb.ts`.
- **IMPLEMENT**: `mealToDraft(record)`: title from `strMeal`; cuisine from `strArea` (null when "Unknown"); description: short `Category: X` line plus tags; ingredients: pair `strIngredientN` with `strMeasureN` for N 1..20, trim, skip empty/null ingredients, `"<measure> <ingredient>"` truncated to 200; steps: split `strInstructions` on line breaks, drop empties and bare "STEP 1" lines, cut to 2000 chars and 100 steps; `imageUrl` from `strMealThumb` only when it is https on `themealdb.com` or a subdomain; `sourceUrl` always `https://www.themealdb.com/meal/<id>` (id digits only). `toSearchResult(record)`: `{id, title, cuisine, category}`.
- **GOTCHA**: Records are untrusted JSON: validate with a zod schema that tolerates extra and null fields; never trust an id or image host without checking. Render as plain text (existing rule).
- **VALIDATE**: table tests including nulls, 20 ingredients, CRLF, missing thumb, hostile thumb host, huge strings.

### Task 6: MealDB routes
- **ACTION**: `GET /api/mealdb/search?q=` (name search, 2 to 60 characters, at most 25 results returned) and `GET /api/mealdb/meals/:id` returning an `ImportPreview` (so the web reuses the review form, duplicate detection and image save).
- **IMPLEMENT**: 404 when disabled; shares the import rate limit and concurrency counter; empty result is `{items: []}`; upstream failure is the generic 502. The photo is saved by the existing `POST /api/recipes/:id/image/from-url` (its SSRF guard applies; the web passes the preview's `imageUrl`).
- **GOTCHA**: Add both routes to the table in `route-protection.test.ts`; the key must not appear in any response or log (test with the log stream hook). `search.php?s=` returns full records, so one call is enough for the list; the detail route uses `lookup.php?i=`.
- **VALIDATE**: route tests with a fake fetcher: disabled gives 404, search maps results, bad query gives 400, preview maps a record and sets `existingRecipeId`, upstream error gives 502 without the key in the body.

### Task 7: Web
- **ACTION**: `features.mealdb` read from the session answer; Load-starter button; MealDB section.
- **IMPLEMENT**: empty-state button calls the route, then reloads the list and announces the result; `MealDbSearch` below the URL form on the Import page, only when enabled: search field, result list (title, cuisine, category), Review opens `/recipes/new` with `importPreview` state exactly like URL import. Notice under the section: "Recipes and photos come from TheMealDB (themealdb.com), a community database that is not open source. Its free key is for personal and development use, and its terms do not allow publishing an app to an app store without a paid subscription. The recipe keeps a link back to TheMealDB."
- **GOTCHA**: The strict Content-Security-Policy blocks third-party images. Do not loosen it: show no thumbnails in the search list; the photo is downloaded server-side on save and then served from this app. Keep focus and live-region behaviour consistent with the existing Import page.
- **VALIDATE**: component tests (button only when empty, calls API, updates list; section hidden when disabled; search, error and empty states).

### Task 8: CLI seed command
- **ACTION**: `npm run seed:starter -- --dir <folder>` mirroring `seed-demo.ts` (explicit folder required, so it never touches a real library by accident).
- **VALIDATE**: spawn test like `demo-data.test.ts`.

### Task 9: Docs and security statement
- **ACTION**: `docs/DATA-SOURCES.md` (table: source, licence, bundled?, how to use, link to terms); README section; `.env.example` and compose entries (commented, off); SECURITY.md: the only outbound requests are import (user-supplied links) and, when enabled, the TheMealDB API on a fixed host; the key is a setting, never committed; summary of TheMealDB's terms and the public-service caution; PRD updated and its two Open Questions marked resolved.
- **GOTCHA**: State the terms as read on 2026-10-17 and tell readers to check the live terms; say nothing about Wikibooks or other datasets beyond "not bundled, licence not reviewed".

### Task 10: Validation and independent review
- **ACTION**: Full checks (below), mutation checks for the new guard rails (disabled means 404, key charset, id digits, photo host allow-list, result limits, idempotent starter load), then offer the user an independent security review of the new routes (approved in earlier phases).

---

## Testing Strategy

### Unit tests
| Test | Input | Expected | Edge |
|---|---|---|---|
| Starter file validity | whole JSON | every entry passes `recipeInputSchema`; titles unique | yes |
| Starter load twice | empty DB | first adds N, second adds 0 | yes |
| Starter matching sanity | load, then match `onion, garlic, rice` | at least 3 ranked results | |
| Meal mapping | record with 20 pairs, nulls, CRLF | clean lines, no empties | yes |
| Hostile record | thumb on another host, huge strings, non-digit id | thumb dropped, truncated, rejected | yes |
| Config | defaults, bad key | off, `1`; bad key refused | yes |
| Fetch JSON | JSON, HTML, 5 MB | accept, refuse, refuse | yes |
| Routes | enabled/disabled, bad queries, upstream failure | 200/404, 400, 502; key never in output | yes |
| Route protection | all new routes, logged out, password set | 401 | |
| Web | empty-state button, MealDB section, disabled | as above | |

### Edge cases checklist
- [ ] Empty library; library with some starter titles already present
- [ ] Search with 1 character, 61 characters, odd characters, no results
- [ ] TheMealDB unreachable or returns `{"meals":null}`
- [ ] A meal already saved (duplicate warning through `existingRecipeId`)
- [ ] Feature off: UI hides it, API 404
- [ ] Login on: all new routes need a session

## Validation Commands
```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run audit:licenses && npm audit --omit=dev
```
EXPECT: zero errors; test count up from 896 server / 208 web.

Manual: `docker compose up`, click Load starter recipes on a fresh volume (works from `dist` with a read-only root); with `MEALDB_ENABLED=true` search, review and save one meal with its photo; confirm the photo is served from `/api/images/...` and the browser makes no request to themealdb.com.

## Acceptance Criteria
- [ ] A fresh install loads about 40 starter recipes with one click, and a second click adds nothing
- [ ] Every bundled data file is original or CC0 and documented in `docs/DATA-SOURCES.md`
- [ ] TheMealDB is off by default, its API answers 404 when off, and the key is never in the repo, logs or responses
- [ ] A TheMealDB recipe imports through the existing review form with a link back and its photo stored locally
- [ ] No CSP relaxation; no outbound request except import and the fixed TheMealDB host
- [ ] Lint, types, tests, build, audit and licences pass; no open high or medium review finding

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| TheMealDB terms read too loosely | M | Public-service use breaks its terms | Off by default, notice, key never shipped, link back, official endpoints only; docs tell readers to read the live terms |
| API shape changes or paid-only limits | M | Importer breaks | Tolerant zod schema, generic error, feature is optional |
| Starter text accidentally copies a source | L | Copyright | Write from scratch in plain wording |
| New outbound path weakens SSRF posture | L | High | Fixed host, guarded fetcher, tests for photo host and key charset, independent review |
| `dist` build forgets the data file | M | Button fails in Docker | Build copies `data/`, Docker run is a manual check, a test loads from the built path |

## Notes
- The photo for a TheMealDB recipe is downloaded only when the user saves, using the existing guarded image route, so a search never downloads images.
- Phase 7 is the last PRD phase; after it only the user-side items from Phase 8 remain (private vulnerability reporting, untested provider guides).

# Implementation Report: Name, Cuisine and Rating Search (RecipeMixer Phase 3)

## Summary
Recipes can now be found by typing. The home page has a search box (runs as you type), a cuisine filter, a minimum-rating filter and a sort menu, all kept in the URL so searches survive a refresh and the back button. Search covers title, cuisine, description and ingredient text, matches word forms and accents, puts title hits first, and treats everything the user types as plain words. The recipe page lets you rate in one click, which feeds the rating filter and sort.

- **Server:** SQLite FTS5 index (`recipe_fts`, migration 004) kept in step by triggers and filled for existing recipes; a safe query builder; `GET /api/recipes` gains `q`, `cuisine`, `minRating`, `sort`; `GET /api/cuisines`; `PATCH /api/recipes/:id/rating`.
- **Web:** search box, three selects, "Clear filters", a "No recipes match your search" state, click-to-rate stars with revert-on-failure.

Nothing is committed. The work is on branch `feat/recipe-search`, created from `feat/ingredient-matching` (neither is merged or pushed yet, and both touch the same list and repository code).

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium-Large | Medium-Large (matched) |
| Files Changed | ~25 | 22 (about 9 server incl. tests, about 8 web incl. tests, docs, plan and report) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Migration and search layer | Done | Index sync tests cover create, update, delete, ingredient changes, rating changes and a pre-existing database |
| 2 | List query: search, filters, sort | Done | |
| 3 | Routes: rating, cuisines | Done | |
| 4 | Benchmark | Done | Four search benchmarks added |
| 5 | Web client and list page | Done | |
| 6 | Detail page quick rating | Done | |
| 7 | Docs and validation | Done | README (feature, API, roadmap), SECURITY.md |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `eslint .` clean; `tsc` clean for server and web |
| Unit Tests | Pass | 528 tests: 412 server (was 328), 116 web (was 95) |
| Build | Pass | server and web |
| Benchmark | Pass | 15,000 recipes: text search p50 1.0 ms, p95 2.6 ms; search + cuisine + rating sort p95 2.0 ms; filter + sort without text p95 9.0 ms; ingredient matching unchanged at p95 46.6 ms (budget 200 ms). Building the 15,000-recipe library takes 20.5 s (was 11.3 s) because of the index triggers |
| Integration (Docker) | Pass | Healthy at schema 4; seven recipes created; search by title, cuisine, ingredient and description; word forms (`tomatoes`) and accents (`creme brulee` finds Crème brûlée); prefix (`curr`); `Indian` and `indian` grouped as one cuisine; filters and every sort order; `OR`, `NEAR(`, quotes, `!!!` and a SQL fragment all treated as plain text and return nothing; invalid `minRating` and `sort` give 400; rating set, cleared and rejected (9 gives 400) |
| Integration (browser) | Pass | Typing `tomatoes` returned Tomato soup and Guacamole after the pause with the URL updated; choosing Italian narrowed to one recipe and showed Clear filters; rating a recipe 2 stars survived a full reload; Back returned to `/?q=tomatoes&cuisine=Italian`; no CSP violations |
| Security/licence | Pass | `npm audit --omit=dev`: 0 vulnerabilities; licence allowlist passes; regex sweep for secrets and personal data clean (only the licence line with the owner's chosen copyright holder); dry-run staging shows no data, image or test-output files |

## Files Changed

| Area | Files |
|---|---|
| Server source | `db/migrations/004_recipe_search.sql`, `db/search.ts`; updated `db/recipes.ts`, `schemas/recipe.ts`, `routes/recipes.ts` |
| Server tests | `search.test.ts`, `search-routes.test.ts`; updated `bench/matching.bench.test.ts`, `health.test.ts`, `migrate.test.ts` (schema version 4) |
| Web source | updated `pages/RecipeListPage.tsx`, `pages/RecipeDetailPage.tsx`, `lib/api.ts`, `lib/types.ts` |
| Web tests | `pages/RecipeListSearch.test.tsx`; updated `RecipeDetailPage.test.tsx`, `lib/api.test.ts` |
| Docs | `README.md`, `SECURITY.md` |

## Deviations from Plan

1. **`ListQuery` is a hand-written interface** (with optional fields) rather than the inferred schema type, so existing callers that pass only `limit` and `offset` keep compiling.
2. **The rating filter menu offers 2 to 5 stars** (the API accepts 1 to 5); the "Best match" sort appears only while searching.
3. **The recipe page's stars are now clickable**, so the old read-only assertion in its test was replaced by one on the pressed star.
4. **The benchmark file now builds one shared library** and runs four timed checks (matching, text search, search with filter and sort, filter and sort without text).
5. **An unneeded lint-disable comment** (for a rule this project does not use) was removed before it was ever run.

## Issues Encountered

- GateGuard bounced parts of several edit batches, twice leaving code temporarily inconsistent (new API functions or routes without their imports). Each time I noticed it from the missing import, redid the bounced edits and re-ran everything before moving on.
- A shell quirk in my own validation script shortened the "101-character query" case to 30 characters, so that case was not exercised live; the unit and route tests cover it (400).

## Not Verified
- The native dropdown menus' appearance and keyboard-only use, and a real phone-width layout (only a ~540 px pane was used).
- The search migration on a real, pre-existing database file (a pre-search database is simulated in a test, and the live container was built fresh).
- CI, which has never run on this branch.

## Next Steps
- [ ] Review with `/code-review`
- [ ] Commit with `/prp-commit` (branch `feat/recipe-search`)
- [ ] Phase 4 and Phase 3 branches are stacked and unpushed; push and merge them in order (4, then 3) when ready
- [ ] Phase 5 (URL import) is the next PRD phase

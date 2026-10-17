# Plan: Name, Cuisine and Rating Search (RecipeMixer Phase 3)

## Summary
Let the user find saved recipes by typing: full-text search over title, cuisine, description and ingredient text (SQLite FTS5, stemming, prefix matching, title weighted highest), with a cuisine filter, a minimum-rating filter and sorting by relevance, rating, newest or title. Add one-click rating from the recipe page so the user's own star rating, which drives the sort, is easy to keep up to date.

## User Story
As a home cook with a growing collection, I want to search my recipes by name or cuisine and sort the best-rated first, so that I can find a dish I already know I like.

## Problem → Solution
The recipe list is newest-first with no way to find anything → `GET /api/recipes` accepts `q`, `cuisine`, `minRating` and `sort`, backed by an FTS5 index that stays in sync with recipe changes; the list page gets a search box, filters and sort control, and the detail page lets you rate in one click.

## Metadata
- **Complexity**: Medium-Large (~25 files)
- **Source PRD**: `.claude/PRPs/prds/recipe-mixer.prd.md`
- **PRD Phase**: 3 - Name/cuisine/rating search (depends on Phase 2; branched from the Phase 4 branch because both touch the list and repository code)
- **Estimated Files**: ~25

## UX Design

### Before
```
Home: "Your recipes" newest first, Load more. No search, filter or sort.
```

### After
```
┌────────────────────────────────────────────────────────┐
│ Your recipes                                           │
│ [ 🔍 Search recipes, cuisines, ingredients...        ] │
│ Cuisine [All v]  Min rating [Any v]  Sort [Best match v]│
│ 7 recipes for "tomato"        [Clear filters]          │
│  cards (title, cuisine, stars) ...                     │
└────────────────────────────────────────────────────────┘
URL: /?q=tomato&cuisine=Italian&minRating=4&sort=rating
Detail page: "Your rating" ★★★★☆ (click a star to rate, click it again to clear)
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Home list | newest first | searchable, filterable, sortable; state in URL | Search runs as you type (short pause) |
| No results | "No recipes yet" only | "No recipes match your search" with Clear filters | "No recipes yet" is kept for an empty library |
| Detail page | read-only stars | click-to-rate stars | Saved immediately, error shown if it fails |

## Mandatory Reading
| Priority | File | Why |
|---|---|---|
| P0 | `server/src/db/recipes.ts` (`listRecipes`, `SUMMARY_COLUMNS`, `toSummary`) | The list query to extend |
| P0 | `server/src/schemas/recipe.ts` (`listQuerySchema`) | Query parsing to extend |
| P0 | `server/src/routes/recipes.ts` | Route patterns (`parseId`, `requireRecipe`) |
| P0 | `server/src/db/migrations/00{1,2,3}_*.sql` | Schema and migration style |
| P1 | `server/test/recipes-repo.test.ts`, `recipes-routes.test.ts`, `migrate.test.ts`, `health.test.ts` | Test style and the schema-version assertions to bump 3 → 4 |
| P1 | `web/src/pages/RecipeListPage.tsx`, `MatchPage.tsx` | List state pattern and URL-state pattern |
| P1 | `web/src/pages/RecipeDetailPage.tsx`, `components/StarRating.tsx` | Where quick rating goes |
| P2 | `web/src/lib/api.ts`, `test-utils.ts` | Client and test helpers |

## External Documentation
| Topic | Source | Key Takeaway |
|---|---|---|
| FTS5 in this SQLite build | verified by running it | Available in better-sqlite3; `tokenize='porter unicode61 remove_diacritics 2'` gives stemming and accent folding; `"term"*` is prefix search; `bm25(table, w1, ...)` ranks with per-column weights |
| FTS5 query syntax | SQLite FTS5 docs | Raw user text must never be passed to `MATCH`: quotes, `*`, `-`, `AND/OR/NOT`, `NEAR(` and `column:` are operators. Build the expression from sanitised tokens, each double-quoted |

## Design
- **Index:** `recipe_fts` FTS5 table (rowid = recipe id) with columns `title, cuisine, description, ingredients`. Triggers keep it in sync: recipe insert, `UPDATE OF title, cuisine, description` and delete; ingredient insert (append text), ingredient delete (recompute). A rating change touches none of them. Migration 004 fills it for existing recipes.
- **Query building:** `buildMatchExpression(q)` keeps only letters and digits (`\p{L}\p{N}`), takes at most 10 tokens of at most 40 characters, double-quotes each, and makes the last one a prefix (`"tom"*`) for search-as-you-type. No tokens (for example `!!!`) means no results, not an error.
- **Ranking:** `bm25(recipe_fts, 10, 4, 1, 2)` (title, cuisine, description, ingredients). Sort options are a fixed set of SQL fragments chosen in code: `relevance` (default with `q`), `newest` (default without), `rating` (rated first, then newest), `title`.
- **Filters:** `cuisine` (case-insensitive exact), `minRating` 1-5. `GET /api/cuisines` lists distinct cuisines with counts for the filter menu.
- **Rating:** `PATCH /api/recipes/:id/rating` with `{rating: 1-5 | null}`.

## Files to Change
| File | Action |
|---|---|
| `server/src/db/migrations/004_recipe_search.sql` | CREATE: FTS5 table, triggers, backfill |
| `server/src/db/search.ts` | CREATE: `buildMatchExpression`, `listCuisines` |
| `server/src/db/recipes.ts` | UPDATE: `listRecipes` gains search, filters, sort; add `setRecipeRating` |
| `server/src/schemas/recipe.ts` | UPDATE: extend `listQuerySchema`, add `ratingInputSchema` |
| `server/src/routes/recipes.ts` | UPDATE: `PATCH .../rating`, `GET /api/cuisines` |
| `server/test/{search,search-routes}.test.ts`, `recipes-repo`, `migrate`, `health`, `bench/matching.bench` | CREATE/UPDATE |
| `web/src/lib/{api,types}.ts` (+ test) | UPDATE: list query options, `listCuisines`, `setRating` |
| `web/src/pages/RecipeListPage.tsx` (+ test) | UPDATE: search box, filters, sort, URL state, no-match state |
| `web/src/pages/RecipeDetailPage.tsx` (+ test) | UPDATE: click-to-rate |
| `README.md`, `SECURITY.md` | UPDATE |

## NOT Building
- Searching inside steps text, typo tolerance, or search highlighting.
- Multi-cuisine selection, tags, or saved searches.
- Changing ingredient matching (Phase 4) or the staples rules.
- Per-field query syntax for users (`title:soup`), which is deliberately blocked.

## Step-by-Step Tasks
1. **Migration and search layer (test first):** `search.test.ts` for `buildMatchExpression` (hostile and edge input) and index sync (create, update, delete, ingredient changes, rating change leaves it alone, existing recipes backfilled); then `004_recipe_search.sql` and `db/search.ts`. GOTCHA: the migration uses single-quoted strings; ingredient deletes during a recipe cascade must not error; bump schema version assertions to 4.
2. **List query:** extend `listRecipes` and the schema (new fields optional so existing calls still work; empty strings treated as absent). Tests for title, cuisine, ingredient and description hits, stemming, prefix, title outranking description, each filter, each sort, pagination totals, `!!!` giving no results, SQL and FTS operators as literal text.
3. **Routes:** `PATCH /api/recipes/:id/rating`, `GET /api/cuisines`, validation tests (400s, 404s).
4. **Benchmark:** add a search benchmark to the existing bench file (15,000 recipes, p95 under 200 ms).
5. **Web client and list page (test first):** `api.ts` options and helpers; search box with a short debounce, cuisine, rating and sort controls (native selects, keyboard and screen-reader labelled), URL state, Clear filters, no-match state.
6. **Detail page quick rating (test first):** interactive stars, immediate save, failure message.
7. **Docs and validation:** README feature and API rows, SECURITY note; full suite, build, audit, licences, Docker, real browser.

## Validation Commands
```bash
npm run typecheck && npm run lint
npm test
npm run bench -w server        # p95 under 200 ms for matching and search
npm run build && npm audit --omit=dev --audit-level=high && npm run audit:licenses
docker compose up -d --build   # create recipes, search, filter, sort, rate; restart; same results
```

## Acceptance Criteria
- [ ] All tasks done and validation passes
- [ ] PRD Phase 3 success signal: searches return correct results in under 200 ms on a large fixture library
- [ ] Raw user text never reaches `MATCH` or SQL; no operator injection

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| FTS5 query-syntax injection or errors from odd input | M | M | Token whitelist and quoting; tests with every operator character |
| Index drifts from the data | M | H | Triggers on every write path; sync tests; backfill in the migration |
| Ingredient trigger cost slows writes | L | L | Append-style update on insert; measured by the existing 15,000-recipe benchmark |
| Cuisine spelling variants fragment the filter | M | L | Case-insensitive grouping and matching; free text stays free |

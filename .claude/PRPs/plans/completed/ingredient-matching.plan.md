# Plan: Ingredient Matching (RecipeMixer Phase 4)

## Summary
Deliver the product's key feature: type the ingredients you have and get your saved recipes ranked by how much of each recipe you can already make, with the missing ingredients listed. Ingredient lines are parsed and normalised when a recipe is saved (and backfilled for existing recipes), indexed by word in SQLite, and matched with a two-stage query (indexed word lookup narrows candidates, precise rule-based scoring ranks them). The web app gets a "What can I cook?" page with an ingredient chip input, a pantry-staples toggle and ranked result cards.

## User Story
As a home cook with ingredients about to spoil, I want to enter what is in my fridge and see which of my recipes I can make (even with a few ingredients missing), so that I cook a good meal and waste less food.

## Problem → Solution
Ingredient lines are stored as raw text and cannot be searched (`name_normalized`, `quantity`, `unit` are all NULL) → every ingredient line is normalised ("2 cups chopped yellow onions" → `yellow onion`), indexed, and matched against the user's ingredients with ranking by coverage and a visible missing list.

## Metadata
- **Complexity**: Large (~40 files; new matching domain logic, a migration, one new page)
- **Source PRD**: `.claude/PRPs/prds/recipe-mixer.prd.md`
- **PRD Phase**: 4 - Ingredient matching (depends only on Phase 2, which is complete)
- **Estimated Files**: ~40 (about 20 server incl. tests and scripts, about 16 web incl. tests, docs)

---

## UX Design

### Before
```
Home: list of saved recipes (newest first). No way to search by what you have.
```

### After
```
┌──────────────────────────────────────────────────────┐
│  RecipeMixer     Recipes   What can I cook?  [+ New] │
├──────────────────────────────────────────────────────┤
│  What's in your fridge?                              │
│  ┌────────────────────────────────────────────────┐  │
│  │ (chicken ×) (rice ×) (spinach ×)  type + Enter │  │
│  └────────────────────────────────────────────────┘  │
│  [x] Assume pantry staples (salt, pepper, water, oil)│
│                                                      │
│  12 recipes you could make or nearly make            │
│  ┌──────────────────────┐ ┌──────────────────────┐   │
│  │ photo                │ │ photo                │   │
│  │ Chicken fried rice   │ │ Spinach curry        │   │
│  │ You have 5 of 6   ✓  │ │ You have 3 of 6      │   │
│  │ Missing: soy sauce   │ │ Missing: onion, ...  │   │
│  └──────────────────────┘ └──────────────────────┘   │
└──────────────────────────────────────────────────────┘
URL: /match?i=chicken&i=rice&i=spinach&staples=1  (shareable, back button works)
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Header nav | New recipe button only | Adds "What can I cook?" link | Active link styled |
| `/match` | does not exist | Ingredient chips, staples toggle, ranked results | Empty input shows a short hint, not all recipes |
| Result card | n/a | "You have X of Y" badge and a "Missing:" list | Tap opens the normal recipe detail page |
| Saving a recipe | ingredient text stored only | Text also normalised and indexed (invisible to the user) | Existing recipes are backfilled at server start |

---

## Mandatory Reading

All files exist today (branch `feat/ingredient-matching`, created from `main`):

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `server/src/db/recipes.ts` | 35-56 | `insertChildren` and `createRecipe`: where ingredient rows are written (hook normalisation here) |
| P0 | `server/src/db/recipes.ts` | 87-104 | `updateRecipe` deletes and reinserts ingredient rows (words must cascade) |
| P0 | `server/src/db/migrations/001_init.sql` | 13-26 | `recipe_ingredient` columns `name_normalized`, `quantity`, `unit` and existing indexes |
| P0 | `server/src/routes/recipes.ts` | 17-27, 36 | `parseId`, `requireRecipe`, and the `parseOrThrow(listQuerySchema, req.query)` GET pattern |
| P0 | `server/src/schemas/recipe.ts` | 49-80 | `listQuerySchema`, summary types, `parseOrThrow` |
| P0 | `server/src/app.ts` | 45-64 | Plugin registration order |
| P1 | `server/src/index.ts` | all | Startup sequence (where the backfill runs after `migrate`) |
| P1 | `server/src/db/migrate.ts` | 16-50 | Migration runner (`NNN_name.sql`) |
| P1 | `server/test/recipes-repo.test.ts` | 1-40 | In-memory DB test setup and `input()` factory |
| P1 | `server/test/recipes-routes.test.ts` | 1-30 | Route test style with `app.inject` |
| P1 | `server/test/migrate.test.ts`, `server/test/health.test.ts` | version asserts | Schema version assertions to bump 2 → 3 |
| P1 | `web/src/lib/api.ts` | 1-40 | `request()` helper and `ApiError` |
| P1 | `web/src/pages/RecipeListPage.tsx` | 1-60 | Load/empty/error state pattern with `AbortController` |
| P1 | `web/src/components/Layout.tsx` | header block | Where the nav link goes |
| P2 | `web/src/components/RecipeCard.tsx`, `StarRating.tsx` | all | Reuse for result cards |
| P2 | `web/src/test-utils.ts` | all | `stubFetch`, `apiResponse`, `summary`, `detail` helpers |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| `parse-ingredient` 3.0.0 (MIT, CommonJS, built-in types, one dependency `numeric-quantity`) | [npm / README](https://npmjs.com/package/parse-ingredient) | Returns objects with `quantity`, `unitOfMeasure`/`unitOfMeasureID` and `description` ("1 1/2 cups sugar" → 1.5, cup, "sugar"). Option `ignoreUOMs` lets words like "large" stay in the description ("2 large eggs"). Header-like lines ("For the sauce:") are flagged `isGroupHeader`. Package is CommonJS: verify the named import works under `NodeNext` before relying on it. |
| `pluralize` 8.0.0 (MIT) | npm | `pluralize.singular('tomatoes')` → `tomato`. Add `@types/pluralize`. |
| Matching pitfalls | vendor guides found via search (unverified) | Naive matching fails on singular/plural and units; coverage-based ranking ("fewest extra items first", per-recipe missing counts) is the common pattern; no authoritative source describes pantry-staple handling, so that is our own documented design choice. |
| SQLite | already in use | `WITHOUT ROWID` composite-key tables are compact for the word index; dynamic `IN (?,?,…)` lists need a hard cap (SQLite's default limit is 32,766 variables, we cap at 100). |

GOTCHA: Search results found no authoritative scoring formula or staple policy, so the rules below are a deliberate, documented design and are covered by fixture tests rather than claimed to be an industry standard.

---

## Matching Design (decisions made in this plan)

### 1. Normalising one ingredient line
`normalizeIngredient(raw) → { quantity, unit, names }`

1. Lower-case; drop anything in parentheses; cut at the first comma ("onion, finely chopped" → "onion"); skip group headers (`isGroupHeader`).
2. Split alternatives on ` or ` ("butter or margarine" → two names). Every alternative is indexed; matching either counts.
3. Parse quantity and unit with `parse-ingredient` (keep the description part).
4. Remove **descriptor words** (`STOP_WORDS`): sizes (large, small, medium), states and preparation words (fresh, dried, frozen, chopped, diced, minced, sliced, grated, shredded, melted, softened, peeled, boneless, skinless, ripe, finely, roughly, optional, ...). Words such as `ground` are treated as descriptors too, because matching is intentionally generous ("ground beef" → `beef`, "ground cinnamon" → `cinnamon`).
5. Apply `SYNONYMS` (rewrite to one canonical form): scallion/spring onion → `green onion`; aubergine → `eggplant`; courgette → `zucchini`; capsicum → `bell pepper`; garbanzo → `chickpea`; coriander leaves → `cilantro`; chilli → `chili`; plain `pepper` → `black pepper`; etc.
6. Singularise each word with `pluralize.singular`.
7. The canonical `name` is the remaining words joined by a space (`yellow onion`); its word list is what is indexed. Lines that normalise to nothing yield no names (they never match and show up as missing).

### 2. When does a user ingredient match a recipe ingredient?
Both sides are normalised the same way into word sets `X` (user) and `Y` (recipe line). They match when `X == Y`, or one is a **subset** of the other (`onion` ⊂ `red onion`, `chicken` ⊂ `chicken breast`), **unless** the extra words contain an identity-changing modifier from `IDENTITY_MODIFIERS` (`peanut`, `coconut`, `almond`, `soy`, `oat`, `ice`, `bell`, ...). Conflicting modifiers never match (`green onion` vs `red onion`: neither is a subset). Known limitation, documented in the README: the rules are an English, Western-cuisine approximation.

### 3. Pantry staples
`STAPLES` = `salt`, `black pepper`, `water`, the `oil` family (`oil`, `olive oil`, `vegetable oil`), `cooking spray`. With `assumeStaples=true` (default) staple lines are removed from both numerator and denominator, so they never appear as "missing" and do not inflate the score. Recipes whose lines are all staples are excluded. The toggle is exposed in the UI and API.

### 4. Scoring and ranking
`coverage = matchedCount / totalCount` over counted (non-staple) lines. Sort by `coverage` desc, then `missingCount` asc, then own `rating` desc (nulls last), then newest. Default `minMatched = 1` so every recipe sharing at least one ingredient appears, best first (the PRD: "it doesn't have to be exact, a subset is fine"). Optional `minCoverage` (0-1) filters further.

### 5. Two-stage query (performance)
Stage 1 (SQL, indexed): count distinct recipe lines per recipe whose words are in the user's word set, keep the top 500 recipes by hits. Stage 2 (TypeScript): load those recipes' ingredient lines and apply the precise rule above, then score and rank. Target: p95 < 200 ms with 15,000 recipes.

### 6. Re-normalisation without data loss
`recipe_ingredient.normalizer_version` records which rule version produced each row. On every start, rows with a lower version than `NORMALIZER_VERSION` are re-processed in batches (`raw_text` is never modified). Changing a rule list means bumping the constant.

---

## Patterns to Mirror

Real code from the repository. Follow these exactly.

### NAMING_CONVENTION
// SOURCE: server/src/db/recipes.ts:35-56, server/src/routes/recipes.ts:17
```ts
// files kebab-case.ts, functions camelCase, relative imports end in .js
export function createRecipe(db: Db, input: RecipeInput): number { ... }
function parseId(raw: string): number { ... }
// DB: snake_case; API JSON: camelCase; env: SCREAMING_SNAKE
```

### REPOSITORY_PATTERN
// SOURCE: server/src/db/recipes.ts:35-56
```ts
function insertChildren(db: Db, recipeId: number, input: RecipeInput): void {
  const insertIngredient = db.prepare(
    'INSERT INTO recipe_ingredient (recipe_id, position, raw_text) VALUES (?, ?, ?)',
  );
  input.ingredients.forEach((text, position) => insertIngredient.run(recipeId, position, text));
  ...
}
export function createRecipe(db: Db, input: RecipeInput): number {
  return db.transaction(() => { ... })();
}
```
Synchronous better-sqlite3, parameterised SQL only, multi-statement writes in `db.transaction`.

### SCHEMA_AND_ROUTE_PATTERN
// SOURCE: server/src/schemas/recipe.ts:49-54, server/src/routes/recipes.ts:36
```ts
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});
app.get('/api/recipes', async (req) => listRecipes(db, parseOrThrow(listQuerySchema, req.query)));
```

### ERROR_HANDLING
// SOURCE: server/src/schemas/recipe.ts:74-82, server/src/app.ts error handler
```ts
export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) { ... throw badRequest(`Invalid ${field}: ${issue?.message ?? 'invalid value'}`); }
  return result.data;
}
// 4xx HttpError messages reach the client; never echo submitted values; 500s are generic.
```

### SERVICE_PATTERN
// SOURCE: server/src/app.ts:53-55
```ts
await app.register(healthRoutes, { db });
await app.register(recipeRoutes, { db, images });
await app.register(imageRoutes, { images });   // add: await app.register(matchRoutes, { db });
```

### MIGRATION_PATTERN
// SOURCE: server/src/db/migrations/002_recipe_indexes.sql, 001_init.sql
```sql
-- header comment, snake_case, one concern per file; never edit an applied migration
CREATE INDEX idx_recipe_created ON recipe (created_at DESC, id DESC);
```

### TEST_STRUCTURE
// SOURCE: server/test/recipes-repo.test.ts:1-40, server/test/recipes-routes.test.ts:1-30
```ts
let db: Db;
beforeEach(() => { db = openMemoryDatabase(); migrate(db); });
afterEach(() => { db.close(); });
function input(overrides: Partial<RecipeInput> = {}): RecipeInput { return { title: 'Tomato soup', ... , ...overrides }; }
// routes: app = await makeApp(); await app.inject({ method: 'GET', url: '/api/...' });
```

### WEB_API_AND_STATE_PATTERN
// SOURCE: web/src/lib/api.ts (request/ApiError), web/src/pages/RecipeListPage.tsx:14-40
```tsx
const controller = new AbortController();
listRecipes({ limit, offset: 0, signal }).then(...).catch(() => { if (!signal?.aborted) setFailed(true); })
return () => controller.abort();
```

### WEB_TEST_PATTERN
// SOURCE: web/src/pages/RecipeListPage.test.tsx, web/src/test-utils.ts
```tsx
stubFetch({ 'GET /api/recipes?limit=24&offset=0': () => apiResponse({ items: [], total: 0 }) });
render(<MemoryRouter><RecipeListPage /></MemoryRouter>);
expect(await screen.findByRole('heading', { name: 'No recipes yet' })).toBeInTheDocument();
```

---

## Files to Change

### Server
| File | Action | Justification |
|---|---|---|
| `server/package.json` | UPDATE | add `parse-ingredient`, `pluralize`, dev `@types/pluralize` |
| `server/src/db/migrations/003_ingredient_index.sql` | CREATE | `normalizer_version` column, `recipe_ingredient_word` table and indexes |
| `server/src/services/ingredient-data.ts` | CREATE | `STOP_WORDS`, `SYNONYMS`, `STAPLES`, `IDENTITY_MODIFIERS`, `NORMALIZER_VERSION` |
| `server/src/services/ingredients.ts` | CREATE | `normalizeIngredient`, `ingredientsMatch`, `isStaple` |
| `server/src/db/ingredients.ts` | CREATE | write words, backfill, candidate query, vocabulary suggest |
| `server/src/db/recipes.ts` | UPDATE | `insertChildren` fills normalised columns and words |
| `server/src/services/matching.ts` | CREATE | `findMatches` (stage 2 scoring and ranking) |
| `server/src/schemas/match.ts` | CREATE | query schemas and result types |
| `server/src/routes/match.ts` | CREATE | `GET /api/match`, `GET /api/ingredients/suggest` |
| `server/src/app.ts` | UPDATE | register `matchRoutes` |
| `server/src/index.ts` | UPDATE | run the backfill after `migrate` |
| `server/scripts/eval-matching.ts` | CREATE | print top results for the author's own ingredient sets |
| `server/package.json` scripts, `vitest.config.ts` | UPDATE | `bench` and `eval:matching` scripts; keep the benchmark out of the default run |
| `server/test/{ingredients,ingredient-data,ingredients-db,matching,match-routes}.test.ts` | CREATE | unit and route tests |
| `server/test/fixtures/matching-library.ts` | CREATE | ~40 realistic recipes and 10 ingredient sets with expected results |
| `server/test/bench/matching.bench.test.ts` | CREATE | 15,000-recipe performance check |
| `server/test/migrate.test.ts`, `server/test/health.test.ts` | UPDATE | schema version 2 → 3 |

### Web
| File | Action | Justification |
|---|---|---|
| `web/src/lib/types.ts`, `web/src/lib/api.ts` (+ `api.test.ts`) | UPDATE | `MatchResult` types, `matchRecipes`, `suggestIngredients` |
| `web/src/components/IngredientChips.tsx` (+ test) | CREATE | chip input |
| `web/src/components/MatchCard.tsx` (+ test) | CREATE | result card with "You have X of Y" and missing list |
| `web/src/pages/MatchPage.tsx` (+ test) | CREATE | the "What can I cook?" page |
| `web/src/components/Layout.tsx`, `web/src/App.tsx` | UPDATE | nav link and `/match` route |
| `web/src/App.test.tsx` | UPDATE | routing test for `/match`, schema version text |

### Docs
| File | Action | Justification |
|---|---|---|
| `README.md`, `SECURITY.md` | UPDATE | feature, API table, matching rules and limits |

## NOT Building

- A pantry inventory that persists between searches (ingredients live in the URL only; Grocy-style tracking is out of scope).
- Quantity-aware matching ("do I have 2 cups?"): quantities and units are stored but not compared.
- Fuzzy/typo matching and semantic embeddings; only the rule-based normaliser above.
- An autocomplete dropdown UI (Phase 6); this phase uses the browser's native `<datalist>` fed by the suggest endpoint.
- Seed data or URL import (Phases 5 and 7): matching quality is evaluated on fixtures and the author's own recipes.
- Non-English ingredient names.

---

## Step-by-Step Tasks

### Task 1: Dependencies and licence check
- **ACTION**: `npm install -w server parse-ingredient pluralize` and `npm install -D -w server @types/pluralize`.
- **IMPLEMENT**: Confirm versions (`parse-ingredient` 3.x, `pluralize` 8.x). Run the licence check; add any new licence expression it reports only if it is an open licence.
- **MIRROR**: Phase 2 dependency step (npm install per workspace).
- **IMPORTS**: n/a yet.
- **GOTCHA**: `parse-ingredient` is CommonJS. Under `NodeNext` check that `import { parseIngredient } from 'parse-ingredient'` works at runtime and in the compiled `dist` (`node -e "require('parse-ingredient')"` and a tsx import). If the named import fails, use `import pkg from 'parse-ingredient'` and destructure. `pluralize` is CommonJS with `export =` types, so use the default import.
- **VALIDATE**: `npm run typecheck -w server && npm run audit:licenses && node -e "console.log(require('parse-ingredient').parseIngredient('1 1/2 cups sugar'))"`.

### Task 2: Ingredient data lists (test first)
- **ACTION**: Write `server/test/ingredient-data.test.ts`, then `server/src/services/ingredient-data.ts`.
- **IMPLEMENT**: Export `NORMALIZER_VERSION = 1`, `STOP_WORDS: ReadonlySet<string>`, `SYNONYMS: ReadonlyMap<string, string>` (phrase → canonical), `STAPLES: ReadonlySet<string>` (canonical names), `IDENTITY_MODIFIERS: ReadonlySet<string>`. Keep each list small, alphabetised and commented with why entries exist.
- **MIRROR**: NAMING_CONVENTION (constants in SCREAMING_SNAKE, kebab-case file).
- **IMPORTS**: none.
- **GOTCHA**: Tests assert structural rules, not just contents: every key and value is lower-case and trimmed, no synonym maps to itself, no synonym value is itself a key (no chains), no staple is also a stop word, no entry has leading or trailing spaces.
- **VALIDATE**: `npm test -w server -- ingredient-data` passes.

### Task 3: Normaliser and match predicate (test first)
- **ACTION**: Write `server/test/ingredients.test.ts` (table-driven), then `server/src/services/ingredients.ts`.
- **IMPLEMENT**: `normalizeIngredient(raw: string): { quantity: number | null; unit: string | null; names: string[] }` where `names` holds one canonical name per alternative (empty when nothing usable). `wordsOf(name: string): string[]`. `ingredientsMatch(user: string[], recipe: string[]): boolean` implementing the subset-without-identity-modifier rule. `isStaple(name: string): boolean`. Apply the normalisation steps from the design. Hard limit: only the first 200 characters of a line are processed; avoid regexes with nested quantifiers (no ReDoS).
- **MIRROR**: Pure functions with no I/O, like `isLoopbackHost` in `server/src/config.ts`.
- **IMPORTS**: `parse-ingredient`, `pluralize`, data lists.
- **GOTCHA**: The table test must include at least: `2 cups chopped yellow onions` → `yellow onion`; `1 (14 oz) can diced tomatoes` → `tomato`; `salt and pepper to taste` (decide and assert the behaviour: two staple names or one line); `butter or margarine` → two names; `3 large eggs, beaten` → `egg`; `1 lb ground beef` → `beef`; `fresh cilantro leaves` → `cilantro`; `scallions` → `green onion`; `For the sauce:` → no names; unicode fractions `½ cup milk` → `milk`; empty and whitespace; a 5,000-character junk line (must finish quickly); markup-like text. Match table: `onion` vs `red onion` true; `red onion` vs `onion` true; `green onion` vs `red onion` false; `butter` vs `peanut butter` false; `milk` vs `coconut milk` false; `chicken` vs `chicken breast` true; `pepper` (→ black pepper) vs `bell pepper` false.
- **VALIDATE**: `npm test -w server -- ingredients` passes; a 5,000-character line normalises in under 50 ms.

### Task 4: Migration 003, DB layer and write path (test first)
- **ACTION**: Write `server/test/ingredients-db.test.ts`; create `003_ingredient_index.sql` and `server/src/db/ingredients.ts`; update `recipes.ts` and `index.ts`; bump version assertions in `migrate.test.ts` and `health.test.ts` to 3.
- **IMPLEMENT**:
  - Migration: `ALTER TABLE recipe_ingredient ADD COLUMN normalizer_version INTEGER NOT NULL DEFAULT 0;` `CREATE TABLE recipe_ingredient_word (ingredient_id INTEGER NOT NULL REFERENCES recipe_ingredient (id) ON DELETE CASCADE, word TEXT NOT NULL, PRIMARY KEY (ingredient_id, word)) WITHOUT ROWID;` `CREATE INDEX idx_ingredient_word_word ON recipe_ingredient_word (word);`
  - `indexIngredientRow(db, rowId, raw)`: runs `normalizeIngredient`, sets `name_normalized` (first name), `quantity`, `unit`, `normalizer_version = NORMALIZER_VERSION`, and replaces the word rows (union of the words of all alternatives).
  - `insertChildren` in `recipes.ts` calls it for every inserted ingredient (inside the existing transaction).
  - `backfillIngredients(db, batchSize = 500): number`: processes rows with `normalizer_version < NORMALIZER_VERSION` in batches, each batch in its own transaction; returns rows updated. `index.ts` calls it after `migrate(db)` and logs the count.
  - `suggestIngredients(db, prefix, limit)`: distinct `name_normalized` with counts, prefix range query (`name_normalized >= ? AND name_normalized < ?`), prefix lower-cased, max 40 characters, limit up to 20.
- **MIRROR**: REPOSITORY_PATTERN, MIGRATION_PATTERN.
- **IMPORTS**: `normalizeIngredient`, `NORMALIZER_VERSION`.
- **GOTCHA**: `updateRecipe` deletes and reinserts ingredient rows; the `ON DELETE CASCADE` on the word table (foreign keys are ON) removes stale words, so no extra cleanup is needed (test it). `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT` is allowed in SQLite. The backfill must be idempotent and safe to run on every start; a crash mid-way just resumes. Never modify `raw_text`. Keep SQL static; the suggest range query must not use `LIKE` with user-supplied wildcards.
- **VALIDATE**: `npm test -w server -- ingredients-db migrate health recipes-repo` passes: creating a recipe fills the normalised columns and words; update replaces them; delete cascades; a row inserted with `normalizer_version = 0` is repaired by the backfill, which then returns 0 on a second run; suggestions respect the prefix and limit and ignore wildcard characters.

### Task 5: Matching service, schemas and routes (test first)
- **ACTION**: Write `server/test/matching.test.ts` and `server/test/match-routes.test.ts` (using `server/test/fixtures/matching-library.ts`), then `schemas/match.ts`, `services/matching.ts`, `routes/match.ts`, and register in `app.ts`.
- **IMPLEMENT**:
  - `matchQuerySchema`: `i` (repeated, 1 to 30 items, each trimmed 1-60 characters; accept a single string or an array), `staples` (`'1'|'0'`, default `'1'`), `minCoverage` (0-1, default 0), `limit` (1-100, default 24), `offset` (0 or more, default 0).
  - `findMatches(db, query)`: normalise the input into word sets (drop inputs that normalise to nothing and report them as `ignored`); stage 1 SQL: `SELECT ri.recipe_id, COUNT(DISTINCT ri.id) AS hits FROM recipe_ingredient_word w JOIN recipe_ingredient ri ON ri.id = w.ingredient_id WHERE w.word IN (?,?,…) GROUP BY ri.recipe_id ORDER BY hits DESC, ri.recipe_id DESC LIMIT 500` (placeholders generated from a capped word list, max 100); stage 2 loads those recipes' lines and applies `ingredientsMatch`, staples and scoring.
  - Result item: `{ recipe: RecipeSummary, matchedCount, totalCount, coverage, matched: string[], missing: string[] }` using the original `raw_text` for display. Response: `{ items, total, usedIngredients: string[], ignored: string[], assumeStaples: boolean }`.
  - `GET /api/ingredients/suggest?q=on&limit=8` → `{ items: [{ name, count }] }`.
- **MIRROR**: SCHEMA_AND_ROUTE_PATTERN, SERVICE_PATTERN, ERROR_HANDLING.
- **IMPORTS**: `parseOrThrow`, `HttpError` helpers; export a small row-to-summary helper from `db/recipes.ts` rather than duplicating `toSummary`.
- **GOTCHA**: Placeholder lists are built from a validated, capped array only. Register `/api/match` and `/api/ingredients/suggest` as static routes (no clash with `/api/recipes/:id`). Query parsing: a single `i=chicken` arrives as a string and `i=a&i=b` as an array. Never echo user input in error messages. An empty ingredient list returns 400 (the UI shows a hint instead of calling the API). Recipes with zero counted lines are skipped.
- **VALIDATE**: `npm test -w server -- matching match-routes` passes. Fixture expectations: `chicken, rice, soy sauce` ranks the fried-rice recipe first; `green onion` does not match a recipe that only has `red onion`; `peanut butter` does not satisfy `butter`; the staples toggle changes `totalCount` and removes salt from `missing`; ties break by fewer missing then rating; 400 for no ingredients, 31 ingredients, a 61-character ingredient, `minCoverage=2`, `limit=0`.

### Task 6: Benchmark and evaluation script
- **ACTION**: Create `server/test/bench/matching.bench.test.ts` and `server/scripts/eval-matching.ts`; update `server/package.json` scripts and `vitest.config.ts`.
- **IMPLEMENT**:
  - Benchmark: build 15,000 synthetic recipes (deterministic seeded PRNG, 6-14 ingredient lines drawn from a vocabulary of about 400 items) inside one transaction, run 200 queries of 3-8 ingredients, assert p95 < 200 ms (log p50/p95/max). It is excluded from `npm test` and runs with `npm run bench -w server`.
  - Script `npm run eval:matching -w server -- sets.json`: reads a JSON array of ingredient lists, runs `findMatches` against the real database in `DATA_DIR`, and prints a Markdown table of the top 5 per set with coverage and missing items, so the author can judge the "8 of 10 sets return a recipe I would cook" metric.
- **MIRROR**: scripts like `server/scripts/copy-migrations.mjs` (but TypeScript run through `tsx`); config in `server/vitest.config.ts`.
- **IMPORTS**: `openDatabase`, `migrate`, `findMatches`.
- **GOTCHA**: Do not read from or write to the repository's `data/` folder in tests (temp directories only); the eval script must say if it runs the backfill. Bench inserts must use the real `createRecipe` so the write path is measured too.
- **VALIDATE**: `npm run bench -w server` prints p95 below 200 ms; the eval script runs against a temp database seeded by the fixture library and prints a table.

### Task 7: Web API client and types (test first)
- **ACTION**: Update `web/src/lib/api.test.ts`, then `types.ts` and `api.ts`.
- **IMPLEMENT**: Types mirror the server response. `matchRecipes({ ingredients, staples, minCoverage, limit, offset, signal })` builds the query with repeated `i=` parameters using `URLSearchParams` (encoded); `suggestIngredients(q, signal)`.
- **MIRROR**: WEB_API_AND_STATE_PATTERN (`request()` helper, `ApiError`).
- **IMPORTS**: existing helpers.
- **GOTCHA**: Always encode via `URLSearchParams` (user text goes into the query string); keep key order stable so tests can assert exact URLs.
- **VALIDATE**: `npm test -w web -- api` passes (exact URL, repeated `i`, encoding of `&` and spaces, error mapping).

### Task 8: Web components, page and routing (test first where practical)
- **ACTION**: Create `IngredientChips`, `MatchCard` and `MatchPage` (with tests); update `Layout.tsx`, `App.tsx` and `App.test.tsx`.
- **IMPLEMENT**:
  - `IngredientChips`: controlled input; Enter or comma adds a trimmed, de-duplicated (case-insensitive) chip; Backspace on empty input removes the last chip; each chip has a remove button with `aria-label="Remove chicken"`; max 30 chips with a message; `<datalist>` suggestions from `suggestIngredients` (debounced, aborting stale requests).
  - `MatchCard`: a link to `/recipes/:id` in the style of `RecipeCard`, shows `You have {matchedCount} of {totalCount}` as a badge (stronger style at coverage 1), and `Missing: …` (first 5 plus "+N more").
  - `MatchPage`: reads and writes the ingredients and staples toggle in the URL query (`i`, `staples`), shows a hint when there are no ingredients, loading skeletons, an error state with retry, an empty state ("Nothing close yet, try fewer ingredients or add more recipes") and a "Load more" button; the staples checkbox is labelled "Assume pantry staples (salt, pepper, water, oil)".
  - Layout nav: link "What can I cook?" next to "New recipe"; route `/match`.
- **MIRROR**: WEB_API_AND_STATE_PATTERN, WEB_TEST_PATTERN, existing Tailwind and shadcn usage in `RecipeListPage.tsx` and `RecipeCard.tsx`.
- **IMPORTS**: `react-router` (`useSearchParams`), `@/components/ui/*`, `@/lib/api`.
- **GOTCHA**: Ingredient text must render as plain text (no `dangerouslySetInnerHTML`). The URL carries the ingredient list; this is local-only data, but never log it. Keep inline styles out (strict CSP). Debounce timers must be cleaned up (tests use fake timers). Do not call the API while the chip list is empty.
- **VALIDATE**: `npm run typecheck -w web && npm test -w web` pass. Tests cover chips add/remove/duplicate/keyboard, URL sync on reload, result rendering with the missing list, the staples toggle refetching with `staples=0`, empty and error states, load more, and the nav link.

### Task 9: Documentation, validation and report
- **ACTION**: Update README (feature available, API table rows, "How matching works" with the rules and limits) and SECURITY.md (input caps, parameterised SQL, rate limiting on the new endpoints); run all validation; write the report.
- **IMPLEMENT**: Document the limitations: English only, approximate ingredient equivalence, quantities ignored, staples assumed by default.
- **MIRROR**: existing README and SECURITY.md structure.
- **IMPORTS**: n/a.
- **GOTCHA**: No personal paths or real recipe data in docs or fixtures (fixtures are hand-written generic recipes).
- **VALIDATE**: Everything in the Validation Commands section below.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Normalise quantity + descriptors | `2 cups chopped yellow onions` | `yellow onion`, qty 2, unit cup | No |
| Normalise parentheses/can | `1 (14 oz) can diced tomatoes` | `tomato` | Yes |
| Alternatives | `butter or margarine` | two names | Yes |
| Group header | `For the sauce:` | no names | Yes |
| Unicode fraction | `½ cup milk` | `milk`, qty 0.5 | Yes |
| Synonyms | `scallions`, `courgette`, `capsicum` | `green onion`, `zucchini`, `bell pepper` | No |
| Junk and long input | 5,000 chars, markup text | finishes < 50 ms, no throw | Yes |
| Match subset | `onion` vs `red onion` | true | No |
| Match conflict | `green onion` vs `red onion` | false | Yes |
| Identity modifier | `butter` vs `peanut butter` | false | Yes |
| Staples | `salt`, `olive oil`, `water` | staple true | No |
| Word index on create/update/delete | recipe CRUD | words match, cascade removes stale words | Yes |
| Backfill | rows at version 0 | repaired once, 0 on rerun | Yes |
| Suggest | prefix `on`, `%`, `_` | prefix only, wildcards inert | Yes |
| Ranking | fixture library + 10 sets | expected recipes in top 3 | No |
| Ties | equal coverage | fewer missing, then rating, then newest | Yes |
| Staples toggle | `staples=0` | `totalCount` and `missing` change | Yes |
| Query validation | 0, 31, 61-char, `minCoverage=2` | 400 | Yes |
| SQL metacharacters | `'); DROP TABLE recipe;--` as an ingredient | 200 (normalises to junk), tables intact | Yes |
| Benchmark | 15,000 recipes, 200 queries | p95 < 200 ms | Yes |
| Web: chips | Enter, comma, Backspace, duplicate, 31st chip | correct chips, message at the limit | Yes |
| Web: page | URL `?i=a&i=b&staples=0` | request sent with the same values | No |
| Web: results | missing list > 5 | `+N more` | Yes |

### Edge Cases Checklist
- [ ] Empty ingredient list (400 server-side, hint in the UI)
- [ ] Maximum input (30 ingredients of 60 characters)
- [ ] Ingredients that normalise to nothing (reported as `ignored`)
- [ ] Recipes with no ingredient lines or only staples (never returned)
- [ ] Existing Phase 2 recipes (backfill on first start after upgrade)
- [ ] Unicode and punctuation in ingredient names
- [ ] Concurrent writes while matching (SQLite WAL, read-only queries)
- [ ] Very large libraries (benchmark)

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
EXPECT: All tests pass (Phase 2's 219 tests still pass after the version updates, plus the new ones)

### Benchmark
```bash
npm run bench -w server
```
EXPECT: p95 under 200 ms for 15,000 recipes

### Full Test Suite
```bash
npm test && npm run build
```
EXPECT: No regressions; both builds succeed

### Security and Licence Checks
```bash
npm audit --omit=dev --audit-level=high && npm run audit:licenses
```
EXPECT: 0 production vulnerabilities; licence allowlist passes

### Database Validation
```bash
npm run build -w server && node server/dist/index.js   # then in another shell:
curl -s "http://127.0.0.1:3210/api/health"
curl -s "http://127.0.0.1:3210/api/match?i=chicken&i=rice"
```
EXPECT: `schemaVersion` 3; existing recipes appear in matches after the startup backfill

### Docker Validation
```bash
docker compose up -d --build
# create two or three recipes via the API or UI, then:
curl -s "http://127.0.0.1:3210/api/match?i=onion"
docker compose down && docker compose up -d   # results identical after restart
```
EXPECT: healthy container; matching works and survives a restart (remove the throwaway volume afterwards)

### Browser Validation
Open `http://127.0.0.1:3210/match`, add chips, toggle staples, open a result, use the back button.
EXPECT: no console errors or CSP violations; only first-party requests; the URL reflects the search; keyboard-only flow works

### Manual Validation
- [ ] Add the author's real recipes, run `npm run eval:matching` with 10 real fridge sets and judge the top 5 (PRD target: at least 8 of 10 sets have a recipe worth cooking)
- [ ] Save a recipe edit and confirm matching reflects the change immediately
- [ ] Check an obviously wrong match (for example `butter` vs peanut butter) is not returned
- [ ] Remove throwaway Docker volumes and test data afterwards

---

## Acceptance Criteria
- [ ] All tasks completed
- [ ] All validation commands pass
- [ ] Tests written and passing
- [ ] No type errors
- [ ] No lint errors
- [ ] Matches the UX design
- [ ] PRD Phase 4 success signal: the hit-rate trial meets the metric on the author's 10 ingredient sets (judged with the eval script)

## Completion Checklist
- [ ] Code follows the conventions in Patterns to Mirror
- [ ] Errors never leak internals or echo user input
- [ ] All SQL parameterised; dynamic placeholder lists capped
- [ ] Tests use in-memory databases and temp directories only
- [ ] `raw_text` is never modified; normalised data is rebuildable
- [ ] README and SECURITY.md updated
- [ ] No Phase 3/5/7 scope added (no name/cuisine search, no URL import, no seed data)
- [ ] Self-contained: Phase 6 can add autocomplete and polish on top of the suggest endpoint and chip component

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Matching quality is subjective and the rules are approximate (false positives like butter/peanut butter, false negatives from unusual names) | H | H | Fixture library with expected results, identity-modifier and synonym lists, eval script on the author's real data, rules versioned so they can be improved without data loss |
| `parse-ingredient` mis-parses unusual lines (ranges, "a pinch of", metric abbreviations) | M | M | The normaliser only trusts its description; stop-word cleanup and table tests; unparseable lines are shown as missing rather than guessed |
| Performance on large libraries | M | M | Two-stage query with an indexed word table, 500-candidate cap, benchmark test with a p95 target |
| Backfill on first start is slow for big libraries | L | L | Batched transactions, idempotent, logs progress; typical hobby libraries are small |
| CommonJS import problems under NodeNext | M | L | Early validation step in Task 1, default-import fallback |
| Over-fitting rules to English/Western cuisines | H | M | Documented limitation; data lists are plain files that can be extended |
| Staples assumption surprises the user | M | L | Visible toggle, default documented, shown in the UI label |
| Existing tests pinned to schema version 2 | H | L | Explicit update in Task 4 |

## Notes
- The three parallel PRD phases (3 search, 4 matching, 5 URL import) touch `server/src/app.ts` and `server/src/db/recipes.ts` only lightly; expect small merge conflicts if they run concurrently. Phase 3 will also add FTS5 over the same `recipe_ingredient` rows; this phase's `recipe_ingredient_word` table is independent of that.
- Why subset matching instead of exact: the PRD states a partial overlap is fine ("it can be a subset of the overall ingredients"), and generous word-subset matching with a short exclusion list gives high recall while keeping the worst false positives out.
- Why a word index plus TypeScript scoring instead of pure SQL: the subset-with-exclusions rule is awkward in SQL; indexing words keeps stage 1 fast and stage 2 simple and testable.
- Confidence for one-pass implementation: 7/10. The mechanics are straightforward; the main uncertainty is rule quality on real recipes, which the eval script and fixtures exist to expose early.

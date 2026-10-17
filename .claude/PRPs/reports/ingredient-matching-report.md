# Implementation Report: Ingredient Matching (RecipeMixer Phase 4)

## Summary
Delivered the product's key feature: enter the ingredients you have and get your saved recipes ranked by how much of each you can already make, with the missing ingredients listed.

- **Server:** a rule-based ingredient normaliser (quantity, unit, canonical names, alternatives, synonyms, compounds), a migration with a word index, write-time indexing plus a startup backfill for older recipes, a two-stage matcher (indexed word lookup, then precise scoring and ranking), `GET /api/match` and `GET /api/ingredients/suggest`, a Markdown evaluation report with a CLI, and a 15,000-recipe benchmark.
- **Web:** a "What can I cook?" page with a chip input (Enter, comma or pasted lists), a pantry-staples switch, ranked result cards ("You have X of Y", "Missing: ..."), loading, empty and error states, load more, URL-based state (shareable, back button works) and a header link.

Nothing is committed. The work is on branch `feat/ingredient-matching` (created from `main`).

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large (matched) |
| Confidence | 7/10 | Held. Mechanics went smoothly; the risk the plan named (rule quality) is only partly retired, see "Not Verified". |
| Files Changed | ~40 | 45 (about 22 server incl. tests and scripts, about 12 web, docs, plan and report) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Dependencies and licence check | Done | `parse-ingredient` 3.0.0 and `pluralize` 8.0.0 import cleanly from the ESM server; licences pass |
| 2 | Ingredient data lists | Done | Structural tests on the lists caught a redundant stop word |
| 3 | Normaliser and match predicate | Done | 92 tests including 100+ table cases |
| 4 | Migration 003, DB layer, write path | Done | Extra `normalized_names` column (deviation) |
| 5 | Matching service, schemas, routes | Done | 30-recipe fixture library and 10 expectation sets all pass |
| 6 | Benchmark and evaluation script | Done | p95 = 49.8 ms on 15,000 recipes |
| 7 | Web API client and types | Done | |
| 8 | Chips, card, page, routing | Done | |
| 9 | Documentation and validation | Done | README (feature, API, how matching works), SECURITY.md |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `eslint .` clean; `tsc` clean for server and web |
| Unit Tests | Pass | 423 tests: 328 server (was 162), 95 web (was 57) |
| Build | Pass | server and web |
| Benchmark | Pass | 15,000 recipes indexed in 11.3 s; 200 queries p50 28.6 ms, p95 49.8 ms, max 61.0 ms (budget 200 ms) |
| Integration (Docker) | Pass | Healthy container at schema 3; recipes created through the API match correctly; a recipe inserted directly (no index) was invisible to matching until restart, then the startup log showed `reindexed: 3` and it matched; `+`-encoded spaces, compounds (`peanut butter`) and spaced suggestions work |
| Integration (browser) | Pass | Typing `eggs` + Enter and `butter` + comma created chips and updated the URL; ranked results with missing lists; open a recipe then Back restores the search; staples toggle changed `1 of 3` to `1 of 4` and the URL gained `staples=0`; zero CSP violations (listener) |
| Evaluation script | Pass | Ran against a real server database seeded with the fixture library; printed the report; clear error when no database exists |
| Security/licence | Pass | `npm audit --omit=dev`: 0 vulnerabilities; licence allowlist passes; regex sweep for secrets and personal data clean; dry-run staging shows no data, image or test-output files |

## Files Changed

| Area | Files |
|---|---|
| Server source | `services/{ingredient-data,ingredients,matching,match-report}.ts`, `db/ingredients.ts`, `db/migrations/003_ingredient_index.sql`, `schemas/match.ts`, `routes/match.ts`; updated `db/recipes.ts`, `app.ts`, `index.ts` |
| Server scripts and config | `scripts/{eval-matching.ts,example-sets.json}`, `vitest.bench.config.ts`; updated `vitest.config.ts`, `tsconfig.json`, `package.json` |
| Server tests | `ingredient-data`, `ingredients`, `ingredients-db`, `matching`, `match-routes`, `match-report`, `bench/matching.bench`, `fixtures/matching-library`; updated `health`, `migrate` (schema version 3) |
| Web source | `components/{IngredientChips,MatchCard}.tsx`, `pages/MatchPage.tsx`; updated `lib/{api,types}.ts`, `components/Layout.tsx`, `App.tsx` |
| Web tests | `IngredientChips`, `MatchCard`, `MatchPage` (new); `api.test.ts`, `App.test.tsx` (updated) |
| Docs | `README.md`, `SECURITY.md`, `package-lock.json` |

## Deviations from Plan

1. **Compounds are single hyphenated tokens, and colour varieties of onion collapse to `onion`.** Instead of relying only on an exclusion list, known compounds (`peanut-butter`, `coconut-milk`, `soy-sauce`, `tomato-paste`, ...) become one token, so they can never match their parts. `yellow/red/white onion` normalise to `onion`, so the plan's example `yellow onion` became `onion`. `green-onion` stays distinct. The identity-word list shrank accordingly.
2. **Extra column `recipe_ingredient.normalized_names`** (all alternative names joined by `|`) in migration 003. The plan stored only the first name, but matching needs every alternative and re-parsing lines per query would have been too slow.
3. **`services/match-report.ts`** holds the report rendering (the plan put it inside the script), so it is unit-tested and the CLI stays a thin wrapper.
4. **`extract` removed from the identity words** and **`as` removed from the stop words.** The first would have stopped `vanilla` matching `vanilla extract`; the second was redundant (it singularises to `a`). The structural tests on the lists found the second.
5. **Suggestions are shown with spaces** (`peanut butter`) while stored hyphenated; typing the spaced form normalises to the same name.
6. **Fixture library has 30 recipes**, not about 40.
7. **Chip input extras:** it also commits on blur and splits pasted comma lists.
8. **Benchmark config is separate** (`vitest.bench.config.ts`) and `server/tsconfig.json` now also typechecks `scripts/`.

## Issues Encountered

- GateGuard bounced part of one batch of edits, leaving a short-lived inconsistent state (the nav link and route were added, their imports were not). I found it with a search, redid the bounced edits and re-ran the whole suite before continuing.
- The first `pluralize` check showed it turns `molasses` into `molass`, so a small uncountable-word list is registered at start-up.
- Windows-specific note carried over: the browser tool's console log is cumulative across navigations, so a stale Phase 2 CSP line still appears there; a fresh `securitypolicyviolation` listener proved no new violations.

## Not Verified
- **The PRD success metric** ("at least 8 of 10 of your real ingredient sets return a recipe you would cook") needs your own recipes. Only a 30-recipe hand-written library and 10 expectation sets were checked. Use `npm run eval:matching -w server -- sets.json` against your database to judge it.
- The browser's native `<datalist>` suggestion dropdown (the tool cannot show it); the suggestion endpoint and the chip component's handling of suggestions are tested.
- A keyboard-only walkthrough and a real phone-width layout (only a ~540 px pane was used).
- CI, which has never been run on this branch.

## Next Steps
- [ ] Review with `/code-review`
- [ ] Commit with `/prp-commit` (branch `feat/ingredient-matching`) and open a pull request
- [ ] Try it on your real recipes with `npm run eval:matching`; word lists are in `server/src/services/ingredient-data.ts` and are meant to be tuned
- [ ] Phases 3 (name and cuisine search) and 5 (URL import) remain; Phase 6 can add richer autocomplete on top of the suggestion endpoint

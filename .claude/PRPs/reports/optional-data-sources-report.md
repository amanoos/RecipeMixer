# Implementation Report: Optional data sources (RecipeMixer Phase 7)

## Summary
A fresh install now has something to cook with, and the project stays fully open. An empty library offers **Load starter recipes**, which adds 43 original recipes written for this project and released as CC0 (repeating it adds nothing). There is also an **optional TheMealDB search**, off by default, on the Import page: search by name, review a result in the normal recipe form, save it with its photo and a link back. Nothing from TheMealDB and no key is stored in the repository. An independent security review found no high issue and one medium (a `.gitignore` rule that would have dropped the starter data from the commit, found before committing); it is fixed.

Nothing is committed. The work is on branch `feat/optional-data-sources`, created from `main` after Phase 8 was merged.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium |
| Files Changed | ~28 | 46 (includes tests, docs, plan and report) |
| Starter recipes | about 40 | 43 |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Starter recipe data | Done | 43 everyday recipes from many cuisines; CC0 licence file beside the data |
| 2 | Starter loader and route | Done | `POST /api/starter-recipes`, skips titles already present; data lives in `server/src/data` so the build copies it into `dist` |
| 3 | Settings | Done | `MEALDB_ENABLED` (off), `MEALDB_API_KEY` (default `1`, plain characters only) |
| 4 | JSON fetch through the guard | Done | `fetchJson`, 1 MB cap, JSON content type only |
| 5 | Meal mapping | Done | untrusted record parsing, limits, photo host allow-list |
| 6 | MealDB routes | Done | search and detail; 404 when off; share the import limiter |
| 7 | Web | Done | empty-state button, `MealDbSearch`, `features` flag from the session answer |
| 8 | CLI seed command | Done | `npm run seed:starter -w server -- --dir <folder>` |
| 9 | Docs and security text | Done | `docs/DATA-SOURCES.md`, README, SECURITY.md, `.env.example`, compose, DEPLOYMENT |
| 10 | Validation and independent review | Done | see below |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static analysis | Pass | `eslint .` clean; `tsc` clean for server and web |
| Unit tests | Pass | 1,235 tests: 1,007 server (was 896), 228 web (was 208) |
| Build | Pass | `dist/data` contains the recipes and the licence file |
| Audit and licences | Pass | 0 vulnerabilities; licence check exit 0; no new dependency |
| Mutation checks | Pass | 15 guard rails broken on purpose, each caught: routes absent when off, key charset, id digits, answer for another meal, photo host and scheme, result cap, URL encoding, record id, ingredient slots, starter idempotence, JSON content type, JSON size cap, feature forced on, query length; plus the shared concurrency cap (a separate limiter makes a test fail). One initial miss (JSON content type) led to a stronger test |
| Live, real TheMealDB | Pass | `search.php` and `lookup.php` through the built server; draft mapped correctly; the photo downloaded, re-encoded and served from `/api/images`; the saved recipe is found again as a duplicate; the key path appears 0 times in the server log |
| Live, Docker (read-only, all capabilities dropped) | Pass | starter load works from `dist` (43 then 0), feature off gives 404 |

## Independent security review (Task 10)
One read-only reviewer (security auditor), with raw-socket probes, a DNS spy and real calls. No high issue.

| Severity | Finding | Outcome |
|---|---|---|
| Medium | `.gitignore` had a bare `data/` rule that ignored `server/src/data/`, so the starter recipes and CC0 licence would not have been committed and a fresh clone and CI would fail. I reproduced it | Fixed: `/data/` and `/server/data/` anchored; `git add -A -n` now lists both files |
| Low | JSON content-type check accepted `+json` inside a parameter (`text/html; charset=+json`) | Fixed: only the media type is judged (`isJsonType`, tested) |
| Low | Photo address had no length cap, so a long one failed confusingly at save | Fixed: capped at 2048, like the image importer |
| Low | Docs said the lookups "share the import limits"; the 10 per minute limits are per route, only the 2-at-a-time cap is shared | Docs reworded |
| Info | Docs said "personal use" for the free key, which TheMealDB's pages do not say; two terms were omitted | Reworded to "development or educational use", marked as this project's reading, added the artwork-licence and third-party notes |
| Info | Clumsy double parenthesis in SECURITY.md; `features.mealdb` is public on `/api/session` | Fixed the wording; the flag is not sensitive |

Held up: fixed API host (no input changed host, path, scheme, port or query), key never in logs or responses (sentinel test), off by default with no outgoing lookup, untrusted record handling (digits-only ids, truncation, prototype-pollution and 200,000-level nesting probes), photo host allow-list tricks, login on every new route, Content-Security-Policy unchanged.

## Files Changed (46)

| Area | Files |
|---|---|
| Server source (new) | `services/starter-recipes.ts`, `services/mealdb.ts`, `services/concurrency.ts`, `routes/starter.ts`, `routes/mealdb.ts`, `data/starter-recipes.json`, `data/LICENSE-starter-recipes.txt`, `scripts/seed-starter.ts` |
| Server source (updated) | `config.ts`, `app.ts`, `routes/import.ts`, `routes/session.ts`, `services/safe-fetch.ts`, `scripts/copy-migrations.mjs`, `package.json` |
| Server tests | new `starter-recipes`, `mealdb`, `mealdb-routes`; updated `safe-fetch`, `config`, `route-protection`, `auth-routes`, `import-routes`, `helpers` |
| Web | new `MealDbSearch.tsx` and test; updated `ImportPage`, `RecipeListPage`, `lib/api.ts`, `lib/auth.ts`, `lib/types.ts`, `AuthGate` and tests |
| Docs and config | `docs/DATA-SOURCES.md`, README, SECURITY.md, `docs/DEPLOYMENT.md`, `.env.example`, `docker-compose.yml`, `.gitignore`, PRD, plan (archived) and this report |

## Deviations from Plan
1. **Starter data lives in `server/src/data/`** (not `server/data/`), so one relative path works from source and from the compiled `dist`, mirroring how migrations are copied.
2. **43 recipes** instead of about 40.
3. **Concurrency cap moved into a shared helper** (`services/concurrency.ts`) so imports and TheMealDB count against one cap; `routes/import.ts` now exports its limit constants.
4. **Search results show no thumbnails**: the strict Content-Security-Policy stays unchanged.
5. **`features` reaches the web app through `AuthContext`**, read from the public session answer.

## Issues Encountered
- The review caught the `.gitignore` problem that local tests could not see, because the files existed on disk.
- My mutation script lost backslashes in two patterns (shell escaping) and reported "pattern missing"; fixed by building the pattern with `String.fromCharCode`. The same stripping briefly broke my new content-type regex until a test run showed it.
- No `pkill` in Git Bash on Windows: the live test server had to be stopped through PowerShell.
- The write gate bounced the first write of many files; each was redone after stating the facts it asked for.

## Not Verified
- Behaviour with a TheMealDB **supporter key** (only the free key `1` was used), and TheMealDB's behaviour under their own rate limits.
- The new UI in a real browser (covered by component tests; I did not drive the page by hand this phase).
- **CI on this branch.**
- The starter text's originality is my own assurance; no automated check can prove it.

## Next Steps
- [ ] Commit on `feat/optional-data-sources` and open a PR; merge after CI
- [ ] Still yours from Phase 8: enable private vulnerability reporting in the repository settings
- [ ] All eight PRD phases are now complete

# Implementation Report: URL Import (RecipeMixer Phase 5)

## Summary
You can now paste a recipe link on a new **Import** page. The server fetches the page, reads its standard `schema.org` recipe data (JSON-LD), and opens the normal new-recipe form pre-filled for you to check. Nothing is saved until you press Save; if the page named a photo, it is downloaded after the save (tick box, on by default) through the same validation and re-encoding as an upload. A link that is already in your library is flagged.

Because the server fetches addresses a user types, all of it goes through one guarded fetcher: http(s) on the standard ports only, every resolved address must be public, the connection is pinned to the address that was checked (no DNS rebinding), redirects are followed by hand and re-checked, and size, decompressed size and time are capped. No new dependencies.

- **Server:** `ip-guard` (public-address check), `safe-fetch` (guarded fetcher), `recipe-jsonld` (parser), `POST /api/import/preview`, `POST /api/recipes/:id/image/from-url`, a `URL_IMPORT_ENABLED` switch, route rate limit (10 a minute) and a two-at-a-time cap.
- **Web:** Import page and nav link, pre-filled form with a banner and photo checkbox, a fresh form on every navigation.
- **Tooling:** `npm run eval:import -w server -- urls.txt` to measure how many of your own links import.

Nothing is committed. The work is on branch `feat/url-import`, created from `main`.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large (matched) |
| Files Changed | ~22 | 40 (plan said ~22; the tests, docs and shared-helper extraction were larger than estimated) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Errors and config | Done | `unprocessable`, `tooManyRequests`, `badGateway`; `URL_IMPORT_ENABLED` |
| 2 | Address guard | Done | IPv4, IPv6 and IPv4-mapped IPv6, fails closed |
| 3 | Guarded fetcher | Done | All 15 controls in the plan; 54 tests |
| 4 | JSON-LD parser | Done | `@graph`, type arrays, HowToStep/HowToSection, image variants, bounded scans; 27 tests |
| 5 | Schemas and repository helper | Done | `findRecipeIdBySourceUrl` |
| 6 | Routes | Done | Preview and photo-from-URL; 19 route tests |
| 7 | Wire up | Done | `AppDeps.fetcher` override for tests |
| 8 | Web client and types | Done | |
| 9 | Import page | Done | |
| 10 | Pre-filled form | Done | |
| 11 | Eval script | Done | Also shares `decodePage` with the route so it measures what the app does |
| 12 | Docs | Done | README, SECURITY.md (including two statements that import made untrue), `.env.example` |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `eslint .` clean; `tsc` clean for server and web |
| Unit Tests | Pass | 725 tests: 574 server (was 412), 151 web (was 116) |
| Build | Pass | server and web |
| Benchmark | Not rerun | search and matching code was not touched |
| Integration (Docker) | Pass | Healthy at schema 4. Refused: `169.254.169.254`, `localhost`, `2130706433`, `[::ffff:7f00:1]` (same generic message, reason in the log only), plus `file:`, odd ports and `127.0.0.1:3210` (400 with a hint). Live flow with a real recipe page: preview, save, photo downloaded and served as WebP, a second preview flagged the duplicate, the recipe was found by search and by "What can I cook?" (3 of 9 for chicken, rice, egg) |
| Integration (browser) | Pass | Import page, duplicate notice, "Import anyway", pre-filled form with the photo box, save with the downloaded photo on the detail page, Back from the saved recipe goes to Import (not the form), "New recipe" in the header gives a blank form. Console clean in a fresh tab through the whole flow |
| Security/licence | Pass | `npm audit --omit=dev`: 0 vulnerabilities; licence allowlist passes; sweep for secrets and personal data clean; dry-run staging shows only source, tests and docs |

### Live import sample (not the PRD's 20-site sample)
Of 4 real recipe pages, 3 imported with title, ingredients, steps and photo (alyonascooking, lecremedelacrumb, spendwithpennies). The fourth (loveandlemons) was a path I guessed that returned 404, so it says nothing about coverage. One 2012 blog page had no recipe data. The run also included `example.com` and a deliberately dead link, so the script's headline "3 of 7" is not a coverage figure. **The PRD target (70% of 20 sites) still needs your own list of links.**

## Files Changed

| Area | Files |
|---|---|
| Server source (new) | `services/ip-guard.ts`, `services/safe-fetch.ts`, `services/recipe-jsonld.ts`, `services/recipe-images.ts`, `schemas/import.ts`, `routes/import.ts` |
| Server source (updated) | `app.ts`, `config.ts`, `errors.ts`, `db/recipes.ts`, `routes/recipes.ts` |
| Server tooling | `scripts/eval-import.ts`, `scripts/example-urls.txt`, `package.json` |
| Server tests | new `ip-guard`, `safe-fetch`, `recipe-jsonld`, `import-routes`; updated `config`, `errors`, `recipes-repo`, `helpers` |
| Web source | new `pages/ImportPage.tsx`, `lib/import-preview.ts`; updated `pages/RecipeFormPage.tsx`, `lib/api.ts`, `lib/types.ts`, `App.tsx`, `components/Layout.tsx` |
| Web tests | new `ImportPage.test.tsx`, `RecipeFormImport.test.tsx`, `import-preview.test.ts`; updated `api.test.ts`, `App.test.tsx` |
| Docs and config | `README.md`, `SECURITY.md`, `.env.example`, PRD, plan and this report |

## Deviations from Plan

1. **The global error handler now passes `HttpError` messages through at any status.** It used to do so only below 500, so the deliberate 502 "Could not fetch that page" came out as a generic 500. This changes behaviour for every route; existing 5xx responses from non-`HttpError` failures stay generic.
2. **Shared image code extracted** into `services/recipe-images.ts` (`attachImage`, `removeImageIfUnused`), and `parseId` and `requireRecipe` are now exported from `routes/recipes.ts`, so the upload route and the new route do not duplicate the replace-and-clean-up logic.
3. **`networkDeps` is exported** from `safe-fetch.ts` so tests can exercise the real socket layer against a local server.
4. **The form is keyed by navigation** (`FormRoute` in `App.tsx`). Not in the plan: found in review, because choosing "New recipe" while on an imported form would otherwise keep the old values. A test fails without it.
5. **Form tests are in their own file**, `RecipeFormImport.test.tsx`, rather than appended to `RecipeFormPage.test.tsx`.
6. **`decodePage` lives in `recipe-jsonld.ts`** and is shared with the eval script (the plan had it private to the route).
7. **A redirect to a port or scheme that is not allowed** gives the same generic failure as any other refused target, rather than a specific message (only the address the user typed gets hints).

## Issues Encountered

- A test failed that proved a real bug: the 502 was being turned into a 500 (deviation 1).
- The real network layer ignored the URL's port (it connected to port 80 and something local answered). Harmless in production, where only default ports are allowed, but fixed and covered by a test.
- `fetchPage` threw synchronously on a bad URL instead of returning a rejected promise; it is now `async`.
- The first version of the "never contacts a local server" test could not fail: every URL in it was stopped by the port rule or pointed at port 80. It was rewritten with a positive control (a public lookup reaches the test server, a loopback lookup does not) and mutation-checked by making the address guard allow everything, which made the guard tests fail.
- The first browser session showed one inline-style CSP error. It also appeared on `/api/health`, and did not appear in a fresh tab through the whole flow, so it was a stale message in the old tab, not from this change.
- GateGuard hooks bounced the first write or edit of many files and several times left a batch half-applied (for example `App.tsx` importing a page that did not exist yet). Each was caught by typecheck and redone.
- A `MaxListenersExceededWarning` appears when the server tests run. It was already there on `main`, before this change.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `ip-guard.test.ts` | 57 | every blocked range at its edges, public examples, mapped IPv6, garbage input |
| `safe-fetch.test.ts` | 54 | URL parsing, IP literal forms, DNS answers, pinning, fallback to a second address, redirects, size, compression bombs, timeouts, status codes, content types, real sockets |
| `recipe-jsonld.test.ts` | 27 | parser variants, text cleaning, limits, hostile input, charset decoding |
| `import-routes.test.ts` | 19 | both endpoints, validation, duplicate flag, rate limit, concurrency cap, switch off, real guarded fetcher refusals, photo replace and clean-up |
| `recipes-repo.test.ts` (added) | 3 | source-link lookup |
| `config.test.ts` (added) | 2 | the URL import switch |
| `errors.test.ts` (extended) | 0 new tests | the three new error helpers, in the existing helper test |
| Web: `ImportPage` 7, `RecipeFormImport` 9, `import-preview` 14, `api` +4, `App` +1 | 35 | import page states, pre-filled form, photo options, retry after a failed photo, state validation, form reset, API client |

## Not Verified
- The PRD success metric (at least 70% of a 20-site sample imports with title, ingredients and photo): needs your list of links.
- **No security review by a separate reviewer was done.** The plan's Risks table called for a pass by the security-reviewer agent before commit; I relied on the 54-test fetcher suite, the mutation check, and the Docker run. Worth doing before you rely on it outside localhost.
- `URL_IMPORT_ENABLED=false` was tested in unit tests (both endpoints 404, nothing fetched) but not in the running container.
- Redirects and compressed pages were tested with fakes, not against a real site that does either; the real socket layer was tested only against a local server and three public pages.
- A real IPv6-only host, and servers that reset connections midway, were not tried.
- Phone-width layout and keyboard-only use of the new page and checkbox (the earlier phases' open items still apply).
- CI on this branch.

## Next Steps
- [ ] Run `npm run eval:import -w server -- urls.txt` on about 20 links from sites you cook from
- [ ] Review the fetcher with a security reviewer before relying on it beyond localhost
- [ ] Commit on `feat/url-import`
- [ ] Phase 6 (UI polish) or Phase 8 (authentication and cloud guide) are next in the PRD

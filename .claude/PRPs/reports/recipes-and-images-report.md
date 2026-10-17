# Implementation Report: Recipes & Images (RecipeMixer Phase 2)

## Summary
Added recipe storage with images. The server gained a validated JSON CRUD API (`/api/recipes`), a hardened image pipeline (real-content type check, size and pixel limits, re-encode to WebP, metadata stripped, content-hash filenames, atomic writes, reference-counted cleanup) and a validated image route (`/api/images/:filename`). The web app gained a recipe list with pagination, a detail page, a create/edit form with image upload and preview, star rating, a confirmation dialog for deletion, client-side routing and a footer server-status indicator.

Nothing is committed. The work is on branch `feat/recipes-and-images` (created from `feat/foundation-security-scaffold`, which holds the Phase 1 commit).

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large (matched) |
| Confidence | 7/10 | Held. The predicted CSP risk with Radix did occur and was fixed; the multipart and router API assumptions held up. |
| Files Changed | ~35 | ~45 changed or created (about 20 server incl. tests, about 22 web incl. tests, plus docs, Dockerfile, lockfile) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Dependencies, config, licence policy | Done | `imagesDir` config, Node engines `>=22.22.0`, LGPL allowed for libvips |
| 2 | Migration 002 and version assertions | Done | Schema version is now 2 |
| 3 | HttpError and zod schemas | Done | |
| 4 | Recipe repository | Done | `deleteRecipe` returns `{deleted, imagePath}` (deviation) |
| 5 | Recipe CRUD routes | Done | |
| 6 | Image service | Done | Added a byte-signature pre-check (extra hardening) |
| 7 | Image routes and app wiring | Done | |
| 8 | Container adjustments | Done | Dockerfile verifies sharp loads |
| 9 | Web API client and types | Done | |
| 10 | Web components, pages, routing | Done | Radix AlertDialog replaced by native dialog (deviation) |
| 11 | Documentation | Done | README (features, API table, backup), SECURITY.md |
| 12 | End-to-end validation | Done | Docker plus real browser |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `eslint .` clean; `tsc` clean for server and web |
| Unit Tests | Pass | 219 tests: 162 server (was 42), 57 web (was 6) |
| Build | Pass | server and web |
| Integration (Docker) | Pass | Container healthy; created a recipe, uploaded a 2400x1800 JPEG carrying copyright/description EXIF: stored as 1600x1200 WebP with no EXIF and none of the secret strings in the bytes; SVG and a fake PNG rejected with 415 and left no files; path-traversal image URLs return 404; data dir mode 0700, image files 0600; recipe and image survived `docker compose down`/`up` with byte-identical image |
| Integration (browser) | Pass | List shows card and image; detail, edit link, create form (blank ingredient lines dropped), save and redirect, delete through the confirmation dialog; only first-party requests; no CSP violations after the dialog fix |
| Security/licence | Pass | `npm audit --omit=dev`: 0 vulnerabilities; licence allowlist passes; regex sweep for secrets and personal data clean |
| Edge Cases | Pass | See tests: invalid ids, limits, SQL metacharacters and markup stored inert, shared image reference counting, concurrent identical saves, truncated and oversize images, storage failures in the browser |

## Files Changed

| Area | Files |
|---|---|
| Server source | `config.ts` (imagesDir), `errors.ts`, `schemas/recipe.ts`, `db/recipes.ts`, `db/migrations/002_recipe_indexes.sql`, `services/images.ts`, `routes/recipes.ts`, `routes/images.ts`, `app.ts` |
| Server tests | `errors`, `recipes-repo`, `recipes-routes`, `images-service`, `images-routes` (new); `helpers`, `health`, `migrate` (updated) |
| Web source | `lib/{types,api}.ts`, `components/{Layout,ServerStatus,StarRating,ImagePicker,RecipeCard,ConfirmDialog}.tsx`, `pages/{RecipeListPage,RecipeDetailPage,RecipeFormPage}.tsx`, `App.tsx`, `main.tsx`, shadcn `input`, `label`, `textarea`, `skeleton` |
| Web tests | `lib/api`, `components/{StarRating,ImagePicker,ConfirmDialog}`, `pages/{RecipeListPage,RecipeDetailPage,RecipeFormPage}` (new); `App.test.tsx`, `test-setup.ts` (updated); `test-utils.ts` (helper) |
| Build/docs | `Dockerfile`, `package.json` (engines, licences), `server/package.json`, `web/package.json`, `package-lock.json`, `README.md`, `SECURITY.md` |

## Deviations from Plan

1. **Native `<dialog>` instead of the shadcn/Radix AlertDialog.** Opening Radix's dialog injects a `<style>` element (its scroll lock), which the strict `style-src 'self'` CSP blocks and reports in the console. Rather than loosen the CSP, I built `ConfirmDialog` on the native `<dialog>` element (focus trap, Escape and backdrop handling, focus starts on Cancel) and deleted the unused `alert-dialog.tsx`. Verified in the real browser: modal, accessible, zero violations on repeated open/close.
2. **`deleteRecipe` returns `{ deleted, imagePath }`** rather than only the image path, so "recipe not found" and "recipe had no image" can be told apart.
3. **Extra hardening in `processImage`:** the leading bytes are checked for JPEG/PNG/WebP before any decoder is invoked, so an SVG is rejected without ever reaching sharp or librsvg. sharp's decoded format is still checked afterwards.
4. **Test helper changes:** the stale `port: 3000` in `testConfig` became `3210`; each test app gets its own temp images directory; a jsdom `<dialog>` polyfill was added to `test-setup.ts`; a shared `test-utils.ts` provides the fetch stub and fixtures.
5. **Plain-text POST returns 400, not 415.** Fastify parses `text/plain` as a string, which the schema then rejects as an invalid body; truly unsupported types such as XML get 415. Both are safe; the test now asserts this.
6. **React-hooks ESLint rules are still not enabled** (carried over from Phase 1: the config-protection hook blocks edits to `eslint.config.js`).

## Issues Encountered

- GateGuard fact-forcing hooks bounced most first-time file writes, so many files were written twice. Resolved by restating facts and retrying; the gate gives a same-directory credit once one sibling has been gated, so ordering matters.
- The Radix CSP conflict above; an earlier console message stayed in the browser tool's log after the fix, so I added a `securitypolicyviolation` listener to prove no new violations occurred.
- Windows path quirks in my own curl and `docker exec` commands (MSYS path rewriting); not app bugs.
- Port 3000 on this machine is used by another application (found in Phase 1); the default stays 3210.

## Not Verified
- The image picker preview and upload through the real browser file chooser (the browser tool cannot drive a file dialog). Covered by unit tests of the picker and form, and by the curl upload against the real container.
- GPS-tagged EXIF specifically; the test image carried copyright and description tags (the same mechanism strips all metadata).
- Keyboard-only walkthrough and phone-width layout in a real browser (only a ~540 px wide pane was used); star rating keyboard operation is unit-tested.
- CI workflow and gitleaks, which still have never run (no remote).

## Next Steps
- [ ] Review with `/code-review`
- [ ] Commit with `/prp-commit` (branch `feat/recipes-and-images`)
- [ ] Phases 3 (search), 4 (ingredient matching) and 5 (URL import) can now run in parallel; each touches `server/src/app.ts` and `server/src/db/recipes.ts` lightly

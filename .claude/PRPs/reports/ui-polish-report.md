# Implementation Report: UI Polish (RecipeMixer Phase 6)

## Summary
The features this phase listed in the PRD already existed, so the work was to fix what a measured audit found and to add the single-page-app basics Lighthouse does not check. On a 375 px phone the header no longer overflows (the "New recipe" button and the theme toggle were clipped), the page no longer jumps while loading (layout shift 0.74 to 0.00 on the list), controls have touch-sized targets, cards line up, the red Delete button is readable (accessibility 96 to 100 on the recipe page), every page has its own title, there is a skip link, and focus follows you from page to page without ever stealing it while you type. The app also has a warm tomato accent in both themes. On the server, text responses are compressed (the script goes from 340 KB to 108 KB on the wire) and the content-hashed build files are cached for a year.

Nothing is committed. The work is on branch `feat/ui-polish`, created from `main` after Phase 5 was merged.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium (matched) |
| Files Changed | ~25 | 39 (tests, demo-data script, new shared components and docs added up) |

## Before and after (same procedure as the baseline: 30 demo recipes, Chrome Lighthouse and trace)

| Measure | Before | After |
|---|---|---|
| Accessibility, 5 pages, mobile, light | 100, 100, 100, 100, **96** (recipe page) | **100 on all five** |
| Accessibility, dark | 100 (checked on 2 pages) | **100 on all five** |
| Contrast, red Delete button | 3.98:1 (needs 4.5:1) | passes |
| Header at 375 px | needs 466 px: button and theme toggle clipped | fits; no horizontal overflow at 320, 375, 768 and 1280 px, every page |
| Smallest tap target on touch (320 px) | nav links 28 px; selects, search and buttons 32 px | everything 44 px or more, except the chips' remove buttons (38 px, up from 30) |
| Layout shift, list page (4x CPU, Fast 4G) | **0.74** | **0.00** |
| Layout shift, recipe page | not measured | 0.00 |
| Layout shift, match page | 0.093 (Lighthouse) | the cause (an empty first frame) is fixed and Lighthouse's layout-shift audit passes (dark run); not re-traced |
| Largest Contentful Paint, list page (same throttling) | 2.15 s, of which 1.96 s was waiting for the first photo to be requested | 2.06 s; the photo wait is gone, what is left is running the JavaScript under 4x CPU slowdown |
| Largest Contentful Paint, recipe page | not measured | 1.51 s |
| Script over the wire | 336 KB, uncompressed | **108 KB** (brotli); 107 KB gzip |
| Caching of hashed build files | revalidated on every visit (`max-age=0`) | one year, `immutable`; `index.html` stays `no-cache` |

Lighthouse's performance score was not available from the tool used here, so performance is judged from the trace numbers above, not a score.

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Demo data script | Done | `npm run seed:demo -w server -- --dir ./demo-data`; refuses a missing `--dir` and any folder that already has a database |
| 2 | Header that fits any screen | Done | logo and theme toggle on one row, links wrap beneath, `<nav>` landmark |
| 3 | Touch targets and contrast | Done | taller controls on touch devices only; darker destructive colour |
| 4 | Consistent cards | Done | full-height link, flush placeholder tile, two reserved title lines |
| 5 | Stable loading | Done | six-card skeletons of the real shape, detail page skeleton |
| 6 | Faster first photos | Done | first photo `fetchpriority="high"`, first row eager, explicit width and height |
| 7 | Titles, skip link, focus | Done | `useDocumentTitle`, "Skip to content", `RouteFocus` (path changes only) |
| 8 | Cache, compression, lazy routes | Partly | cache and compression done; lazy routes tried and **reverted** (see deviations) |
| 9 | Reduced motion and accent | Done | `prefers-reduced-motion` rule, tomato accent in both themes, card hover, empty-state icons |
| 10 | Verify, document, report | Done | |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `eslint .` clean; `tsc` clean for server and web |
| Unit Tests | Pass | 767 tests: 586 server (was 574), 181 web (was 151) |
| Build | Pass | server and web |
| Audit and licences | Pass | `npm audit --omit=dev`: 0 vulnerabilities; licence check passes with the new MIT dependency (`@fastify/compress` 9.2.2) |
| Integration (Docker) | Pass | clean install with the new dependency; read-only container runs; `curl` shows brotli and the immutable cache on the script, gzip and `no-cache` on `index.html`; logs clean; throwaway project and volume removed |
| Browser | Pass | Lighthouse on five pages in light and dark; throttled traces; overflow and touch-size scripts at four widths; screenshots at 375 px (light) and desktop (dark) |

## Files Changed

| Area | Files |
|---|---|
| Web source (new) | `components/CardImage.tsx`, `CardGridSkeleton.tsx`, `RouteFocus.tsx`, `lib/use-document-title.ts` |
| Web source (updated) | `Layout.tsx`, `RecipeCard.tsx`, `MatchCard.tsx`, `IngredientChips.tsx`, `StarRating.tsx`, `ui/button.tsx`, `ui/input.tsx`, `ui/card.tsx`, the five pages, `App.tsx`, `index.css`, `test-setup.ts` |
| Web tests (new) | `CardImage`, `RouteFocus`, `Layout`, `use-document-title`, `page-titles`, `MatchPageFirstPaint` |
| Server source | `app.ts` (compression, cache headers), `scripts/demo-data.ts`, `scripts/seed-demo.ts`, `package.json`, lockfile |
| Server tests | `static-assets.test.ts`, `demo-data.test.ts` |
| Docs and config | `README.md`, `SECURITY.md`, `.gitignore`, PRD, plan and this report |

## Deviations from Plan

1. **Lazy-loaded routes were tried and reverted.** The plan's decision gate asked for at least a 20% smaller first download. Lazy pages brought it from 340 KB to 317 KB (7%; 2% gzipped), because the pages are tiny and the weight is React and the router. The simpler eager version stayed.
2. **A fix that was not in the plan:** the match page started with `loading = false`, so when opened with ingredients in the address it painted an empty frame and then jumped when the skeleton appeared (layout shift 0.093). It now starts out loading, with a test that renders the first frame to prove it (the test fails without the fix).
3. **`main` minimum height was not needed.** Skeletons of the real shape and size did the job, confirmed by a CLS of 0.00.
4. **Touch sizes needed a second pass:** the logo link (28 px) and the chip controls were missed by the first measurement and fixed after it. The chips' remove buttons stop at 38 px so chips do not become bulky.
5. **Compression threshold:** `@fastify/compress` applies its 1 KB threshold only to in-memory responses, not to streamed files, so the test checks the threshold on API responses instead of on a small CSS file.
6. **Shared components were extracted** (`CardImage`, `CardGridSkeleton`), which the plan listed only as changes inside the two cards and the pages.

## Issues Encountered

- The first Lighthouse run on the match page reported a layout shift of 0.093 that the earlier baseline had not flagged on that page; it led to deviation 2.
- My first touch-size script missed the logo link and the chips because it measured only the first page; the sweep across all five pages found them.
- A shell here-document of several hundred lines would not run; the same edits were applied with the Write tool and small scripts, with the same exact-match checks.
- GateGuard hooks bounced the first write of many files; each was redone after stating the facts it asked for.
- The two mutation checks (break the behaviour, watch the test fail, restore) both worked: route focus (typing must not move focus) and the match page's first frame.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `server/test/static-assets.test.ts` | 8 | cache headers for hashed and other files, security headers, gzip and brotli, small and large responses, photos left alone |
| `server/test/demo-data.test.ts` | 4 | recipes are valid, seeded counts and photos, the command's refusals |
| `web/src/components/RouteFocus.test.tsx` | 5 | no focus on first render, focus on path change, none on query change, Back does not scroll, missing target |
| `web/src/components/Layout.test.tsx` | 4 | skip link first and working, landmarks and links, focus after navigation, theme switch |
| `web/src/components/CardImage.test.tsx` | 8 | priorities, reserved photo box, placeholder tile, card link and title lines |
| `web/src/lib/use-document-title.test.tsx` | 4 | set, follow, restore, nothing to show |
| `web/src/page-titles.test.tsx` | 7 | every route's title |
| `web/src/pages/MatchPageFirstPaint.test.tsx` | 2 | first frame is already loading when opened with ingredients |

## Not Verified
- **Keyboard-only and screen-reader use by a person.** The skip link, focus movement and titles are covered by automated tests and the browser measurements, but I did not walk the whole app with a keyboard or a screen reader.
- A real phone: everything was measured with Chrome's device emulation (including touch), not on hardware, and only in Chrome (not Firefox or Safari).
- Real photos: the demo photos are plain colour fields, so image weight and decode time are understated.
- The match page's layout shift was fixed and the Lighthouse audit passes, but it was not re-traced under throttling.
- A Lighthouse performance score (not available here); the PRD's "performance at least 90" is supported by the trace numbers but not by a score.
- CI on this branch.

## Possible follow-ups
- On a phone the three filters (cuisine, rating, sort) stack in three rows and take much of the first screen; a more compact layout would show a recipe sooner.
- A security review of the Phase 5 URL fetcher is still outstanding (from the previous phase).

## Next Steps
- [ ] Walk the app once with the keyboard only, and on a real phone
- [ ] Commit on `feat/ui-polish` and open a PR
- [ ] Phase 7 (optional data sources) or Phase 8 (authentication and cloud guide) are next in the PRD

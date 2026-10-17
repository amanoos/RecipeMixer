# Plan: UI Polish (RecipeMixer Phase 6)

## Summary
Phases 3 to 5 already built the features the PRD lists for this phase (chips with autocomplete, search as you type, image cards, empty states, dark mode, native-dialog confirm). So this phase is not a redesign: it fixes what a measured audit of the running app found, so the PRD's success signal (Lighthouse performance and accessibility of at least 90, and "pleasant to use") is true on a phone as well as a desktop. The work is: a header that fits on a phone, a layout that does not jump while loading, faster first paint of the photos, cards that line up, bigger touch targets, one contrast fix, and the missing basics of a single-page app for keyboard and screen-reader users (page titles, skip link, focus on navigation). Plus two cheap server wins for cloud use: gzip/brotli and long-lived caching of the hashed build files.

## User Story
As someone who cooks from a phone in the kitchen, I want the app to load quickly, fit my screen and be easy to tap and read, so that finding a recipe for the ingredients I have is pleasant rather than fiddly.

## Problem → Solution
Works well on a desktop, but on a 375 px phone the header overflows (the "New recipe" button is clipped and the theme toggle is off-screen), the page jumps while loading (layout shift 0.74), controls are 28 to 32 px tall, and the cards in a row have different heights → fits any screen, stays still while loading, has comfortable touch targets, consistent cards.

## Metadata
- **Complexity**: Medium (many small changes across the web app, two small server changes, no migration)
- **Source PRD**: `.claude/PRPs/prds/recipe-mixer.prd.md`
- **PRD Phase**: 6 - UI polish
- **Estimated Files**: ~25 (web ~18 incl. tests, server ~4, docs, plan and report)

---

## Audit baseline (measured on the running app, 30 sample recipes, Chrome Lighthouse and trace)

| Area | Finding | Evidence |
|---|---|---|
| Accessibility score | 100 on the list, match, form and import pages, mobile, light and dark; **96 on the recipe page** | Lighthouse |
| Contrast | The red **Delete** button text is 3.98:1 (needs 4.5:1) | `color-contrast` audit on `/recipes/:id` |
| Header at 375 px | The nav needs about 466 px, so the page widens (mobile browsers zoom out) and "New recipe" and the theme toggle are clipped | screenshot, layout width 466 at a 375 viewport |
| Touch targets | nav links 28 px tall; selects, search box and buttons 32 px (usual guidance is 44 px; WCAG 2.2 AA minimum is 24 px, so these pass AA but are fiddly) | element measurements |
| Layout shift (CLS) | **0.74** (good is 0.1 or less): one shift of 0.7365 at about 1.9 s, when the list replaces a 3-card skeleton and pushes the footer and header area; font swap adds only 0.0001 | trace, `CLSCulprits` |
| Largest Contentful Paint | **2.15 s** with 4x CPU and Fast 4G throttling, of which 1.96 s is "load delay": the first card photo is `loading="lazy"`, has no `fetchpriority`, and is only requested after JS and the API call finish | trace, `LCPDiscovery` |
| Cards | cards in one row end at different heights (the link is not full height); the no-photo placeholder tile has a white band above it (the card's padding rule only removes padding for an `<img>`) | screenshot |
| Delivery | no compression (JS is 336 KB raw, 106 KB gzipped); hashed build files are served with `max-age=0`, so they are revalidated every visit; one JS bundle with no route splitting | `curl -I`, `dist` sizes |
| SPA basics | the page title is "RecipeMixer" on every page; no skip link; no focus or announcement on route change | code search |
| Already good | native-dialog confirm, visible focus rings, labels on all inputs, dark mode, reduced layout width on desktop, search-as-you-type, chips, empty and error states | audit |

## Targets (acceptance)
- Lighthouse accessibility **100** on every page in both themes (the one failure fixed), mobile profile.
- **No horizontal overflow** at 320, 375, 768 and 1280 px; header fully usable at 320 px.
- Layout shift **0.1 or less** on the list, match and detail pages with 30 recipes (4x CPU, Fast 4G).
- LCP on the list page **2.5 s or less** under the same throttling (from 2.15 s it is already inside the good range, so the goal is to cut the 1.96 s of delay and keep it there as the library grows; report the new number honestly).
- Primary touch controls at least 44 px tall on touch devices.
- Every page has its own title; skip link, focus handling and keyboard walkthrough verified by hand.
- Bundle: initial JS smaller than today (decision gate in Task 8) and served compressed.

---

## UX Design

### Before / After (phone, 375 px)
```
BEFORE                                   AFTER
┌───────────────────────────┐            ┌───────────────────────────┐
│RecipeMixer What can I co… │ clipped    │RecipeMixer            [☾] │
│                  [+ New re│            │[What can I cook?][Import] │
│                           │            │[+ New recipe]             │
│ cards of uneven heights   │            │ cards: equal heights,     │
│ page jumps while loading  │            │ stable while loading      │
└───────────────────────────┘            └───────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Header on a phone | overflows, theme toggle unreachable | logo and theme toggle on one row, nav wraps beneath | no hamburger menu, so no extra JS or focus trap |
| Keyboard | tab through the header on every page | "Skip to content" link first; focus moves to the page heading after navigation | search-param-only changes do not steal focus |
| Screen reader | same title everywhere, no announcement | `Page name - RecipeMixer` titles; route change announced by the focus move | |
| Cards | uneven, placeholder has a band | equal height per row, flush placeholder | |
| Loading | skeleton of 3, then a jump | skeleton sized like the real grid | |

---

## Mandatory Reading

| Priority | File | Why |
|---|---|---|
| P0 | `web/src/components/Layout.tsx` | header to fix; skip link and focus target go here |
| P0 | `web/src/components/RecipeCard.tsx`, `MatchCard.tsx` | card heights, placeholder band, image loading priority |
| P0 | `web/src/components/ui/card.tsx`, `button.tsx`, `input.tsx` | shared sizes and the card padding rule |
| P0 | `web/src/pages/RecipeListPage.tsx`, `MatchPage.tsx`, `RecipeDetailPage.tsx` | skeletons, titles, selects, delete button |
| P0 | `web/src/index.css` | colour tokens (`--destructive`), dark theme |
| P1 | `web/src/App.tsx`, `web/src/main.tsx` | routes for lazy loading and titles |
| P1 | `server/src/app.ts` | static file registration (caching), compression |
| P1 | `web/src/test-setup.ts`, `test-utils.ts`, `App.test.tsx` | test patterns |
| P2 | `web/src/components/ConfirmDialog.tsx`, `ImagePicker.tsx`, `IngredientChips.tsx` | touch size and keyboard behaviour |

## External Documentation
| Topic | Source | Key Takeaway |
|---|---|---|
| Core Web Vitals | web.dev (CLS, LCP) | reserve space, do not lazy-load the LCP image, use `fetchpriority="high"` on it |
| Touch size | WCAG 2.2 SC 2.5.8 (24 px minimum), common 44 px guidance | pointer-based sizing keeps desktop dense |
| Tailwind v4 | `pointer-coarse:` and `motion-reduce:` variants | size controls only on touch devices |
| @fastify/static | `maxAge`, `immutable` options | long cache only for content-hashed files |
| @fastify/compress | MIT licence | gzip and brotli for text responses |

---

## Patterns to Mirror
- **Components**: small function components, Tailwind classes via `cn`, shadcn-style primitives in `components/ui` (the project's own copies, free to edit).
- **Tests**: Testing Library with `MemoryRouter`, `stubFetch({'METHOD /path': ...})`, `findBy*` for async, role-based queries (see `web/src/pages/RecipeFormImport.test.tsx`).
- **Server**: plugins registered in `buildApp` (`server/src/app.ts`), config via `Config`, tests with `makeApp` and `app.inject`.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `web/src/components/Layout.tsx` | UPDATE | responsive header, `<nav>` landmark, skip link, focus on route change |
| `web/src/lib/use-document-title.ts` (+ test) | CREATE | one hook that sets `Page - RecipeMixer` |
| `web/src/components/RouteFocus.tsx` (+ test) | CREATE | moves focus to the main region after a path change (not on first load or search-only changes) |
| `web/src/components/RecipeCard.tsx`, `MatchCard.tsx` | UPDATE | full-height link and card, flush placeholder, `priority` prop for image loading |
| `web/src/components/ui/card.tsx` | UPDATE | padding rule also covers a placeholder tile (add `data-slot="card-image"`) |
| `web/src/components/ui/button.tsx`, `input.tsx` | UPDATE | `pointer-coarse:` heights |
| `web/src/pages/RecipeListPage.tsx`, `MatchPage.tsx`, `RecipeDetailPage.tsx`, `RecipeFormPage.tsx`, `ImportPage.tsx` | UPDATE | titles, skeleton shape, select heights, first-photo priority, delete button colour |
| `web/src/index.css` | UPDATE | `--destructive` text colour that meets 4.5:1 on its tinted background; reduced-motion rule; optional accent |
| `web/src/App.tsx` | UPDATE | lazy routes (if Task 8 gate passes), title for the 404 page |
| `server/src/app.ts` | UPDATE | long cache for `/assets/*`, compression |
| `server/package.json`, lockfile | UPDATE | `@fastify/compress` (MIT) |
| `server/test/static-assets.test.ts` | CREATE | cache and compression headers |
| `server/scripts/seed-demo.ts`, `package.json` | CREATE | repeatable demo data for audits and screenshots (see Task 1) |
| `README.md`, PRD, report | UPDATE/CREATE | notes and results |

## NOT Building
- A redesign, new pages or new features; no hamburger menu; no animation library; no UI kit swap.
- Offline support, PWA install, service worker (revisit with Phase 8 if wanted).
- Screenshot or visual-regression testing in CI (measure by hand and record numbers in the report).
- Server-side rendering or prerendering.
- Internationalisation.

---

## Step-by-Step Tasks

### Task 1: Demo data script (so every number can be reproduced)
- **ACTION**: `server/scripts/seed-demo.ts`, run as `npm run seed:demo -w server -- --dir ./demo-data`. Creates about 30 synthetic recipes (varied cuisines, ratings, one very long title, some without photos) with generated solid-colour photos, by calling the repository and image pipeline directly.
- **GOTCHA**: it must never touch real data: require an explicit `--dir`, refuse a directory that already contains `recipemixer.db`, and print the command to start the app on it. Add `demo-data/` to `.gitignore`.
- **VALIDATE**: a test that seeds an in-memory database and checks counts; refusal test on an existing database.

### Task 2: Header that fits any screen
- **ACTION**: restructure `Layout` header as logo + theme toggle on the first row and `<nav aria-label="Main">` beneath on small screens (`flex-wrap`), single row from `sm` up. Nav links and the "New recipe" button get comfortable touch height on coarse pointers.
- **MIRROR**: existing `NavLink` active styling.
- **VALIDATE**: browser check at 320, 375, 768, 1280 px: no horizontal overflow, theme toggle reachable. Unit test that the nav landmark and its links exist.

### Task 3: Touch targets and contrast
- **ACTION**: `button.tsx`, `input.tsx` and the three filter selects get a taller size under `pointer-coarse:` (44 px) while staying compact for a mouse. Change `--destructive` (light theme) so the red text on its tint reaches at least 4.5:1; re-check the dark theme and any other use of the token (badge, error text).
- **VALIDATE**: Lighthouse on `/recipes/:id` shows 100; measure heights on a touch-emulated page.

### Task 4: Consistent cards
- **ACTION**: make the card link `h-full` and the grid items stretch so a row ends level; put `data-slot="card-image"` on the placeholder tile and make the card's padding rule apply to it; reserve two title lines (`min-h`) so rows align; same for `MatchCard`.
- **VALIDATE**: unit test for the placeholder markup; browser check that row heights are equal with a long title.

### Task 5: Stable loading (layout shift)
- **ACTION**: make loading states take the space of the content they stand in for: skeleton grid of 6 cards with the same aspect ratio and title block as a real card on the list and match pages; detail page skeleton with the two-column layout; keep the footer out of the first screen while loading (a page `min-h` on `main`).
- **GOTCHA**: do not guess; re-run the trace after the change and read `CLSCulprits`. If a shift remains, fix what the trace names.
- **VALIDATE**: CLS of 0.1 or less on list, match and detail (throttled), recorded in the report.

### Task 6: Faster first photos
- **ACTION**: `RecipeCard` and `MatchCard` take a `priority` prop; the first row (the first 3 in the list) render `loading="eager"` and the first one `fetchPriority="high"`; the rest stay lazy. Add explicit `width` and `height` attributes matching the 4:3 box so the browser reserves space before the file arrives.
- **VALIDATE**: unit tests for the attributes; trace shows the first photo requested earlier, LCP breakdown recorded.

### Task 7: Page titles, skip link, focus on navigation
- **ACTION**:
  - `useDocumentTitle(title)` sets `title - RecipeMixer` and restores the default on unmount; use it on every page (the recipe page uses the recipe's title; the 404 page has its own).
  - Skip link as the first focusable element: "Skip to content", visually hidden until focused, targets `<main id="main" tabIndex={-1}>`.
  - `RouteFocus` moves focus to the main region when the path changes, never on the first load and never when only the query string changes (so typing in the search box or toggling a filter keeps its focus).
- **GOTCHA**: focus must not jump while the user types; the path-only comparison above and a test that proves it are the point.
- **VALIDATE**: unit tests (title per route, skip link target, focus moves on path change but not on search change, not on first render); manual keyboard walkthrough of the whole app.

### Task 8: Smaller, cached, compressed delivery
- **ACTION**:
  - Server: register `@fastify/compress` (MIT; text responses only, gzip and brotli, threshold 1 KB); serve `/assets/*` with `maxAge` one year and `immutable` (hashed names), keep `index.html` revalidated. Do not compress images (already WebP).
  - Web: lazy-load the form, import, detail and match pages with `React.lazy` and one `Suspense` fallback (a skeleton in `Layout`'s `Outlet`).
- **DECISION GATE**: measure the initial JS before and after; keep the lazy routes only if the first-load bundle shrinks meaningfully (at least 20%) and the tests stay simple; otherwise revert that part and say so in the report.
- **GOTCHA**: the strict CSP stays as is (no inline anything); the Docker image must keep working with a read-only root; run `npm audit` and the licence check for the new dependency.
- **VALIDATE**: `static-assets.test.ts` (headers for a hashed file, `index.html`, compression with `Accept-Encoding`, API JSON, image not recompressed); Docker run; `npm audit --omit=dev`.

### Task 9: Reduced motion and small visual refinements
- **ACTION**: a `prefers-reduced-motion` rule that disables transitions and skeleton pulse; card hover and focus states consistent; empty states get an icon. **Author's call (decide when reviewing the plan):** a warm accent colour for primary buttons, links and the active nav item instead of the current black and white. If chosen, define it as tokens in `index.css` for both themes and let Lighthouse confirm contrast; if not, skip it.
- **VALIDATE**: contrast audit in both themes; visual check at three widths.

### Task 10: Verify, document, report
- **ACTION**: rerun the full audit exactly as in the baseline table (Lighthouse on five pages, both themes, mobile; trace with the same throttling; overflow and touch-size scripts at four widths); README notes (demo data script, keyboard help); write the report with a before/after table.
- **VALIDATE**: all commands below.

---

## Testing Strategy

| Test | Input | Expected | Edge? |
|---|---|---|---|
| Title hook | each page renders | title is `Page - RecipeMixer`, restored on leave | yes |
| Skip link | first Tab on any page | skip link is focused and targets the main region | |
| Route focus | navigate between paths | focus lands on main; query-only change leaves focus on the search box; first render does not steal focus | yes |
| Cards | placeholder tile, long title, first card priority | flush tile, two reserved lines, eager and `fetchpriority="high"` on the first only | |
| Header | render | nav landmark with the links, theme button present | |
| Seed script | empty dir; dir with a database | seeds 30; refuses the second | yes |
| Static headers | hashed asset, `index.html`, JSON with and without `Accept-Encoding`, image | immutable and compressed as designed; image untouched | yes |
| Lazy routes | open each page in `App.test` | each still renders (async `findBy`) | |

### Edge Cases Checklist
- [ ] 320 px width, long titles, many filters on
- [ ] Both themes, light and dark system preference
- [ ] Keyboard only: skip link, header, filters, cards, dialog, forms
- [ ] Slow network and CPU throttling
- [ ] Zero, one and many recipes (empty state, short list, full page)
- [ ] Browser Back and Forward keep scroll and focus sensible

---

## Validation Commands
```bash
npm run lint && npm run typecheck
npm test
npm run build
npm audit --omit=dev
npm run audit:licenses
```
EXPECT: all clean.

### Browser and Docker
1. `npm run seed:demo -w server -- --dir ./demo-data`, then start the app on it (`DATA_DIR=./demo-data`).
2. Lighthouse (mobile) on `/`, `/match?i=chicken&i=rice`, `/recipes/:id`, `/recipes/new`, `/import`, in light and dark; expect 100 accessibility.
3. Performance trace on `/` and `/recipes/:id` with 4x CPU and Fast 4G; record CLS, LCP and the LCP breakdown.
4. Overflow and touch-size script at 320, 375, 768 and 1280 px.
5. `docker compose up --build` on a throwaway project; `curl -I` shows compression and caching; stop and delete the volume.

## Acceptance Criteria
- [ ] All targets above met or the shortfall reported with numbers
- [ ] No new lint or type errors; tests for every new component and hook
- [ ] CSP unchanged (no inline scripts or styles); no console errors in a fresh tab
- [ ] `npm audit` and the licence check pass with the new dependency
- [ ] Before and after numbers recorded in the report

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A layout-shift cause other than the skeleton | M | M | re-trace after each change, fix what the trace names |
| Focus management annoys users (steals focus) | M | M | compare path only, test the typing case explicitly |
| Lazy routes make tests flaky or save little | M | L | decision gate, revert if the gain is small |
| New dependency (compress) adds weight or a vulnerability | L | L | MIT licence, audit, text-only responses |
| Colour changes break contrast elsewhere | M | M | token-level change, Lighthouse in both themes |
| Subjective taste (accent colour) | M | L | explicit author's call in Task 9 |

## Notes
- Lighthouse's performance category was not available from the tool used here, so performance is judged from a throttled trace (LCP, CLS) rather than a score; the report says so.
- Accessibility was already 100 on four of five pages, so the PRD's "at least 90" is met today except for the recipe page's contrast failure; most of this phase is about phone layout, stability and the single-page-app basics that Lighthouse does not check.
- The 30-recipe demo data is synthetic (solid-colour photos); real photos are larger, which makes the image priority work matter more, not less.

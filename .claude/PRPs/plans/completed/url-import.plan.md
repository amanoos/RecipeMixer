# Plan: URL Import (RecipeMixer Phase 5)

## Summary
Paste a recipe link and RecipeMixer reads the page's standard `schema.org` Recipe data (JSON-LD), shows it in the normal recipe form for review, and saves it with its photo. Because the server fetches addresses supplied by the user, the fetch is SSRF-hardened: http(s) only, ports 80/443 only, every resolved address must be public, the connection is pinned to the checked address (no DNS rebinding), each redirect is re-checked, and size and time are capped. No new dependencies.

## User Story
As someone building a recipe library, I want to paste a recipe URL and get the recipe filled in, so that I do not retype ingredients and steps and my "what can I cook?" results get useful quickly.

## Problem → Solution
Every recipe must be typed by hand → paste a link, review the pre-filled form, save. The photo is downloaded and stored through the existing image pipeline.

## Metadata
- **Complexity**: Large (security-critical network code plus a new parser, two endpoints and a web flow; no migration)
- **Source PRD**: `.claude/PRPs/prds/recipe-mixer.prd.md`
- **PRD Phase**: 5 - URL import
- **Estimated Files**: ~22 (server ~12 incl. tests, web ~8 incl. tests, docs, plan and report)

---

## UX Design

### Before
```
Recipes page  →  "New recipe" → empty form → type everything
```

### After
```
Nav: Recipes | What can I cook? | Import
Import page:  [ https://... recipe link            ] [Import]
                    │ preview (server fetches, parses JSON-LD, nothing saved yet)
                    ▼
New-recipe form, pre-filled, banner "Imported from example.com. Review, then save."
   [x] Also download the photo          (shown only when the page had an image)
   [Save recipe]  → recipe saved → photo fetched by the server → detail page
```
If the link is already in the library, the import page says so with a link to that recipe and still lets the user continue.

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Nav | 2 links | + "Import" | `NavLink` like the others |
| New recipe form | blank | can arrive pre-filled via router state | edit and save work unchanged |
| Photo | upload from disk | or downloaded from the page's image | server-side fetch, same re-encode pipeline |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `server/src/services/images.ts` | all | `processImage` and `ImageStore`; imported photos must go through exactly this (byte sniffing, re-encode, hash name) |
| P0 | `server/src/routes/recipes.ts` | all | route style, `parseId`, `requireRecipe`, `removeImageIfUnused`, image replace logic to mirror |
| P0 | `server/src/schemas/recipe.ts` | all | `recipeInputSchema` limits that imported data must fit; `parseOrThrow` |
| P0 | `server/src/errors.ts` | all | `HttpError` helpers (add 422, 429 and 502 here) |
| P0 | `server/src/app.ts` | all | route registration; multipart limits (`fields: 0`, `parts: 1`) are for uploads only |
| P1 | `server/src/plugins/security.ts` | all | global rate limit; per-route limits override via route `config` |
| P1 | `server/src/config.ts` | all | env schema and `Config` (add the import switch) |
| P1 | `server/test/helpers.ts` | all | `makeApp`, `testConfig`, `tinyPng` |
| P1 | `server/test/security.test.ts` | all | test style (`app.inject`, `afterEach` close) |
| P1 | `web/src/pages/RecipeFormPage.tsx` | all | form to pre-fill; save-then-image flow with "saved but image failed" message |
| P1 | `web/src/lib/api.ts` | all | `request`, `jsonRequest`, `ApiError` |
| P2 | `web/src/pages/MatchPage.tsx` | all | page layout, loading/error states |
| P2 | `web/src/test-utils.ts` | all | `stubFetch`, `findCall` |
| P2 | `SECURITY.md` ("Planned protections") | all | text to turn into real documentation |

## External Documentation
| Topic | Source | Key Takeaway |
|---|---|---|
| SSRF | OWASP SSRF Prevention Cheat Sheet (read the full page during implementation; only excerpts were read for the PRD) | resolve then check the IP, pin the connection, re-validate every redirect, block non-http schemes, never return the fetched body to the caller unparsed |
| JSON-LD recipes | schema.org/Recipe, Google "Recipe structured data" | `@graph` wrappers, `@type` may be an array, `recipeInstructions` may be text, `HowToStep[]`, `HowToSection[]` or string[]; `image` may be a string, `ImageObject` or an array; `recipeCuisine` may be a string or array |
| Node networking | Node docs: `https.request` `lookup` option, `net.BlockList`, `zlib` `maxOutputLength` | `lookup` can force the connected address; BlockList checks CIDR ranges for v4 and v6; async zlib calls accept `maxOutputLength` against decompression bombs |

---

## Patterns to Mirror

### ERROR_HANDLING
```ts
// SOURCE: server/src/errors.ts
export class HttpError extends Error { readonly statusCode: number; ... }
export const badRequest = (message: string): HttpError => new HttpError(400, message);
```
Messages are safe to show and never echo submitted values. Add `unprocessable` (422), `tooManyRequests` (429) and `badGateway` (502) next to these.

### ROUTE_STYLE
```ts
// SOURCE: server/src/routes/recipes.ts
export const recipeRoutes: FastifyPluginAsync<{ db: Db; images: ImageStore }> = async (app, { db, images }) => {
  app.put<{ Params: { id: string } }>('/api/recipes/:id/image', async (req) => {
    const id = parseId(req.params.id);
    requireRecipe(db, id);
    ...
    const { data, filename } = await processImage(upload);
    await images.save(filename, data);
    const { previous } = setRecipeImage(db, id, filename);
    if (previous && previous !== filename) await removeImageIfUnused(db, images, previous);
    return requireRecipe(db, id);
  });
```

### VALIDATION
```ts
// SOURCE: server/src/schemas/recipe.ts
export const ratingInputSchema = z.object({ rating: ... }).strict();
parseOrThrow(schema, req.body)   // message names the field, never the value
```

### TEST_STRUCTURE
```ts
// SOURCE: server/test/security.test.ts
let app: FastifyInstance;
afterEach(async () => { await app?.close(); });
app = await makeApp();
const res = await app.inject({ method: 'GET', url: '/api/health' });
```
Web tests use `stubFetch({ 'POST /api/import/preview': () => apiResponse(...) })` and `findCall`.

---

## Design

### Approach
Two small endpoints plus one web page; reuse the existing create-recipe and image code.

1. `POST /api/import/preview` `{ url }` → fetches the page, parses it, returns a draft. **Saves nothing and downloads no image.**
2. The web app opens the normal new-recipe form pre-filled with the draft. The user reviews and saves with the existing `POST /api/recipes`.
3. If the user kept "Also download the photo", the web app then calls `POST /api/recipes/:id/image/from-url` `{ url }` with the image address from the draft. The server fetches it with the same guard, runs `processImage`, and stores it exactly like an upload.

### Alternatives considered
- **One-shot import endpoint that saves immediately**: rejected; the PRD asks for a preview, and bad parses would pollute the library.
- **Download the image during preview**: rejected; abandoned previews would leave orphan files on disk.
- **Use `undici`/global `fetch` with a custom dispatcher**: rejected; `undici` is not importable without a new dependency. `node:https` with a pinned `lookup` needs none.
- **An HTML parser dependency (cheerio, htmlparser2)**: rejected for v1; JSON-LD lives in `<script>` elements and a bounded scan over at most 2 MB is enough. Revisit if the sample shows pages it misses.
- **Port allow-list vs. any port**: only 80 and 443; this stops the feature probing internal services on odd ports.

### NOT Building
- Scraping pages without JSON-LD (microdata, `og:` tags, free-text heuristics); those pages get a clear "no recipe data found" message and manual entry.
- Importing the source's star rating (the rating stays the user's own; the draft leaves it empty).
- Bulk or background import, import queues, or scheduled re-sync.
- Fetching the page's other resources (CSS, scripts, other images).
- Authentication (Phase 8), UI polish beyond this flow (Phase 6), optional data sources (Phase 7).

---

## SSRF controls (the security contract)

Implemented once in `server/src/services/safe-fetch.ts` and used by both endpoints. Nothing else in the server may fetch a user-supplied URL.

| # | Control | Detail |
|---|---|---|
| 1 | Scheme | `http:` and `https:` only; anything else (file, ftp, gopher, data, javascript) is rejected before any network call |
| 2 | URL shape | max 2048 characters; no `user:password@`; port must be empty/80 (http) or empty/443 (https) |
| 3 | Address check | literal IPs (the WHATWG parser already normalises decimal, hex and octal forms) and every address from `dns.lookup(host, { all: true })` must be public; one non-public address rejects the whole host |
| 4 | Blocked ranges (IPv4) | 0.0.0.0/8, 10/8, 100.64/10, 127/8, 169.254/16 (cloud metadata), 172.16/12, 192.0.0.0/24, 192.0.2.0/24, 192.88.99.0/24, 192.168/16, 198.18/15, 198.51.100.0/24, 203.0.113.0/24, 224/4, 240/4 |
| 5 | Blocked ranges (IPv6) | allow only global unicast `2000::/3` and subtract `2001::/32`, `2001:db8::/32`, `2002::/16`, `3fff::/20`; IPv4-mapped (`::ffff:a.b.c.d`) addresses are unwrapped and checked as IPv4; everything else (loopback, link-local, unique-local, NAT64, multicast) is rejected |
| 6 | DNS rebinding | after the check, the request is made with `https.request`/`http.request` and a `lookup` function that returns only the already-validated address (TLS SNI and the `Host` header still use the hostname) |
| 7 | Redirects | never followed automatically; max 5 hops; each `Location` is resolved against the current URL and goes through controls 1 to 6 again; https → http downgrade is refused |
| 8 | Size | pages 2 MB, images 5 MB (the existing `MAX_IMAGE_BYTES`); the stream is destroyed the moment the count is exceeded; `Content-Length` over the limit fails fast |
| 9 | Compression | accept gzip, deflate and br; compressed bytes are capped first, then decompressed with `maxOutputLength` equal to the limit |
| 10 | Time | one overall 10 s deadline per fetch (all hops together), plus a socket idle timeout |
| 11 | Content type | pages: `text/html` or `application/xhtml+xml`; images: not trusted at all, `processImage` decides from bytes |
| 12 | No ambient data | no cookies, no `Authorization`, no forwarded client headers; a fixed honest `User-Agent` (`RecipeMixer/<version> (+repo URL)`) |
| 13 | Error hygiene | blocked, unresolvable, refused and timed-out targets all give the same message, "Could not fetch that page", so the endpoint cannot be used to map the local network; the reason is logged server-side at `warn` and the response never repeats the URL or any fetched bytes |
| 14 | Abuse limits | route rate limit 10/minute per client, at most 2 imports running at once (extra requests get 429), and a `URL_IMPORT_ENABLED=false` switch that turns both endpoints into 404 |
| 15 | Output hygiene | parsed text is plain text only (HTML tags and entities removed), clipped to the recipe schema limits, and goes through `recipeInputSchema` in the browser flow like any manual entry; the page's own image address is only ever fetched through the same guard |

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `server/src/errors.ts` | UPDATE | `unprocessable` (422), `badGateway` (502), `tooManyRequests` (429) |
| `server/src/config.ts` | UPDATE | `urlImportEnabled` from `URL_IMPORT_ENABLED` (default true) |
| `server/src/services/ip-guard.ts` | CREATE | `isPublicAddress(ip)` using `net.BlockList` and the v6 allow-list |
| `server/src/services/safe-fetch.ts` | CREATE | the guarded fetcher (controls 1 to 13), dependency-injectable for tests |
| `server/src/services/recipe-jsonld.ts` | CREATE | HTML → JSON-LD blocks → `RecipeDraft` |
| `server/src/schemas/import.ts` | CREATE | `importUrlSchema`, `RecipeDraft`, preview result type |
| `server/src/routes/import.ts` | CREATE | the two endpoints, rate limit, concurrency cap, duplicate-source lookup |
| `server/src/db/recipes.ts` | UPDATE | `findRecipeIdBySourceUrl(db, url)` |
| `server/src/app.ts` | UPDATE | register the route plugin, pass the fetcher |
| `server/scripts/eval-import.ts`, `example-urls.txt` | CREATE | run the pipeline over a list of URLs and print a pass/fail table (PRD's 70% target) |
| `server/package.json` | UPDATE | `eval:import` script |
| `server/test/ip-guard.test.ts` | CREATE | address classification table |
| `server/test/safe-fetch.test.ts` | CREATE | every SSRF control, with fake resolver and transport plus a few real loopback sockets that must be refused |
| `server/test/recipe-jsonld.test.ts` | CREATE | parser variants (fixtures inline) |
| `server/test/import-routes.test.ts` | CREATE | endpoints end to end with an injected fetcher |
| `web/src/lib/types.ts`, `web/src/lib/api.ts` | UPDATE | `previewImport`, `importImageFromUrl`, draft types |
| `web/src/pages/ImportPage.tsx` (+ test) | CREATE | URL box, loading/error/duplicate states |
| `web/src/pages/RecipeFormPage.tsx` (+ test) | UPDATE | pre-fill from router state, banner, photo checkbox, post-save image import |
| `web/src/App.tsx`, `web/src/components/Layout.tsx` | UPDATE | `/import` route and nav link |
| `README.md`, `SECURITY.md`, `.env.example` | UPDATE | feature, API table, roadmap, real SSRF documentation, new env var |

---

## Step-by-Step Tasks

### Task 1: Errors and config
- **ACTION**: add `unprocessable`, `badGateway`, `tooManyRequests` helpers; add `urlImportEnabled` to `Config`, `envSchema` (`URL_IMPORT_ENABLED`, `'true'|'false'`, default `true`, same transform as `ALLOW_INSECURE_NO_AUTH`), `testConfig`, `.env.example`.
- **MIRROR**: `server/src/errors.ts`, `server/src/config.ts`.
- **VALIDATE**: `npm run typecheck`, `config.test.ts` extended for default and `false`.

### Task 2: Address guard
- **ACTION**: `ip-guard.ts` exporting `isPublicAddress(ip: string): boolean`. Build two `net.BlockList` instances at module load from the ranges in controls 4 and 5. Unwrap IPv4-mapped IPv6 (both `::ffff:1.2.3.4` and the hex form `::ffff:7f00:1`) before checking. Unknown or unparseable input returns `false` (fail closed).
- **GOTCHA**: do not rely on `BlockList.check` alone for mapped addresses; unwrap explicitly and test it.
- **VALIDATE**: table test covering each blocked range at both edges, public examples (`8.8.8.8`, `1.1.1.1`, `2606:4700:4700::1111`), mapped loopback, `::`, `::1`, `fe80::1`, `fc00::1`, `100.64.0.1`, `169.254.169.254`, `0.0.0.0`, `255.255.255.255`, garbage strings.

### Task 3: Guarded fetcher
- **ACTION**: `safe-fetch.ts`:
  - `parseTargetUrl(raw)` → `URL` or throws `badRequest` for scheme, length, credentials, port (specific messages are fine here because they describe the user's own input, not the network).
  - `createSafeFetcher(deps?)` returns `fetchPage(url)` and `fetchImage(url)`; both call a shared `guardedGet(url, { maxBytes, accept, type })`.
  - `deps.lookup` defaults to `dns.promises.lookup(host, { all: true, verbatim: true })`; `deps.request` defaults to a thin wrapper over `http.request`/`https.request` taking the pinned `{ address, family }`. Tests inject both.
  - Loop up to 5 hops; per hop: parse, resolve, `isPublicAddress` on **all** addresses, connect to the first with the pinned lookup, handle 301/302/303/307/308 by resolving `Location`, otherwise require 2xx.
  - Streaming byte counter with destroy on overflow; gzip/deflate/br via async zlib with `maxOutputLength`; overall `AbortController` deadline of 10 s that destroys the socket.
  - All network-level failures and blocked targets throw `badGateway('Could not fetch that page')` after reporting the internal reason (pass an optional `onReject(reason)` callback so the service stays free of Fastify).
- **GOTCHA**: when connecting by IP for https, pass `servername: hostname` and `headers.Host`; for an IP-literal URL do not set `servername`. Keep-alive off (`agent: false`) so a pinned socket is never reused for another host.
- **GOTCHA**: `Content-Length` can lie; the streaming counter is the real limit.
- **VALIDATE**: `safe-fetch.test.ts` cases listed under Testing Strategy.

### Task 4: JSON-LD parser
- **ACTION**: `recipe-jsonld.ts` exporting `extractRecipe(html: string, pageUrl: URL): RecipeDraft | null`.
  - Find `<script ... type="application/ld+json" ...>` blocks with a case-insensitive, attribute-order-independent scan (max 50 blocks, total input already capped at 2 MB); skip blocks that fail `JSON.parse`.
  - Walk each parsed value: arrays, `@graph`, and `mainEntity`/`mainEntityOfPage` objects (depth limit 6, node limit 5000); pick the first object whose `@type` (string or array, with or without a schema.org prefix) is `Recipe`.
  - Map: `name`→title (required, otherwise null result); `description`; `recipeCuisine` (string or array → first non-empty); `recipeIngredient` (string[]; also accept `ingredients` legacy); `recipeInstructions` (string split on newlines, `HowToStep.text`/`name`, `HowToSection.itemListElement` flattened, string[]); `image` (string, `ImageObject.url`, array → first usable) resolved against `pageUrl` and kept only if `http(s)`; `url` is ignored (the canonical source is the address the user entered, after redirects).
  - Text cleaning: strip tags, decode common entities (`&amp; &lt; &gt; &quot; &#39; &nbsp;` and numeric), collapse whitespace; clip to schema limits (title 200, cuisine 80, description 5000, ingredient 200, step 2000, 100 items each); drop empties.
  - Return a draft with `rating: null`.
- **GOTCHA**: entities and HTML appear inside JSON strings for many sites; clean after parsing, never before. Large arrays or deep nesting must not hang (limits above).
- **VALIDATE**: `recipe-jsonld.test.ts` (see Testing Strategy).

### Task 5: Schemas and repository helper
- **ACTION**: `schemas/import.ts`: `importUrlSchema = z.object({ url: z.string().trim().min(1).max(2048) }).strict()`; `RecipeDraft` and `ImportPreview` (`{ draft, imageUrl: string | null, sourceUrl: string, existingRecipeId: number | null }`). Add `findRecipeIdBySourceUrl` to `db/recipes.ts` (parameterised, exact match, lowest id).
- **MIRROR**: `schemas/recipe.ts`, `db/recipes.ts`.
- **VALIDATE**: unit test for the helper in `recipes-repo.test.ts`.

### Task 6: Routes
- **ACTION**: `routes/import.ts` as a plugin taking `{ db, images, fetcher, enabled }`. When disabled, register nothing (the existing not-found handler answers 404).
  - `POST /api/import/preview`: validate body, `fetcher.fetchPage`, check content type, `extractRecipe`; null → `unprocessable('No recipe data found on that page')`. The returned `sourceUrl` is the final URL after redirects (normalised, no fragment).
  - `POST /api/recipes/:id/image/from-url`: `parseId`, `requireRecipe`, validate body, `fetcher.fetchImage`, `processImage` (which rejects non-images/SVG/oversize), save and set exactly as the upload route does, remove the previous image if now unused. Share the "replace image" code with the upload route by extracting a small helper rather than duplicating it.
  - Route-level `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` on both; a module-level counter allows at most 2 concurrent fetches, otherwise `tooManyRequests('Another import is already running')`; release in `finally`.
- **MIRROR**: `routes/recipes.ts`.
- **VALIDATE**: `import-routes.test.ts`.

### Task 7: Wire up
- **ACTION**: register in `app.ts` with `createSafeFetcher({ onReject: (reason) => app.log.warn({ reason }, 'import target rejected') })`. Allow `buildApp` to accept an optional `fetcher` override in `AppDeps` so route tests inject a fake without a network.
- **VALIDATE**: full server test run; `health`/`security` tests still pass.

### Task 8: Web API client and types
- **ACTION**: `previewImport(url, signal?)`, `importImageFromUrl(id, url)`; types `RecipeDraft`, `ImportPreview`.
- **MIRROR**: `lib/api.ts` (`jsonRequest`).
- **VALIDATE**: `api.test.ts` additions (body shape, error mapping).

### Task 9: Import page
- **ACTION**: `ImportPage.tsx`: labelled URL input (`type="url"`, `inputMode="url"`), Import button, `aria-busy` while loading, error in a `role="alert"`, duplicate notice with link to `/recipes/:id`, then `navigate('/recipes/new', { state: { importPreview } })`. Route `import` and nav link "Import".
- **MIRROR**: `pages/MatchPage.tsx`, `components/Layout.tsx`.
- **VALIDATE**: `ImportPage.test.tsx`: success navigates with state, server error shown, duplicate notice, empty input blocked, button disabled while loading.

### Task 10: Pre-filled form
- **ACTION**: `RecipeFormPage` reads `useLocation().state`, accepts it only if it passes a small shape guard (strings and string arrays), initialises the fields from the draft, shows a banner naming the source host, and (when `imageUrl` exists) a checked "Also download the photo from the page" checkbox. After the existing save, if checked and no file was chosen manually, call `importImageFromUrl`; on failure reuse the existing "The recipe was saved, but the image could not be saved: ..." message. Choosing a file manually unchecks and ignores the checkbox.
- **GOTCHA**: do not let router state (which survives reload) cause a second recipe: the existing `savedId` logic already turns later submits into updates.
- **VALIDATE**: extend `RecipeFormPage.test.tsx`: pre-fill, banner, save posts draft values, image import called once, failure message, no state means a blank form as before.

### Task 11: Eval script
- **ACTION**: `scripts/eval-import.ts` reads a text file of URLs (one per line, `#` comments), runs the real fetcher and parser, prints title, ingredient and step counts, image yes/no and the failure reason, then the success rate against the 70% target. Never writes to the database. Sleeps 1 s between requests. `example-urls.txt` contains comments explaining the format only; the user supplies their 20 sites.
- **VALIDATE**: run on a small list during validation.

### Task 12: Docs
- **ACTION**: README (feature, API rows, "How URL import works", roadmap 5 done), SECURITY.md (move URL import from "Planned" to real protections, listing the table above in prose; keep Authentication and Imported content notes accurate), `.env.example` (`URL_IMPORT_ENABLED`), `docker-compose.yml` note if the container needs outbound access (it does by default).
- **VALIDATE**: links and command names are accurate.

---

## Testing Strategy

### Unit tests
| Test | Input | Expected | Edge? |
|---|---|---|---|
| ip-guard table | each range edge, public IPs, mapped v6, garbage | public → true, everything else false | yes |
| URL parsing | `file:///etc/passwd`, `ftp://x`, `javascript:...`, `http://user:pw@host/`, `http://host:8080/`, `http://host:22/`, 3000-char URL | rejected with 400 | yes |
| IP literal forms | `http://2130706433/`, `http://0x7f.1/`, `http://127.1/`, `http://[::1]/`, `http://[::ffff:127.0.0.1]/`, `http://169.254.169.254/` | rejected (same generic fetch error) | yes |
| DNS result checks | host resolving to `[8.8.8.8, 10.0.0.5]` | rejected (one bad address rejects) | yes |
| DNS rebinding | fake lookup answers public first, private on a second call | request connects to the first (pinned) address and never re-resolves | yes |
| Redirects | 302 to `http://127.0.0.1/`, to a host resolving private, to `file:`, https → http, loop of 6 hops | each rejected; 5 safe hops succeed | yes |
| Size/time | body streaming past 2 MB, `Content-Length` lie, never-ending body, stalled socket | aborted, generic error, socket destroyed | yes |
| Compression | gzip bomb expanding past the cap | rejected | yes |
| Real sockets | start a local `http.createServer` on 127.0.0.1 and import its URL | refused by the guard and **the server never receives a request** | yes |
| JSON-LD variants | plain Recipe, `@graph`, `@type` array, string vs HowToStep vs HowToSection instructions, image string/object/array, relative image, entities and tags in text, malformed JSON block before a good one, two Recipe objects, no Recipe, huge array, deep nesting | expected draft or null | yes |
| Routes | preview success, no recipe (422), blocked target (502 generic), invalid body (400), disabled switch (404), duplicate source, rate limit, concurrency cap; image import success, non-image bytes (415), SVG, oversize, unknown recipe (404), replaces and cleans the previous image | as stated | yes |
| Web | import page and form tests listed in Tasks 9 and 10 | | |

### Edge Cases Checklist
- [ ] Empty and whitespace URL
- [ ] Very long URL
- [ ] Non-string `url` and extra body fields (strict schema)
- [ ] Page that is not HTML (PDF, JSON, image)
- [ ] Recipe with no ingredients or steps (still previewable, title required)
- [ ] Fields over the schema limits are clipped, not rejected
- [ ] Concurrent imports above the cap
- [ ] Network failure and timeout

---

## Validation Commands

```bash
npm run lint && npm run typecheck
npm test
npm run build
npm audit --omit=dev
npm run audit:licenses
```
EXPECT: all clean; no new dependencies, so audit and licence results are unchanged.

### Integration (Docker and live)
1. `docker compose up -d --build` with a throwaway volume; `POST /api/import/preview` with each of: `http://127.0.0.1:3210/api/health`, `http://169.254.169.254/`, `http://localhost/`, `file:///etc/passwd`, `http://[::1]:3210/`. EXPECT: all refused, container logs show the rejections, no outbound request.
2. Import 5 to 10 real public recipe pages with `npm run eval:import -w server -- <list>`; record the rate honestly. The PRD's 20-site sample is the user's to supply.
3. Real browser: Import page → pre-filled form → save → photo present on the detail page; CSP console clean; Back button behaviour; the recipe then appears in search and in "What can I cook?".

### Manual Validation
- [ ] A page with no recipe data gives a clear message and the user can still add the recipe manually
- [ ] A duplicate link shows the notice
- [ ] `URL_IMPORT_ENABLED=false` hides nothing broken (the page shows a clear "disabled" error) and the endpoints answer 404

---

## Acceptance Criteria
- [ ] All tasks completed and tests written first for the guard and parser
- [ ] Every row of the SSRF table has at least one test that fails if the control is removed
- [ ] The local-socket test proves a loopback target receives no request
- [ ] >= 70% of the user's sample imports with title, ingredients and image (or the shortfall is reported with reasons)
- [ ] No type or lint errors; no new dependencies; docs updated

## Completion Checklist
- [ ] Code follows discovered patterns; error messages never echo URLs or fetched bytes
- [ ] No other code path fetches a user-supplied URL
- [ ] SECURITY.md describes what is actually implemented and its limits

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SSRF bypass (IP encodings, mapped IPv6, rebinding, redirects) | M | High | allow-list for IPv6, WHATWG normalisation, pinned `lookup`, per-hop re-checks, dedicated tests per control, review by the security-reviewer agent before commit |
| Sites block non-browser clients or serve bot checks | H | M | honest User-Agent, clear error, manual entry fallback; report the success rate truthfully |
| Sites without JSON-LD | M | M | out of scope for v1; message tells the user |
| Decompression or memory abuse | L | M | size caps before and after decompression, concurrency cap, timeouts |
| Copyright of imported content | M | L | stored locally for personal use, kept out of the repo (already in README) |
| Router state lost on reload | L | L | form simply opens blank; user pastes the link again |

## Notes
- Docker keeps its read-only root filesystem and non-root user; the feature needs only outbound network, which compose allows by default. Documented for people who restrict egress.
- `existingRecipeId` uses exact source-URL equality; it is a convenience warning, not a uniqueness rule.
- If real-world coverage is low, the next step is a microdata fallback, not heuristics.

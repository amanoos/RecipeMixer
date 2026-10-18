# Implementation Report: Find a photo (photo search for recipes)

## Summary
A recipe can now get a photo from the internet by title. **Find a photo** (on the recipe page, and on the recipe form) searches Wikimedia Commons and Openverse (Flickr photos) for openly licensed pictures, shows **at most five** with their author and licence, and saves the one you pick. The photo is stored locally like an upload, and its credit ("Photo: ... by ..., CC BY 2.0, via ...") is shown under it with a link to the photo's page. Everything was tested against the real services.

Nothing is committed. The work is on branch `feat/photo-search`, from `main` after the title cleanup was merged.

## What it does, and why these sources
- **Google and Bing image search are not usable legitimately:** scraping breaks their terms, Bing's image API is retired, and Google's official one needs a key and costs money past a small allowance. Both chosen services need no key: Wikimedia Commons (MediaWiki API) and Openverse (anonymous: 20 a minute, 200 a day, read from its response headers).
- **Licences:** only ones that allow resizing and re-encoding (CC0, public domain, CC BY, CC BY-SA). No-derivatives is never offered. Non-commercial is off by default (`IMAGE_SEARCH_ALLOW_NONCOMMERCIAL`).
- **Browser safety:** the browser never loads a third-party image (the Content-Security-Policy is unchanged). The server downloads each candidate, shrinks it to a small WebP and sends it inline; a pick is made with a signed token, so the pick route cannot be made to fetch an address the search did not return.

## Live results (real services, 2026-10-18)
| Title | Photos | Time |
|---|---|---|
| Braised Pork Belly (Hong Shao Rou/红烧肉), an Easy Version | 4 | 2.4 s |
| Tomato Soup | 5 | 1.7 s |
| Shakshuka | 5 | 3.0 s |
| Chicken Tikka Masala | 5 | not timed |

Choosing one saved the photo (51 KB WebP) with its credit; a changed token, or an address instead of a token, was refused with 400.

## Tasks Completed
| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Migration, credit fields, caption | Done | migration 006; credit cleared whenever the photo changes |
| 2 | Query cleaning and the two providers | Done | `services/image-search.ts` |
| 3 | Signed tokens and the two routes | Done | `GET /api/image-search`, `POST /api/recipes/:id/image/from-search` |
| 4 | Dialog on the recipe page and the form | Done | the form holds the pick until the recipe is saved |
| 5 | Docs, checks, live test | Done | `docs/DATA-SOURCES.md`, `SECURITY.md`, README, `.env.example`, deployment guide |
| 6 | Independent security review and fixes | Done | below |

## Validation Results
| Level | Status | Notes |
|---|---|---|
| Static analysis | Pass | `eslint .` clean, `tsc` clean |
| Tests | Pass | 1,507 tests: 1,212 server (was 1,061), 295 web (was 265) |
| Build, audit, licences | Pass | 0 vulnerabilities, licence check passes, no new dependency |
| Live, real services | Pass | see above |
| Mutation checks | Pass | 16 controls broken on purpose. 13 were caught at once; two more (a strict pick body, an expired choice) needed a new test and are now caught; one is redundant (a second no-derivatives check that sits behind the licence pattern). The slow tag-stripping pattern made the test run hang instead of fail, which also counts as caught |

## Independent security review
One read-only reviewer, with real requests and live calls. **No high issue.**

| Severity | Finding | Outcome |
|---|---|---|
| Medium | Privacy wording was wrong: the server also downloads five previews per search from Flickr's and Wikimedia's picture servers, not only from the two services | Dialog, SECURITY.md, DATA-SOURCES and README now say so; Openverse is limited to Flickr photos on `staticflickr.com`, standard port |
| Low | A quadratic tag-stripping pattern let hostile provider text stall the server (80,000 "<" took 10 s; 1 MB would take minutes) | Text is cut first and the pattern bounded; 1 MB now takes milliseconds |
| Low | Licence version unbounded (100,000 characters came through) | Only a plain number like 2.0 is shown |
| Low | The longest genuine token (about 6,000 characters) exceeded the 4,096 limit | Limit is 8,192, with a test |
| Low | `AND`, `OR`, `NOT` and a leading hyphen survived in the search phrase | Removed |
| Low | A cross-site GET could trigger a search and burn the Openverse quota | Every API request is now same-origin checked, not only writes |
| Low | Country-specific "PD-" tags accepted as public domain | Only plain "Public domain", CC0 and the CC BY family |
| Low | Invisible direction and zero-width characters in credits | Stripped |
| Low | Photo-page link had no client-side https check; loose numbers in the docs | Check added; docs corrected (about 100 to 200 KB, worst case about half a minute) |
| Info | The recipe title appears in the request log; the form kept an expired choice | Documented; an expired choice is now cleared after one failure |

Held up: fixed provider hosts and paths; no way to reach a non-public address (decimal, hex, IPv6, mapped and metadata addresses all refused); hostile provider records (userinfo, look-alike hosts, SVG, ND licences, prototype pollution); forged, truncated, expired and other-process tokens; credits shown as plain text with https-only links; unchanged CSP.

## Files Changed (42)
Server new: `services/image-search.ts`, `services/candidate-token.ts`, `routes/image-search.ts`, migration `006_image_credit.sql`. Server updated: `config.ts`, `app.ts`, `plugins/auth.ts`, `db/recipes.ts`, `schemas/recipe.ts`, `services/images.ts`, `services/recipe-images.ts`, `routes/session.ts`. Web new: `PhotoSearchDialog.tsx`; updated: `RecipeDetailPage`, `RecipeFormPage`, `lib/api.ts`, `lib/types.ts`, `lib/auth.ts`, `AuthGate`. Tests: new `image-search`, `image-search-routes`, `candidate-token`, `PhotoSearchDialog`; extended route, repo, migration, health, auth, detail, form, api and AuthGate tests. Docs: SECURITY.md, DATA-SOURCES.md, README, `.env.example`, DEPLOYMENT.md.

## Deviations from Plan
1. **Openverse is limited to Flickr photos** (planned: any source except Wikimedia), after the review showed other sources would mean downloads from arbitrary hosts.
2. **Every API request is now same-origin checked**, not only writes (a change to `plugins/auth.ts`, found by the review).
3. **Response size:** the plan said about 100 KB per search; real searches are 100 to 200 KB.

## Not Verified
- The dialog in a real browser by hand (component tests and the live API only).
- Behaviour when Openverse's anonymous limit (200 a day) is actually used up; a 429 answer is handled and tested.
- **CI on this branch.**

## Next Steps
- [ ] Commit on `feat/photo-search`, open a PR, merge after CI
- [ ] Try it on your own recipes: open one and press **Find a photo**

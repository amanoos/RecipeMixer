# RecipeMixer

## Problem Statement

A home cook (the author) often has ingredients in the fridge that are close to spoiling and no idea what to make from them. Recipe sites and apps are organised around finding a recipe first and then shopping for it, not around "what can I cook with what I already have." The cost is wasted food and uninspired meals.

## Evidence

- Author's own stated pain: wants to "maximize the use of existing ingredients in the fridge and avoid waste."
- Author has not found an existing tool that does this. Mealie, Tandoor and Grocy exist (self-hosted recipe managers and a pantry tracker), but desk research did not confirm that any of them ranks recipes by partial ingredient overlap. **Assumption - needs validation** by checking Mealie/Tandoor docs and issue trackers before building.
- No external user research. This is a hobby project with a single user, so evidence is first-person.

## Proposed Solution

A fast, modern, fully open source web app that stores recipes in a local SQLite database (with images on disk), searches them by name, cuisine and rating, and, as its core feature, takes a list of ingredients you have and returns recipes ranked by how many of their ingredients you already have, listing what is missing. Recipes arrive through manual entry and URL import (schema.org JSON-LD). The app runs as a Docker container, always on, on the author's local Docker setup or in the cloud. A focused tool beats extending Mealie/Tandoor because ingredient-overlap ranking is the whole product, not a side feature.

## Key Hypothesis

We believe ranked partial-ingredient matching will help the author turn leftover ingredients into a meal and cut food waste.
We'll know we're right when, for most of the fridge ingredient sets the author tries, the top 5 results include a recipe the author would actually cook.

## What We're NOT Building

- User accounts / multi-user support - single-user hobby tool; at most one shared secret (see Decisions).
- Meal planning - not needed to validate the hypothesis.
- Shopping lists - missing ingredients are only displayed, not managed.
- Nutrition tracking - out of scope for v1.
- Native mobile app - the web UI is responsive; no app-store distribution.
- AI-generated recipes - search is over stored recipes only; keeps the app deterministic and free.
- Pantry/inventory tracking - ingredients are typed per search, not persisted (Grocy covers that).
- Paid or proprietary services - nothing with a cost or closed licence in the core.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Useful top-5 hit rate (proposed) | >= 8 of 10 real fridge ingredient sets return a recipe the author would cook in the top 5 | Author trial with a fixed set of 10 ingredient lists on a library of >= 200 recipes |
| Ingredient search latency (proposed) | p95 < 200 ms on 15,000 recipes | Automated benchmark in test suite |
| URL import success (proposed) | >= 70% of a 20-site sample import with title, ingredients and image | Manual run against a sample list |
| Public-repo hygiene | 0 secrets, 0 personal data, 0 copyrighted images in repo history | gitleaks in CI + pre-release manual check |
| Cost | $0 | Licence/dependency review; hosting on free tier or local Docker |

All numeric targets are proposals and need author confirmation.

## Open Questions

- [ ] Do Mealie or Tandoor already support ranked partial-ingredient search? If so, is a standalone app still worth building (author has said yes for a hobby project)?
- [ ] "Cloud" and "$0 spend" may conflict. Docker is not required for cloud hosting (author decision), so any host that can run a Node process with a persistent disk for SQLite and images qualifies. Which free options (if any) fit? TBD - needs research. SQLite needs a persistent disk, so stateless/serverless hosts are poor fits.
- [ ] Seed data: is bundling an open dataset (tastyR CC0, Wikibooks Cookbook CC-BY-SA) licence-safe? CC0 label on a scrape of a commercial site is doubtful. Needs a licence check, or ship with no seed data.
- [ ] TheMealDB as an optional plugin: terms restrict app-store release and some features are paid. Acceptable for an off-by-default plugin in a public repo?
- [x] Rating data: resolved - the author's own 1-5 star rating is sufficient; imported JSON-LD ratings are a bonus when present.
- [x] Auth for cloud: resolved - a single shared password/token via environment variable is acceptable.
- [x] Images: resolved - stored as files on disk, with the path/hash in the database.
- [x] Repo licence: resolved - MIT.

---

## Users & Context

**Primary User**
- **Who**: The author, a home cook, using the app on a phone or laptop in the kitchen.
- **Current behavior**: Looks in the fridge, then browses recipe sites or bookmarks, usually starting from a recipe rather than from ingredients.
- **Trigger**: Feeling hungry, or noticing ingredients about to spoil.
- **Success state**: Finds a recipe that uses most of what is on hand, cooks it and eats a good meal.

**Job to Be Done**
When I am hungry or have ingredients about to spoil, I want to find a recipe using the ingredients I have on hand, so I can cook and eat a delicious meal.

**Non-Users**
No specific excluded group. In practice: teams or families needing accounts, people wanting meal planning or shopping lists, and anyone who wants a hosted service run by someone else.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Ingredient-based search with ranking by overlap, showing matched and missing ingredients | The key feature and the hypothesis |
| Must | Local SQLite storage of recipes with name and cuisine search (FTS5) | Core storage and retrieval |
| Must | URL import from schema.org JSON-LD, with image download | Fills the library without manual typing; SSRF-hardened |
| Must | Manual recipe add/edit/delete with image upload | Fallback when import fails |
| Must | Security baseline for a public repo (see Technical Approach) | Hard requirement from the author |
| Must | Docker image + compose file for local use, plus a documented non-Docker run (`npm run build && npm start`) for cloud hosts; always-on, persistent data directory | Stated deployment target |
| Should | Sort/filter by rating (own stars plus imported when present) | Requested; data is scarce |
| Should | Ingredient normalisation, stemming and synonym list | Match quality depends on it |
| Should | Engaging UI: fast search-as-you-type, ingredient chips, recipe cards with images, dark mode | "Modern, fast, engaging" requirement |
| Could | Optional seed dataset (licence-checked) | Makes a first run useful |
| Could | Optional TheMealDB importer, off by default, with a non-open-service notice | Extra source of recipes and images |
| Could | Optional shared-password auth for cloud use | Needed if exposed publicly; see Decisions |
| Won't | Accounts, meal planning, shopping lists, nutrition, mobile app, AI recipes, pantry tracking | See What We're NOT Building |

### MVP Scope

Add a recipe by hand or by URL, then type ingredients and see ranked matches with the missing ingredients listed. Includes the SQLite database, image storage, name/cuisine search and the security baseline.

### User Flow

1. Open the app, type or tap ingredients into the search box (chips).
2. See recipe cards ranked by "you have X of Y", with missing ingredients shown.
3. Open a recipe for steps and the image.
4. If nothing fits, paste a recipe URL to import a new one, then search again.

---

## Technical Approach

**Feasibility**: HIGH

**Architecture Notes**
- UI: React + Vite + Tailwind CSS + shadcn/ui (MIT, free, fast, accessible, code owned in-repo). Mantine is the alternative if a packaged library is preferred.
- Backend: small Node/TypeScript server (Fastify or Hono). Needed because URL import cannot run in-browser (CORS) and to keep the database and images off the client.
- Database: SQLite via `better-sqlite3`. FTS5 (Porter stemmer, bm25) for name/cuisine/text search. A normalised `recipe_ingredient` table drives matching: score = matched / total ingredients, with a minimum-match threshold and a missing list.
- Images: stored on disk in a data directory, referenced from the database with a content hash. Not committed to git.
- Packaging: single Docker image plus `docker-compose.yml` with a persistent volume for the database and images. Compose publishes the port on `127.0.0.1` by default; exposing it publicly is an explicit opt-in that requires auth to be configured.
- Source of truth is the SQLite file plus the images directory; backups are a copy of the data volume.
- Everything open source: permissive repo licence, OSI-approved dependencies only, checked in CI.

**Security baseline (public repo + possibly cloud-hosted)**
- No secrets, personal data or `.db`/image files in git: strict `.gitignore`, `.env.example` only, gitleaks in pre-commit and CI.
- SSRF protection on URL import (OWASP): http(s) only, resolve DNS and block loopback/RFC1918/link-local/100.64.0.0/10 addresses, do not auto-follow redirects (re-validate each hop), size and timeout limits, validate image MIME type, random filenames.
- XSS: render imported text as plain text, no `dangerouslySetInnerHTML`, strict Content-Security-Policy.
- Parameterised SQL only.
- Auth: if the server is reachable beyond localhost, a shared password/token via environment variable is required; the app refuses to start publicly without it.
- Container runs as non-root with a read-only root filesystem where practical; no telemetry.
- `SECURITY.md`, Dependabot/`npm audit`, licence check in CI.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SSRF via URL import | H | Controls above; dedicated tests with private-IP, redirect and DNS-rebinding cases |
| Unauthenticated app exposed on the cloud | M | Auth required for non-loopback exposure; safe compose default |
| Copyright of imported images/text | H | Never commit user data; show source URL; keep data directory out of git |
| Messy ingredient text breaks matching | H | Quantity/unit/name parser, normalisation, synonyms, fixture-based tests |
| Scarce rating data | H | Own star ratings; import from JSON-LD when present |
| Scraper breakage as sites change | M | Rely on schema.org JSON-LD, which is stable; manual entry fallback |
| Cloud hosting conflicts with $0 budget | M | Local Docker is the primary target; cloud is documented, not required |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently (e.g., "with 3" or "-")
  DEPENDS: phases that must complete first (e.g., "1, 2" or "-")
  PRP: link to generated plan file once created
-->

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Foundation & security scaffold | Repo, licence, TS monorepo, Docker/compose, CI, gitleaks, SQLite schema, server skeleton, UI shell | complete | - | - | [plan](../plans/completed/foundation-security-scaffold.plan.md), [report](../reports/foundation-security-scaffold-report.md) |
| 2 | Recipes & images | Recipe CRUD, manual entry, image upload/storage on disk | complete | - | 1 | [plan](../plans/completed/recipes-and-images.plan.md), [report](../reports/recipes-and-images-report.md) |
| 3 | Name/cuisine/rating search | FTS5 search, cuisine filter, rating sort, own star ratings | complete | with 4, 5 | 2 | [plan](../plans/completed/recipe-search.plan.md), [report](../reports/recipe-search-report.md) |
| 4 | Ingredient matching | Ingredient parser/normaliser, ranking by overlap, missing list, benchmark | complete | with 3, 5 | 2 | [plan](../plans/completed/ingredient-matching.plan.md), [report](../reports/ingredient-matching-report.md) |
| 5 | URL import | JSON-LD import, image download, SSRF hardening and tests | pending | with 3, 4 | 2 | - |
| 6 | UI polish | Ingredient chips, search-as-you-type, recipe cards, dark mode, responsive layout, accessibility | pending | - | 3, 4 | - |
| 7 | Optional data sources | Licence-checked seed data; optional TheMealDB importer (off by default) | pending | with 8 | 4, 5 | - |
| 8 | Hardening & deployment | Shared-password auth, CSP, security review, cloud deployment guide, README/SECURITY.md | pending | with 7 | 5, 6 | - |

### Phase Details

**Phase 1: Foundation & security scaffold**
- **Goal**: A secure, reproducible base before any feature work.
- **Scope**: Repo layout, MIT licence, `.gitignore`, `.env.example`, gitleaks, CI (lint, test, licence check, `npm audit`), Dockerfile (non-root) and compose with loopback-only port, SQLite migrations, Fastify/Hono skeleton, Vite + Tailwind + shadcn/ui shell.
- **Success signal**: `docker compose up` serves an empty UI; CI green; gitleaks clean.

**Phase 2: Recipes & images**
- **Goal**: Store and view recipes with images.
- **Scope**: Schema (recipe, ingredient lines, steps, cuisine, rating, source URL, image hash), CRUD API, forms, image upload with MIME/size checks.
- **Success signal**: A recipe with an image can be created, edited, viewed and deleted, and survives a container restart.

**Phase 3: Name/cuisine/rating search**
- **Goal**: Find recipes by name and cuisine, sorted by rating.
- **Scope**: FTS5 index with triggers, cuisine filter, rating sort, own star rating.
- **Success signal**: Searches return correct results in under 200 ms on a large fixture library.

**Phase 4: Ingredient matching**
- **Goal**: The key feature, with useful rankings.
- **Scope**: Ingredient parsing and normalisation (quantity, unit, name, stemming, synonyms), overlap scoring, minimum-match threshold, matched/missing display, benchmark and fixture tests.
- **Success signal**: Hit-rate trial meets the success metric on the author's 10 ingredient sets.

**Phase 5: URL import**
- **Goal**: Fill the library without typing.
- **Scope**: Server-side fetch with SSRF controls, JSON-LD parsing (including `@graph`), image download, error handling, import preview before save.
- **Success signal**: >= 70% of the 20-site sample imports; all SSRF test cases are blocked.

**Phase 6: UI polish**
- **Goal**: Modern, fast, engaging feel.
- **Scope**: Ingredient chips with autocomplete, instant results, image cards, empty states, dark mode, responsive design, keyboard and screen-reader accessibility.
- **Success signal**: Lighthouse performance and accessibility scores >= 90 (proposed); author finds it pleasant to use.

**Phase 7: Optional data sources**
- **Goal**: A useful first run without compromising openness.
- **Scope**: Licence review and optional seed importer; optional TheMealDB plugin with a clear notice.
- **Success signal**: A fresh install can load starter recipes with a documented licence for each source.

**Phase 8: Hardening & deployment**
- **Goal**: Safe to expose beyond localhost and safe to publish.
- **Scope**: Shared-password/token auth, rate limiting, CSP, security review, cloud deployment guide, README, `SECURITY.md`, final public-repo sweep.
- **Success signal**: The app refuses public exposure without auth; the security review has no open high-severity issues.

### Parallelism Notes

Phases 3, 4 and 5 all depend only on the recipe store from Phase 2 and touch different modules (search, matching, import), so they can run in parallel. Phase 6 needs the search and matching APIs. Phases 7 and 8 can run in parallel at the end.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| UI framework | shadcn/ui + Tailwind + React/Vite | Mantine, MUI, Chakra | Free (MIT), light, modern, accessible, code owned in-repo |
| Database | SQLite + FTS5 | PostgreSQL, JSON files | Local, zero-ops, built-in full-text search, single-file backup |
| Image storage | Files on disk, hash/path in database | BLOBs in SQLite | Faster, smaller database, simpler backups (author confirmed) |
| Ingredient matching | Normalised table + overlap score | FTS5 AND query | FTS5 implicit AND is too strict; partial overlap is the requirement |
| Recipe sources | Manual + URL import core; seed data and TheMealDB optional | TheMealDB, Spoonacular as core | Core must be fully open source; TheMealDB is a proprietary free service, Spoonacular/Edamam are closed |
| Backend | Node/TypeScript server | Browser-only app | URL import needs a server (CORS); keeps data private |
| Deployment | Always on. Docker for local; cloud may use Docker or a plain Node process with a persistent disk | Desktop app, Docker-only | Author requirement: online all the time; Docker not required in the cloud |
| Network exposure | Loopback by default; auth required if public | Open by default | Public repo + cloud means careless clones could expose their data |
| Licence | MIT (author decision) | Apache-2.0, GPL/AGPL | Maximises reuse; simple and permissive |
| Ratings | Author's own 1-5 stars; imported ratings optional | Rely on external rating data | Open sources rarely carry ratings (author decision) |
| Cloud auth | Single shared password/token via env var | Reverse-proxy auth, accounts | Simple, fits single-user scope (author decision) |
| Scope | Single-user, no meal planning/shopping/nutrition/AI | Broader recipe suite | Keeps focus on the hypothesis |

---

## Research Summary

**Market Context**
- Mealie and Tandoor are the main self-hosted recipe managers (Mealie simpler, Tandoor feature-heavy); Grocy handles pantry inventory. Comparisons are mostly blog posts, some from vendors, so feature claims are unverified. No source confirmed ranked partial-ingredient recipe search in these tools.
- TheMealDB offers free recipes, images and cuisine/ingredient filters, but multi-ingredient filtering is a paid feature and its terms limit app-store release; it is not open source.
- Open datasets exist (tastyR CC0, Wikibooks Cookbook CC-BY-SA 4.0) but their licences are unverified upstream and may not cover the underlying recipe text.

**Technical Context**
- SQLite FTS5 supports bm25 ranking and the Porter stemmer; multi-term queries are AND by default, so overlap ranking needs a separate normalised ingredient table. A comparable local-first recipe manager (fond) uses FTS5 over titles, ingredients, steps and tags.
- Most recipe sites publish schema.org Recipe JSON-LD; browser-only importers hit CORS errors, so a server is needed.
- OWASP SSRF guidance: allowlist where possible, disable or re-validate redirects, resolve and check IPs against private ranges (guards against DNS rebinding), block non-HTTP schemes. Only partial excerpts of the OWASP page were read; consult the full page during Phase 5.
- shadcn/ui: MIT, copy-in components on Radix + Tailwind, roughly 18 KB gzipped for a sample page versus about 55 KB for Mantine (third-party estimate).

---

*Generated: 2026-10-16*
*Status: DRAFT - needs validation*

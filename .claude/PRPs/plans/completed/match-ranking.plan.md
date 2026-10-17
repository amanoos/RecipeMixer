# Plan: Better match ranking and generic ingredient names

## Summary
Two changes to "What can I cook?". (1) Rank by how well a recipe fits **both ways**: how much of the recipe you can make *and* how many of your ingredients it uses, so a three-line recipe that uses one ingredient no longer beats a real dish that uses most of what you have. (2) Let a general ingredient stand for its specific kinds, so `beef` matches `flank steak` and `cheese` matches `feta`, in both directions.

## User Story
As a cook with a few ingredients in the fridge, I want recipes that use most of what I have near the top, and I want "beef" to count for "flank steak", so that the first results are dishes I would actually make.

## Problem → Solution
Ranking is by coverage only (matched lines divided by counted lines), so a recipe with few lines wins on one match; and matching is by shared words, so a generic name never reaches a specific recipe line → a blended score plus a small, editable table of generic-to-specific names.

## Metadata
- **Complexity**: Small to Medium
- **Source PRD**: `.claude/PRPs/prds/recipe-mixer.prd.md` (refines Phase 4, no new phase)
- **Estimated Files**: ~10

## Evidence (6 real searches on the 43 starter recipes, 2026-10-17)

| You have | Today's top 3 | Problem |
|---|---|---|
| beef, broccoli, rice | Coconut Rice (1 of 3), Baked Stuffed Peppers (2 of 6), **Beef and Broccoli Stir Fry** (2 of 7) | the obvious answer is third; `beef` does not match `flank steak` |
| eggs, spinach, cheese | Mushroom Omelette, **Spinach and Feta Quiche** (3 of 7), Egg Fried Noodles | `cheese` does not match `feta`, so the quiche is held back |
| chicken, rice, onion, garlic | Chicken and Rice Skillet first | fine |
| potato, onion, eggs | Spanish Tortilla first | fine |
| tomato, pasta, garlic, olive oil | Tomato Soup, Tuna Pasta Salad, Caprese | fine |
| chickpeas, coconut milk, onion | Chickpea Curry, Coconut Rice, Tortilla | fine |

A simulation of the blended score on those same results (using matched lines as a stand-in for "my ingredients used") puts Coconut Rice out of the top 3 for the beef set and lifts the quiche to first for the cheese set, and leaves the four good sets unchanged. With the beef synonym the stir fry becomes first (3 of 7, all three of my ingredients used). Both fixes are needed: with only the score change, Baked Stuffed Peppers beats the stir fry.

## Design

### 1. Blended score
For each recipe (staples ignored as today):
- `coverage` = matched recipe lines / counted recipe lines (unchanged, still shown as "you have X of Y")
- `usage` = distinct ingredients **you typed** that match at least one counted line / ingredients you typed (typed staples such as salt are left out of this count when "assume staples" is on, so typing salt cannot lower a score)
- `score` = harmonic mean of coverage and usage (F-measure): `2·c·u / (c+u)`

Sort by `score`, then `coverage`, then fewest missing, then your rating, then newest. `minCoverage` still filters on coverage. The API keeps `coverage` and its other fields and adds `score` (0 to 1), so nothing the web app reads changes.

Why this and not "most matched lines first": that would push large recipes that need ten more things above small ones that need one. The harmonic mean is high only when a recipe is both mostly makeable and uses most of what you have.

### 2. Generic names
A small table in `ingredient-data.ts`, `GENERIC_KINDS: Map<generic, specifics[]>`:
- `beef`: flank steak, sirloin, ribeye, brisket, chuck, short rib, steak
- `pork`: pork chop, pork tenderloin, ham (not bacon or sausage, which people buy as their own item)
- `lamb`: lamb chop, leg of lamb, lamb shoulder
- `fish`: salmon, cod, tuna, halibut, tilapia, trout
- `cheese`: cheddar, mozzarella, feta, parmesan, gruyere, ricotta, goat cheese, swiss
- `pasta`: spaghetti, penne, macaroni, linguine, fusilli, rigatoni

Rule in `ingredientsMatch`: a generic name matches a line that names one of its specifics (the line contains all the words of a specific), and a specific you type matches a generic recipe line (`feta` satisfies `cheese`). Two different specifics never match each other (`cheddar` does not satisfy `feta`). The existing identity-word guard still applies (`beef` does not match `beef broth`).
Matching only: the saved ingredient index and the normaliser are not changed, so **no reindex** and `NORMALIZER_VERSION` stays 1.

### 3. Candidate search must learn the generics too
Stage 1 finds candidate recipes by shared words from an indexed table, so `beef` would never find a recipe whose line only says `flank steak`. The lookup words are widened with the specific words of any generic you typed (and the generic word for a specific you typed). Stage 2 scoring then applies the exact rule above. The 500-candidate cap and the speed target (p95 under 200 ms on 15,000 recipes) must still hold; the bench checks it.

## Decisions for you (defaults in bold)
1. **Score = harmonic mean of coverage and usage** vs. "most of my ingredients used first, coverage second".
2. **Which generics to ship first**: the six above. Easy to add to later; one line per kind.
3. **Show the score in the UI? No**: keep "you have 3 of 7"; only the order changes. The sentence under "What can I cook?" is reworded to match.

## Files to Change
| File | Action |
|---|---|
| `server/src/services/ingredient-data.ts` | UPDATE: `GENERIC_KINDS` table with comments |
| `server/src/services/ingredients.ts` | UPDATE: generic/specific rule in `ingredientsMatch`, helper to widen lookup words |
| `server/src/services/matching.ts` | UPDATE: usage, score, new sort, widened candidate words |
| `server/src/schemas/match.ts` | UPDATE: `score` in `MatchItem` |
| `server/test/matching.test.ts`, `ingredients.test.ts`, `ingredient-data.test.ts`, `fixtures/matching-library.ts` | UPDATE/CREATE: new cases; any existing expectation whose order changes is called out and justified |
| `server/test/starter-recipes.test.ts` | UPDATE: the six searches above as regression tests on the real starter set |
| `server/scripts/eval-matching.ts` | UPDATE: print the score |
| `web/src/lib/types.ts`, match page copy | UPDATE: `score` type, one sentence of wording |
| `README.md` ("How matching works") | UPDATE |

## NOT Building
- Quantity comparison, substitutions beyond the table, or learning from your choices.
- A reindex, a migration, or a change to how ingredient lines are saved.
- A user-editable synonym screen (the table is a code file, as before).

## Step-by-Step Tasks
1. **Table and rule.** Add `GENERIC_KINDS`; extend `ingredientsMatch`; tests for every direction, sibling refusal (`cheddar` vs `feta`), identity guard (`beef` vs `beef broth`), plurals, odd input. *Validate:* ingredient unit tests.
2. **Widened candidate lookup.** Expand words for generics; test that `beef` finds a recipe with only `flank steak`. *Validate:* matching tests plus `npm run bench -w server` still under 200 ms.
3. **Score and sort.** Usage, F-measure, new comparator, `score` in the response and schema. *Validate:* hand-computed scores; ties fall back in the documented order; typed staples do not lower the score.
4. **Regression on real data.** Load the starter set in a test and assert the six searches: beef/broccoli/rice puts Beef and Broccoli Stir Fry first and Coconut Rice outside the top 3; eggs/spinach/cheese puts the Quiche first; the four good sets keep their first result.
5. **Update existing expectations** that change order, one at a time, each with a stated reason.
6. **Web and docs.** Type for `score`, reworded sentence, README ranking section with an example.
7. **Validate and review.** Lint, types, all tests, build, audit; the matching eval on `example-sets.json`; mutation checks (score uses usage, generic rule one-way only, sibling refusal, candidate widening, staples excluded from usage); optional independent review (low risk: no new input, no network).

## Testing Strategy
- Unit: every generic/specific pair both ways, sibling refusal, identity words, empty and odd input; score values by hand for three sets; comparator tie order.
- Integration: the six real searches; the existing 15,000-recipe bench.
- Edge cases: no matches, a single ingredient typed, only staples typed, 30 ingredients, the same ingredient typed twice, `minCoverage` set.

## Validation Commands
```bash
npm run lint && npm run typecheck && npm test && npm run build
npm run bench -w server
npm run eval:matching -w server -- server/scripts/example-sets.json
```
EXPECT: green; bench p95 under 200 ms.

## Acceptance Criteria
- [ ] beef, broccoli, rice: Beef and Broccoli Stir Fry first, Coconut Rice not in the top 3
- [ ] eggs, spinach, cheese: Spinach and Feta Quiche first
- [ ] The four searches that were already fine keep the same first result
- [ ] `beef` does not match `beef broth`; `cheddar` does not satisfy `feta`
- [ ] No reindex, no schema change, speed target held, API only gains `score`

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Blend reorders results users liked | M | Worse top 5 on some sets | Regression sets, eval script, easy to revert (one comparator) |
| Generic table too eager (e.g. `fish` matches `fish sauce`) | M | False matches | Identity-word guard plus tests for known traps; table is small and reviewed |
| Wider candidate words slow the search | L | Latency | Bench gate before merge |
| Existing tests encode the old order | M | Churn | Each change justified individually in the report |

## Notes
- This plan was written from six hand-run searches, not the formal ten-set trial in the PRD; the eval run in step 7 can report on your own sets once you provide them.

# Data sources

Where the recipes in RecipeMixer can come from, what licence each source has, and what the repository does and does not contain. Last reviewed 2026-10-17.

| Source | Licence | In this repository? | How to use it |
|---|---|---|---|
| Recipes you type in | Yours | No (stored in your data folder) | **Add a recipe** |
| Recipes you import from a link | Belong to their authors | No (stored in your data folder) | **Import**, paste a link |
| **Starter recipes** (about 40) | CC0 1.0, written for this project | Yes: `server/src/data/starter-recipes.json` | **Load starter recipes** on an empty library, or `npm run seed:starter -w server -- --dir ./data` |
| **TheMealDB** (optional) | Not open source, see below | No, never | Set `MEALDB_ENABLED=true`, then search on the **Import** page |

Not used, and not bundled: Wikibooks Cookbook, the tastyR dataset, Kaggle recipe sets and RecipeNLG. Their licences were looked at only briefly (some are share-alike, one is a scrape of a commercial site, one needs terms accepted), so none is included. They are not reviewed and not recommended here.

## Starter recipes

About forty plain, common dishes (soups, pasta, curries, salads, breakfasts) from many cuisines, written for this project and dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/legalcode). The licence text is in `server/src/data/LICENSE-starter-recipes.txt`. They have no photos (cards show a placeholder), no source link and no rating, so they are easy to tell apart from recipes you saved yourself.

- Loading them twice adds nothing: a recipe is skipped when one with the same title (ignoring capitals) is already in the library.
- You can edit or delete any of them like your own recipes.
- They share common ingredients (onion, garlic, eggs, rice, tomato) on purpose, so "what can I cook?" gives useful answers on a fresh install.

## TheMealDB (optional, off by default)

[TheMealDB](https://www.themealdb.com) is a community recipe database with photos and a JSON API. It is **not open source**, so RecipeMixer does not bundle any of its data and keeps the feature off until you turn it on. What its pages said when this was written (2026-10-17):

- [Terms of use](https://www.themealdb.com/terms_of_use.php) (last updated 01/07/2025): content from the API may be copied and modified if the official endpoints are used (do not scrape the website); copyright and trademark notices must not be removed; the free API is for development projects, and "You cannot publish apps to an appstore unless you are a paid subscriber"; most artwork is created by their users, must not be passed off as your own and should link back; resale of the API is not allowed.
- [API page](https://www.themealdb.com/api.php): the key `1` is a test key "during development of your app or for educational use"; multi-ingredient filtering and listing the whole database are supporter features.

What that means here:

- RecipeMixer is a personal, self-hosted tool. This project's reading (not TheMealDB's statement) is that using the free key for your own library fits "development or educational use"; the terms do not define "personal". If you run it as a public service for other people, or build something you distribute, read their terms and consider a supporter key. You are responsible for anyone you give access to the API through your server.
- Some artwork carries a Creative Commons licence (their `strCreativeCommons` field); the terms point to that field for checking, and a link back to TheMealDB is kept on every saved recipe.
- The app uses only the official API endpoints (`search.php` and `lookup.php`), one reviewed recipe at a time. It does not scrape their site and it does not download everything.
- A recipe saved from TheMealDB keeps its source link (`https://www.themealdb.com/meal/<id>`), which is shown on the recipe page. The photo is downloaded and re-encoded locally only when you save.
- Terms can change. Check the pages above before relying on this.

To turn it on, set `MEALDB_ENABLED=true` (and `MEALDB_API_KEY` if you have a supporter key; otherwise the default `1` is used). A supporter key is a secret: keep it in the environment or a secret file, never in the repository or an image.

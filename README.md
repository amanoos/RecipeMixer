# RecipeMixer

An open source, local-first recipe manager that answers one question: **what can I cook with what I already have?**

Type the ingredients in your fridge and RecipeMixer will rank your saved recipes by how many of their ingredients you already have, and show what is missing. It is built to cut food waste, not to replace a full meal planner.

> **Status: early development.** You can save, view, edit, search and delete recipes with photos, find what you can cook from the ingredients you have, and import a recipe from a link. See [the roadmap](#roadmap).

## Features

Available now:

- Save recipes (title, cuisine, description, source link, your own 1 to 5 star rating, ingredients and steps) in a local SQLite database
- Add a photo to each recipe: JPEG, PNG or WebP up to 5 MB, stored as a WebP file on disk with location and camera data removed
- **Search** your recipes as you type, across title, cuisine, description and ingredients (word forms and accents are matched, and the best match comes first), filter by cuisine and minimum rating, and sort by best match, newest, highest rated or title. Rate a recipe with one click on its page
- **What can I cook?** Enter the ingredients you have and see your recipes ranked by how much of each you can already make, with the missing ingredients listed. A partial match is fine, and the search lives in the page URL so it can be bookmarked
- Browse, edit and delete recipes in a modern UI (React, Tailwind CSS, shadcn/ui) with light and dark themes
- Everything open source, no accounts, no telemetry, no paid services

- **Import from a link:** paste the address of a recipe page and RecipeMixer reads the page's standard `schema.org` recipe data (title, ingredients, steps, cuisine, photo), shows it in the normal form for you to check, and saves it with the photo. Nothing is saved until you press Save

## Quick start

Requirements: Node.js 22 or newer (24 recommended, see `.nvmrc`).

```bash
npm install
npm run dev
```

Open the Vite URL printed in the terminal (usually http://localhost:5173). The API runs on http://127.0.0.1:3210.

### Run with Docker

```bash
docker compose up -d
```

Open http://127.0.0.1:3210. Your data lives in the `recipemixer-data` Docker volume and survives restarts and rebuilds.

### Run without Docker (for example on a cloud host)

```bash
npm ci
npm run build
npm start
```

The host needs a persistent disk for `DATA_DIR`, because the database and images are stored there. Serverless or stateless platforms are not a good fit.

> **Do not expose the app to the internet yet.** There is no login. Password authentication is planned (Phase 8). Until then the server only listens on `127.0.0.1` and refuses to start on any other address unless you set `ALLOW_INSECURE_NO_AUTH=true`, which you should do only when something else protects the port. The provided `docker-compose.yml` does this safely by publishing the port on `127.0.0.1` only.

## Configuration

Settings come from environment variables (see [`.env.example`](.env.example)). Never commit a real `.env` file.

| Variable | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Address to listen on. Anything other than loopback requires `ALLOW_INSECURE_NO_AUTH=true`. |
| `PORT` | `3210` | Port to listen on. |
| `DATA_DIR` | `./data` | Where the SQLite database (and later, images) are stored. |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent`. |
| `ALLOW_INSECURE_NO_AUTH` | `false` | Explicit opt-in to listen beyond loopback without authentication. |
| `URL_IMPORT_ENABLED` | `true` | Set to `false` to turn off fetching pages and photos from links completely. |
| `WEB_DIST` | built-in path | Folder containing the built web app. Set automatically in Docker. |

### Backups

Everything you save is in `DATA_DIR` (the Docker volume `recipemixer-data`): the database file `recipemixer.db` and the `images/` folder. Copy that folder, with the server stopped, to back it up.

## Project layout

```
server/   Fastify + TypeScript API, SQLite (better-sqlite3), migrations
web/      React + Vite + Tailwind CSS v4 + shadcn/ui
```

Useful commands: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run audit:licenses`.

To scan for secrets before committing, install [gitleaks](https://github.com/gitleaks/gitleaks) and enable the hook: `git config core.hooksPath .githooks`.

## API

JSON over HTTP on the same port as the web app. Errors look like `{"error": "message"}`.

| Method and path | Purpose |
|---|---|
| `GET /api/health` | Server and database status |
| `GET /api/recipes?limit=24&offset=0` | List recipes (`limit` 1 to 100). Optional `q` (search text), `cuisine`, `minRating` (1 to 5) and `sort` (`relevance`, `newest`, `rating`, `title`); newest first by default, best match first when searching |
| `GET /api/cuisines` | Cuisines in use with how many recipes each has |
| `PATCH /api/recipes/:id/rating` | Set your rating (`{"rating": 4}`) or clear it (`{"rating": null}`) |
| `POST /api/recipes` | Create a recipe |
| `GET /api/recipes/:id` | Get one recipe with ingredients and steps |
| `PUT /api/recipes/:id` | Replace a recipe |
| `DELETE /api/recipes/:id` | Delete a recipe and its image file (if no other recipe uses it) |
| `PUT /api/recipes/:id/image` | Upload an image as `multipart/form-data`, field name `image` |
| `DELETE /api/recipes/:id/image` | Remove a recipe's image |
| `GET /api/images/:filename` | Serve a stored image (content-hash filenames only) |
| `GET /api/match?i=chicken&i=rice&staples=1` | Rank recipes by the ingredients you have (`i` repeated, 1 to 30 items of up to 60 characters; `staples=0` counts salt, pepper, water and oil too; optional `minCoverage`, `limit`, `offset`) |
| `GET /api/ingredients/suggest?q=on` | Ingredient names from your recipes that start with a prefix |
| `POST /api/import/preview` | Fetch a recipe page and return what was read (`{"url": "https://..."}`); saves nothing. Limited to 10 calls a minute |
| `POST /api/recipes/:id/image/from-url` | Download a photo from a link, re-encode it like an upload and attach it to a saved recipe |

## How matching works

Each ingredient line is read when a recipe is saved ("2 cups chopped yellow onions" becomes `onion`) and indexed. Your ingredients go through the same steps, so `Onions` matches that line.

- **Normalising:** quantities, units, sizes and preparation words are dropped, plurals are made singular, and regional names are unified (scallion and spring onion, courgette and zucchini). "A or B" lines match either one.
- **Matching:** an ingredient matches a recipe line when their words are the same or one contains the other (`onion` matches `red onion`, `chicken` matches `chicken breast`), unless the extra word makes it a different product (`butter` does not match `peanut butter`, `garlic` does not match `garlic powder`, `chicken` does not match `chicken broth`).
- **Pantry staples:** salt, pepper, water and oils are assumed to be in your kitchen by default, so they are neither counted nor listed as missing. Untick the box to count them.
- **Ranking:** best coverage first (how many of the recipe's ingredients you have), then fewest missing, then your own rating, then newest. Recipes that share at least one ingredient are shown, so a partial match still appears.
- **Limits:** the rules are an English, Western-cuisine approximation; quantities are stored but not compared; a line like "salt, pepper" is read up to the first comma. If a match looks wrong, the word lists live in `server/src/services/ingredient-data.ts`.
- **Tuning:** `npm run eval:matching -w server -- sets.json` prints the top matches for your own ingredient lists (see `server/scripts/example-sets.json`) so you can judge the results by eye, and `npm run bench -w server` checks speed on a 15,000-recipe library.

## How URL import works

Open **Import**, paste a link and press Import. The server fetches the page, looks for the recipe data that most recipe sites publish for search engines (`schema.org` JSON-LD), and opens the new-recipe form pre-filled. Check it, change what you like, and save. If the page named a photo, it is downloaded when you save (untick the box to skip it).

- **What it reads:** title, description, cuisine, ingredients, steps and the photo address. Your own star rating is never imported.
- **When it cannot:** pages without that data (some blogs, paywalled or script-only sites) give "No recipe data found on that page"; add those recipes by hand.
- **Duplicates:** if a saved recipe already uses the same link you are told, and can still import anyway.
- **Safety:** the server only fetches public web addresses, so a pasted link cannot be used to reach your own machine or network. See [SECURITY.md](SECURITY.md) for the details.
- **Measuring it:** `npm run eval:import -w server -- urls.txt` tries your own list of links (see `server/scripts/example-urls.txt`) and prints how many import with a title, ingredients and a photo.

## Security and privacy

See [SECURITY.md](SECURITY.md). In short: your recipes and images stay on your machine, nothing is sent anywhere except the requests you start when importing from a link, and this repository never contains user data (databases, images and `.env` files are git-ignored).

## Recipe content and images

Recipes and images you import belong to their original authors. RecipeMixer stores them locally for your personal use and keeps them out of the repository. Respect the terms of the sites you import from.

## Roadmap

1. Foundation and security scaffold (done)
2. Recipes and images (done)
3. Name, cuisine and rating search (done)
4. Ingredient matching (done)
5. URL import with SSRF protection (done)
6. UI polish
7. Optional data sources
8. Authentication, hardening and cloud deployment guide

## Licence

[MIT](LICENSE)

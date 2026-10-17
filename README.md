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
- Browse, edit and delete recipes in a modern UI (React, Tailwind CSS, shadcn/ui) with light and dark themes. It fits any screen from a 320 px phone up, uses comfortable touch sizes on touch devices, stays still while loading, has a "Skip to content" link, a title for every page and keyboard focus that follows you from page to page, and honours the system setting for reduced motion
- **Private by design:** by default it only answers on your own computer. To use it from your phone or from anywhere else, set a password (`APP_PASSWORD_FILE`) and put HTTPS in front; every recipe, search and photo is then behind the login. The [deployment guide](docs/DEPLOYMENT.md) covers free options, including private access with Tailscale
- Everything open source, no accounts, no telemetry, no paid services

- **Starter recipes:** an empty library offers a **Load starter recipes** button that adds about forty simple recipes written for this project and free to use (CC0). Nothing is added twice
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

> **Before you expose the app, read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).** On its own computer the app needs no password: it listens on `127.0.0.1` only and refuses other web addresses. To listen anywhere else it needs a strong password (`APP_PASSWORD` or, better, `APP_PASSWORD_FILE`) or the explicit opt-in `ALLOW_INSECURE_NO_AUTH=true`, which exists for setups where the port is protected another way. The provided `docker-compose.yml` publishes the port on `127.0.0.1` only. The app does not do HTTPS itself: put a reverse proxy or tunnel in front of any public address.

## Configuration

Settings come from environment variables (see [`.env.example`](.env.example)). Never commit a real `.env` file.

| Variable | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Address to listen on. Anything other than loopback requires a password or `ALLOW_INSECURE_NO_AUTH=true`. |
| `APP_PASSWORD` / `APP_PASSWORD_FILE` | none | The shared password (at least 12 characters), or the path of a file that holds it. Set only one. With a password, the API and photos need a login. |
| `TRUST_PROXY` | `false` | The address of your reverse proxy (an IP, a range, or `loopback`/`uniquelocal`), so the real client address is used for the login limits. |
| `COOKIE_SECURE` | `auto` | `true` always marks the login cookie `Secure`. |
| `ALLOWED_HOSTS` | none | With no password: extra host names the app may be opened by. |
| `PORT` | `3210` | Port to listen on. |
| `DATA_DIR` | `./data` | Where the SQLite database (and later, images) are stored. |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent`. |
| `ALLOW_INSECURE_NO_AUTH` | `false` | Explicit opt-in to listen beyond loopback without a password. Not needed when a password is set. |
| `URL_IMPORT_ENABLED` | `true` | Set to `false` to turn off fetching pages and photos from links completely. |
| `MEALDB_ENABLED` | `false` | Set to `true` to add a TheMealDB search to the Import page. See [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md). |
| `MEALDB_API_KEY` | `1` | TheMealDB key. `1` is their free development key; a supporter key stays in the environment only. |
| `WEB_DIST` | built-in path | Folder containing the built web app. Set automatically in Docker. |

### Backups

Everything you save is in `DATA_DIR` (the Docker volume `recipemixer-data`): the database file `recipemixer.db` and the `images/` folder. Copy that folder, with the server stopped, to back it up.

## Project layout

```
server/   Fastify + TypeScript API, SQLite (better-sqlite3), migrations
web/      React + Vite + Tailwind CSS v4 + shadcn/ui
```

Useful commands: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run audit:licenses`.

To try the app with made-up recipes (30 recipes with photos, nothing real), fill a new folder and point the server at it: `npm run seed:demo -w server -- --dir ./demo-data`, then `npm run build` and `DATA_DIR=./demo-data npm start`. The command refuses to run without `--dir` and refuses a folder that already holds a database, so it can never add demo recipes to your own library.

To scan for secrets before committing, install [gitleaks](https://github.com/gitleaks/gitleaks) and enable the hook: `git config core.hooksPath .githooks`.

## API

JSON over HTTP on the same port as the web app. Errors look like `{"error": "message"}`.

| Method and path | Purpose |
|---|---|
| `GET /api/health` | Server status (the schema version too, once logged in). Public |
| `GET`, `POST`, `DELETE /api/session` | Who is logged in, log in (`{"password": "..."}`), log out. Public. Every other `/api` route needs a login when a password is set |
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
| `POST /api/starter-recipes` | Add the bundled starter recipes that are not in the library yet (repeating it adds nothing) |
| `GET /api/mealdb/search?q=pasta`, `GET /api/mealdb/meals/:id` | Only when `MEALDB_ENABLED=true`, otherwise 404. Search TheMealDB by name, and read one meal as a draft to review. Each has the import limit of 10 calls a minute, and fetches share the cap of 2 at a time |

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

## Where recipes come from

You can type recipes in, import them from a link, load the bundled starter set, or (optionally) search TheMealDB. [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) lists every source, its licence and what is bundled. Load the starter recipes from an empty library, or from a command: `npm run seed:starter -w server -- --dir ./data`.

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
6. UI polish (done)
7. Optional data sources (done)
8. Authentication, hardening and cloud deployment guide (done)

## Licence

[MIT](LICENSE)

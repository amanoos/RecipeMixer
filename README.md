# RecipeMixer

An open source, local-first recipe manager that answers one question: **what can I cook with what I already have?**

Type the ingredients in your fridge and RecipeMixer will rank your saved recipes by how many of their ingredients you already have, and show what is missing. It is built to cut food waste, not to replace a full meal planner.

> **Status: early development.** You can save, view, edit and delete recipes with photos. Search, ingredient matching and URL import are planned. See [the roadmap](#roadmap).

## Features

Available now:

- Save recipes (title, cuisine, description, source link, your own 1 to 5 star rating, ingredients and steps) in a local SQLite database
- Add a photo to each recipe: JPEG, PNG or WebP up to 5 MB, stored as a WebP file on disk with location and camera data removed
- Browse, edit and delete recipes in a modern UI (React, Tailwind CSS, shadcn/ui) with light and dark themes
- Everything open source, no accounts, no telemetry, no paid services

Planned:

- Search recipes by name and cuisine, sorted by your own rating
- **Ingredient search**: find recipes you can make from a subset of ingredients, ranked by overlap
- Import recipes from a URL using the page's standard `schema.org` recipe data

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
| `GET /api/recipes?limit=24&offset=0` | List recipes, newest first (`limit` 1 to 100) |
| `POST /api/recipes` | Create a recipe |
| `GET /api/recipes/:id` | Get one recipe with ingredients and steps |
| `PUT /api/recipes/:id` | Replace a recipe |
| `DELETE /api/recipes/:id` | Delete a recipe and its image file (if no other recipe uses it) |
| `PUT /api/recipes/:id/image` | Upload an image as `multipart/form-data`, field name `image` |
| `DELETE /api/recipes/:id/image` | Remove a recipe's image |
| `GET /api/images/:filename` | Serve a stored image (content-hash filenames only) |

## Security and privacy

See [SECURITY.md](SECURITY.md). In short: your recipes and images stay on your machine, nothing is sent to third parties, and this repository never contains user data (databases, images and `.env` files are git-ignored).

## Recipe content and images

Recipes and images you import belong to their original authors. RecipeMixer stores them locally for your personal use and keeps them out of the repository. Respect the terms of the sites you import from.

## Roadmap

1. Foundation and security scaffold (done)
2. Recipes and images (done)
3. Name, cuisine and rating search
4. Ingredient matching
5. URL import with SSRF protection
6. UI polish
7. Optional data sources
8. Authentication, hardening and cloud deployment guide

## Licence

[MIT](LICENSE)

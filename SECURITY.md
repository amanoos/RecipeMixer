# Security policy

_Last reviewed: 2026-10-17_

## Reporting a vulnerability

Please report security problems privately using GitHub's **private vulnerability reporting** (the "Report a vulnerability" button on the repository's Security tab). Do not open a public issue for a vulnerability. If the button is not there (private reporting has to be switched on in the repository's settings, and may be off on a fork), contact the maintainer through the contact details on their GitHub profile.

## Supported versions

Only the latest commit on `main` is supported while the project is in early development.

## How it is meant to be used

RecipeMixer is a **single-user** app: one person, one library, one shared password. It has two modes.

1. **On your own computer (the default).** No password. The server listens on `127.0.0.1` only, and Docker Compose publishes the port on `127.0.0.1` only. Even here, a web page on another site cannot read or change your recipes (see "Other sites and other names" below).
2. **Reachable from elsewhere (a phone away from home, a server).** A strong password is **required**, and HTTPS has to be put in front of the app (the app does not do HTTPS itself). The [deployment guide](docs/DEPLOYMENT.md) covers free options, including private access with Tailscale, and a tested HTTPS setup with Caddy.

What it defends against: strangers on the internet or your network reading, changing or deleting your library; guessing the password; other websites acting through your browser; a hostile web page fed to the import feature; hostile files uploaded as photos; and careless clones of this public repository exposing their owners' data. What it does not: see "Known limits".

## Protections

### Access control (when a password is set)

- **One shared password** from `APP_PASSWORD` or, better, `APP_PASSWORD_FILE`. It must be at least 12 characters and is refused when it is easy to guess (all digits, a repeated pattern, keyboard or alphabet runs, common words with a few letters around them). An empty setting is an error, not "no password". The password is compared in constant time, never written to the database, never logged and never sent back.
- **Startup guard.** Listening on anything other than loopback needs a password, or the explicit `ALLOW_INSECURE_NO_AUTH=true` for setups where the port is protected another way (such as the loopback-only Docker mapping). Without either, the server refuses to start and says how to fix it.
- **Everything is behind the login except the page itself.** With a password set, every request to `/api` needs a session, except `GET /api/health` (which tells a logged-out caller only "ok") and the three session routes. The rule is applied to the whole app before any route, matched on exact method and path, and fails closed: a route added later is protected without anyone remembering to do it, a path that cannot be read is treated as private, and so is any request whose target is not a plain path (a full `http://host/...` address, `*`). A test lists every route and fails if one is added without being accounted for. The web app's own files (page, scripts, styles) are public so the login page can load; they contain none of your data. Stored photos are behind the login too.
- **Sessions.** A random 256-bit token in a cookie that is `HttpOnly`, `SameSite=Strict` and, over HTTPS, `Secure` with the `__Host-` prefix. The database stores only a keyed hash of the token (the key comes from the password), so a copy of the database cannot be turned into a working login, and changing the password ends every session. A session ends after 7 days without use or 30 days after login; logging out ends it on the server and asks the browser to empty its cache for the site.
- **Guessing.** Five wrong passwords lock a client out for 15 minutes (an IPv6 user counts as a whole /64 network), and after a burst of wrong passwords from anywhere every attempt waits a second; the login route also has its own request limit. The lockout counts clients, not everyone together, so a stranger cannot lock the owner out, provided the app sees real client addresses: behind a reverse proxy, `TRUST_PROXY` must name the proxy (an IP or range; hop counts and "true" are refused because they let a client fake its address). The app logs a warning when it sees proxy headers it was not told to trust. Wrong passwords are logged without the password.

### Other sites and other names

- **Cross-site requests.** A request that changes anything (POST, PUT, PATCH, DELETE) is refused if the browser says it came from another site (`Sec-Fetch-Site`) or from an origin other than the one it is sent to. This is on with or without a password. Scripts that send neither header still work with a valid login.
- **DNS rebinding.** With no password, the app only answers to `localhost`, `127.0.0.1` and `::1` (plus names you list in `ALLOWED_HOSTS`), so a web page cannot point its own name at your computer and read your library.
- **No cross-origin access.** No CORS headers are sent.

### Web and delivery

- **Headers.** A strict Content-Security-Policy (no inline scripts or styles, no third-party origins), `X-Content-Type-Options: nosniff`, a restrictive Permissions-Policy and other standard headers; a per-client rate limit (an IPv6 range counts as one client); errors never contain stack traces or internals.
- **Caching.** Every API answer is marked `private, no-store`, so a proxy or CDN never keeps a copy. Photos are `private` and long-lived (a browser may keep them, a shared cache may not). Only content-hashed build files are cached publicly, for a year; `index.html` is revalidated on every visit.
- **Compression.** Text responses are compressed; none of them contains a session token or another secret that a compression side channel could read, and photos are not recompressed.

### Your data

- **Privacy.** The database and recipe images live in `DATA_DIR` on your machine or volume. There is no telemetry, and your recipes are never sent anywhere. The only outgoing requests are the ones you start with the Import page, which fetch the page and photo at the link you pasted (and, only if you switch it on, searches of TheMealDB; like any web request, tell that site your server's address).
- **Image uploads.** An upload is accepted only if its bytes are a real JPEG, PNG or WebP (the client's file name and declared type are ignored; SVG, GIF and anything else is refused). It must be 5 MB or smaller and at most 40 megapixels, is decoded (at most two at a time, so memory stays bounded) and re-encoded as a WebP no larger than 1600 px, and loses all metadata (EXIF, GPS, camera and copyright tags). Files are stored under a hash of their content in a private folder (`DATA_DIR/images`, mode 0700) and are served only through `/api/images/<64 hex characters>.webp`; the data directory itself is never exposed.
- **Recipe content.** All user text is validated for length and shape on the server, stored with parameterised SQL, and rendered by React as plain text. A recipe's source link is stored as text and is never fetched when you save, view or edit a recipe (only the Import page fetches a link), and is shown as a clickable link only when it starts with `http://` or `https://`.
- **Recipe search.** What you type is never passed to the search engine as written: only letters and digits are kept (at most 10 words of 40 characters), each word is quoted, so operators such as `OR`, `NEAR(`, `title:` and `*` are searched as ordinary words. Filters and sort orders are range-checked or picked from a fixed list, and all values are bound as SQL parameters.
- **Ingredient search.** At most 30 ingredients of 60 characters; ingredient text only goes through pure normalisation functions (which look at no more than the first 200 characters of a line, so hostile input cannot make them slow) and bound SQL parameters; the only dynamic SQL is a list of `?` placeholders sized from that validated, capped list.

### URL import

This is the only place the server fetches an address you give it, and it all goes through one guarded fetcher. It accepts `http` and `https` on the standard ports only (no `file:`, `ftp:`, other ports or `user:password@` addresses); resolves the host and requires **every** address to be public (loopback, private, link-local including cloud metadata addresses, carrier-grade NAT, documentation, multicast, reserved, AS112 and the Azure host service address are refused, for IPv4, IPv6 and IPv4-mapped IPv6; IPv6 is allowed only inside global unicast space); connects to the address it checked, so a host cannot change its DNS answer between the check and the connection; follows at most 5 redirects by hand, re-checking each one and refusing a downgrade from https to http; stops reading at 2 MB for a page and 5 MB for a photo (also after decompression) and gives up after 10 seconds in total; and sends no cookies or credentials. For a target the guard blocks, every failure looks the same ("Could not fetch that page") and the reason goes only to the server log, so a blocked target never gets a connection; for public targets the answer can still differ slightly (an error status, a timing), which reveals nothing about private addresses. What is read from a page is reduced to plain text and limited in size, parsed in linear time, and the import endpoints are limited to 10 calls a minute and 2 at a time. Photos go through the same validation and re-encoding as uploads. Set `URL_IMPORT_ENABLED=false` to remove the feature entirely.

### Optional TheMealDB search

Off by default (`MEALDB_ENABLED=false`); when off its two routes do not exist and answer 404. When on, the server calls TheMealDB's official JSON API on one fixed address (`https://www.themealdb.com/api/json/v1/<key>/`) through the same guarded fetcher (public addresses only, no redirects into private space, 1 MB and 10 second limits). Only the search words and a numeric meal id come from you, URL-encoded or restricted to digits. The key may only contain letters, digits, `-` and `_`, is never logged and never sent to the browser. What comes back is validated as untrusted data: records without a numeric id are dropped, text is cut to the limits a saved recipe has, and a photo address is accepted only if it is https on `themealdb.com`. The photo is downloaded only when you save, through the same checks and re-encoding as any other image. Each of the lookups has the same limit as an import (10 calls a minute per route), and together with page imports at most 2 fetches run at the same time. TheMealDB is a third party and not open source; its terms (read 2026-10-17) allow using the API but not scraping the site, require its notices to stay, and do not allow publishing an app to an app store without a paid subscription. See [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

### Starter recipes

`POST /api/starter-recipes` adds recipes that ship inside the application (original text, CC0). It makes no network request, takes no input, is behind the login, and repeating it adds nothing.

### Containers and repository

- **Containers.** The Docker image runs as a non-root user with a read-only root filesystem, dropped capabilities and `no-new-privileges`. The example HTTPS setup does not publish the app's port at all. Local secrets and demo data are excluded from the Docker build.
- **Repository hygiene.** Databases, images, uploads, `.env` files and the deployment password file are git-ignored. CI runs a secret scan (gitleaks), a dependency audit and an open-source licence check; GitHub secret scanning with push protection is on for the repository. Run `git config core.hooksPath .githooks` to get a local pre-commit secret scan.

## Known limits

- **One password, no accounts.** No two-factor login, no password reset (change the setting and restart), no audit trail beyond the server log.
- **No HTTPS in the app.** Over plain HTTP, anyone on the network path can read the password and the cookie. Always put HTTPS in front of any address other than your own computer.
- **The lockout is in memory** and resets when the app restarts. It is a deterrent; the protection is a strong password plus HTTPS.
- **Proxy settings matter.** If `TRUST_PROXY` is missing behind a proxy, client addresses and HTTPS are not detected, which weakens the lockout and drops the cookie's `Secure` flag (the app warns in the log). If it is too broad (for example the private ranges while the app's port is reachable by other machines), a client could fake its address.
- **An expired session keeps the page in browser memory** behind the login, so unsaved edits are not lost, until you log out or close the tab.
- **Anyone who can read the server's files, the password file or the process environment** can read the library; the app cannot defend against that.
- **Importing** trusts the public internet's DNS and the sites you point it at; it is not an anonymiser, and imported recipes belong to their authors.
- Multi-user isolation and hosted multi-tenant use are out of scope.

## Security reviews

- **2026-10-17, Phase 8.** Two independent reviewers, working read-only, examined all the login and hardening code and, for the first time, the URL-import fetcher added in an earlier phase. Each finding was reproduced or reasoned through, fixed with a regression test (where a test could be isolated, it was shown to fail when the fix was removed), and the fixes were reviewed again. At the end no high or medium issue was open.
  - **Login code.** One high: a request line carrying a full address (`GET http://host/api/...`) skipped the login check and returned data without a password. Fixed by treating any request whose target is not a plain path as private; the tests now speak raw HTTP over a real socket, which the earlier tests could not. Two medium: the password rules accepted things like `123456789012` (now refused: digits only, repeated patterns, alphabet and keyboard runs), and the lockout counted each IPv6 address separately (now one count per /64 network, plus a global slow-down). Lows: a missing warning when proxy headers arrive without `TRUST_PROXY` (added), photos left in the browser cache after logout (the browser is asked to clear its cache), the password file permissions in the guide (now `chmod 400` and the container's owner), a short window in which parallel guesses could slip past the lockout during the slow-down (closed by checking again after the wait). Left as is, and documented: the page stays in browser memory behind the login after a session expires, so unsaved edits are not lost.
  - **URL-import fetcher.** No way to reach a loopback, private, link-local or cloud-metadata address was found, through any address encoding, redirect, DNS or proxy trick tried. One high, in the parser rather than the network layer: a crafted 2 MB page could freeze the whole server for many seconds (two separate slow patterns, one of them found only on the second look). Both are now linear, with tests that run 2 MB of hostile input. One medium: Azure's internal host service address and a few special-purpose ranges were not blocked (now are). Lows: a stuck DNS lookup could tie up Node's helper threads (the Docker image raises the pool), image decoding could use a lot of memory when many run at once (two at a time now), and a search queue could grow (capped). Left as is: a slow first address is not retried with a shorter timeout (availability only), hosts behind NAT64 cannot import, the server's own public address is allowed, and import is on by default when no password is set (it is only reachable from your own computer in that mode).
  - **Not reviewed or not tested:** behaviour through a real Caddy, nginx or Cloudflare other than the tested Caddy setup, Docker networking on other hosts, a real browser's cookie handling beyond the checks in the test log, and anything that needs a real tailnet.
- **2026-10-17, Phase 7.** One independent reviewer, read-only, examined the starter-recipe route and the optional TheMealDB importer, with probes over real sockets and a DNS spy. No high issue. One medium: `.gitignore` had a bare `data/` rule that would have kept the bundled starter recipes and their CC0 licence out of the repository (a fresh clone would have failed); the rule is now anchored. Lows fixed: the JSON content-type check accepted `+json` anywhere in a parameter (now the media type alone is judged), a photo address had no length cap (now 2048, like the image importer), and the docs overstated a shared rate limit (the per-route limits are separate; the cap of 2 simultaneous fetches is shared). Docs now separate what TheMealDB's pages say from this project's reading of them. Held up under attack: the fixed API host (no input could change host, path, scheme or query), the key never in logs or responses, off-by-default with no outgoing lookup, untrusted record handling, photo host allow-list tricks, prototype pollution and deep nesting, the login on every new route, and an unchanged Content-Security-Policy.

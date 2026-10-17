# Security policy

_Last reviewed: 2026-10-17_

## Reporting a vulnerability

Please report security problems privately using GitHub's **private vulnerability reporting** (the "Report a vulnerability" button on the repository's Security tab). Do not open a public issue for a vulnerability. If private reporting is not enabled on your fork, contact the maintainer through the contact details on their GitHub profile.

## Supported versions

Only the latest commit on `main` is supported while the project is in early development.

## Threat model (current)

RecipeMixer is a **single-user, local-first** app. It has no accounts and no login yet.

- **Network exposure:** the server listens on `127.0.0.1` by default and refuses to start on any other address unless `ALLOW_INSECURE_NO_AUTH=true` is set. The Docker Compose file publishes the port on `127.0.0.1` only. **Do not expose the app publicly until authentication is added** (planned for a later phase).
- **Your data:** the database and recipe images live in `DATA_DIR` on your machine or volume. There is no telemetry, and your recipes are never sent anywhere. The only outgoing requests are the ones you start with the Import page, which fetch the page and photo at the link you pasted (and, like any web request, tell that site your server's address).
- **Repository hygiene:** databases, images, uploads and `.env` files are git-ignored. CI runs a secret scan (gitleaks), a dependency audit and an open-source licence check. Run `git config core.hooksPath .githooks` to get a local pre-commit secret scan.
- **Web security:** the server sends a strict Content-Security-Policy (no inline scripts or styles, no third-party origins), `X-Content-Type-Options: nosniff` and other standard headers, applies a per-IP rate limit, and never returns stack traces to clients.
- **Image uploads:** an upload is accepted only if its bytes are a real JPEG, PNG or WebP (the client's file name and declared type are ignored; SVG, GIF and anything else is refused). It must be 5 MB or smaller and at most 40 megapixels, is decoded and re-encoded as a WebP no larger than 1600 px, and loses all metadata (EXIF, GPS, camera and copyright tags). Files are stored under a hash of their content in a private folder (`DATA_DIR/images`, mode 0700) and are served only through `/api/images/<64 hex characters>.webp`, so the data directory itself is never exposed.
- **Recipe content:** all user text is validated for length and shape on the server, stored with parameterised SQL, and rendered by React as plain text. A recipe's source link is stored as text and is never fetched when you save, view or edit a recipe (only the Import page fetches a link, see below), and is shown as a clickable link only when it starts with `http://` or `https://`.
- **Recipe search:** what you type is never passed to the search engine as written. Only letters and digits are kept (at most 10 words of 40 characters), each word is quoted, and operators such as `OR`, `NEAR(`, `title:`, quotes and `*` are therefore searched as ordinary words. Filters and sort orders are range-checked or picked from a fixed list, all values are bound as SQL parameters, and the search index is kept in step by database triggers on every change to a recipe.
- **Ingredient search:** the query accepts at most 30 ingredients of 60 characters, and every other parameter is range-checked. Ingredient text is only ever passed to pure normalisation functions (which look at no more than the first 200 characters of a line, so hostile input cannot make them slow) and bound as SQL parameters; the only dynamic SQL is a list of `?` placeholders sized from that validated, capped list. Error messages never repeat what was submitted, and the endpoints are covered by the global rate limit.
- **URL import:** this is the only place the server fetches an address you give it, and it all goes through one guarded fetcher. It accepts `http` and `https` on the standard ports only (no `file:`, `ftp:`, other ports or `user:password@` addresses); resolves the host and requires **every** address to be public (loopback, private, link-local including cloud metadata, carrier-grade NAT, documentation, multicast and reserved ranges are refused, for IPv4, IPv6 and IPv4-mapped IPv6); connects to the address it checked, so a host cannot change its DNS answer between the check and the connection; follows at most 5 redirects by hand, re-checking each one and refusing a downgrade from https to http; stops reading at 2 MB for a page and 5 MB for a photo (also after decompression) and gives up after 10 seconds in total; and sends no cookies or credentials. Refused, unreachable and failed targets all give the same message ("Could not fetch that page"), so the feature cannot be used to map your network; the reason is written to the server log only. Photos go through the same validation and re-encoding as uploads. What is read from a page is reduced to plain text and limited in size before you see it, and the import endpoints are limited to 10 calls a minute and 2 at a time. Set `URL_IMPORT_ENABLED=false` to remove the feature entirely.
- **Containers:** the Docker image runs as a non-root user with a read-only root filesystem, dropped capabilities and `no-new-privileges`.

## Planned protections

- **Authentication:** a shared password or token for any deployment reachable beyond localhost.
- **Fetch hardening beyond the application:** the app cannot see what happens on the network below it. If you deploy it where outbound traffic matters, also restrict the container's egress to the public internet.

## Out of scope

Multi-user isolation, hosted multi-tenant use and protection against someone who already has access to the machine or the data volume.

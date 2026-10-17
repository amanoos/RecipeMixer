# Security policy

_Last reviewed: 2026-10-16_

## Reporting a vulnerability

Please report security problems privately using GitHub's **private vulnerability reporting** (the "Report a vulnerability" button on the repository's Security tab). Do not open a public issue for a vulnerability. If private reporting is not enabled on your fork, contact the maintainer through the contact details on their GitHub profile.

## Supported versions

Only the latest commit on `main` is supported while the project is in early development.

## Threat model (current)

RecipeMixer is a **single-user, local-first** app. It has no accounts and no login yet.

- **Network exposure:** the server listens on `127.0.0.1` by default and refuses to start on any other address unless `ALLOW_INSECURE_NO_AUTH=true` is set. The Docker Compose file publishes the port on `127.0.0.1` only. **Do not expose the app publicly until authentication is added** (planned for a later phase).
- **Your data:** the database and (later) recipe images live in `DATA_DIR` on your machine or volume. Nothing is sent to third parties and there is no telemetry.
- **Repository hygiene:** databases, images, uploads and `.env` files are git-ignored. CI runs a secret scan (gitleaks), a dependency audit and an open-source licence check. Run `git config core.hooksPath .githooks` to get a local pre-commit secret scan.
- **Web security:** the server sends a strict Content-Security-Policy (no inline scripts or styles, no third-party origins), `X-Content-Type-Options: nosniff` and other standard headers, applies a per-IP rate limit, and never returns stack traces to clients.
- **Image uploads:** an upload is accepted only if its bytes are a real JPEG, PNG or WebP (the client's file name and declared type are ignored; SVG, GIF and anything else is refused). It must be 5 MB or smaller and at most 40 megapixels, is decoded and re-encoded as a WebP no larger than 1600 px, and loses all metadata (EXIF, GPS, camera and copyright tags). Files are stored under a hash of their content in a private folder (`DATA_DIR/images`, mode 0700) and are served only through `/api/images/<64 hex characters>.webp`, so the data directory itself is never exposed.
- **Recipe content:** all user text is validated for length and shape on the server, stored with parameterised SQL, and rendered by React as plain text. A recipe's source link is stored but never fetched by the server, and is shown as a clickable link only when it starts with `http://` or `https://`.
- **Ingredient search:** the query accepts at most 30 ingredients of 60 characters, and every other parameter is range-checked. Ingredient text is only ever passed to pure normalisation functions (which look at no more than the first 200 characters of a line, so hostile input cannot make them slow) and bound as SQL parameters; the only dynamic SQL is a list of `?` placeholders sized from that validated, capped list. Error messages never repeat what was submitted, and the endpoints are covered by the global rate limit.
- **Containers:** the Docker image runs as a non-root user with a read-only root filesystem, dropped capabilities and `no-new-privileges`.

## Planned protections

- **URL import (SSRF):** when recipe import from URLs is added, the server will accept only `http(s)`, resolve DNS and block loopback, private, link-local and carrier-grade NAT ranges, re-validate every redirect, and limit response size and time.
- **Authentication:** a shared password or token for any deployment reachable beyond localhost.
- **Imported content:** recipes imported from URLs will go through the same validation and image pipeline as manual entry.

## Out of scope

Multi-user isolation, hosted multi-tenant use and protection against someone who already has access to the machine or the data volume.

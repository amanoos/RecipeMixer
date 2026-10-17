# Contributing

Thanks for your interest in RecipeMixer.

## Setup

```bash
npm install
npm run dev
```

Node.js 22 or newer is required (24 recommended, see `.nvmrc`). Enable the local secret-scan hook with `git config core.hooksPath .githooks` (needs [gitleaks](https://github.com/gitleaks/gitleaks)).

## Before opening a pull request

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run audit:licenses
```

CI runs the same checks plus a dependency audit and a secret scan.

## Guidelines

- Add or update tests for behaviour changes.
- **Never commit** databases, images, `.env` files, or anything that contains personal data.
- Every dependency must have an OSI-approved open source licence (the licence check enforces an allowlist).
- Do not add third-party network calls, analytics or CDN assets. The Content-Security-Policy intentionally allows only the app's own origin.
- All SQL must be parameterised. Imported or user-supplied text must be rendered as plain text.
- Report security issues privately, see [SECURITY.md](SECURITY.md).

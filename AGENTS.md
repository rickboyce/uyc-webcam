# AGENTS.md

Compact project notes for coding agents working in this repo. Prefer this file for first-pass orientation before scanning broadly.

## Project Overview

This is a tiny static webcam, weather, and events site for Ullswater Yacht Club.

The public site is static files in `site/`, with generated/cached assets served from Cloudflare R2. Background jobs refresh webcam imagery, weather JSON, and events JSON. The webcam/NVR should stay private; do not expose camera endpoints directly from the public site.

## Repo Map

- `site/` - Static public site.
  - `index.html` - Page markup.
  - `assets/site.css` - Main styling and design tokens.
  - `assets/js/main.js` - Browser entrypoint.
  - `assets/js/webcam.js` - Webcam refresh logic.
  - `assets/js/weather.js` - Weather rendering.
  - `assets/js/events.js` - Events rendering.
  - `assets/js/shared.js` - Shared browser helpers.
- `dev/` - Local development runner and proxy server.
  - `dev.py` starts the site and optionally local workers.
  - `local_server.py` serves `site/` and proxies `/var/*` JSON.
- `workers/weather-refresh/` - Cloudflare Worker that refreshes weather data.
- `workers/events-refresh/` - Cloudflare Worker that refreshes upcoming events.
- `workers/shared/` - Shared Worker auth helpers and tests.
- `capture/` - Docker-based webcam capture tooling for RouterOS.
- `deploy/routeros/` - Example RouterOS container configuration.

## Common Commands

Run the local static site:

```sh
python3 dev/dev.py
```

Run the local site with one or both local workers:

```sh
python3 dev/dev.py --weather-worker
python3 dev/dev.py --events-worker
python3 dev/dev.py --workers
```

Run individual workers:

```sh
cd workers/weather-refresh && npm run dev
cd workers/events-refresh && npm run dev
```

Run tests:

```sh
cd workers && npm run test:shared
cd workers/events-refresh && npm test
```

There is currently no root-level `npm test` script.

## Local Development Notes

- The default local site URL is `http://127.0.0.1:8080/`.
- Without local workers, `/var/*` JSON requests proxy to `https://test.uyc.boats`.
- With local workers enabled, matching JSON requests proxy to localhost workers and fall back to the test site if unavailable.
- Local worker JSON responses are generated directly; they do not write to R2 or purge caches.
- Weather worker default local port: `8787`.
- Events worker default local port: `8788`.

## Deployment Model

- `main` deploys to production.
- `test` deploys to the test environment.
- Cloudflare Workers use `wrangler`.
- Site, worker, and capture deployments are driven by GitHub Actions badges referenced in `README.md`.

## Coding Guidelines

- Keep the site simple, fast, static, and mobile-friendly.
- Use existing plain HTML/CSS/JS patterns; there is no frontend framework.
- Prefer small, direct edits over new abstractions.
- Preserve the privacy/safety wording around webcam imagery unless explicitly asked to change it.
- Keep public browser code independent of private camera/NVR details.
- In `site/assets/js/shared.js`, reuse existing formatting, fetch, escaping, and date helpers before adding new ones.
- In worker code, keep environment-specific behavior behind existing environment variables and Wrangler config.

## Quick Triage

- For visual or layout changes, start with `site/index.html` and `site/assets/site.css`.
- For webcam refresh behavior, start with `site/assets/js/webcam.js`.
- For weather UI/data display, start with `site/assets/js/weather.js` and `workers/weather-refresh/src/`.
- For events UI/data display, start with `site/assets/js/events.js` and `workers/events-refresh/src/`.
- For local dev proxy issues, start with `dev/local_server.py` and `dev/dev.py`.
- For auth helper issues, start with `workers/shared/access-auth.ts` and `workers/shared/test/`.

## Verification

For simple site changes, run:

```sh
python3 dev/dev.py --no-open
```

Then inspect `http://127.0.0.1:8080/`.

For Worker changes, run the relevant test command above and, when useful, start the affected worker locally with `npm run dev`.

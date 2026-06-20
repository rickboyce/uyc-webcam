# ⛵ UYC Webcam

A tiny static webcam, weather and events site for **Ullswater Yacht Club**.

🌊 **Live site:** [uyc.boats](https://uyc.boats)

---

## What is this?

A simple, fast, mobile-friendly page for checking conditions at the Club before heading to the lake.

It shows:

* 📸 a regularly refreshed webcam image
* 🌦️ current weather at the Club
* 💨 wind information for sailors
* 🗓️ upcoming Club events
* 📱 a lightweight page that works nicely on mobile

It is intentionally simple, fast, and static — because sometimes all you need is a clear view of the water and a quick look at the wind. ⛵

---

## How it works

The public website is just static files and cached assets served from **Cloudflare R2**.

A few small background jobs keep things fresh:

1. 📸 a RouterOS-hosted container captures the latest webcam image
2. 🌦️ a Cloudflare Worker refreshes weather data
3. 🗓️ a Cloudflare Worker refreshes upcoming Club events
4. 🪣 generated files are written to Cloudflare R2
5. 🚀 Cloudflare serves the public site

The webcam/NVR should not be exposed directly to the public internet. Instead, the image is fetched privately, cached, and published to Cloudflare R2 for the website to display.

This keeps the site cheap, fast, and kind to the camera/NVR.

---

## Environments

The project has separate **test** and **production** environments.

* The `main` branch deploys to production.
* The `test` branch deploys to the test environment.

---

## Project structure

```text
uyc-webcam/
├── capture/
├── site/
├── workers/
│   ├── weather-refresh/
│   └── events-refresh/
└── deploy/
    └── routeros/
```

### `capture/`
[![build-capture](https://github.com/rickboyce/uyc-webcam/actions/workflows/build-capture.yml/badge.svg?branch=test)](https://github.com/rickboyce/uyc-webcam/actions/workflows/build-capture.yml)

Docker-based webcam capture tooling intended to run on a MikroTik RouterOS router.

### `site/` 
[![deploy-site](https://github.com/rickboyce/uyc-webcam/actions/workflows/deploy-site.yml/badge.svg?branch=test)](https://github.com/rickboyce/uyc-webcam/actions/workflows/deploy-site.yml)

Static website files for the public webcam page.

### `workers/weather-refresh/`
[![deploy-worker-weather](https://github.com/rickboyce/uyc-webcam/actions/workflows/deploy-worker-weather.yml/badge.svg?branch=test)](https://github.com/rickboyce/uyc-webcam/actions/workflows/deploy-worker-weather.yml)

Cloudflare Worker for refreshing weather data.

### `workers/events-refresh/`
[![deploy-worker-events](https://github.com/rickboyce/uyc-webcam/actions/workflows/deploy-worker-events.yml/badge.svg?branch=test)](https://github.com/rickboyce/uyc-webcam/actions/workflows/deploy-worker-events.yml)

Cloudflare Worker for refreshing upcoming Club events.

### `deploy/routeros/`

Example RouterOS configuration for deploying the capture tool using RouterOS Containers.

---

## Local development

Run the local site from the project root:

```sh
python3 dev/dev.py
```

By default the site serves files from `site/` at `http://127.0.0.1:8080/` and proxies `/var/*` JSON to `https://test.uyc.boats`.

To run the site with local worker data, start one or both workers:

```sh
python3 dev/dev.py --weather-worker
python3 dev/dev.py --events-worker
python3 dev/dev.py --workers
```

When a local worker is enabled, the dev server tries its local JSON endpoint first and falls back to the test website if the worker is not running or has no data. The launcher also calls each local worker's `/refresh` endpoint once at startup to warm the local R2 data.

Individual worker dev commands are also available:

```sh
cd workers/weather-refresh && npm run dev
cd workers/events-refresh && npm run dev
```

---

## Additional data sources and credits

Weather data comes from Open-Meteo.

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

This keeps the site cheap, fast, and kind to the camera/NVR.

---

## Why this design?

The webcam/NVR should not be exposed directly to the public internet.

Instead, the image is fetched privately, cached, and published to Cloudflare R2 for the website to display.

---

## Environments

The project has separate **test** and **production** environments.

* The `main` branch deploys to production.
* The `test` branch deploys to the test environment.

### Components

* Worker - Weather [![deploy-worker-weather](https://github.com/rickboyce/uyc-webcam/actions/workflows/deploy-worker-weather.yml/badge.svg?branch=test)](https://github.com/rickboyce/uyc-webcam/actions/workflows/deploy-worker-weather.yml)
* Worker - Events [![deploy-worker-events](https://github.com/rickboyce/uyc-webcam/actions/workflows/deploy-worker-events.yml/badge.svg?branch=test)](https://github.com/rickboyce/uyc-webcam/actions/workflows/deploy-worker-events.yml)
* Container - Webcam Capture [![build-capture](https://github.com/rickboyce/uyc-webcam/actions/workflows/build-capture.yml)](https://github.com/rickboyce/uyc-webcam/actions/workflows/build-capture.yml)
* Static Site [![deploy-site](https://github.com/rickboyce/uyc-webcam/actions/workflows/deploy-site.yml/badge.svg?branch=test)](https://github.com/rickboyce/uyc-webcam/actions/workflows/deploy-site.yml)

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

Docker-based webcam capture tooling intended to run on a MikroTik RouterOS router.

### `site/`

Static website files for the public webcam page.

### `workers/weather-refresh/`

Cloudflare Worker for refreshing weather data.

### `workers/events-refresh/`

Cloudflare Worker for refreshing upcoming Club events.

### `deploy/routeros/`

Example RouterOS configuration for deploying the capture tool using RouterOS Containers.

---

## Deployment

GitHub Actions handles build and deployment.

It can:

* build and publish the capture container
* deploy the static site to Cloudflare R2
* deploy the Cloudflare Workers
* deploy separately to test and production

`main` is the production branch, so changes to production should go through a pull request.

---

## Additional data sources and credits

Weather data comes from Open-Meteo.

Event data comes from the public Ullswater Yacht Club calendar feed.

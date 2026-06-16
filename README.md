# ⛵ UYC Webcam

A tiny static webcam and weather site for **Ullswater Yacht Club**.

🌊 **Live site:** [uyc.boats](https://uyc.boats)

---

## What is this?

Just a simple webcam page.

- 📸 a regularly refreshed webcam image
- 🌦️ current weather at the Club
- 💨 wind information for sailors
- 🕒 recent update timestamps
- 📱 a simple mobile-friendly page for quickly checking before heading to the lake

It is intentionally simple, fast, and static — because sometimes all you need is a clear view of the water and a quick look at the wind. ⛵

---

## How it works

The site has just one moving part - a small Docker container, intended to run on a RouterOS router, grabs and caches the latest webcam image and weather data.

That container periodically:

1. 📸 fetches a still image from the webcam/NVR
2. 🌦️ fetches the latest weather data
3. 🪣 uploads the cached files to Cloudflare R2
4. 🚀 lets Cloudflare serve the public site

The public website itself is just static files and cached assets. The aim is to make the site cheap, fast, and kind to the camera.

By having the Docker container fetch the webcam image once and then publish it to Cloudflare R2:

- the camera/NVR does not get exposed to the public internet at all
- the site can be hosted for free using Cloudflare R2
- Cloudflare can aggressively cache the static site and assets to make it quick

---

## Project structure

```text
uyc-webcam/
├── capture/
├── site/
└── deploy/
    └── routeros/
```

### `capture/`

Docker-based capture tooling.

This is the only active component. It grabs the webcam image and weather data, caches them, and uploads the results to Cloudflare R2.

### `site/`

Static website files for the webcam page.

### `deploy/routeros/`

Example RouterOS configuration to deploy the capture tool using RouterOS Containers.
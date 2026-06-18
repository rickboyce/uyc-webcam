import { formatDateTime } from "./shared.js";

const WEBCAM_PATH = "/var/webcam.jpg";
const REFRESH_MS = 60_100;

function webcamCacheKey() {
    return Math.floor(Date.now() / 60_000);
}

function refreshWebcam(image) {
    image.src = `${WEBCAM_PATH}?m=${webcamCacheKey()}`;
}

function bindWebcamTimestamp(image, timestamp) {
    image.onload = async () => {
        try {
            const response = await fetch(image.src, {
                method: "HEAD",
                cache: "no-cache"
            });
            const lastModified = response.headers.get("Last-Modified");

            if (!lastModified) {
                throw new Error("No Last-Modified header");
            }

            timestamp.textContent = formatDateTime(new Date(lastModified));
        } catch {
            timestamp.textContent = "(error)";
        }
    };
}

export function setupWebcam() {
    const image = document.getElementById("webcam");
    const timestamp = document.getElementById("webcam-timestamp");

    bindWebcamTimestamp(image, timestamp);
    setInterval(() => refreshWebcam(image), REFRESH_MS);
}

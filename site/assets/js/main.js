import { setupEvents } from "./events.js";
import { setupWeather } from "./weather.js";
import { setupWebcam } from "./webcam.js";

function revealJsDrivenSections() {
    document.querySelectorAll("[data-js-driven]").forEach((section) => {
        section.hidden = false;
    });
}

function init() {
    setupWebcam();

    setupWeather();
    setupEvents();
    revealJsDrivenSections();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}

import { setupEvents } from "./events.js";
import { setupWeather } from "./weather.js";
import { setupWebcam } from "./webcam.js";

function init() {
    setupWebcam();
    setupWeather();
    setupEvents();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}

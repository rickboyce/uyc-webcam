const OPEN_ZOOM = 2;
const MAX_ZOOM = 4;

function imagePoint(image, { x, y }) {
    const rect = image.getBoundingClientRect();
    return { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height };
}

export function setupWebcamViewer(image) {
    const frame = image.parentElement;
    const trigger = document.getElementById("webcam-open");
    const dialog = document.getElementById("webcam-viewer");
    const viewport = dialog.querySelector(".webcam-viewport");
    const zoomIn = document.getElementById("webcam-zoom-in");
    const zoomOut = document.getElementById("webcam-zoom-out");
    const readout = document.getElementById("webcam-scale");

    if (!dialog.showModal) return;

    let zoom = OPEN_ZOOM;
    const pointers = new Map();
    let gestureStart;
    let dismissOnRelease = false;

    function centre() {
        const rect = viewport.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    function setZoom(value) {
        zoom = Math.max(1, Math.min(MAX_ZOOM, value));
        const fit = Math.min(viewport.clientWidth / image.naturalWidth, viewport.clientHeight / image.naturalHeight);
        image.style.width = `${image.naturalWidth * fit * zoom}px`;
        readout.textContent = `${Number(zoom.toFixed(1))}×`;
        zoomIn.disabled = zoom >= MAX_ZOOM;
    }

    // Keep the same point on the lake under the fingers as their midpoint moves.
    function placePoint(point, target) {
        const rect = image.getBoundingClientRect();
        viewport.scrollBy(rect.left + point.x * rect.width - target.x, rect.top + point.y * rect.height - target.y);
    }

    function zoomAroundCentre(value) {
        const target = centre();
        const point = imagePoint(image, target);
        setZoom(value);
        placePoint(point, target);
    }

    const visibleArea = window.visualViewport;
    function fitDialogToScreen() {
        if (!visibleArea) return;
        dialog.style.left = `${visibleArea.offsetLeft}px`;
        dialog.style.top = `${visibleArea.offsetTop}px`;
        dialog.style.width = `${visibleArea.width}px`;
        dialog.style.height = `${visibleArea.height}px`;
    }

    trigger.addEventListener("click", (event) => {
        const point = event.detail && event.target === trigger
            ? imagePoint(image, { x: event.clientX, y: event.clientY })
            : { x: 0.5, y: 0.5 };
        // Reserve the inline image's space while the same refreshing image is in the dialog.
        frame.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
        // Place Close on screen before showModal focuses it on a pinch-zoomed page.
        fitDialogToScreen();
        dialog.showModal();
        visibleArea?.addEventListener("resize", fitDialogToScreen);
        visibleArea?.addEventListener("scroll", fitDialogToScreen);
        viewport.append(image);
        setZoom(OPEN_ZOOM);
        placePoint(point, centre());
    });

    document.getElementById("webcam-close").addEventListener("click", () => dialog.close());
    zoomIn.addEventListener("click", () => zoomAroundCentre(zoom * 2));
    zoomOut.addEventListener("click", () => {
        if (zoom <= 2) dialog.close();
        else zoomAroundCentre(zoom / 2);
    });

    dialog.addEventListener("close", () => {
        visibleArea?.removeEventListener("resize", fitDialogToScreen);
        visibleArea?.removeEventListener("scroll", fitDialogToScreen);
        pointers.clear();
        dismissOnRelease = false;
        frame.prepend(image);
        image.style.removeProperty("width");
        frame.style.removeProperty("aspect-ratio");
        trigger.focus({ preventScroll: true });
    });

    function gesture() {
        const [a, b] = pointers.values();
        if (!b) return { x: a.x, y: a.y, distance: 0 };
        return {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            distance: Math.hypot(a.x - b.x, a.y - b.y)
        };
    }

    function beginGesture() {
        const position = gesture();
        gestureStart = { point: imagePoint(image, position), distance: position.distance, zoom };
    }

    viewport.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || pointers.size >= 2) return;
        viewport.setPointerCapture(event.pointerId);
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        beginGesture();
    });

    viewport.addEventListener("pointermove", (event) => {
        if (!pointers.has(event.pointerId)) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const position = gesture();
        if (gestureStart.distance > 0) {
            setZoom(gestureStart.zoom * position.distance / gestureStart.distance);
            dismissOnRelease = zoom <= 1.02;
        }
        placePoint(gestureStart.point, position);
    });

    function endPointer(event) {
        if (!pointers.delete(event.pointerId)) return;
        if (event.type !== "pointerup") dismissOnRelease = false;
        if (pointers.size) beginGesture();
        else if (dismissOnRelease) dialog.close();
    }

    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
        viewport.addEventListener(name, endPointer);
    }

    function refit() {
        if (!dialog.open || !image.naturalWidth) return;
        zoomAroundCentre(zoom);
        if (pointers.size) beginGesture();
    }

    new ResizeObserver(refit).observe(viewport);
    image.addEventListener("load", () => {
        trigger.hidden = false;
        refit();
    });
    image.addEventListener("error", () => {
        trigger.hidden = true;
        if (dialog.open) dialog.close();
    });
}

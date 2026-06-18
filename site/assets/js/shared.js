export const USER_LOCALE = navigator.language || "en-GB";

export async function fetchJson(path) {
    const response = await fetch(path, { cache: "no-cache" });

    if (!response.ok) {
        throw new Error(`Fetch failed: ${path}`);
    }

    return response.json();
}

export function formatDateTime(date) {
    return date.toLocaleString(USER_LOCALE, {
        dateStyle: "medium",
        timeStyle: "medium"
    });
}

export function setTimestamp(element, value) {
    if (!value) {
        element.textContent = "(unknown)";
        return;
    }

    element.textContent = formatDateTime(new Date(value));
}

export function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function truncateText(value, maxLength) {
    if (!value || value.length <= maxLength) {
        return value || "";
    }

    return value.slice(0, maxLength - 1).trimEnd() + "\u2026";
}

export function parseDateOnly(dateText) {
    const [year, month, day] = dateText.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
}

export function subtractOneDay(date) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() - 1);
    return copy;
}

export function formatShortDate(date) {
    return date.toLocaleDateString(USER_LOCALE, {
        weekday: "short",
        day: "numeric",
        month: "short"
    });
}

export function nearestHour(date) {
    const rounded = new Date(date);
    rounded.setMinutes(0, 0, 0);

    if (date.getMinutes() >= 30) {
        rounded.setHours(rounded.getHours() + 1);
    }

    return rounded;
}

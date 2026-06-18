import {
    USER_LOCALE,
    escapeHtml,
    fetchJson,
    formatShortDate,
    parseDateOnly,
    setTimestamp,
    subtractOneDay,
    truncateText
} from "./shared.js";

const EVENTS_PATH = "/var/events7day.json";
const REFRESH_MS = 1_800_000;
const EVENT_CARD_CLASS = "card event-card";

function formatEventDateRange(event) {
    const start = event.all_day ? parseDateOnly(event.start) : new Date(event.start);

    if (!event.end) {
        return formatShortDate(start);
    }

    const end = event.all_day ? subtractOneDay(parseDateOnly(event.end)) : new Date(event.end);

    if (start.toDateString() === end.toDateString()) {
        return formatShortDate(start);
    }

    return `${formatShortDate(start)} \u2013 ${formatShortDate(end)}`;
}

function formatEventTime(event) {
    if (event.all_day) {
        return "All day";
    }

    const start = new Date(event.start);
    const startText = start.toLocaleTimeString(USER_LOCALE, {
        hour: "2-digit",
        minute: "2-digit"
    });

    if (!event.end) {
        return startText;
    }

    const end = new Date(event.end);
    const endText = end.toLocaleTimeString(USER_LOCALE, {
        hour: "2-digit",
        minute: "2-digit"
    });

    return `${startText}\u2013${endText}`;
}

function eventDateBadge(event) {
    const date = event.all_day ? parseDateOnly(event.start) : new Date(event.start);

    return {
        day: date.toLocaleDateString(USER_LOCALE, { weekday: "short" }),
        number: date.toLocaleDateString(USER_LOCALE, { day: "numeric" }),
        month: date.toLocaleDateString(USER_LOCALE, { month: "short" })
    };
}

function attachEventDescriptionToggle(card) {
    const descriptionToggle = card.querySelector(".event-description-toggle");

    if (!descriptionToggle) {
        return;
    }

    const renderDescription = expanded => {
        descriptionToggle.textContent = expanded ? descriptionToggle.dataset.full : descriptionToggle.dataset.short;

        const more = document.createElement("span");
        more.className = "event-description-more";
        more.textContent = expanded ? "Show less" : "Show more";
        descriptionToggle.appendChild(more);

        descriptionToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    };

    const toggleDescription = () => {
        renderDescription(descriptionToggle.getAttribute("aria-expanded") !== "true");
    };

    descriptionToggle.addEventListener("click", event => {
        event.stopPropagation();
        toggleDescription();
    });

    descriptionToggle.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleDescription();
        }
    });
}

function eventCardMarkup(event) {
    const badge = eventDateBadge(event);
    const fullDescription = event.description || "";
    const description = truncateText(fullDescription, 220);
    const isTruncatedDescription = fullDescription.length > description.length;
    const descriptionClass = isTruncatedDescription ? " event-description-toggle" : "";
    const descriptionAttrs = isTruncatedDescription
        ? ` role="button" tabindex="0" aria-expanded="false" data-short="${escapeHtml(description)}" data-full="${escapeHtml(fullDescription)}"`
        : "";
    const descriptionMore = isTruncatedDescription
        ? `<span class="event-description-more">Show more</span>`
        : "";

    return `
        <div class="event-when" aria-label="${escapeHtml(formatEventDateRange(event))}">
            <div class="date-badge event-date" aria-hidden="true">
                <span class="date-badge-part event-date-day">${escapeHtml(badge.day)}</span>
                <span class="date-badge-number event-date-number">${escapeHtml(badge.number)}</span>
                <span class="date-badge-part event-date-month">${escapeHtml(badge.month)}</span>
            </div>
        </div>
        <div class="event-content">
            <h3 class="event-title"><span class="event-title-text">${escapeHtml(event.title || "Untitled event")}</span> <span class="event-time">${escapeHtml(formatEventTime(event))}</span></h3>
            ${fullDescription ? `<div class="event-description${descriptionClass}"${descriptionAttrs}>${escapeHtml(description)}${descriptionMore}</div>` : ""}
        </div>
    `;
}

function renderEvents(list, data) {
    list.innerHTML = "";

    if (!data.events || data.events.length === 0) {
        list.innerHTML = `<div class="${EVENT_CARD_CLASS}">No public events listed for the next 7 days.</div>`;
        return;
    }

    data.events.forEach(event => {
        const card = document.createElement("article");
        card.className = EVENT_CARD_CLASS;
        card.innerHTML = eventCardMarkup(event);
        attachEventDescriptionToggle(card);
        list.appendChild(card);
    });
}

async function refreshEvents(list, timestamp) {
    try {
        const data = await fetchJson(EVENTS_PATH);
        renderEvents(list, data);
        setTimestamp(timestamp, data.updated_at);
    } catch {
        list.innerHTML = `<div class="${EVENT_CARD_CLASS}">Events unavailable</div>`;
        timestamp.textContent = "(error)";
    }
}

export function setupEvents() {
    const list = document.getElementById("events-list");
    const timestamp = document.getElementById("events-timestamp");

    refreshEvents(list, timestamp);
    setInterval(() => refreshEvents(list, timestamp), REFRESH_MS);
}

import { isAccessRequestAuthorized } from "../../shared/access-auth.ts";

const CALENDAR_URL =
  "https://ullswateryachtclub.org/feeds/058aba17-c338-480a-b7e7-396cb2a081a7.ics";

const LOCAL_TZ = "Europe/London";
const UTC_TZ = "UTC";
const LOOKAHEAD_DAYS = 7;
const EVENTS_OBJECT_KEY_DEFAULT = "var/events7day.json";
const EVENTS_WORKER_PATH = "events-worker";

// The UYC feed currently marks at least one cancelled event only in SUMMARY,
// rather than with STATUS:CANCELLED. Keep this configurable in case the title
// check ever becomes too broad.
const FILTER_CANCELLED_EVENTS_BY_TITLE = true;

const TZID_ALIASES: Record<string, string> = {
  "GMT Standard Time": "Europe/London"
};

type Env = {
  UYC_BUCKET: R2Bucket;
  ENVIRONMENT: "prod" | "test" | "local";
  EVENTS_OBJECT_KEY?: string;
  CACHE_PURGE_URL?: string;
  CLOUDFLARE_ZONE_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  ACCESS_AUD?: string;
  ACCESS_JWKS_URL?: string;
};

type IcsParams = Record<string, string>;

type EventRecord = {
  title?: string;
  start?: string;
  end?: string;
  all_day?: boolean;
  location?: string;
  description?: string;
  url?: string;
  uid?: string;
  status?: string;

  multi_day?: boolean;
  occurrence_date?: string;
  original_start?: string;
  original_end?: string;

  event_group_id?: string;
  event_instance_id?: string;
};

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[${env.ENVIRONMENT}] Events refresh triggered by cron: ${event.cron}`);
    ctx.waitUntil(updateEvents(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (isEventsObjectPath(url.pathname, env)) {
      return handleEventsObjectRead(env);
    }

    if (isManualRefreshPath(url.pathname, env)) {
      return handleManualRefresh(request, env);
    }

    return Response.json({
      ok: true,
      service: "uyc-webcam-events-refresh",
      environment: env.ENVIRONMENT
    });
  }
};

function eventsObjectKey(env: Env): string {
  return env.EVENTS_OBJECT_KEY || EVENTS_OBJECT_KEY_DEFAULT;
}

function isEventsObjectPath(pathname: string, env: Env): boolean {
  const objectPath = `/${eventsObjectKey(env)}`;

  return pathname === objectPath || pathname === `/${env.ENVIRONMENT}/${EVENTS_WORKER_PATH}${objectPath}`;
}

function isManualRefreshPath(pathname: string, env: Env): boolean {
  return (
    pathname === "/refresh" ||
    pathname === `/${env.ENVIRONMENT}/${EVENTS_WORKER_PATH}/refresh`
  );
}

async function handleManualRefresh(request: Request, env: Env): Promise<Response> {
  if (env.ENVIRONMENT !== "local" && !(await isAccessRequestAuthorized(request, env))) {
    return Response.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  await updateEvents(env);

  return Response.json({
    ok: true,
    environment: env.ENVIRONMENT,
    refreshed_at: toIsoZ(new Date())
  });
}

async function handleEventsObjectRead(env: Env): Promise<Response> {
  const objectKey = eventsObjectKey(env);
  const object = await env.UYC_BUCKET.get(objectKey);

  if (!object) {
    return Response.json(
      { ok: false, error: `Events object not found: ${objectKey}` },
      { status: 404 }
    );
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "no-store");

  return new Response(object.body, {
    headers
  });
}

async function updateEvents(env: Env): Promise<void> {
  const response = await fetch(CALENDAR_URL, {
    headers: {
      "User-Agent": "uyc-webcam-events/1.0",
      "Accept": "text/calendar,*/*"
    }
  });

  if (!response.ok) {
    throw new Error(`Calendar fetch failed: ${response.status} ${response.statusText}`);
  }

  const icsText = await response.text();
  const output = convertIcsTextToJson(icsText, CALENDAR_URL);

  const objectKey = eventsObjectKey(env);

  await env.UYC_BUCKET.put(
    objectKey,
    JSON.stringify(output, null, 2) + "\n",
    {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl: "public, max-age=60"
      }
    }
  );

  await purgeCloudflareCache(env);

  console.log(
    `[${env.ENVIRONMENT}] Updated ${objectKey} with ${output.events.length} event entries`
  );
}

async function purgeCloudflareCache(env: Env): Promise<void> {
  if (!env.CACHE_PURGE_URL || !env.CLOUDFLARE_ZONE_ID || !env.CLOUDFLARE_API_TOKEN) {
    console.log(`[${env.ENVIRONMENT}] Cloudflare cache purge skipped: missing configuration`);
    return;
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        files: [env.CACHE_PURGE_URL]
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Cloudflare cache purge failed: ${response.status} ${response.statusText}`);
  }

  console.log(`[${env.ENVIRONMENT}] Purged Cloudflare cache for ${env.CACHE_PURGE_URL}`);
}

export function convertIcsTextToJson(
  icsText: string,
  sourceUrl: string,
  now = new Date()
) {
  const lines = unfoldIcsLines(icsText);

  const nowLocalParts = getDatePartsInTimeZone(now, LOCAL_TZ);

  const windowStart = zonedDateTimeToUtc(
    nowLocalParts.year,
    nowLocalParts.month,
    nowLocalParts.day,
    0,
    0,
    0,
    LOCAL_TZ
  );

  const windowEndParts = addDaysToDateParts(
    nowLocalParts.year,
    nowLocalParts.month,
    nowLocalParts.day,
    LOOKAHEAD_DAYS + 1
  );

  const windowEnd = zonedDateTimeToUtc(
    windowEndParts.year,
    windowEndParts.month,
    windowEndParts.day,
    0,
    0,
    0,
    LOCAL_TZ
  );

  const events: EventRecord[] = [];
  let currentEvent: EventRecord | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      currentEvent = {};
      continue;
    }

    if (line === "END:VEVENT") {
      if (currentEvent !== null) {
        if (
          !isCancelledEvent(currentEvent) &&
          eventOverlapsWindow(currentEvent, windowStart, windowEnd)
        ) {
          events.push(...expandEventAcrossDays(currentEvent, windowStart, windowEnd));
        }
      }

      currentEvent = null;
      continue;
    }

    if (currentEvent === null) {
      continue;
    }

    const [name, params, value] = splitIcsProperty(line);

    if (name === "SUMMARY") {
      currentEvent.title = cleanIcsText(value);
    } else if (name === "DTSTART") {
      const parsed = parseIcsDateTime(value, params);
      currentEvent.start = parsed.value;
      currentEvent.all_day = parsed.allDay;
    } else if (name === "DTEND") {
      const parsed = parseIcsDateTime(value, params);
      currentEvent.end = parsed.value;
    } else if (name === "LOCATION") {
      currentEvent.location = cleanIcsText(value);
    } else if (name === "DESCRIPTION") {
      currentEvent.description = cleanIcsText(value, true);
    } else if (name === "URL") {
      currentEvent.url = value;
    } else if (name === "UID") {
      currentEvent.uid = value;
    } else if (name === "STATUS") {
      currentEvent.status = value;
    }
  }

  events.sort((a, b) => {
    const startComparison = (a.start || "").localeCompare(b.start || "");

    if (startComparison !== 0) {
      return startComparison;
    }

    return (a.title || "").localeCompare(b.title || "");
  });

  return {
    schema_version: 1,
    updated_at: toIsoZ(now),
    source_url: sourceUrl,
    timezone: UTC_TZ,
    floating_time_assumption: LOCAL_TZ,
    lookahead_days: LOOKAHEAD_DAYS,
    window_start: toIsoZ(windowStart),
    window_end: toIsoZ(windowEnd),
    events
  };
}

function isCancelledEvent(event: EventRecord): boolean {
  const status = (event.status || "").toUpperCase();

  if (status === "CANCELLED") {
    return true;
  }

  if (!FILTER_CANCELLED_EVENTS_BY_TITLE) {
    return false;
  }

  const title = event.title || "";
  return /\bCANCELLED\b/i.test(title);
}

function unfoldIcsLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const unfolded: string[] = [];

  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }

  return unfolded;
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\N/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function cleanIcsText(value: string, polishSpacing = false): string {
  let cleaned = unescapeIcsText(value);
  cleaned = decodeHtmlEntities(cleaned);
  cleaned = cleaned.replace(/[\t\r\n]+/g, " ");

  if (polishSpacing) {
    cleaned = cleaned.replace(/(?<=[a-z])(?=[A-Z])/g, " ");
    cleaned = cleaned.replace(/(?<=[.!?])(?=[A-Za-z])/g, " ");
    cleaned = cleaned.replace(/(?<=[,;])(?=\S)/g, " ");
  }

  cleaned = cleaned.replace(/\s{2,}/g, " ");
  return cleaned.trim();
}

function decodeHtmlEntities(value: string): string {
  // Calendar text is displayed as plain text, not trusted HTML.
  // Decode only the common presentation entities we expect from the UYC feed,
  // and deliberately avoid producing HTML-significant characters such as
  // <, >, quotes or ampersands from numeric entities. This prevents inputs such
  // as &amp;lt; or &#38;lt; from being decoded twice into real markup.
  return value
    .replace(/&#(\d+);/g, (match, code) => {
      return decodeSafeNumericHtmlEntity(match, Number(code));
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => {
      return decodeSafeNumericHtmlEntity(match, parseInt(code, 16));
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&rsquo;/gi, "’")
    .replace(/&lsquo;/gi, "‘")
    .replace(/&rdquo;/gi, "”")
    .replace(/&ldquo;/gi, "“")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&amp;/gi, "&");
}

function decodeSafeNumericHtmlEntity(original: string, codePoint: number): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return original;
  }

  const decoded = String.fromCodePoint(codePoint);

  return isHtmlSignificantCharacter(decoded) ? original : decoded;
}

function isHtmlSignificantCharacter(value: string): boolean {
  return value === "&" || value === "<" || value === ">" || value === '"' || value === "'";
}

function splitIcsProperty(line: string): [string | null, IcsParams, string] {
  const colonIndex = line.indexOf(":");

  if (colonIndex === -1) {
    return [null, {}, ""];
  }

  const left = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1);

  const parts = left.split(";");
  const name = parts[0].toUpperCase();
  const params: IcsParams = {};

  for (const param of parts.slice(1)) {
    const equalsIndex = param.indexOf("=");

    if (equalsIndex !== -1) {
      const key = param.slice(0, equalsIndex).toUpperCase();
      const paramValue = param.slice(equalsIndex + 1);
      params[key] = paramValue;
    }
  }

  return [name, params, value];
}

function timezoneFromParams(params: IcsParams): string {
  let tzid = params["TZID"];

  if (!tzid) {
    return LOCAL_TZ;
  }

  tzid = tzid.replace(/^"|"$/g, "");
  return TZID_ALIASES[tzid] || tzid;
}

function parseIcsDateTime(
  value: string,
  params: IcsParams
): { value: string; allDay: boolean } {
  const isAllDay = /^\d{8}$/.test(value);

  if (isAllDay) {
    return {
      value: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`,
      allDay: true
    };
  }

  const match = /^(\d{8})T(\d{6})(Z?)$/.exec(value);

  if (!match) {
    return { value, allDay: false };
  }

  const [, datePart, timePart, isUtc] = match;

  const year = Number(datePart.slice(0, 4));
  const month = Number(datePart.slice(4, 6));
  const day = Number(datePart.slice(6, 8));
  const hour = Number(timePart.slice(0, 2));
  const minute = Number(timePart.slice(2, 4));
  const second = Number(timePart.slice(4, 6));

  const date = isUtc
    ? new Date(Date.UTC(year, month - 1, day, hour, minute, second))
    : zonedDateTimeToUtc(
        year,
        month,
        day,
        hour,
        minute,
        second,
        timezoneFromParams(params)
      );

  return {
    value: toIsoZ(date),
    allDay: false
  };
}

function parseEventDateTime(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  if (value.endsWith("Z")) {
    return new Date(value);
  }

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;

    return zonedDateTimeToUtc(
      Number(year),
      Number(month),
      Number(day),
      0,
      0,
      0,
      LOCAL_TZ
    );
  }

  const localDateTimeMatch =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);

  if (localDateTimeMatch) {
    const [, year, month, day, hour, minute, second] = localDateTimeMatch;

    return zonedDateTimeToUtc(
      Number(year),
      Number(month),
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      LOCAL_TZ
    );
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function eventOverlapsWindow(
  event: EventRecord,
  windowStart: Date,
  windowEnd: Date
): boolean {
  const start = parseEventDateTime(event.start);

  if (!start) {
    return false;
  }

  let end = parseEventDateTime(event.end);

  if (event.all_day) {
    if (!end) {
      end = addLocalDaysToUtc(start, 1);
    }
  } else if (!end) {
    end = start;
  }

  return start < windowEnd && end > windowStart;
}

function expandEventAcrossDays(
  event: EventRecord,
  windowStart: Date,
  windowEnd: Date
): EventRecord[] {
  const start = parseEventDateTime(event.start);

  if (!start) {
    return [];
  }

  let end = parseEventDateTime(event.end);

  if (event.all_day) {
    if (!end) {
      end = addLocalDaysToUtc(start, 1);
    }
  } else if (!end) {
    end = start;
  }

  if (end <= start) {
    end = new Date(start.getTime() + 1);
  }

  if (!(start < windowEnd && end > windowStart)) {
    return [];
  }

  const effectiveStart = maxDate(start, windowStart);
  const effectiveEnd = minDate(end, windowEnd);

  // DTEND is exclusive, so the last displayed day is determined from the instant
  // immediately before the effective end.
  const lastInstant = new Date(effectiveEnd.getTime() - 1);

  const firstDay = localDateKey(effectiveStart);
  const lastDay = localDateKey(lastInstant);
  const days = enumerateLocalDates(firstDay, lastDay);

  const originalStart = event.start;
  const originalEnd = event.end;
  const isMultiDay = days.length > 1;

  const baseEventForId: EventRecord = {
    ...event,
    original_start: originalStart,
    original_end: originalEnd
  };

  const eventGroupId = getEventGroupId(baseEventForId);

  return days.map((day) => {
    const nextDay = addDaysToDateString(day, 1);

    const dayStart = localDateStringToUtc(day);
    const dayEnd = localDateStringToUtc(nextDay);

    const segmentStart = maxDate(start, dayStart, windowStart);
    const segmentEnd = minDate(end, dayEnd, windowEnd);

    const expanded: EventRecord = {
      ...event,
      multi_day: isMultiDay,
      occurrence_date: day,
      original_start: originalStart,
      original_end: originalEnd,
      event_group_id: eventGroupId,
      event_instance_id: `${eventGroupId}:${day}`
    };

    if (event.all_day) {
      expanded.start = day;
      expanded.end = nextDay;
      expanded.all_day = true;
    } else {
      expanded.start = toIsoZ(segmentStart);
      expanded.end = toIsoZ(segmentEnd);
      expanded.all_day = false;
    }

    return expanded;
  });
}

function getEventGroupId(event: EventRecord): string {
  if (event.uid) {
    return event.uid;
  }

  return stableId(
    [
      event.title || "",
      event.original_start || event.start || "",
      event.original_end || event.end || "",
      event.location || ""
    ].join("|")
  );
}

function stableId(value: string): string {
  let hash = 2166136261;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return `evt_${(hash >>> 0).toString(36)}`;
}

function localDateKey(date: Date): string {
  const parts = getDatePartsInTimeZone(date, LOCAL_TZ);
  return datePartsToDateString(parts.year, parts.month, parts.day);
}

function datePartsToDateString(year: number, month: number, day: number): string {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

function parseDateStringParts(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    throw new Error(`Invalid date string: ${value}`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function addDaysToDateString(value: string, days: number): string {
  const parts = parseDateStringParts(value);
  const result = addDaysToDateParts(parts.year, parts.month, parts.day, days);

  return datePartsToDateString(result.year, result.month, result.day);
}

function localDateStringToUtc(value: string): Date {
  const parts = parseDateStringParts(value);

  return zonedDateTimeToUtc(
    parts.year,
    parts.month,
    parts.day,
    0,
    0,
    0,
    LOCAL_TZ
  );
}

function enumerateLocalDates(firstDay: string, lastDay: string): string[] {
  const dates: string[] = [];

  let current = firstDay;

  while (current <= lastDay) {
    dates.push(current);
    current = addDaysToDateString(current, 1);
  }

  return dates;
}

function addLocalDaysToUtc(date: Date, days: number): Date {
  const parts = getDatePartsInTimeZone(date, LOCAL_TZ);
  const target = addDaysToDateParts(parts.year, parts.month, parts.day, days);

  return zonedDateTimeToUtc(
    target.year,
    target.month,
    target.day,
    parts.hour,
    parts.minute,
    parts.second,
    LOCAL_TZ
  );
}

function getDatePartsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    second: Number(lookup.second)
  };
}

function getTimeZoneOffsetMs(timeZone: string, date: Date): number {
  const parts = getDatePartsInTimeZone(date, timeZone);

  const utcFromParts = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return utcFromParts - date.getTime();
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  let offset = getTimeZoneOffsetMs(timeZone, utcGuess);
  let utc = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) - offset
  );

  offset = getTimeZoneOffsetMs(timeZone, utc);

  utc = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) - offset
  );

  return utc;
}

function addDaysToDateParts(
  year: number,
  month: number,
  day: number,
  days: number
) {
  const date = new Date(Date.UTC(year, month - 1, day + days));

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function minDate(...dates: Date[]): Date {
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

function maxDate(...dates: Date[]): Date {
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function toIsoZ(date: Date): string {
  return date.toISOString().replace(".000Z", "Z");
}

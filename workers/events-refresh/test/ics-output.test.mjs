import assert from "node:assert/strict";
import test from "node:test";

import { convertIcsTextToJson } from "../src/index.ts";

const SOURCE_URL = "https://example.test/calendar.ics";

// Fixed during British Summer Time so tests cover the UYC site's normal
// summer-season path: Europe/London local time is UTC+1.
const SUMMER_NOW = new Date("2026-06-18T10:00:00Z");

// Fixed during winter so tests also cover GMT/UTC equivalence.
const WINTER_NOW = new Date("2026-01-10T10:00:00Z");

function calendar(...events) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//UYC Webcam Tests//EN",
    ...events,
    "END:VCALENDAR",
    ""
  ].join("\r\n");
}

function event(...lines) {
  return [
    "BEGIN:VEVENT",
    ...lines,
    "END:VEVENT"
  ];
}

function convert(events, now = SUMMER_NOW) {
  return convertIcsTextToJson(calendar(...events), SOURCE_URL, now);
}

function eventSummaries(output) {
  return output.events.map((entry) => ({
    uid: entry.uid,
    title: entry.title,
    start: entry.start,
    end: entry.end,
    all_day: entry.all_day,
    multi_day: entry.multi_day,
    occurrence_date: entry.occurrence_date,
    original_start: entry.original_start,
    original_end: entry.original_end,
    event_group_id: entry.event_group_id,
    event_instance_id: entry.event_instance_id
  }));
}

test("sets stable output metadata and the local seven-day window", () => {
  // This protects the public JSON contract consumed by the static site:
  // timestamps are UTC, the window is based on Europe/London local midnight,
  // and metadata names stay stable if the parser implementation changes.
  const output = convert([
    ...event(
      "UID:metadata-1",
      "SUMMARY:Metadata Event",
      "DTSTART;TZID=GMT Standard Time:20260618T183000",
      "DTEND;TZID=GMT Standard Time:20260618T203000"
    )
  ]);

  assert.equal(output.schema_version, 1);
  assert.equal(output.updated_at, "2026-06-18T10:00:00Z");
  assert.equal(output.source_url, SOURCE_URL);
  assert.equal(output.timezone, "UTC");
  assert.equal(output.floating_time_assumption, "Europe/London");
  assert.equal(output.lookahead_days, 7);
  assert.equal(output.window_start, "2026-06-17T23:00:00Z");
  assert.equal(output.window_end, "2026-06-25T23:00:00Z");
});

test("converts a normal timed UYC event into one JSON entry", () => {
  // Timed events from the UYC feed usually include a Microsoft timezone name.
  // The output should normalize that local time to UTC and preserve the useful
  // fields the website may display later.
  const output = convert([
    ...event(
      "UID:race-1",
      "SUMMARY:Evening Race",
      "DTSTART;TZID=GMT Standard Time:20260618T183000",
      "DTEND;TZID=GMT Standard Time:20260618T203000",
      "LOCATION:Ullswater Yacht Club",
      "DESCRIPTION:Briefing\\nFirst start at 18:30 &rsquo;sharp&rsquo;",
      "URL:https://example.test/events/race-1"
    )
  ]);

  assert.deepEqual(output.events, [
    {
      title: "Evening Race",
      start: "2026-06-18T17:30:00Z",
      end: "2026-06-18T19:30:00Z",
      all_day: false,
      location: "Ullswater Yacht Club",
      description: "Briefing First start at 18:30 ’sharp’",
      url: "https://example.test/events/race-1",
      uid: "race-1",
      multi_day: false,
      occurrence_date: "2026-06-18",
      original_start: "2026-06-18T17:30:00Z",
      original_end: "2026-06-18T19:30:00Z",
      event_group_id: "race-1",
      event_instance_id: "race-1:2026-06-18"
    }
  ]);
});

test("treats floating date-times as Europe/London local time", () => {
  // Some ICS feeds omit TZID and Z suffixes. Within this project's scope we
  // assume those floating times are local club times.
  const output = convert([
    ...event(
      "UID:floating-1",
      "SUMMARY:Floating Time",
      "DTSTART:20260619T120000",
      "DTEND:20260619T130000"
    )
  ]);

  assert.deepEqual(eventSummaries(output), [
    {
      uid: "floating-1",
      title: "Floating Time",
      start: "2026-06-19T11:00:00Z",
      end: "2026-06-19T12:00:00Z",
      all_day: false,
      multi_day: false,
      occurrence_date: "2026-06-19",
      original_start: "2026-06-19T11:00:00Z",
      original_end: "2026-06-19T12:00:00Z",
      event_group_id: "floating-1",
      event_instance_id: "floating-1:2026-06-19"
    }
  ]);
});

test("preserves UTC date-times marked with Z", () => {
  // If a source ever emits UTC timestamps directly, the converter should not
  // reinterpret them as local time.
  const output = convert([
    ...event(
      "UID:utc-1",
      "SUMMARY:UTC Event",
      "DTSTART:20260619T120000Z",
      "DTEND:20260619T130000Z"
    )
  ]);

  assert.equal(output.events[0].start, "2026-06-19T12:00:00Z");
  assert.equal(output.events[0].end, "2026-06-19T13:00:00Z");
});

test("converts winter local timed events without a DST offset", () => {
  // Europe/London is UTC in winter. This guards the timezone conversion logic
  // on the other side of the daylight-saving boundary.
  const output = convert(
    [
      ...event(
        "UID:winter-1",
        "SUMMARY:Winter Working Party",
        "DTSTART;TZID=GMT Standard Time:20260112T100000",
        "DTEND;TZID=GMT Standard Time:20260112T120000"
      )
    ],
    WINTER_NOW
  );

  assert.equal(output.window_start, "2026-01-10T00:00:00Z");
  assert.equal(output.events[0].start, "2026-01-12T10:00:00Z");
  assert.equal(output.events[0].end, "2026-01-12T12:00:00Z");
});

test("creates a one-day all-day entry when DTEND is omitted", () => {
  // All-day events often use an exclusive DTEND, but if the feed omits it we
  // still want a useful one-day event rather than dropping it.
  const output = convert([
    ...event(
      "UID:all-day-no-end",
      "SUMMARY:Club Closed",
      "DTSTART;VALUE=DATE:20260620"
    )
  ]);

  assert.deepEqual(eventSummaries(output), [
    {
      uid: "all-day-no-end",
      title: "Club Closed",
      start: "2026-06-20",
      end: "2026-06-21",
      all_day: true,
      multi_day: false,
      occurrence_date: "2026-06-20",
      original_start: "2026-06-20",
      original_end: undefined,
      event_group_id: "all-day-no-end",
      event_instance_id: "all-day-no-end:2026-06-20"
    }
  ]);
});

test("expands all-day multi-day events into daily JSON entries", () => {
  // ICS all-day DTEND is exclusive. A 20-23 June event represents 20, 21 and
  // 22 June, and the site wants one display card per day.
  const output = convert([
    ...event(
      "UID:camp-1",
      "SUMMARY:Junior Camp",
      "DTSTART;VALUE=DATE:20260620",
      "DTEND;VALUE=DATE:20260623"
    )
  ]);

  assert.deepEqual(eventSummaries(output), [
    {
      uid: "camp-1",
      title: "Junior Camp",
      start: "2026-06-20",
      end: "2026-06-21",
      all_day: true,
      multi_day: true,
      occurrence_date: "2026-06-20",
      original_start: "2026-06-20",
      original_end: "2026-06-23",
      event_group_id: "camp-1",
      event_instance_id: "camp-1:2026-06-20"
    },
    {
      uid: "camp-1",
      title: "Junior Camp",
      start: "2026-06-21",
      end: "2026-06-22",
      all_day: true,
      multi_day: true,
      occurrence_date: "2026-06-21",
      original_start: "2026-06-20",
      original_end: "2026-06-23",
      event_group_id: "camp-1",
      event_instance_id: "camp-1:2026-06-21"
    },
    {
      uid: "camp-1",
      title: "Junior Camp",
      start: "2026-06-22",
      end: "2026-06-23",
      all_day: true,
      multi_day: true,
      occurrence_date: "2026-06-22",
      original_start: "2026-06-20",
      original_end: "2026-06-23",
      event_group_id: "camp-1",
      event_instance_id: "camp-1:2026-06-22"
    }
  ]);
});

test("expands timed events that cross midnight into local-day segments", () => {
  // UYC may not use timed overnight events today, but they are conceivable for
  // cruises, socials or maintenance. They should remain timed events, not become
  // all-day events, and should split into one entry per local date.
  const output = convert([
    ...event(
      "UID:overnight-1",
      "SUMMARY:Night Cruise",
      "DTSTART;TZID=GMT Standard Time:20260621T230000",
      "DTEND;TZID=GMT Standard Time:20260622T010000"
    )
  ]);

  assert.deepEqual(eventSummaries(output), [
    {
      uid: "overnight-1",
      title: "Night Cruise",
      start: "2026-06-21T22:00:00Z",
      end: "2026-06-21T23:00:00Z",
      all_day: false,
      multi_day: true,
      occurrence_date: "2026-06-21",
      original_start: "2026-06-21T22:00:00Z",
      original_end: "2026-06-22T00:00:00Z",
      event_group_id: "overnight-1",
      event_instance_id: "overnight-1:2026-06-21"
    },
    {
      uid: "overnight-1",
      title: "Night Cruise",
      start: "2026-06-21T23:00:00Z",
      end: "2026-06-22T00:00:00Z",
      all_day: false,
      multi_day: true,
      occurrence_date: "2026-06-22",
      original_start: "2026-06-21T22:00:00Z",
      original_end: "2026-06-22T00:00:00Z",
      event_group_id: "overnight-1",
      event_instance_id: "overnight-1:2026-06-22"
    }
  ]);
});

test("keeps a timed event with no DTEND as a tiny timed event", () => {
  // The frontend can still show the start time. The converter gives it a tiny
  // internal end instant so it overlaps the window. This documents that current
  // output rather than implying the feed supplied a real duration.
  const output = convert([
    ...event(
      "UID:timed-no-end",
      "SUMMARY:Brief Notice",
      "DTSTART;TZID=GMT Standard Time:20260619T090000"
    )
  ]);

  assert.deepEqual(eventSummaries(output), [
    {
      uid: "timed-no-end",
      title: "Brief Notice",
      start: "2026-06-19T08:00:00Z",
      end: "2026-06-19T08:00:00.001Z",
      all_day: false,
      multi_day: false,
      occurrence_date: "2026-06-19",
      original_start: "2026-06-19T08:00:00Z",
      original_end: undefined,
      event_group_id: "timed-no-end",
      event_instance_id: "timed-no-end:2026-06-19"
    }
  ]);
});

test("includes events that overlap the local window boundaries", () => {
  // The worker publishes a rolling local-date window. Events should be included
  // if any part overlaps the window, and excluded if they end exactly at the
  // start or begin exactly at the end.
  const output = convert([
    ...event(
      "UID:ends-at-window-start",
      "SUMMARY:Too Early",
      "DTSTART;TZID=GMT Standard Time:20260617T220000",
      "DTEND;TZID=GMT Standard Time:20260618T000000"
    ),
    ...event(
      "UID:overlaps-start",
      "SUMMARY:Starts Before Window",
      "DTSTART;TZID=GMT Standard Time:20260617T230000",
      "DTEND;TZID=GMT Standard Time:20260618T010000"
    ),
    ...event(
      "UID:overlaps-end",
      "SUMMARY:Ends After Window",
      "DTSTART;TZID=GMT Standard Time:20260625T230000",
      "DTEND;TZID=GMT Standard Time:20260626T010000"
    ),
    ...event(
      "UID:starts-at-window-end",
      "SUMMARY:Too Late",
      "DTSTART;TZID=GMT Standard Time:20260626T000000",
      "DTEND;TZID=GMT Standard Time:20260626T010000"
    )
  ]);

  assert.deepEqual(
    output.events.map((entry) => ({
      uid: entry.uid,
      start: entry.start,
      end: entry.end,
      occurrence_date: entry.occurrence_date
    })),
    [
      {
        uid: "overlaps-start",
        start: "2026-06-17T23:00:00Z",
        end: "2026-06-18T00:00:00Z",
        occurrence_date: "2026-06-18"
      },
      {
        uid: "overlaps-end",
        start: "2026-06-25T22:00:00Z",
        end: "2026-06-25T23:00:00Z",
        occurrence_date: "2026-06-25"
      }
    ]
  );
});

test("sorts output by start time and then title", () => {
  // The static site assumes events are already in display order.
  const output = convert([
    ...event(
      "UID:b",
      "SUMMARY:Beta",
      "DTSTART;TZID=GMT Standard Time:20260619T100000",
      "DTEND;TZID=GMT Standard Time:20260619T110000"
    ),
    ...event(
      "UID:a",
      "SUMMARY:Alpha",
      "DTSTART;TZID=GMT Standard Time:20260619T100000",
      "DTEND;TZID=GMT Standard Time:20260619T110000"
    ),
    ...event(
      "UID:earlier",
      "SUMMARY:Later Title",
      "DTSTART;TZID=GMT Standard Time:20260619T090000",
      "DTEND;TZID=GMT Standard Time:20260619T100000"
    )
  ]);

  assert.deepEqual(output.events.map((entry) => entry.title), [
    "Later Title",
    "Alpha",
    "Beta"
  ]);
});

test("filters cancelled events by status and title", () => {
  // The UYC feed has used title-only cancellation text, so both formal ICS
  // cancellation and title cancellation are part of our current contract.
  const output = convert([
    ...event(
      "UID:keep-1",
      "SUMMARY:Open Sailing",
      "DTSTART;TZID=GMT Standard Time:20260619T120000",
      "DTEND;TZID=GMT Standard Time:20260619T140000"
    ),
    ...event(
      "UID:cancelled-status",
      "SUMMARY:Cancelled by status",
      "STATUS:CANCELLED",
      "DTSTART;TZID=GMT Standard Time:20260619T150000",
      "DTEND;TZID=GMT Standard Time:20260619T160000"
    ),
    ...event(
      "UID:cancelled-title",
      "SUMMARY:CANCELLED Training",
      "DTSTART;TZID=GMT Standard Time:20260619T170000",
      "DTEND;TZID=GMT Standard Time:20260619T180000"
    )
  ]);

  assert.deepEqual(output.events.map((entry) => entry.uid), ["keep-1"]);
});

test("cleans folded ICS text, escaped text and expected presentation entities", () => {
  // This covers the feed-polishing behaviour the frontend relies on: folded
  // lines are joined, ICS text escapes are decoded, simple HTML presentation
  // entities are normalized, and cramped prose is spaced out.
  const output = convert([
    ...event(
      "UID:text-1",
      "SUMMARY:Race\\, Training\\; and Social",
      "DTSTART;TZID=GMT Standard Time:20260619T120000",
      "DTEND;TZID=GMT Standard Time:20260619T130000",
      "DESCRIPTION:First line\\nSecond line.More text,Next bit",
      " continuing here &nbsp; &ndash; &amp; details &rsquo;ok&rsquo;"
    )
  ]);

  assert.equal(output.events[0].title, "Race, Training; and Social");
  assert.equal(
    output.events[0].description,
    "First line Second line. More text, Next bitcontinuing here – & details ’ok’"
  );
});

test("does not decode numeric entities into HTML-significant characters", () => {
  // Calendar text is later displayed as text. Avoid turning numeric entities
  // into markup-significant characters before the frontend handles the string.
  const output = convert([
    ...event(
      "UID:safe-entities",
      "SUMMARY:Safe Entities",
      "DTSTART;TZID=GMT Standard Time:20260619T120000",
      "DTEND;TZID=GMT Standard Time:20260619T130000",
      "DESCRIPTION:Keep &#60;script&#62; and &#38;lt; escaped, decode &#8217;"
    )
  ]);

  const description = output.events[0].description;

  assert.match(description, /&#60;\s*script&#62;/);
  assert.match(description, /&#38;\s*lt;/);
  assert.ok(!description.includes("<script>"));
  assert.ok(!description.includes("&lt;"));
  assert.ok(description.endsWith("decode ’"));
});

#!/usr/bin/env python3

import html
import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

LOCAL_TZ = ZoneInfo("Europe/London")
UTC = timezone.utc

TZID_ALIASES = {
    "GMT Standard Time": "Europe/London",
}

LOOKAHEAD_DAYS = 7


def unfold_ics_lines(text):
    lines = text.splitlines()
    unfolded = []

    for line in lines:
        if line.startswith((" ", "\t")) and unfolded:
            unfolded[-1] += line[1:]
        else:
            unfolded.append(line)

    return unfolded


def unescape_ics_text(value):
    return (
        value
        .replace("\\n", "\n")
        .replace("\\N", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
    )


def clean_ics_text(value, polish_spacing=False):
    value = unescape_ics_text(value)
    value = html.unescape(value)
    value = re.sub(r"[\t\r\n]+", " ", value)

    if polish_spacing:
        # The source descriptions sometimes use line/table breaks without a
        # real separating space, leaving strings such as "SeriesTwo" or
        # "cruisers.Briefing" after whitespace normalisation.
        value = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", value)
        value = re.sub(r"(?<=[.!?])(?=[A-Za-z])", " ", value)
        value = re.sub(r"(?<=[,;])(?=\S)", " ", value)

    value = re.sub(r"\s{2,}", " ", value)
    return value.strip()


def split_ics_property(line):
    if ":" not in line:
        return None, {}, ""

    left, value = line.split(":", 1)
    parts = left.split(";")
    name = parts[0].upper()
    params = {}

    for param in parts[1:]:
        if "=" in param:
            key, param_value = param.split("=", 1)
            params[key.upper()] = param_value

    return name, params, value


def timezone_from_params(params):
    tzid = params.get("TZID")

    if not tzid:
        return LOCAL_TZ

    tzid = tzid.strip('"')
    tzid = TZID_ALIASES.get(tzid, tzid)

    try:
        return ZoneInfo(tzid)
    except ZoneInfoNotFoundError:
        print(
            f"Warning: unknown TZID {tzid!r}; assuming Europe/London",
            file=sys.stderr,
        )
        return LOCAL_TZ


def parse_ics_datetime(value, params):
    is_all_day = len(value) == 8 and value.isdigit()

    if is_all_day:
        return f"{value[0:4]}-{value[4:6]}-{value[6:8]}", True

    match = re.match(r"^(\d{8})T(\d{6})(Z?)$", value)
    if not match:
        return value, False

    date_part, time_part, is_utc = match.groups()
    dt = datetime.strptime(date_part + time_part, "%Y%m%d%H%M%S")

    if is_utc:
        dt = dt.replace(tzinfo=UTC)
    else:
        # Floating/local times in this UYC calendar are treated as Europe/London
        # unless the event provides an explicit TZID parameter.
        dt = dt.replace(tzinfo=timezone_from_params(params))

    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z"), False


def parse_event_datetime(value):
    if not value:
        return None

    if value.endswith("Z"):
        value = value[:-1] + "+00:00"

    if len(value) == 10:
        return datetime.fromisoformat(value).replace(tzinfo=LOCAL_TZ)

    dt = datetime.fromisoformat(value)

    if dt.tzinfo is None:
        return dt.replace(tzinfo=LOCAL_TZ)

    return dt.astimezone(LOCAL_TZ)


def event_overlaps_window(event, window_start, window_end):
    start = parse_event_datetime(event.get("start"))
    if not start:
        return False

    end = parse_event_datetime(event.get("end"))

    if event.get("all_day"):
        # All-day DTEND values are exclusive in iCalendar. If there is no end,
        # treat the event as a single all-day event.
        if not end:
            end = start + timedelta(days=1)
    elif not end:
        end = start

    return start < window_end and end > window_start


def read_ics(source):
    if source.startswith(("http://", "https://")):
        request = urllib.request.Request(
            source,
            headers={
                "User-Agent": "uyc-webcam-events/1.0",
                "Accept": "text/calendar,*/*",
            },
        )

        with urllib.request.urlopen(request, timeout=20) as response:
            return response.read().decode("utf-8", errors="replace")

    with open(source, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def convert_ics_to_json(ics_url, json_path):
    lines = unfold_ics_lines(read_ics(ics_url))

    now_local = datetime.now(LOCAL_TZ)
    window_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    window_end = window_start + timedelta(days=LOOKAHEAD_DAYS + 1)

    events = []
    current_event = None

    for line in lines:
        if line == "BEGIN:VEVENT":
            current_event = {}
            continue

        if line == "END:VEVENT":
            if current_event is not None:
                status = current_event.get("status", "").upper()
                if status != "CANCELLED" and event_overlaps_window(current_event, window_start, window_end):
                    events.append(current_event)
            current_event = None
            continue

        if current_event is None:
            continue

        name, params, value = split_ics_property(line)

        if name == "SUMMARY":
            current_event["title"] = clean_ics_text(value)
        elif name == "DTSTART":
            parsed, all_day = parse_ics_datetime(value, params)
            current_event["start"] = parsed
            current_event["all_day"] = all_day
        elif name == "DTEND":
            parsed, _ = parse_ics_datetime(value, params)
            current_event["end"] = parsed
        elif name == "LOCATION":
            current_event["location"] = clean_ics_text(value)
        elif name == "DESCRIPTION":
            current_event["description"] = clean_ics_text(value, polish_spacing=True)
        elif name == "URL":
            current_event["url"] = value
        elif name == "UID":
            current_event["uid"] = value
        elif name == "STATUS":
            current_event["status"] = value

    events.sort(key=lambda event: event.get("start", ""))

    output = {
        "schema_version": 1,
        "updated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "source_url": ics_url,
        "timezone": "UTC",
        "floating_time_assumption": "Europe/London",
        "lookahead_days": LOOKAHEAD_DAYS,
        "window_start": window_start.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "window_end": window_end.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "events": events,
    }

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main():
    if len(sys.argv) != 3:
        print(
            "Usage: ics-to-json.py <ics-url> <output.json>",
            file=sys.stderr,
        )
        return 2

    ics_url = sys.argv[1]
    json_path = sys.argv[2]

    convert_ics_to_json(ics_url, json_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
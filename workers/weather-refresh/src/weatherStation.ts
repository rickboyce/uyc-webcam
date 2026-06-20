const WEATHER_STATION_URL = "https://www.glenriddingcybercafe.co.uk/weather-pbpier/";
const WEATHER_STATION_FRESH_MINUTES = 30;
const WEATHER_STATION_FUTURE_TOLERANCE_MINUTES = 5;
const WEATHER_STATION_TIMEOUT_MS = 10_000;
const WEATHER_STATION_TIMEZONE = "Europe/London";
const MONTH_BY_NAME: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
};

type LocalTimestamp = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type WeatherStationWindReading = {
  observed_at: string;
  age_minutes: number;
  is_fresh: boolean;
  source_url: string;
  wind_speed_10m: number;
  wind_gusts_10m: number;
  wind_direction_10m: number;
  wind_direction_compass: string;
};

export async function fetchWeatherStationWindReading(): Promise<WeatherStationWindReading | null> {
  try {
    const response = await fetch(WEATHER_STATION_URL, {
      headers: {
        "accept": "text/html"
      },
      signal: AbortSignal.timeout(WEATHER_STATION_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`Weather station failed: ${response.status} ${response.statusText}`);
    }

    return parseWeatherStationWindReading(await response.text(), new Date());
  } catch (error) {
    console.warn("Weather station wind unavailable", error);
    return null;
  }
}

function parseWeatherStationWindReading(html: string, now: Date): WeatherStationWindReading {
  const text = htmlToPlainText(html);
  const observedMatch = text.match(
    /Conditions at local time\s+(\d{1,2}):(\d{2})\s+on\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/
  );
  const windSpeedMatch = text.match(
    /Wind Speed \(gust\)\s+([0-9]+(?:\.[0-9]+)?)\s+mph\s+Wind Speed \(avg\)\s+([0-9]+(?:\.[0-9]+)?)\s+mph/
  );
  const windBearingMatch = text.match(
    /Wind Bearing\s+([0-9]+(?:\.[0-9]+)?)\s+(?:degrees|\u00b0)\s+([A-Z]{1,3})/
  );

  if (!observedMatch || !windSpeedMatch || !windBearingMatch) {
    throw new Error("Weather station page did not contain expected wind fields");
  }

  const [, hourText, minuteText, dayText, monthName, yearText] = observedMatch;
  const month = MONTH_BY_NAME[monthName.toLowerCase()];

  if (!month) {
    throw new Error(`Weather station page used an unknown month: ${monthName}`);
  }

  const stationLocal = {
    year: Number(yearText),
    month,
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: 0
  };
  const observedAtDate = zonedDateTimeToUtc(stationLocal, WEATHER_STATION_TIMEZONE);
  const observedAt = observedAtDate.toISOString();
  const ageMinutes = Math.round((now.getTime() - observedAtDate.getTime()) / 60_000);
  const futureToleranceMinutes = -WEATHER_STATION_FUTURE_TOLERANCE_MINUTES;
  const isFresh = ageMinutes >= futureToleranceMinutes && ageMinutes <= WEATHER_STATION_FRESH_MINUTES;

  return {
    observed_at: observedAt,
    age_minutes: ageMinutes,
    is_fresh: isFresh,
    source_url: WEATHER_STATION_URL,
    wind_speed_10m: Number(windSpeedMatch[2]),
    wind_gusts_10m: Number(windSpeedMatch[1]),
    wind_direction_10m: Number(windBearingMatch[1]),
    wind_direction_compass: windBearingMatch[2]
  };
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/&nbsp;/gi, " ")
    .replace(/&deg;/gi, " degrees ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function zonedDateTimeToUtc(timestamp: LocalTimestamp, timeZone: string): Date {
  const desiredWallClockMs = timestampAsUtcMs(timestamp);
  const utcGuessMs = desiredWallClockMs;
  const guessWallClockMs = timestampAsUtcMs(getDatePartsInTimeZone(new Date(utcGuessMs), timeZone));

  return new Date(utcGuessMs + desiredWallClockMs - guessWallClockMs);
}

function getDatePartsInTimeZone(date: Date, timeZone: string): LocalTimestamp {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);
  const valueByType = Object.fromEntries(parts.map(part => [part.type, part.value]));

  return {
    year: Number(valueByType.year),
    month: Number(valueByType.month),
    day: Number(valueByType.day),
    hour: Number(valueByType.hour),
    minute: Number(valueByType.minute),
    second: Number(valueByType.second)
  };
}

function timestampAsUtcMs(timestamp: LocalTimestamp): number {
  return Date.UTC(
    timestamp.year,
    timestamp.month - 1,
    timestamp.day,
    timestamp.hour,
    timestamp.minute,
    timestamp.second
  );
}

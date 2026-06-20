const LATITUDE = "54.5950";
const LONGITUDE = "-2.8412";
const LOCAL_TIMEZONE = "Europe/London";

export type OpenMeteoWeather = {
  current?: Record<string, unknown>;
  [key: string]: unknown;
};

export async function fetchOpenMeteoWeather(): Promise<{
  sourceUrl: string;
  weather: OpenMeteoWeather;
}> {
  const sourceUrl = buildWeatherApiUrl();
  const response = await fetch(sourceUrl, {
    cache: "no-store",
    headers: {
      "accept": "application/json",
      "cache-control": "no-store",
      "pragma": "no-cache"
    }
  });

  if (!response.ok) {
    throw new Error(`Weather API failed: ${response.status} ${response.statusText}`);
  }

  return {
    sourceUrl,
    weather: await response.json()
  };
}

function buildWeatherApiUrl(): string {
  const url = new URL("https://api.open-meteo.com/v1/forecast");

  url.searchParams.set("latitude", LATITUDE);
  url.searchParams.set("longitude", LONGITUDE);

  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "apparent_temperature",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
      "wind_gusts_10m",
      "wind_direction_10m",
      "is_day"
    ].join(",")
  );

  url.searchParams.set(
    "hourly",
    [
      "temperature_2m",
      "precipitation_probability",
      "weather_code",
      "wind_speed_10m",
      "wind_gusts_10m",
      "wind_direction_10m",
      "is_day"
    ].join(",")
  );

  url.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "wind_speed_10m_max",
      "wind_gusts_10m_max",
      "wind_direction_10m_dominant"
    ].join(",")
  );

  url.searchParams.set("timezone", LOCAL_TIMEZONE);
  url.searchParams.set("forecast_days", "4");
  url.searchParams.set("wind_speed_unit", "mph");

  return url.toString();
}

import { isAccessRequestAuthorized } from "../../shared/access-auth.ts";
import { fetchOpenMeteoWeather } from "./openMeteo";
import { fetchWeatherStationWindReading, type WeatherStationWindReading } from "./weatherStation";

const WEATHER_OBJECT_KEY_DEFAULT = "var/weather.json";
const WEATHER_WORKER_PATH = "weather-worker";
const OPEN_METEO_SOURCE_ID = "open_meteo";
const POOLEY_BRIDGE_STATION_ID = "pooley_bridge_weather_station";

type WeatherStationSource = {
  id: string;
  label: string;
  type: "weather_station";
  source_url: string;
  observed_at: string;
  age_minutes: number;
  is_fresh: boolean;
  current: {
    wind_speed_10m: number;
    wind_gusts_10m: number;
    wind_direction_10m: number;
  };
  metadata: {
    wind_direction_compass: string;
  };
};

type WeatherOutput = {
  schema_version: number;
  environment: Env["ENVIRONMENT"];
  updated_at: string;
  forecast: {
    id: string;
    label: string;
    type: "forecast";
    source_url: string;
    current?: {
      time?: unknown;
    };
    timezone?: unknown;
  } & Record<string, unknown>;
  weather_stations: WeatherStationSource[];
};

type RefreshSourceSummary = {
  forecast: {
    id: string;
    label: string;
    type: "forecast";
    source_url: string;
    current_time: string | null;
    timezone: string | null;
  };
  weather_stations: Array<{
    id: string;
    label: string;
    type: "weather_station";
    source_url: string;
    observed_at: string;
    age_minutes: number;
    is_fresh: boolean;
  }>;
};

type Env = {
  UYC_BUCKET: R2Bucket;
  ENVIRONMENT: "prod" | "test" | "local";
  WEATHER_OBJECT_KEY?: string;
  CACHE_PURGE_URL?: string;
  CLOUDFLARE_ZONE_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  ACCESS_AUD?: string;
  ACCESS_JWKS_URL?: string;
};

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[${env.ENVIRONMENT}] Weather refresh triggered by cron: ${event.cron}`);
    ctx.waitUntil(updateWeather(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (isWeatherObjectPath(url.pathname, env)) {
      return handleWeatherObjectRequest(env);
    }

    if (isManualRefreshPath(url.pathname, env)) {
      return handleManualRefresh(request, env);
    }

    return Response.json({
      ok: true,
      service: "uyc-webcam-weather-refresh",
      environment: env.ENVIRONMENT
    });
  }
};

function weatherObjectKey(env: Env): string {
  return env.WEATHER_OBJECT_KEY || WEATHER_OBJECT_KEY_DEFAULT;
}

function isWeatherObjectPath(pathname: string, env: Env): boolean {
  const objectPath = `/${weatherObjectKey(env)}`;

  return pathname === objectPath || pathname === `/${env.ENVIRONMENT}/${WEATHER_WORKER_PATH}${objectPath}`;
}

function isManualRefreshPath(pathname: string, env: Env): boolean {
  return (
    pathname === "/refresh" ||
    pathname === `/${env.ENVIRONMENT}/${WEATHER_WORKER_PATH}/refresh`
  );
}

async function handleManualRefresh(request: Request, env: Env): Promise<Response> {
  if (env.ENVIRONMENT === "local") {
    return jsonResponse(await buildWeatherOutput(env));
  }

  if (env.ENVIRONMENT !== "local" && !(await isAccessRequestAuthorized(request, env))) {
    return Response.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const output = await updateWeather(env);

  return Response.json({
    ok: true,
    environment: env.ENVIRONMENT,
    refreshed_at: output.updated_at,
    object_key: weatherObjectKey(env),
    sources: buildRefreshSourceSummary(output)
  });
}

async function handleWeatherObjectRequest(env: Env): Promise<Response> {
  if (env.ENVIRONMENT === "local") {
    return jsonResponse(await buildWeatherOutput(env));
  }

  return Response.json(
    { ok: false, error: "Weather JSON is only served directly by the local worker" },
    { status: 404 }
  );
}

async function updateWeather(env: Env): Promise<WeatherOutput> {
  const output = await buildWeatherOutput(env);
  const objectKey = weatherObjectKey(env);

  await env.UYC_BUCKET.put(
    objectKey,
    JSON.stringify(output, null, 2),
    {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl: "public, max-age=60"
      }
    }
  );

  console.log(`[${env.ENVIRONMENT}] Updated ${objectKey}`);

  await purgeCloudflareCache(env);

  return output;
}

async function buildWeatherOutput(env: Env): Promise<WeatherOutput> {
  const stationReadingPromise = fetchWeatherStationWindReading();
  const { sourceUrl, weather: sourceWeather } = await fetchOpenMeteoWeather();
  const stationReading = await stationReadingPromise;
  const weatherStations = buildWeatherStationSources(stationReading);

  const output = {
    schema_version: 2,
    environment: env.ENVIRONMENT,
    updated_at: new Date().toISOString(),
    forecast: {
      id: OPEN_METEO_SOURCE_ID,
      label: "Open-Meteo",
      type: "forecast",
      source_url: sourceUrl,
      ...sourceWeather
    },
    weather_stations: weatherStations
  };

  return output;
}

function buildRefreshSourceSummary(output: WeatherOutput): RefreshSourceSummary {
  return {
    forecast: {
      id: output.forecast.id,
      label: output.forecast.label,
      type: output.forecast.type,
      source_url: output.forecast.source_url,
      current_time: typeof output.forecast.current?.time === "string"
        ? output.forecast.current.time
        : null,
      timezone: typeof output.forecast.timezone === "string"
        ? output.forecast.timezone
        : null
    },
    weather_stations: output.weather_stations.map((station) => ({
      id: station.id,
      label: station.label,
      type: station.type,
      source_url: station.source_url,
      observed_at: station.observed_at,
      age_minutes: station.age_minutes,
      is_fresh: station.is_fresh
    }))
  };
}

function jsonResponse(output: unknown): Response {
  return Response.json(output, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

function buildWeatherStationSources(
  stationReading: WeatherStationWindReading | null
): WeatherStationSource[] {
  if (!stationReading) {
    return [];
  }

  return [
    {
      id: POOLEY_BRIDGE_STATION_ID,
      label: "Pooley Bridge weather station",
      type: "weather_station",
      source_url: stationReading.source_url,
      observed_at: stationReading.observed_at,
      age_minutes: stationReading.age_minutes,
      is_fresh: stationReading.is_fresh,
      current: {
        wind_speed_10m: stationReading.wind_speed_10m,
        wind_gusts_10m: stationReading.wind_gusts_10m,
        wind_direction_10m: stationReading.wind_direction_10m
      },
      metadata: {
        wind_direction_compass: stationReading.wind_direction_compass
      }
    }
  ];
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

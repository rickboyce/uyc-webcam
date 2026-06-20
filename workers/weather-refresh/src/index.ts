import { isAccessRequestAuthorized } from "../../shared/access-auth.ts";
import { fetchOpenMeteoWeather, type OpenMeteoWeather } from "./openMeteo";
import { fetchWeatherStationWindReading, type WeatherStationWindReading } from "./weatherStation";

const WEATHER_OBJECT_KEY_DEFAULT = "var/weather.json";
const WEATHER_WORKER_PATH = "weather-worker";

type Env = {
  UYC_BUCKET: R2Bucket;
  ENVIRONMENT: "prod" | "test";
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

function isManualRefreshPath(pathname: string, env: Env): boolean {
  return (
    pathname === "/refresh" ||
    pathname === `/${env.ENVIRONMENT}/${WEATHER_WORKER_PATH}/refresh`
  );
}

async function handleManualRefresh(request: Request, env: Env): Promise<Response> {
  if (!(await isAccessRequestAuthorized(request, env))) {
    return Response.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  await updateWeather(env);

  return Response.json({
    ok: true,
    environment: env.ENVIRONMENT,
    refreshed_at: new Date().toISOString()
  });
}

async function updateWeather(env: Env): Promise<void> {
  const stationReadingPromise = fetchWeatherStationWindReading();
  const { sourceUrl, weather: sourceWeather } = await fetchOpenMeteoWeather();
  const stationReading = await stationReadingPromise;
  const currentWeather = applyWeatherStationWind(sourceWeather.current, stationReading);

  const output = {
    schema_version: 1,
    environment: env.ENVIRONMENT,
    updated_at: new Date().toISOString(),
    source_url: sourceUrl,
    weather_station: stationReading,
    ...sourceWeather,
    current: currentWeather
  };

  const objectKey = env.WEATHER_OBJECT_KEY || WEATHER_OBJECT_KEY_DEFAULT;

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

  await purgeCloudflareCache(env);

  console.log(`[${env.ENVIRONMENT}] Updated ${objectKey}`);
}

function applyWeatherStationWind(
  currentWeather: OpenMeteoWeather["current"],
  stationReading: WeatherStationWindReading | null
): OpenMeteoWeather["current"] {
  if (!currentWeather || !stationReading?.is_fresh) {
    return currentWeather;
  }

  return {
    ...currentWeather,
    wind_speed_10m: stationReading.wind_speed_10m,
    wind_gusts_10m: stationReading.wind_gusts_10m,
    wind_direction_10m: stationReading.wind_direction_10m,
    wind_source: "pooley_bridge_weather_station",
    wind_observed_at: stationReading.observed_at
  };
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

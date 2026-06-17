const LATITUDE = "54.5950";
const LONGITUDE = "-2.8412";
const WEATHER_OBJECT_KEY_DEFAULT = "var/weather.json";

type Env = {
  UYC_BUCKET: R2Bucket;
  ENVIRONMENT: "prod" | "test";
  WEATHER_OBJECT_KEY?: string;
  REFRESH_TOKEN?: string;
};

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[${env.ENVIRONMENT}] Weather refresh triggered by cron: ${event.cron}`);
    ctx.waitUntil(updateWeather(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/refresh") {
      return handleManualRefresh(request, env);
    }

    return Response.json({
      ok: true,
      service: "uyc-webcam-weather-refresh",
      environment: env.ENVIRONMENT
    });
  }
};

async function handleManualRefresh(request: Request, env: Env): Promise<Response> {
  if (env.ENVIRONMENT !== "test") {
    return Response.json(
      { ok: false, error: "Manual refresh is only enabled for test" },
      { status: 403 }
    );
  }
/*
  const expectedAuth = `Bearer ${env.REFRESH_TOKEN}`;
  const actualAuth = request.headers.get("authorization");

  if (!env.REFRESH_TOKEN || actualAuth !== expectedAuth) {
    return Response.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }*/

  await updateWeather(env);

  return Response.json({
    ok: true,
    environment: env.ENVIRONMENT,
    refreshed_at: new Date().toISOString()
  });
}

async function updateWeather(env: Env): Promise<void> {
  const weatherApiUrl = buildWeatherApiUrl();

  const response = await fetch(weatherApiUrl, {
    headers: {
      "accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Weather API failed: ${response.status} ${response.statusText}`);
  }

  const sourceWeather = await response.json();

  const output = {
    schema_version: 1,
    environment: env.ENVIRONMENT,
    updated_at: new Date().toISOString(),
    source_url: weatherApiUrl,
    ...sourceWeather
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

  console.log(`[${env.ENVIRONMENT}] Updated ${objectKey}`);
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
      "wind_direction_10m"
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
      "wind_direction_10m"
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

  url.searchParams.set("timezone", "Europe/London");
  url.searchParams.set("forecast_days", "4");
  url.searchParams.set("wind_speed_unit", "mph");

  return url.toString();
}
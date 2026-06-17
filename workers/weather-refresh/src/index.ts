type Env = {
    UYC_BUCKET: R2Bucket;
    ENVIRONMENT: "prod" | "test";
    WEATHER_API_URL: string;
    WEATHER_OBJECT_KEY: string;
  };
  
  export default {
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
      console.log(`[${env.ENVIRONMENT}] Weather refresh triggered by cron: ${event.cron}`);
  
      ctx.waitUntil(updateWeather(env));
    },
  
    async fetch(_request: Request, env: Env): Promise<Response> {
      return Response.json({
        ok: true,
        service: "uyc-webcam-weather-refresh",
        environment: env.ENVIRONMENT,
        purpose: "Scheduled weather refresh Worker"
      });
    }
  };
  
  async function updateWeather(env: Env): Promise<void> {
    const response = await fetch(env.WEATHER_API_URL, {
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
      source_url: env.WEATHER_API_URL,
      ...sourceWeather
    };
  
    await env.UYC_BUCKET.put(
      env.WEATHER_OBJECT_KEY,
      JSON.stringify(output, null, 2),
      {
        httpMetadata: {
          contentType: "application/json; charset=utf-8",
          cacheControl: "public, max-age=900"
        }
      }
    );
  
    console.log(`[${env.ENVIRONMENT}] Updated ${env.WEATHER_OBJECT_KEY}`);
  }
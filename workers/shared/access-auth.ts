import { createRemoteJWKSet, jwtVerify } from "jose";

export type AccessAuthEnv = {
  ENVIRONMENT: string;
  ACCESS_AUD?: string;
  ACCESS_JWKS_URL?: string;
};

export async function isAccessRequestAuthorized(
  request: Request,
  env: AccessAuthEnv
): Promise<boolean> {
  if (!env.ACCESS_AUD || !env.ACCESS_JWKS_URL) {
    console.log(`[${env.ENVIRONMENT}] Access JWT validation skipped: missing configuration`);
    return false;
  }

  const token = request.headers.get("cf-access-jwt-assertion");

  console.log(`[${env.ENVIRONMENT}] Access auth diagnostic`, {
    hasJwt: !!token,
    hasAccessClientId: !!request.headers.get("cf-access-client-id"),
    hasAccessClientSecret: !!request.headers.get("cf-access-client-secret"),
    hasAccessAud: !!env.ACCESS_AUD,
    hasAccessJwksUrl: !!env.ACCESS_JWKS_URL,
    jwksOrigin: env.ACCESS_JWKS_URL
      ? new URL(env.ACCESS_JWKS_URL).origin
      : null,
  });

  if (!token) {
    return false;
  }

  try {
    const jwks = createRemoteJWKSet(new URL(env.ACCESS_JWKS_URL));

    await jwtVerify(token, jwks, {
      issuer: new URL(env.ACCESS_JWKS_URL).origin,
      audience: env.ACCESS_AUD
    });

    return true;
  } catch (error) {
    console.log(`[${env.ENVIRONMENT}] Access JWT validation failed: ${error}`);
    return false;
  }
}

import assert from "node:assert/strict";
import test from "node:test";

import { isAccessRequestAuthorized } from "../access-auth.ts";

const JWKS_URL = "https://team.cloudflareaccess.com/cdn-cgi/access/certs";
const ISSUER = "https://team.cloudflareaccess.com";
const AUDIENCE = "uyc-worker";

test("accepts a Cloudflare Access JWT with the expected issuer, audience and signature", async () => {
  const { token, jwk } = await createSignedAccessJwt({
    aud: AUDIENCE,
    iss: ISSUER,
    exp: Math.floor(Date.now() / 1000) + 300
  });

  await withMockedJwks(jwk, async () => {
    const request = new Request("https://worker.example/refresh", {
      headers: {
        "Cf-Access-Jwt-Assertion": token
      }
    });

    assert.equal(await isAccessRequestAuthorized(request, accessEnv()), true);
  });
});

test("rejects a Cloudflare Access JWT for a different application audience", async () => {
  const { token, jwk } = await createSignedAccessJwt({
    aud: "other-worker",
    iss: ISSUER,
    exp: Math.floor(Date.now() / 1000) + 300
  });

  await withMockedJwks(jwk, async () => {
    const request = new Request("https://worker.example/refresh", {
      headers: {
        "Cf-Access-Jwt-Assertion": token
      }
    });

    assert.equal(await isAccessRequestAuthorized(request, accessEnv()), false);
  });
});

test("rejects requests when Access validation is not configured", async () => {
  const request = new Request("https://worker.example/refresh");

  assert.equal(
    await isAccessRequestAuthorized(request, {
      ENVIRONMENT: "test"
    }),
    false
  );
});

function accessEnv() {
  return {
    ENVIRONMENT: "test",
    ACCESS_AUD: AUDIENCE,
    ACCESS_JWKS_URL: JWKS_URL
  };
}

async function withMockedJwks(jwk, callback) {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => Response.json({ keys: [jwk] });

  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function createSignedAccessJwt(payload) {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );

  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";

  const encodedHeader = base64UrlEncodeJson({
    alg: "RS256",
    kid: jwk.kid,
    typ: "JWT"
  });
  const encodedPayload = base64UrlEncodeJson(payload);
  const signedData = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signedData)
  );

  return {
    jwk,
    token: `${signedData}.${base64UrlEncodeBytes(new Uint8Array(signature))}`
  };
}

function base64UrlEncodeJson(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncodeBytes(bytes) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

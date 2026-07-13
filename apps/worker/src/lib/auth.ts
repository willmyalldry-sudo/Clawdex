import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { jsonError } from "./utils";

export type AppBindings = { Bindings: Env; Variables: { actorEmail: string } };

const jwksByTeamDomain = new Map<string, JWTVerifyGetKey>();

function accessJwks(teamDomain: string): JWTVerifyGetKey {
  let jwks = jwksByTeamDomain.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksByTeamDomain.set(teamDomain, jwks);
  }
  return jwks;
}

/** Verifies a Cloudflare Access application token (`cf-access-jwt-assertion`) against the
 * team's JWKS and returns the authenticated user's email. Header presence alone (the prior
 * check here) does not prove the request passed through Access - the signature must be
 * checked to rule out a spoofed header reaching the Worker directly. */
export async function verifyAccessJwt(env: Env, token: string): Promise<string> {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const audience = env.CF_ACCESS_AUD;
  if (!teamDomain || !audience) {
    throw new Error("Access verification is not configured (CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD missing).");
  }
  const { payload } = await jwtVerify(token, accessJwks(teamDomain), { issuer: teamDomain, audience });
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (!email) throw new Error("Access token payload is missing an email claim.");
  return email;
}

export const requireAccessUser: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (String(c.env.AUTH_MODE) === "development") {
    c.set("actorEmail", "developer@agentos.local");
    await next();
    return;
  }

  const accessJwt = c.req.header("cf-access-jwt-assertion");
  if (!c.req.header("cf-access-authenticated-user-email") || !accessJwt) {
    return jsonError("Cloudflare Access authentication is required.", 401, "unauthorized");
  }

  try {
    c.set("actorEmail", (await verifyAccessJwt(c.env, accessJwt)).toLowerCase());
    await next();
  } catch {
    return jsonError("Cloudflare Access token verification failed.", 401, "unauthorized");
  }
};

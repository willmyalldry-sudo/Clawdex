import { afterEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyAccessJwt } from "./auth";

const audience = "test-application-aud";

// createRemoteJWKSet caches fetched keys per URL (both our own module-level cache in
// auth.ts and jose's internal per-instance cache), so each test uses a distinct team
// domain to guarantee it hits the freshly stubbed fetch instead of a prior test's keys.
function uniqueTeamDomain() {
  return `https://test-team-${crypto.randomUUID()}.cloudflareaccess.com`;
}

async function issueToken(teamDomain: string, overrides: { audience?: string; issuer?: string; email?: string } = {}) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const kid = "test-key";
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  const jwt = await new SignJWT({ email: overrides.email ?? "adviser@agentos.local" })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? teamDomain)
    .setAudience(overrides.audience ?? audience)
    .setExpirationTime("5m")
    .sign(privateKey);
  return { jwt, jwks: { keys: [publicJwk] } };
}

function stubJwksFetch(teamDomain: string, jwks: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === `${teamDomain}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify(jwks), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected fetch to ${String(input)}`);
  }));
}

describe("verifyAccessJwt", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the email claim for a token signed by the team's JWKS", async () => {
    const teamDomain = uniqueTeamDomain();
    const { jwt, jwks } = await issueToken(teamDomain, { email: "Adviser@AgentOS.local" });
    stubJwksFetch(teamDomain, jwks);
    const env = { CF_ACCESS_TEAM_DOMAIN: teamDomain, CF_ACCESS_AUD: audience } as unknown as Env;
    await expect(verifyAccessJwt(env, jwt)).resolves.toBe("Adviser@AgentOS.local");
  });

  it("rejects a token issued for a different application audience", async () => {
    const teamDomain = uniqueTeamDomain();
    const { jwt, jwks } = await issueToken(teamDomain, { audience: "some-other-app-aud" });
    stubJwksFetch(teamDomain, jwks);
    const env = { CF_ACCESS_TEAM_DOMAIN: teamDomain, CF_ACCESS_AUD: audience } as unknown as Env;
    await expect(verifyAccessJwt(env, jwt)).rejects.toThrow();
  });

  it("rejects a token from an unrecognized issuer", async () => {
    const teamDomain = uniqueTeamDomain();
    const { jwt, jwks } = await issueToken(teamDomain, { issuer: "https://attacker.cloudflareaccess.com" });
    stubJwksFetch(teamDomain, jwks);
    const env = { CF_ACCESS_TEAM_DOMAIN: teamDomain, CF_ACCESS_AUD: audience } as unknown as Env;
    await expect(verifyAccessJwt(env, jwt)).rejects.toThrow();
  });

  it("fails closed when Access is not configured", async () => {
    const env = { CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "" } as unknown as Env;
    await expect(verifyAccessJwt(env, "anything")).rejects.toThrow(/not configured/);
  });
});

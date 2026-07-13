import type { MiddlewareHandler } from "hono";
import { jsonError } from "./utils";

export type AppBindings = { Bindings: Env; Variables: { actorEmail: string } };

export const requireAccessUser: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (String(c.env.AUTH_MODE) === "development") {
    c.set("actorEmail", "developer@agentos.local");
    await next();
    return;
  }

  const email = c.req.header("cf-access-authenticated-user-email");
  const accessJwt = c.req.header("cf-access-jwt-assertion");
  if (!email || !accessJwt) {
    return jsonError("Cloudflare Access authentication is required.", 401, "unauthorized");
  }
  c.set("actorEmail", email.toLowerCase());
  await next();
};

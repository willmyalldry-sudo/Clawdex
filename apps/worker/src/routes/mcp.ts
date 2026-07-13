import { getAgentByName } from "agents";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { classifyMcpRisk, rankMcpCatalog, tokenize, type McpRiskLevel } from "@agent-os/shared";
import type { AppBindings } from "../lib/auth";
import { neonQuery } from "../lib/neon";
import { nowIso, uuid } from "../lib/utils";
import { MCP_CATALOG, MCP_CATALOG_SOURCE, MCP_CATALOG_SYNCED_AT } from "../data/mcp-catalog.generated";

interface McpStatus {
  servers: Array<{ id: string; name: string; url: string; state: string }>;
  tools: Array<{ name: string; title: string; description: string; serverId: string }>;
  resources: number;
  prompts: number;
  updatedAt: string;
}

interface ConnectResponse {
  connection: { id: string; state: string; authUrl?: string };
  status: McpStatus;
}

interface PlanRow extends Record<string, unknown> {
  id: string;
  task: string;
  status: string;
  server_ids: string[];
  expires_at: string;
}

const connectSchema = z.object({
  id: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().trim().min(2).max(120),
  url: z.string().url().max(2_000),
  transport: z.enum(["auto", "streamable-http", "sse"]).default("auto"),
});
const planSchema = z.object({ task: z.string().trim().min(5).max(2_000) });
const executeSchema = z.object({ approved: z.literal(true) });

export const mcpApi = new Hono<AppBindings>();

mcpApi.get("/catalog", (c) => {
  const query = c.req.query("q")?.trim().toLowerCase() ?? "";
  const category = c.req.query("category")?.trim().toLowerCase() ?? "";
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 48), 1), 100);
  const filtered = MCP_CATALOG.filter((entry) => {
    const matchesCategory = !category || entry.category.toLowerCase() === category;
    const haystack = `${entry.name} ${entry.category} ${entry.description} ${entry.tags.join(" ")}`.toLowerCase();
    return matchesCategory && (!query || haystack.includes(query));
  });
  return c.json({
    entries: filtered.slice(offset, offset + limit),
    total: filtered.length,
    offset,
    limit,
    categories: [...new Set(MCP_CATALOG.map((entry) => entry.category))].sort(),
    source: MCP_CATALOG_SOURCE,
    syncedAt: MCP_CATALOG_SYNCED_AT,
  });
});

mcpApi.get("/status", async (c) => c.json(await requestAgent<McpStatus>(c.env, "/status")));

mcpApi.post("/connect", zValidator("json", connectSchema), async (c) => {
  const input = c.req.valid("json");
  const response = await requestAgentResponse(c.env, "/connect", { method: "POST", body: JSON.stringify(input) });
  if (!response.ok) return response;
  const payload = await response.json<ConnectResponse>();
  await audit(c.env, input.id, "mcp.connector_added", { name: input.name, transport: input.transport, state: payload.connection.state });
  return c.json(payload, payload.connection.state === "authenticating" ? 202 : 201);
});

mcpApi.delete("/connect/:id", async (c) => {
  const id = c.req.param("id");
  const response = await requestAgentResponse(c.env, `/connect/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) return response;
  const payload = await response.json<{ removed: string; status: McpStatus }>();
  await audit(c.env, id, "mcp.connector_removed", {});
  return c.json(payload);
});

mcpApi.post("/plans", zValidator("json", planSchema), async (c) => {
  const { task } = c.req.valid("json");
  const status = await requestAgent<McpStatus>(c.env, "/status");
  const recommendations = rankMcpCatalog(task, MCP_CATALOG, 8);
  const terms = tokenize(task);
  const connectedTools = status.tools
    .map((tool) => {
      const haystack = `${tool.name} ${tool.title} ${tool.description}`.toLowerCase();
      const matchedTerms = terms.filter((term) => haystack.includes(term));
      return { ...tool, score: matchedTerms.length, matchedTerms };
    })
    .filter((tool) => tool.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 12);
  const serverIds = [...new Set(connectedTools.map((tool) => tool.serverId))].slice(0, 3);
  const riskLevel = highestRisk([classifyMcpRisk(task), ...recommendations.slice(0, 3).map((entry) => entry.riskLevel)]);
  const id = uuid();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const state = serverIds.length > 0 ? "approval_required" : "configuration_required";
  const steps = serverIds.length > 0
    ? ["Review the matched connected tools.", "Approve this exact task and risk level.", "Execute with a maximum of six model/tool steps.", "Store the confirmed result in the audit trail."]
    : ["Review the recommended catalog entries.", "Open the source repository and deploy or locate its remote MCP endpoint.", "Register the HTTPS Streamable HTTP or SSE endpoint.", "Create a new plan for approval and execution."];

  await neonQuery(c.env,
    `INSERT INTO mcp_task_plans(id,actor_email,task,status,risk_level,recommendations,server_ids,created_at,expires_at)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`,
    [id, c.get("actorEmail"), task, state, riskLevel, JSON.stringify({ catalog: recommendations, connectedTools }), JSON.stringify(serverIds), createdAt, expiresAt]);
  await audit(c.env, id, "mcp.plan_created", { riskLevel, serverCount: serverIds.length, state });
  return c.json({ id, task, state, riskLevel, recommendations, connectedTools, serverIds, steps, approvalRequired: serverIds.length > 0, createdAt, expiresAt }, 201);
});

mcpApi.post("/plans/:id/execute", zValidator("json", executeSchema), async (c) => {
  const rows = await neonQuery<PlanRow>(c.env,
    "SELECT id,task,status,server_ids,expires_at::text FROM mcp_task_plans WHERE id=$1 AND actor_email=$2",
    [c.req.param("id"), c.get("actorEmail")]);
  const plan = rows.rows[0];
  if (!plan) return c.json({ error: { code: "not_found", message: "MCP task plan not found." } }, 404);
  if (plan.status !== "approval_required") return c.json({ error: { code: "not_executable", message: "This plan is not ready for execution." } }, 409);
  if (new Date(plan.expires_at).getTime() <= Date.now()) return c.json({ error: { code: "expired", message: "This approval plan expired. Create a new plan." } }, 409);
  await neonQuery(c.env, "UPDATE mcp_task_plans SET status='executing',approved_at=now() WHERE id=$1", [plan.id]);

  const response = await requestAgentResponse(c.env, "/execute", { method: "POST", body: JSON.stringify({ task: plan.task, planId: plan.id, serverIds: plan.server_ids }) });
  const result = await response.json<unknown>();
  if (!response.ok) {
    await neonQuery(c.env, "UPDATE mcp_task_plans SET status='failed',error_message=$2,completed_at=now() WHERE id=$1", [plan.id, JSON.stringify(result).slice(0, 4_000)]);
    return Response.json(result, { status: response.status });
  }
  await neonQuery(c.env, "UPDATE mcp_task_plans SET status='completed',result=$2::jsonb,completed_at=now() WHERE id=$1", [plan.id, JSON.stringify(result)]);
  await audit(c.env, plan.id, "mcp.plan_completed", { serverIds: plan.server_ids });
  return c.json({ planId: plan.id, status: "completed", result });
});

mcpApi.get("/plans", async (c) => {
  const rows = await neonQuery(c.env,
    `SELECT id,task,status,risk_level,result,error_message,created_at,approved_at,completed_at
     FROM mcp_task_plans WHERE actor_email=$1 ORDER BY created_at DESC LIMIT 25`, [c.get("actorEmail")]);
  return c.json({ plans: rows.rows });
});

async function requestAgent<T>(env: Env, path: string): Promise<T> {
  const response = await requestAgentResponse(env, path);
  const payload = await response.json<T>();
  if (!response.ok) throw new Error(`MCP agent request failed (${response.status}).`);
  return payload;
}

async function requestAgentResponse(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const agent = await getAgentByName(env.MCP_CONTROL_AGENT, "workspace");
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  return agent.fetch(new Request(`https://mcp-agent.internal${path}`, { ...init, headers }));
}

async function audit(env: Env, entityId: string, action: string, metadata: Record<string, unknown>): Promise<void> {
  await neonQuery(env,
    "INSERT INTO audit_log(entity_type,entity_id,action,rule_version,metadata) VALUES('mcp_task_plan',$1,$2,'mcp-control-v1',$3::jsonb)",
    [entityId, action, JSON.stringify(metadata)]);
}

function highestRisk(levels: McpRiskLevel[]): McpRiskLevel {
  const order: McpRiskLevel[] = ["low", "medium", "high", "critical"];
  return levels.reduce((highest, current) => order.indexOf(current) > order.indexOf(highest) ? current : highest, "low");
}

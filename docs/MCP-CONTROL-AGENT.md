# MCP Control Agent

## Goal

Provide one approval-gated control plane for the MCP projects cataloged by `ever-works/awesome-mcp-servers` without pretending that every source repository is already a hosted MCP endpoint.

The current snapshot contains 4,065 catalog entries. Refresh it with:

```powershell
npm run mcp:catalog:sync
```

## Architecture

```text
React MCP dashboard
  -> authenticated Hono /api/mcp routes
    -> catalog search and deterministic task ranking
    -> Neon plan and approval audit records
    -> McpControlAgent Durable Object
      -> persistent MCP connections and OAuth state
      -> Workers AI planner/executor
      -> approved remote Streamable HTTP or SSE MCP tools
```

The GitHub catalog is an inventory of projects. A project link is not passed to the MCP client. An operator must inspect the project, deploy it or obtain its official remote MCP endpoint, and explicitly register that endpoint.

## Safety model

- Cloudflare Access protects `/api/mcp/*` with the same authenticated identity as the rest of Agent OS.
- Remote endpoints must use HTTPS, except loopback URLs during local development.
- GitHub and npm project URLs are rejected as connection endpoints.
- The Agents SDK performs additional SSRF checks and persists connection/OAuth state in the agent's SQLite storage.
- Creating a plan never invokes a tool.
- A plan must match ready tools, be explicitly approved, and execute before its 30-minute expiry.
- A run is limited to three matched servers and six model/tool steps.
- Tool output is treated as untrusted content and cannot expand the approved task.
- Payments, trading, messaging, publishing, deletion, and infrastructure changes are classified as high or critical risk.
- Results and failures are written to `mcp_task_plans`; lifecycle events are added to `audit_log`.
- Arbitrary bearer-token headers are intentionally not accepted by the UI. Prefer remote MCP OAuth or a separately secured gateway.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/mcp/catalog` | Search and paginate the synchronized catalog |
| `GET /api/mcp/status` | List persistent servers, tools, resources, and prompts |
| `POST /api/mcp/connect` | Register an explicit remote endpoint |
| `DELETE /api/mcp/connect/:id` | Remove a persistent connection |
| `POST /api/mcp/plans` | Rank catalog entries and connected tools for a task |
| `POST /api/mcp/plans/:id/execute` | Approve and execute the exact task |
| `GET /api/mcp/plans` | Read the latest audited plans and results |

Example connection payload:

```json
{
  "id": "github",
  "name": "GitHub MCP",
  "url": "https://mcp.example.com/mcp",
  "transport": "streamable-http"
}
```

## Setup

1. Install dependencies with `npm install`.
2. Apply Neon migrations with `npm run db:migrate:neon`. Migration `004_mcp_control_agent.sql` creates the plan and audit-result table.
3. Generate bindings with `npm run cf:types`.
4. Run locally with `npm run dev` or build with `npm run build`.
5. In the dashboard, open **MCP control agent**, inspect a catalog source, and enter its runnable remote endpoint.
6. Complete OAuth if the remote MCP server requests it.
7. Enter a task, review the plan and risk label, then approve only the exact task intended.

## Deployment

The Worker config includes:

- `AI` Workers AI binding
- `MCP_CONTROL_AGENT` Durable Object binding
- `v1-mcp-control-agent` SQLite Durable Object migration
- `/agents/*` in `assets.run_worker_first` for agent routing and OAuth callbacks

Deploy only after the Neon migration is applied and Cloudflare Access protects the application. A first production connection should use a read-only MCP server and a non-consequential test task.

## Known gaps

- Local stdio-only MCP packages cannot run inside a remote Worker. They need a remote HTTP/SSE deployment or a gateway.
- Each catalog project has independent credentials, deployment steps, and trust characteristics; those cannot be inferred safely from the catalog description.
- Tool-level read/write annotations are inconsistent across community servers, so the control plane requires plan-level approval for every execution.
- The current executor uses Workers AI model `@cf/zai-org/glm-4.7-flash`; model selection is not exposed in the UI.

# Optional integrations

The production Worker does not execute local MCP servers or Maigret. The root
`.mcp.json` exposes operator-side tools for supervised development and incident
investigation only.

- **Abstract and Bouncer via Pipedream MCP** are optional, interactive,
  operator-side email checks. The production validator is Bouncer's own REST
  API called directly from the Worker (`BOUNCER_API_KEY`); these MCP tools are
  a separate path for ad-hoc lookups and cannot override a failed production
  validation result or the employer-domain gate.
- **Meilisearch and OpenSearch MCP** are search/index administration tools, not
  email validators. Neon remains the authoritative record store.
- **Maigret** is pinned in `maigret/manifest.json` and disabled. It is not an
  email-validation provider. Its broad username enumeration features are outside
  the production data policy, so it may not affect qualification or outreach.

Restart the MCP-capable editor after changing `.mcp.json`. OAuth or provider
authentication is completed in the MCP client; credentials are never committed.

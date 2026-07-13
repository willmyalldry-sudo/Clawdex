CREATE TABLE IF NOT EXISTS mcp_task_plans (
  id text PRIMARY KEY,
  actor_email text NOT NULL,
  task text NOT NULL,
  status text NOT NULL CHECK (status IN ('configuration_required','approval_required','executing','completed','failed')),
  risk_level text NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
  recommendations jsonb NOT NULL DEFAULT '{}'::jsonb,
  server_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_mcp_task_plans_actor_created ON mcp_task_plans(actor_email,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_task_plans_status ON mcp_task_plans(status,expires_at);

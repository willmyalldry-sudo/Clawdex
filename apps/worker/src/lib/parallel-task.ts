export interface ParallelTaskRunHandle {
  runId: string;
  status: string;
}

export interface ParallelTaskRunResult {
  status: string;
  output: unknown;
}

export async function createParallelTaskRun(env: Env, input: string, processor = "ultra"): Promise<ParallelTaskRunHandle> {
  if (!env.PARALLEL_API_KEY) throw new Error("PARALLEL_API_KEY is not configured.");
  const response = await fetch(`${env.PARALLEL_API_BASE}/tasks/runs`, {
    method: "POST",
    headers: { "x-api-key": env.PARALLEL_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ input, processor }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Parallel Task Run returned HTTP ${response.status}.`);
  const data = await response.json<{ run_id?: string; status?: string }>();
  if (!data.run_id) throw new Error("Parallel Task Run did not return a run_id.");
  return { runId: data.run_id, status: data.status ?? "queued" };
}

export async function getParallelTaskRunResult(env: Env, runId: string, apiTimeoutSeconds = 20): Promise<ParallelTaskRunResult> {
  if (!env.PARALLEL_API_KEY) throw new Error("PARALLEL_API_KEY is not configured.");
  const params = new URLSearchParams({ api_timeout: String(apiTimeoutSeconds) });
  const response = await fetch(`${env.PARALLEL_API_BASE}/tasks/runs/${encodeURIComponent(runId)}/result?${params}`, {
    headers: { "x-api-key": env.PARALLEL_API_KEY, Accept: "application/json" },
    signal: AbortSignal.timeout((apiTimeoutSeconds + 10) * 1_000),
  });
  if (!response.ok) throw new Error(`Parallel Task Run result returned HTTP ${response.status}.`);
  const data = await response.json<{ status?: string; output?: unknown }>();
  return { status: data.status ?? "unknown", output: data.output ?? null };
}

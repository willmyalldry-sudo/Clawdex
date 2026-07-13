const isDemo = import.meta.env.VITE_DEMO_MODE === "true";
const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

export async function getJson<T>(path: string, fallback: T): Promise<T> {
  if (isDemo) return fallback;
  const response = await fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<T>;
}

export async function mutateJson<T>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  if (isDemo) return { demo: true } as T;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<T>;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: string } | string };
    return typeof body.error === "string" ? body.error : body.error?.message ?? `Request failed (${response.status})`;
  } catch { return `Request failed (${response.status})`; }
}

export { isDemo };

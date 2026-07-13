import { Client, type QueryResult, type QueryResultRow } from "pg";

function connectionString(env: Env): string {
  const hyperdrive = (env as Env & { HYPERDRIVE?: Hyperdrive }).HYPERDRIVE;
  if (hyperdrive?.connectionString) return hyperdrive.connectionString;
  if (env.DATABASE_URL) return env.DATABASE_URL;
  throw new Error("Neon is not configured. Add the HYPERDRIVE binding or DATABASE_URL for local development.");
}

export async function withNeon<T>(env: Env, operation: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: connectionString(env), statement_timeout: 60_000 });
  await client.connect();
  try {
    return await operation(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function neonQuery<Row extends QueryResultRow = QueryResultRow>(
  env: Env,
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<Row>> {
  return withNeon(env, (client) => client.query<Row>(text, values));
}

export async function neonTransaction<T>(env: Env, operation: (client: Client) => Promise<T>): Promise<T> {
  return withNeon(env, async (client) => {
    await client.query("BEGIN");
    try {
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export function databaseConfigured(env: Env): boolean {
  return Boolean((env as Env & { HYPERDRIVE?: Hyperdrive }).HYPERDRIVE?.connectionString || env.DATABASE_URL);
}

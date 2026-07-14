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

/**
 * Execute a single query with automatic connection management.
 * 
 * ⚠️  PERFORMANCE NOTE: Each call creates a new connection.
 * For multiple related queries, use `neonTransaction()` instead to reuse a single connection.
 * 
 * @example
 * ```ts
 * // ❌ AVOID: 3 separate connections
 * await neonQuery(env, "SELECT * FROM table1");
 * await neonQuery(env, "SELECT * FROM table2");
 * await neonQuery(env, "SELECT * FROM table3");
 * 
 * // ✅ PREFER: 1 connection reused
 * await neonTransaction(env, async (client) => {
 *   await client.query("SELECT * FROM table1");
 *   await client.query("SELECT * FROM table2");
 *   await client.query("SELECT * FROM table3");
 * });
 * ```
 */
export async function neonQuery<Row extends QueryResultRow = QueryResultRow>(
  env: Env,
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<Row>> {
  return withNeon(env, (client) => client.query<Row>(text, values));
}

/**
 * Execute multiple queries within a single transaction and connection.
 * 
 * ALWAYS USE THIS when executing multiple related queries:
 * - Teacher candidate/profile/link inserts (3 queries → 1 transaction)
 * - Signal event extraction loops (batch INSERT instead of loop)
 * - Enrichment result writes with metadata updates
 * - Qualification and enrollment steps
 * 
 * Benefits:
 * - Single connection reused for all statements
 * - Automatic rollback on error
 * - Atomic writes (no partial updates on failure)
 * - ~80% reduction in round-trip time for multi-query operations
 * 
 * @example
 * ```ts
 * const result = await neonTransaction(env, async (client) => {
 *   const inserted = await client.query(
 *     `INSERT INTO teacher_candidates (...) VALUES ($1, $2, ...) ON CONFLICT (...) DO UPDATE ...`,
 *     [firstName, lastName, ...]
 *   );
 *   const profileId = inserted.rows[0].id;
 *   await client.query(
 *     `INSERT INTO teacher_signal_links (...) VALUES ($1, $2, ...)`,
 *     [profileId, signalEventId]
 *   );
 *   return profileId;
 * });
 * ```
 */
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

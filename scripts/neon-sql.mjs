import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");

const mode = process.argv[2] ?? "migrate";
const directory = resolve("database/neon");
const entries = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
const selected = mode === "seed"
  ? entries.filter((name) => /seed/i.test(name))
  : entries.filter((name) => !/seed/i.test(name));

const client = new pg.Client({ connectionString, statement_timeout: 120_000 });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtext('benjamin-signal-os-migrations'))");
  await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
    filename text PRIMARY KEY,
    sha256 text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const filename of selected) {
    const sql = await readFile(resolve(directory, filename), "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");
    const previous = await client.query("SELECT sha256 FROM public.schema_migrations WHERE filename = $1", [filename]);
    if (previous.rowCount) {
      if (previous.rows[0].sha256 !== sha256) throw new Error(`Applied migration changed: ${filename}`);
      process.stdout.write(`skip ${filename}\n`);
      continue;
    }
    await client.query(sql);
    await client.query("INSERT INTO public.schema_migrations (filename, sha256) VALUES ($1, $2)", [filename, sha256]);
    process.stdout.write(`apply ${filename}\n`);
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('benjamin-signal-os-migrations'))").catch(() => undefined);
  await client.end();
}

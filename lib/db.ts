import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

const g = globalThis as unknown as { __mindforumPool?: Pool };

function buildPool(): Pool {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error("POSTGRES_URL is not set");
  }
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function pool(): Pool {
  if (!g.__mindforumPool) g.__mindforumPool = buildPool();
  return g.__mindforumPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool().query<T>(text, params as never[]);
}

/** Run a function in a single transaction. Commits on success, rolls back on throw. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

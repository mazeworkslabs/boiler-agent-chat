/**
 * Schema Cache — Introspects all external databases at startup
 * and caches table/column/type info for the db_researcher agent.
 *
 * This eliminates the need for agents to run information_schema queries
 * and prevents "column does not exist" errors from guessing.
 */

import postgres from "postgres";

interface ColumnInfo {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
}

const DB_URLS: Record<string, string | undefined> = {
  fbg_analytics: process.env.DATABASE_URL_FBG_ANALYTICS,
  naringslivsklimat: process.env.DATABASE_URL_NARINGSLIVSKLIMAT,
  scb_data: process.env.DATABASE_URL_SCB_DATA,
  fbg_planning: process.env.DATABASE_URL_FBG_PLANNING,
};

let cachedSchema = "";

export async function initSchemaCache(): Promise<void> {
  const parts: string[] = [];

  for (const [dbName, url] of Object.entries(DB_URLS)) {
    if (!url) {
      console.warn(`[SchemaCache] No URL for ${dbName}, skipping`);
      continue;
    }

    try {
      const sql = postgres(url, { connect_timeout: 5 });

      // Get all columns in public schema
      const columns = await sql<ColumnInfo[]>`
        SELECT table_name, column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `;

      // Get approximate row counts
      const rowCounts = await sql<{ tablename: string; estimate: string }[]>`
        SELECT c.relname AS tablename, c.reltuples::bigint AS estimate
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
      `;
      const countMap = new Map(rowCounts.map((r) => [r.tablename, Math.max(0, Number(r.estimate))]));

      // Group columns by table
      const tables = new Map<string, ColumnInfo[]>();
      for (const col of columns) {
        if (!tables.has(col.table_name)) tables.set(col.table_name, []);
        tables.get(col.table_name)!.push(col);
      }

      parts.push(`### ${dbName}`);
      for (const [tableName, cols] of tables) {
        const count = countMap.get(tableName) ?? 0;
        parts.push(`**${tableName}** (~${count} rader)`);
        for (const col of cols) {
          const nullable = col.is_nullable === "YES" ? ", nullable" : "";
          parts.push(`  - ${col.column_name}: ${col.data_type}${nullable}`);
        }
      }
      parts.push("");

      await sql.end();
      console.log(`[SchemaCache] Loaded ${tables.size} tables from ${dbName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SchemaCache] Failed for ${dbName}: ${msg}`);
      parts.push(`### ${dbName}\n(Kunde inte ladda schema — kör information_schema-queries manuellt)\n`);
    }
  }

  cachedSchema = parts.join("\n");
  console.log(`[SchemaCache] Ready (${cachedSchema.length} chars)`);
}

export function getSchemaContext(): string {
  return cachedSchema || "(Schema ej laddat — kör information_schema-queries manuellt)";
}

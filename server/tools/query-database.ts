import postgres from "postgres";
import { Type, type FunctionDeclaration } from "@google/genai";

const DB_CONFIGS: Record<string, string> = {
  fbg_analytics: process.env.DATABASE_URL_FBG_ANALYTICS!,
  naringslivsklimat: process.env.DATABASE_URL_NARINGSLIVSKLIMAT!,
  fbg_planning: process.env.DATABASE_URL_FBG_PLANNING!,
};

const connections = new Map<string, ReturnType<typeof postgres>>();

function getConnection(database: string): ReturnType<typeof postgres> {
  if (!connections.has(database)) {
    const url = DB_CONFIGS[database];
    if (!url) throw new Error(`Unknown database: ${database}. Available: ${Object.keys(DB_CONFIGS).join(", ")}`);
    connections.set(database, postgres(url));
  }
  return connections.get(database)!;
}

export async function queryDatabase(
  database: string,
  query: string
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  // Safety: only allow SELECT and WITH (CTE) statements
  const trimmed = query.trim().toUpperCase();
  if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) {
    throw new Error("Only SELECT queries are allowed");
  }

  // Block dangerous keywords
  const blocked = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE", "GRANT", "REVOKE"];
  for (const keyword of blocked) {
    // Match keyword as a whole word (not part of a column name)
    if (new RegExp(`\\b${keyword}\\b`, "i").test(query)) {
      throw new Error(`Blocked keyword: ${keyword}`);
    }
  }

  const sql = getConnection(database);
  const rows = await sql.unsafe(query);

  return {
    rows: rows as unknown as Record<string, unknown>[],
    rowCount: rows.length,
  };
}

// Tool definition for Anthropic API
export const queryDatabaseToolDefinition = {
  name: "query_database",
  description:
    "Kör en read-only SQL-query mot en av Business Falkenbergs PostgreSQL-databaser. Tillgängliga databaser: fbg_analytics (företagsdata, jobb), naringslivsklimat (KPIs för 14 kommuner, inkomst, bostäder), fbg_planning (århjulet/aktiviteter).",
  input_schema: {
    type: "object" as const,
    properties: {
      database: {
        type: "string",
        enum: ["fbg_analytics", "naringslivsklimat", "fbg_planning"],
        description: "Vilken databas att fråga",
      },
      query: {
        type: "string",
        description: "SQL SELECT-query att köra",
      },
    },
    required: ["database", "query"],
  },
};

// Tool definition for Gemini API
export const queryDatabaseGeminiTool: FunctionDeclaration = {
  name: "query_database",
  description: queryDatabaseToolDefinition.description,
  parameters: {
    type: Type.OBJECT,
    properties: {
      database: {
        type: Type.STRING,
        enum: ["fbg_analytics", "naringslivsklimat", "fbg_planning"],
        description: "Vilken databas att fråga",
      },
      query: {
        type: Type.STRING,
        description: "SQL SELECT-query att köra",
      },
    },
    required: ["database", "query"],
  },
};

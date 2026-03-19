/**
 * Add to Memory — Persistent per-user learning tool.
 *
 * Agents call this when they:
 * - Learn from a mistake (wrong column, double-counted data, etc.)
 * - Get corrected by the user
 * - Discover something useful about the data or tools
 *
 * Memory is stored as a markdown file per user in uploads/memory/.
 * All agents see the memory in their system prompt.
 */

import { Type, type FunctionDeclaration } from "@google/genai";
import { mkdir, readFile, appendFile, writeFile } from "fs/promises";
import path from "path";

const MEMORY_DIR = path.join(process.cwd(), "uploads", "memory");

const description = `Spara en lärdom eller insikt till ditt långtidsminne. Använd detta när:
- Du gör ett misstag och användaren rättar dig (t.ex. "den kolumnen finns inte", "du dubbelräknade")
- Du upptäcker något viktigt om datan (t.ex. "tabellen innehåller kvinnor/män/totalt — summera INTE")
- Du lär dig ett mönster som är bra att komma ihåg (t.ex. "SCB returnerar antal, inte procent")
Minnet sparas permanent och visas för alla agenter i framtida konversationer.`;

export const addToMemoryToolDefinition = {
  name: "add_to_memory",
  description,
  input_schema: {
    type: "object" as const,
    properties: {
      category: {
        type: "string" as const,
        enum: ["data_mistake", "tool_tip", "user_preference", "domain_knowledge"],
        description:
          "Kategori: data_mistake (fel i data/query), tool_tip (tips om verktyg), user_preference (användarens preferens), domain_knowledge (ämneskunskap)",
      },
      lesson: {
        type: "string" as const,
        description:
          "Kort, konkret lärdom. Skriv som en regel, t.ex. 'scb_income_distribution innehåller rader för kvinnor, män OCH totalt — filtrera på kön eller totalt, annars dubbelräknas allt.'",
      },
    },
    required: ["category", "lesson"],
  },
};

export const addToMemoryGeminiTool: FunctionDeclaration = {
  name: "add_to_memory",
  description,
  parameters: {
    type: Type.OBJECT,
    properties: {
      category: {
        type: Type.STRING,
        enum: ["data_mistake", "tool_tip", "user_preference", "domain_knowledge"],
        description: "Kategori för lärdomen",
      },
      lesson: {
        type: Type.STRING,
        description: "Kort, konkret lärdom formulerad som en regel",
      },
    },
    required: ["category", "lesson"],
  },
};

/**
 * Get the memory file path for a user.
 */
function getUserMemoryPath(userEmail: string): string {
  const safeEmail = userEmail.replace(/[^a-z0-9@._-]/gi, "_");
  return path.join(MEMORY_DIR, `${safeEmail}.md`);
}

/**
 * Load a user's memory. Returns empty string if no memory exists.
 */
export async function loadUserMemory(userEmail: string): Promise<string> {
  try {
    const content = await readFile(getUserMemoryPath(userEmail), "utf-8");
    return content.trim();
  } catch {
    return "";
  }
}

/**
 * Execute the add_to_memory tool.
 */
export async function executeAddToMemory(
  input: Record<string, unknown>,
  userEmail: string
): Promise<{ success: boolean; result: string }> {
  const category = input.category as string;
  const lesson = input.lesson as string;

  if (!lesson || lesson.trim().length < 5) {
    return { success: false, result: "Lärdomen är för kort. Skriv minst en mening." };
  }

  const categoryLabels: Record<string, string> = {
    data_mistake: "Datafel",
    tool_tip: "Verktygstips",
    user_preference: "Användarpreferens",
    domain_knowledge: "Domänkunskap",
  };

  const label = categoryLabels[category] || category;
  const timestamp = new Date().toISOString().split("T")[0];
  const entry = `\n- **[${label}]** (${timestamp}): ${lesson.trim()}`;

  await mkdir(MEMORY_DIR, { recursive: true });
  const memoryPath = getUserMemoryPath(userEmail);

  try {
    await readFile(memoryPath, "utf-8");
    // File exists — append
    await appendFile(memoryPath, entry + "\n");
  } catch {
    // File doesn't exist — create with header
    await writeFile(memoryPath, `# Minne — ${userEmail}\n${entry}\n`);
  }

  return {
    success: true,
    result: `Sparat till minnet: "${lesson.trim()}"`,
  };
}

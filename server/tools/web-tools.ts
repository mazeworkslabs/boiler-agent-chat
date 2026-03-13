import { Type, type FunctionDeclaration } from "@google/genai";

// --- web_fetch: hämta och parsa en webbsida ---

export const webFetchToolDefinition = {
  name: "web_fetch",
  description:
    "Hämta innehållet från en URL. Returnerar text-innehållet (HTML strippat till text om möjligt). Använd för att läsa webbsidor, API:er, dokumentation etc.",
  input_schema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description: "URL att hämta",
      },
      extract_text: {
        type: "boolean",
        description: "Om true, extrahera bara text (strippa HTML). Default: true.",
      },
    },
    required: ["url"],
  },
};

export const webFetchGeminiTool: FunctionDeclaration = {
  name: "web_fetch",
  description: webFetchToolDefinition.description,
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: { type: Type.STRING, description: "URL att hämta" },
      extract_text: {
        type: Type.BOOLEAN,
        description: "Om true, extrahera bara text. Default: true.",
      },
    },
    required: ["url"],
  },
};

function stripHtml(html: string): string {
  // Remove script and style tags with content
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common entities
  text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

export async function executeWebFetch(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: string }> {
  const url = input.url as string;
  const extractText = input.extract_text !== false; // default true

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BFAssistant/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return { success: false, result: `HTTP ${res.status}: ${res.statusText}` };
    }

    const contentType = res.headers.get("content-type") || "";
    const body = await res.text();

    if (extractText && contentType.includes("text/html")) {
      const text = stripHtml(body);
      // Limit to ~8000 chars to avoid overwhelming the model
      return {
        success: true,
        result: text.length > 8000 ? text.slice(0, 8000) + "\n\n... (trunkerat)" : text,
      };
    }

    // For JSON/text, return as-is (truncated)
    return {
      success: true,
      result: body.length > 8000 ? body.slice(0, 8000) + "\n\n... (trunkerat)" : body,
    };
  } catch (err) {
    return {
      success: false,
      result: err instanceof Error ? err.message : "Fetch error",
    };
  }
}

// --- web_search: sök på webben ---

export const webSearchToolDefinition = {
  name: "web_search",
  description:
    "Sök på webben efter information. Returnerar sökresultat med titlar, URLs och snippets. Använd för att hitta aktuell information, fakta, nyheter etc.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Sökfråga",
      },
    },
    required: ["query"],
  },
};

export const webSearchGeminiTool: FunctionDeclaration = {
  name: "web_search",
  description: webSearchToolDefinition.description,
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "Sökfråga" },
    },
    required: ["query"],
  },
};

export async function executeWebSearch(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: string }> {
  const query = input.query as string;

  // Use a simple approach: fetch DuckDuckGo HTML search and extract results
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BFAssistant/1.0)",
      },
      signal: AbortSignal.timeout(10000),
    });

    const html = await res.text();

    // Extract result snippets from DDG HTML
    const results: string[] = [];
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < 8) {
      const href = match[1];
      const title = stripHtml(match[2]);
      const snippet = stripHtml(match[3]);
      results.push(`[${title}](${href})\n${snippet}`);
    }

    if (results.length === 0) {
      return { success: true, result: "Inga sökresultat hittades." };
    }

    return { success: true, result: results.join("\n\n") };
  } catch (err) {
    return {
      success: false,
      result: err instanceof Error ? err.message : "Search error",
    };
  }
}

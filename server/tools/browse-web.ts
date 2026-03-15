/**
 * Browse Web — Playwright-based web browsing tool.
 *
 * Uses a real browser for JavaScript-heavy sites and SPAs.
 * Falls back to HTTP fetch if Playwright is not installed.
 * Supports optional screenshots saved as downloadable files.
 */

import { Type, type FunctionDeclaration } from "@google/genai";
import { writeFile, mkdir, stat } from "fs/promises";
import path from "path";
import { db } from "../db";
import { generatedFiles } from "../db/schema";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

const description = `Besök en webbsida med en riktig webbläsare (headless Chrome). Använd detta för JavaScript-tunga sidor, SPAs, eller sidor som kräver rendering. Kan ta screenshots. Faller tillbaka till HTTP-fetch om webbläsare ej är tillgänglig.`;

export const browseWebToolDefinition = {
  name: "browse_web",
  description,
  input_schema: {
    type: "object" as const,
    properties: {
      url: { type: "string", description: "URL att besöka" },
      screenshot: {
        type: "boolean",
        description: "Ta en screenshot av sidan (sparas som PNG). Default: false.",
      },
      wait_for: {
        type: "string",
        description: "CSS-selektor att vänta på innan innehåll extraheras. Optional.",
      },
    },
    required: ["url"],
  },
};

export const browseWebGeminiTool: FunctionDeclaration = {
  name: "browse_web",
  description,
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: { type: Type.STRING, description: "URL att besöka" },
      screenshot: { type: Type.BOOLEAN, description: "Ta screenshot. Default: false." },
      wait_for: { type: Type.STRING, description: "CSS-selektor att vänta på. Optional." },
    },
    required: ["url"],
  },
};

// Track whether Playwright is available (lazy-detected on first use)
let playwrightAvailable: boolean | null = null;

interface BrowseResult {
  text: string;
  screenshotFile?: { id: string; filename: string; mimeType: string; sizeBytes: number };
}

async function tryPlaywright(
  url: string,
  options: { screenshot?: boolean; waitFor?: string },
  sessionId?: string
): Promise<BrowseResult | null> {
  if (playwrightAvailable === false) return null;

  try {
    const pw = await import("playwright");
    playwrightAvailable = true;

    const browser = await pw.chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    if (options.waitFor) {
      await page.waitForSelector(options.waitFor, { timeout: 10000 }).catch(() => {});
    }

    // Extract text content
    const text = await page.evaluate(() => {
      document.querySelectorAll("script, style, noscript, svg").forEach((el) => el.remove());
      return document.body?.innerText || "";
    });

    let screenshotFile: BrowseResult["screenshotFile"];

    if (options.screenshot) {
      await mkdir(UPLOADS_DIR, { recursive: true });
      const fileId = crypto.randomUUID();
      const hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, "_");
      const filename = `screenshot_${hostname}.png`;
      const destPath = path.join(UPLOADS_DIR, `${fileId}.png`);

      const buffer = await page.screenshot({ fullPage: false });
      await writeFile(destPath, buffer);

      const fileStat = await stat(destPath);

      if (sessionId) {
        await db.insert(generatedFiles).values({
          id: fileId,
          sessionId,
          filename,
          mimeType: "image/png",
          filePath: destPath,
          sizeBytes: fileStat.size,
        });
      }

      screenshotFile = { id: fileId, filename, mimeType: "image/png", sizeBytes: fileStat.size };
    }

    await page.close();
    await browser.close();

    return { text, screenshotFile };
  } catch (err) {
    if (playwrightAvailable === null) {
      playwrightAvailable = false;
      console.log("[BrowseWeb] Playwright not available, using fetch fallback");
    } else {
      // Playwright is available but this specific page failed
      console.error("[BrowseWeb] Playwright error:", (err as Error).message);
    }
    return null;
  }
}

function stripHtml(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

async function fetchFallback(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; BFAssistant/1.0)",
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

  const body = await res.text();
  const contentType = res.headers.get("content-type") || "";
  return contentType.includes("text/html") ? stripHtml(body) : body;
}

export async function executeBrowseWeb(
  input: Record<string, unknown>,
  sessionId?: string
): Promise<{
  success: boolean;
  result: string;
  files?: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }>;
}> {
  const url = input.url as string;
  const screenshot = input.screenshot as boolean | undefined;
  const waitFor = input.wait_for as string | undefined;

  try {
    // Try Playwright first
    const pwResult = await tryPlaywright(url, { screenshot, waitFor }, sessionId);

    if (pwResult) {
      const truncated =
        pwResult.text.length > 8000
          ? pwResult.text.slice(0, 8000) + "\n\n... (trunkerat)"
          : pwResult.text;

      let result = truncated;
      if (pwResult.screenshotFile) {
        result += `\n\n📸 Screenshot sparad: ${pwResult.screenshotFile.filename}`;
      }

      return {
        success: true,
        result,
        files: pwResult.screenshotFile ? [pwResult.screenshotFile] : undefined,
      };
    }

    // Fallback to fetch
    const text = await fetchFallback(url);
    const truncated = text.length > 8000 ? text.slice(0, 8000) + "\n\n... (trunkerat)" : text;

    return {
      success: true,
      result: `(Hämtad med HTTP fetch — ej rendering)\n\n${truncated}`,
    };
  } catch (err) {
    return {
      success: false,
      result: err instanceof Error ? err.message : "Browse error",
    };
  }
}

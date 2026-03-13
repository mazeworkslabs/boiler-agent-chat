import { execFile } from "child_process";
import { writeFile, unlink, mkdir, readdir, copyFile, stat, symlink } from "fs/promises";
import path from "path";
import os from "os";
import { Type, type FunctionDeclaration } from "@google/genai";
import { db } from "../db";
import { generatedFiles } from "../db/schema";

const SANDBOX_DIR = path.join(os.tmpdir(), "chat-app-sandbox");
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const ASSETS_DIR = path.join(process.cwd(), "public", "assets");
const TIMEOUT_MS = 30_000;

// Python deps via uv
const UV_DEPS = [
  "pandas",
  "matplotlib",
  "requests",
  "beautifulsoup4",
  "numpy",
  "seaborn",
  "openpyxl",
  "tabulate",
  "Pillow",
  "python-pptx",
];

// npm packages pre-installed in JS sandbox
const NPM_DEPS = [
  "pptxgenjs",
  "xlsx",
  "json2csv",
  "cheerio",
  "marked",
];

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".json": "application/json",
  ".html": "text/html",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const description = `Kör kod i en sandboxad miljö. Stöder Python och JavaScript.
Python (default): Körs med uv. Bibliotek: ${UV_DEPS.join(", ")}.
JavaScript: Körs med Node.js. Bibliotek: ${NPM_DEPS.join(", ")}.
Timeout: ${TIMEOUT_MS / 1000}s. Filer som sparas i arbetskatalogen blir automatiskt nedladdningsbara.`;

export const runCodeToolDefinition = {
  name: "run_code",
  description,
  input_schema: {
    type: "object" as const,
    properties: {
      code: {
        type: "string",
        description: "Kod att köra",
      },
      language: {
        type: "string",
        enum: ["python", "javascript"],
        description: "Språk att köra. Default: python.",
      },
      description: {
        type: "string",
        description: "Kort beskrivning av vad koden gör",
      },
    },
    required: ["code"],
  },
};

export const runCodeGeminiTool: FunctionDeclaration = {
  name: "run_code",
  description,
  parameters: {
    type: Type.OBJECT,
    properties: {
      code: { type: Type.STRING, description: "Kod att köra" },
      language: {
        type: Type.STRING,
        enum: ["python", "javascript"],
        description: "Språk att köra. Default: python.",
      },
      description: { type: Type.STRING, description: "Kort beskrivning av vad koden gör" },
    },
    required: ["code"],
  },
};

export interface GeneratedFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

// Ensure JS sandbox has npm deps installed
let jsEnvReady = false;
const JS_ENV_DIR = path.join(SANDBOX_DIR, "_js_env");

async function ensureJsEnv(): Promise<string> {
  if (jsEnvReady) return JS_ENV_DIR;

  await mkdir(JS_ENV_DIR, { recursive: true });

  const pkgPath = path.join(JS_ENV_DIR, "package.json");
  await writeFile(pkgPath, JSON.stringify({ name: "sandbox", private: true }), "utf-8");

  await new Promise<void>((resolve, reject) => {
    execFile(
      "npm",
      ["install", "--save", ...NPM_DEPS],
      { cwd: JS_ENV_DIR, timeout: 60_000 },
      (err) => (err ? reject(err) : resolve())
    );
  });

  jsEnvReady = true;
  return JS_ENV_DIR;
}

async function runPython(code: string, runDir: string): Promise<{ stdout: string; stderr: string }> {
  const scriptPath = path.join(runDir, "script.py");
  await writeFile(scriptPath, code, "utf-8");

  const args = ["run", "--no-project"];
  for (const dep of UV_DEPS) {
    args.push("--with", dep);
  }
  args.push("python", scriptPath);

  return new Promise((resolve, reject) => {
    execFile("uv", args, {
      timeout: TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      cwd: runDir,
      env: { ...process.env },
    }, (error, stdout, stderr) => {
      if (error && !stdout && !stderr) reject(error);
      else resolve({ stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

async function runJavaScript(code: string, runDir: string): Promise<{ stdout: string; stderr: string }> {
  const jsEnvDir = await ensureJsEnv();
  const scriptPath = path.join(runDir, "script.mjs");

  // Prepend NODE_PATH so require/import can find the shared deps
  const wrappedCode = code;
  await writeFile(scriptPath, wrappedCode, "utf-8");

  return new Promise((resolve, reject) => {
    execFile("node", [scriptPath], {
      timeout: TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      cwd: runDir,
      env: {
        ...process.env,
        NODE_PATH: path.join(jsEnvDir, "node_modules"),
      },
    }, (error, stdout, stderr) => {
      if (error && !stdout && !stderr) reject(error);
      else resolve({ stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

export async function executeRunCode(
  input: Record<string, unknown>,
  sessionId?: string
): Promise<{ success: boolean; result: string; files?: GeneratedFile[] }> {
  const code = input.code as string;
  const language = (input.language as string) || "python";

  // Create a unique run directory to isolate files
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const runDir = path.join(SANDBOX_DIR, runId);
  await mkdir(runDir, { recursive: true });
  await mkdir(UPLOADS_DIR, { recursive: true });

  // Symlink brand assets into sandbox
  const assetsLink = path.join(runDir, "assets");
  await symlink(ASSETS_DIR, assetsLink).catch(() => {});

  // Snapshot existing files before run
  const filesBefore = new Set(await readdir(runDir));
  const scriptFile = language === "javascript" ? "script.mjs" : "script.py";

  try {
    const result = language === "javascript"
      ? await runJavaScript(code, runDir)
      : await runPython(code, runDir);

    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");

    // Detect new files created during execution
    const filesAfter = await readdir(runDir);
    const newFiles = filesAfter.filter(
      (f) => !filesBefore.has(f) && f !== scriptFile
    );

    const savedFiles: GeneratedFile[] = [];

    for (const filename of newFiles) {
      const ext = path.extname(filename).toLowerCase();
      const mimeType = MIME_TYPES[ext] || "application/octet-stream";
      const srcPath = path.join(runDir, filename);
      const fileStat = await stat(srcPath);

      if (fileStat.isFile() && fileStat.size > 0 && fileStat.size < 50 * 1024 * 1024) {
        const fileId = crypto.randomUUID();
        const destFilename = `${fileId}${ext}`;
        const destPath = path.join(UPLOADS_DIR, destFilename);

        await copyFile(srcPath, destPath);

        if (sessionId) {
          await db.insert(generatedFiles).values({
            id: fileId,
            sessionId,
            filename,
            mimeType,
            filePath: destPath,
            sizeBytes: fileStat.size,
          });
        }

        savedFiles.push({
          id: fileId,
          filename,
          mimeType,
          sizeBytes: fileStat.size,
        });
      }
    }

    let resultText = output || "(Ingen output)";
    if (savedFiles.length > 0) {
      resultText += `\n\n📎 Genererade filer:\n${savedFiles.map((f) => `- ${f.filename} (${formatBytes(f.sizeBytes)})`).join("\n")}`;
    }

    return {
      success: true,
      result: resultText,
      files: savedFiles.length > 0 ? savedFiles : undefined,
    };
  } catch (err) {
    return {
      success: false,
      result: err instanceof Error ? err.message : "Körningsfel",
    };
  } finally {
    await unlink(path.join(runDir, scriptFile)).catch(() => {});
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

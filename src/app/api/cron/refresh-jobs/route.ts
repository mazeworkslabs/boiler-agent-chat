/**
 * Cron endpoint: Refresh job postings from Arbetsförmedlingen (JobStream API).
 *
 * Fetches recent job ads for Falkenberg, classifies them with Gemini Flash Lite,
 * and upserts into fbg_analytics database (job_postings + job_classification_stats).
 *
 * Protected by CRON_SECRET. Intended to run monthly via system cron.
 *
 * Usage: GET /api/cron/refresh-jobs?secret=<CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import postgres from "postgres";

const FALKENBERG_LOCATION_ID = "qaJg_wMR_C8T";
const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
const BATCH_DELAY_MS = 500; // delay between Gemini calls to avoid rate limits

interface JobAd {
  id: string;
  headline: string;
  employer_name?: string;
  occupation_label?: string;
  publication_date: string;
  occupation_group?: string;
  employment_type?: string;
  number_of_vacancies?: number;
  working_hours_type?: string;
}

interface Classification {
  education_level: string;
  employer_type: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Fetch from JobStream API
// ---------------------------------------------------------------------------

async function fetchJobs(): Promise<JobAd[]> {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const url = new URL("https://jobstream.api.jobtechdev.se/stream");
  url.searchParams.set("date", ninetyDaysAgo.toISOString());
  url.searchParams.set("location-concept-id", FALKENBERG_LOCATION_ID);
  url.searchParams.set("limit", "500");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) throw new Error(`JobStream API error: ${res.status}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any[] = await res.json();

  return raw
    .filter((j) => !j.removed)
    .map((j) => ({
      id: j.id?.toString() || "",
      headline: j.headline || "",
      employer_name: j.employer?.name,
      occupation_label: j.occupation?.label,
      publication_date: j.publication_date || new Date().toISOString(),
      occupation_group: j.occupation_group?.label,
      employment_type: j.employment_type?.label,
      number_of_vacancies: j.number_of_vacancies ?? null,
      working_hours_type: j.working_hours_type?.label,
    }));
}

// ---------------------------------------------------------------------------
// Classify with Gemini Flash Lite
// ---------------------------------------------------------------------------

async function classifyJob(job: JobAd): Promise<Classification> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallbackClassify(job);

  const prompt = `Klassificera denna svenska jobbannons. Svara BARA med JSON.

Yrkestitel: ${job.occupation_label || "okänd"}
Rubrik: ${job.headline}
Arbetsgivare: ${job.employer_name || "okänd"}

Svara med: {"education_level":"<nivå>","employer_type":"<typ>","confidence":<0-1>}

education_level: "Grundskola", "Gymnasium", "Eftergymnasial", "Kandidat", "Master", "Ingen kravspecifikation"
employer_type: "Privat", "Offentlig", "Vård", "Utbildning"`;

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey });
    const res = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const text = res.text || "";
    const match = text.match(/\{[^}]+\}/);
    if (!match) return fallbackClassify(job);

    const parsed = JSON.parse(match[0]);
    return {
      education_level: parsed.education_level || "Ingen kravspecifikation",
      employer_type: parsed.employer_type || "Privat",
      confidence: Math.min(Math.max(parsed.confidence || 0.5, 0), 1),
    };
  } catch {
    return fallbackClassify(job);
  }
}

function fallbackClassify(job: JobAd): Classification {
  const text = `${job.headline} ${job.occupation_label} ${job.employer_name}`.toLowerCase();

  let education_level = "Ingen kravspecifikation";
  if (text.includes("högskol") || text.includes("kandidat") || text.includes("master")) {
    education_level = "Kandidat";
  } else if (text.includes("gymnasie") || text.includes("gymnasium")) {
    education_level = "Gymnasium";
  }

  let employer_type = "Privat";
  if (text.includes("kommun") || text.includes("region") || text.includes("myndighet")) {
    employer_type = "Offentlig";
  } else if (text.includes("skol") || text.includes("förskol")) {
    employer_type = "Utbildning";
  } else if (text.includes("vård") || text.includes("sjukhus")) {
    employer_type = "Vård";
  }

  return { education_level, employer_type, confidence: 0.4 };
}

// ---------------------------------------------------------------------------
// Database upsert
// ---------------------------------------------------------------------------

async function upsertJobs(
  sql: ReturnType<typeof postgres>,
  jobs: JobAd[],
  classifications: Map<string, Classification>
): Promise<number> {
  let count = 0;

  for (const job of jobs) {
    const cls = classifications.get(job.id);
    if (!cls) continue;

    await sql`
      INSERT INTO job_postings (
        original_af_id, headline, employer_name, occupation_label,
        publication_date, education_level, employer_type, confidence,
        occupation_group, employment_type, number_of_vacancies, working_hours_type
      ) VALUES (
        ${job.id}, ${job.headline}, ${job.employer_name || null}, ${job.occupation_label || null},
        ${job.publication_date.split("T")[0]}, ${cls.education_level}, ${cls.employer_type}, ${cls.confidence},
        ${job.occupation_group || null}, ${job.employment_type || null}, ${job.number_of_vacancies ?? null}, ${job.working_hours_type || null}
      )
      ON CONFLICT (original_af_id) DO UPDATE SET
        occupation_group = COALESCE(EXCLUDED.occupation_group, job_postings.occupation_group),
        employment_type = COALESCE(EXCLUDED.employment_type, job_postings.employment_type),
        number_of_vacancies = COALESCE(EXCLUDED.number_of_vacancies, job_postings.number_of_vacancies),
        working_hours_type = COALESCE(EXCLUDED.working_hours_type, job_postings.working_hours_type)
    `;
    count++;
  }

  return count;
}

async function upsertStats(
  sql: ReturnType<typeof postgres>,
  classifications: Map<string, Classification>
): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const stats = new Map<string, number>();

  for (const cls of classifications.values()) {
    const key = `${cls.education_level}|${cls.employer_type}`;
    stats.set(key, (stats.get(key) || 0) + 1);
  }

  for (const [key, count] of stats) {
    const [education_level, employer_type] = key.split("|");
    await sql`
      INSERT INTO job_classification_stats (stat_date, education_level, employer_type, job_count)
      VALUES (${today}, ${education_level}, ${employer_type}, ${count})
      ON CONFLICT (stat_date, education_level, employer_type)
      DO UPDATE SET job_count = job_classification_stats.job_count + EXCLUDED.job_count
    `;
  }
}

// ---------------------------------------------------------------------------
// API Route
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  // Auth check
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUrl = process.env.DATABASE_URL_FBG_ANALYTICS;
  if (!dbUrl) {
    return NextResponse.json({ error: "DATABASE_URL_FBG_ANALYTICS not set" }, { status: 500 });
  }

  const startTime = Date.now();

  try {
    // 1. Fetch jobs
    const allJobs = await fetchJobs();
    console.log(`[RefreshJobs] Fetched ${allJobs.length} jobs from JobStream`);

    // 2. Check which are new
    const sql = postgres(dbUrl);
    const existing = await sql`
      SELECT original_af_id FROM job_postings
      WHERE created_at > NOW() - INTERVAL '90 days'
    `;
    const existingIds = new Set(existing.map((r) => r.original_af_id));
    const newJobs = allJobs.filter((j) => !existingIds.has(j.id));

    console.log(`[RefreshJobs] ${newJobs.length} new jobs to classify`);

    if (newJobs.length === 0) {
      await sql.end();
      return NextResponse.json({
        status: "ok",
        message: "No new jobs",
        fetched: allJobs.length,
        new: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    // 3. Classify with Gemini
    const classifications = new Map<string, Classification>();
    for (let i = 0; i < newJobs.length; i++) {
      const cls = await classifyJob(newJobs[i]);
      classifications.set(newJobs[i].id, cls);

      if (i > 0 && i % 10 === 0) {
        console.log(`[RefreshJobs] Classified ${i}/${newJobs.length}`);
      }

      // Rate limit
      if (i < newJobs.length - 1) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    // 4. Upsert to database
    const upserted = await upsertJobs(sql, newJobs, classifications);
    await upsertStats(sql, classifications);
    await sql.end();

    const duration = Date.now() - startTime;
    console.log(`[RefreshJobs] Done: ${upserted} jobs upserted in ${duration}ms`);

    return NextResponse.json({
      status: "ok",
      fetched: allJobs.length,
      new: newJobs.length,
      upserted,
      duration_ms: duration,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[RefreshJobs] Error: ${message}`);
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}

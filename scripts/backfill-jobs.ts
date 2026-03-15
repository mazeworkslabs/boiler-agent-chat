/**
 * One-time backfill: Fetch historical job ads from Arbetsförmedlingen
 * and classify them with Gemini Flash Lite.
 *
 * Fills gaps in fbg_analytics.job_postings using the Historical API.
 *
 * Usage:
 *   # Requires SSH tunnel: ssh -L 5433:127.0.0.1:5433 glsfbg -N
 *   npx tsx scripts/backfill-jobs.ts
 *
 * Or on VPS:
 *   docker exec -it chat-app-app-1 npx tsx scripts/backfill-jobs.ts
 */

import "dotenv/config";
import postgres from "postgres";
import { GoogleGenAI } from "@google/genai";

const MUNICIPALITY = "1382"; // Falkenberg
const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
const BATCH_DELAY_MS = 400;
const PAGE_SIZE = 100;

const sql = postgres(process.env.DATABASE_URL_FBG_ANALYTICS!);
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// ---------------------------------------------------------------------------
// 1. Find gaps
// ---------------------------------------------------------------------------

async function findGapMonths(): Promise<{ from: string; to: string }[]> {
  const rows = await sql`
    SELECT date_trunc('month', publication_date) AS month, COUNT(*) AS cnt
    FROM job_postings
    WHERE publication_date >= '2025-01-01'
    GROUP BY 1 ORDER BY 1
  `;

  const gaps: { from: string; to: string }[] = [];
  const current = new Date("2025-01-01");
  const now = new Date();

  while (current < now) {
    const monthStr = current.toISOString().slice(0, 7);
    const row = rows.find((r) => (r.month as Date).toISOString().startsWith(monthStr));
    const count = row ? Number(row.cnt) : 0;

    // Normal month should have ~100-300 ads. Gap if < 50.
    if (count < 50) {
      const y = current.getFullYear();
      const m = current.getMonth();
      const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(y, m + 1, 0).getDate();
      const to = `${y}-${String(m + 1).padStart(2, "0")}-${lastDay}`;
      gaps.push({ from, to });
    }

    current.setMonth(current.getMonth() + 1);
  }

  return gaps;
}

// ---------------------------------------------------------------------------
// 2. Fetch from Historical API
// ---------------------------------------------------------------------------

interface HistoricalAd {
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

async function fetchHistorical(from: string, to: string): Promise<HistoricalAd[]> {
  const ads: HistoricalAd[] = [];
  let offset = 0;

  while (true) {
    const url = new URL("https://historical.api.jobtechdev.se/search");
    url.searchParams.set("municipality", MUNICIPALITY);
    url.searchParams.set("published-after", from);
    url.searchParams.set("published-before", to);
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", String(offset));

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) throw new Error(`Historical API ${res.status}: ${await res.text()}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const hits = data.hits || [];

    for (const h of hits) {
      ads.push({
        id: h.id?.toString() || "",
        headline: h.headline || "",
        employer_name: h.employer?.name,
        occupation_label: h.occupation?.label,
        publication_date: h.publication_date || "",
        occupation_group: h.occupation_group?.label,
        employment_type: h.employment_type?.label,
        number_of_vacancies: h.number_of_vacancies ?? null,
        working_hours_type: h.working_hours_type?.label,
      });
    }

    const total = data.total?.value || 0;
    offset += PAGE_SIZE;
    if (offset >= total || hits.length === 0) break;

    // Small delay between pages
    await new Promise((r) => setTimeout(r, 200));
  }

  return ads;
}

// ---------------------------------------------------------------------------
// 3. Classify with Gemini
// ---------------------------------------------------------------------------

async function classifyJob(job: HistoricalAd): Promise<{ education_level: string; employer_type: string; confidence: number }> {
  const prompt = `Klassificera jobbannons. Svara BARA JSON.
Rubrik: ${job.headline}
Yrke: ${job.occupation_label || "?"}
Arbetsgivare: ${job.employer_name || "?"}
Svar: {"education_level":"<Grundskola|Gymnasium|Eftergymnasial|Kandidat|Master|Ingen kravspecifikation>","employer_type":"<Privat|Offentlig|Vård|Utbildning>","confidence":<0-1>}`;

  try {
    const res = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const match = (res.text || "").match(/\{[^}]+\}/);
    if (!match) throw new Error("no json");
    const p = JSON.parse(match[0]);
    return {
      education_level: p.education_level || "Ingen kravspecifikation",
      employer_type: p.employer_type || "Privat",
      confidence: Math.min(Math.max(p.confidence || 0.5, 0), 1),
    };
  } catch {
    // Keyword fallback
    const t = `${job.headline} ${job.occupation_label}`.toLowerCase();
    return {
      education_level: t.includes("högskol") || t.includes("kandidat") ? "Kandidat" : t.includes("gymnasi") ? "Gymnasium" : "Ingen kravspecifikation",
      employer_type: t.includes("kommun") || t.includes("region") ? "Offentlig" : "Privat",
      confidence: 0.3,
    };
  }
}

// ---------------------------------------------------------------------------
// 4. Upsert to DB
// ---------------------------------------------------------------------------

async function upsertAd(ad: HistoricalAd, cls: { education_level: string; employer_type: string; confidence: number }) {
  await sql`
    INSERT INTO job_postings (
      original_af_id, headline, employer_name, occupation_label,
      publication_date, education_level, employer_type, confidence,
      occupation_group, employment_type, number_of_vacancies, working_hours_type
    ) VALUES (
      ${ad.id}, ${ad.headline}, ${ad.employer_name || null}, ${ad.occupation_label || null},
      ${ad.publication_date.split("T")[0]}, ${cls.education_level}, ${cls.employer_type}, ${cls.confidence},
      ${ad.occupation_group || null}, ${ad.employment_type || null}, ${ad.number_of_vacancies ?? null}, ${ad.working_hours_type || null}
    )
    ON CONFLICT (original_af_id) DO UPDATE SET
      education_level = EXCLUDED.education_level,
      employer_type = EXCLUDED.employer_type,
      confidence = EXCLUDED.confidence,
      occupation_group = COALESCE(EXCLUDED.occupation_group, job_postings.occupation_group),
      employment_type = COALESCE(EXCLUDED.employment_type, job_postings.employment_type),
      number_of_vacancies = COALESCE(EXCLUDED.number_of_vacancies, job_postings.number_of_vacancies),
      working_hours_type = COALESCE(EXCLUDED.working_hours_type, job_postings.working_hours_type)
  `;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("🔍 Finding gap months...");
  const gaps = await findGapMonths();

  if (gaps.length === 0) {
    console.log("✅ No gaps found!");
    await sql.end();
    return;
  }

  console.log(`📅 Found ${gaps.length} gap months: ${gaps.map((g) => g.from.slice(0, 7)).join(", ")}`);

  let totalUpserted = 0;

  for (const gap of gaps) {
    console.log(`\n📡 Fetching ${gap.from} → ${gap.to}...`);
    const ads = await fetchHistorical(gap.from, gap.to);
    console.log(`   ${ads.length} ads found`);

    // Filter out already existing
    const existingIds = new Set(
      (await sql`SELECT original_af_id FROM job_postings WHERE original_af_id = ANY(${ads.map((a) => a.id)})`).map((r) => r.original_af_id)
    );
    const newAds = ads.filter((a) => !existingIds.has(a.id));
    console.log(`   ${newAds.length} new (${existingIds.size} already exist)`);

    for (let i = 0; i < newAds.length; i++) {
      const cls = await classifyJob(newAds[i]);
      await upsertAd(newAds[i], cls);
      totalUpserted++;

      if ((i + 1) % 25 === 0) {
        console.log(`   Classified ${i + 1}/${newAds.length}...`);
      }

      if (i < newAds.length - 1) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    console.log(`   ✅ ${newAds.length} upserted for ${gap.from.slice(0, 7)}`);
  }

  console.log(`\n🎉 Done! Total upserted: ${totalUpserted}`);
  await sql.end();
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});

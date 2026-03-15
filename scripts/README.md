# Scripts

## backfill-jobs.ts — Engångskörning

Fyller gap i `fbg_analytics.job_postings` med historisk data från Arbetsförmedlingens Historical API + Gemini Flash Lite-klassificering.

### Kör lokalt (med SSH-tunnel)

```bash
# Terminal 1 — SSH tunnel
ssh -L 5433:127.0.0.1:5433 glsfbg -N

# Terminal 2 — kör backfill
npx tsx scripts/backfill-jobs.ts
```

### Vad det gör

1. Hittar gap-månader (< 50 annonser) från 2025-01-01 och framåt
2. Hämtar historisk data från `historical.api.jobtechdev.se` per gap-månad
3. Klassificerar varje annons med Gemini Flash Lite (utbildningsnivå, arbetsgivartyp)
4. Upsert till `fbg_analytics.job_postings`

### Uppskattad tid

~400ms per annons (Gemini-klassificering). Gap jan-maj 2025 ≈ 1000 annonser ≈ 7-8 min.

### Efter körning

Verifiera med:
```sql
SELECT date_trunc('month', publication_date) AS month, COUNT(*)
FROM job_postings
WHERE publication_date >= '2025-01-01'
GROUP BY 1 ORDER BY 1;
```

Alla månader bör ha ~100-300 annonser.

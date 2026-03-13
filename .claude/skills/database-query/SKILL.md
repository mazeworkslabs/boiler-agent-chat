---
name: database-query
description: Fråga Business Falkenbergs PostgreSQL-databaser. Företagsekonomi, KPI:er, näringslivsklimat, verksamhetsplanering.
trigger: När användaren frågar om data, statistik, företag, KPI:er, indikatorer, aktiviteter, bostadspriser, inkomstfördelning, jobbstatistik, eller vill analysera siffror.
---

# Database Query Skill

Du har tillgång till verktyget `query_database` som kör read-only SQL mot Business Falkenbergs PostgreSQL-databaser.

## Tillgängliga databaser

### 1. `fbg_analytics` — Företagsdata & arbetsmarknad i Falkenberg
- **company_financials** — Bokslut per företag/år: omsättning, anställda, soliditet, resultat, rörelsemarginal, bransch (grov/fin), org_nummer
- **job_postings** — Platsannonser
- **scb_employment_stats** — SCB sysselsättningsstatistik
- **job_classification_stats** — Yrkesklassificeringar
- **education_cohort_data/stats** — Utbildningskohorter
- **education_heatmap_data** — Utbildningsheatmap

### 2. `naringslivsklimat` — Näringslivsindikatorer, 14 kustkommuner
- **municipalities** — id (4-siffrigt), name (Falkenberg = '1382')
- **indicator_definitions** — id, name, unit, source, description
- **indicator_values** — indicator_id, municipality_id, year, gender, value
- **scb_housing_detail** — Bostadspriser (permanent/fritid)
- **scb_income_distribution** — Inkomstfördelning P1-P100, D1-D10
- **scb_leading_indicators** — Ledande indikatorer

### 3. `scb_data` — KPI:er och ekonomisk data
- **kpis** — id, name, description
- **kpi_data** — kpi_id, municipality_id, period, gender, value
- **municipalities** — id, name
- **economic_data** — Ekonomisk data
- **commute_flows** — Pendlingsflöden mellan kommuner
- **municipal_data** — Kommundata

### 4. `fbg_planning` — Århjulet (verksamhetsplanering)
- **strategic_concepts** — Strategiska koncept
- **focus_areas** — Fokusområden: Service & Kompetens, Platsutveckling, Etablering & Innovation, Övrigt
- **activities** — Aktiviteter: title, description, start_date, end_date, responsible, status, weeks[]

## Riktlinjer

- Kör alltid **read-only** queries (SELECT). Aldrig INSERT/UPDATE/DELETE.
- Använd LIMIT om du inte vet hur stor resultaten blir.
- Falkenbergs kommun-id är `'1382'`.
- Förklara resultaten på svenska, med kontext.
- Om du behöver utforska en databas, börja med att lista tabeller eller kolla kolumner.
- Kombinera gärna data från flera databaser för rikare analyser.

## Exempel

```sql
-- Top 10 företag i Falkenberg efter omsättning 2023
SELECT foretag, omsattning, anstallda, bransch_grov
FROM company_financials
WHERE bokslutsaar = 2023
ORDER BY omsattning DESC NULLS LAST
LIMIT 10;

-- Falkenbergs befolkningsutveckling
SELECT year, value FROM indicator_values
WHERE indicator_id = 'N01951' AND municipality_id = '1382'
ORDER BY year;

-- Kommande aktiviteter i Århjulet
SELECT a.title, a.start_date, a.end_date, a.responsible, f.name as fokusomrade
FROM activities a
JOIN focus_areas f ON a.focus_area_id = f.id
WHERE a.start_date >= CURRENT_DATE
ORDER BY a.start_date;
```

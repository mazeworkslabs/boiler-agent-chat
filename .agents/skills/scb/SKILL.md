---
name: scb-api
description: Hämta data direkt från SCB (Statistiska centralbyrån) PxWeb API. Tabellkatalog, query-format, Python-hjälpfunktioner.
trigger: Befolkning, utbildning, arbetsmarknad, bostäder, inkomster, kommunalekonomi — statistik utanför våra databaser.
---

# SCB Data Assistant

Du är en expert på att hämta och bearbeta data från Statistiska centralbyråns (SCB) öppna API.
Standardkommun: **1382 Falkenberg**. Jämför alltid mot riket (00) om det är relevant.

## Användarens fråga/önskemål
$ARGUMENTS

---

## API-översikt

SCB har två API-versioner mot Statistikdatabasen:

| | PxWebApi v1 (stabil) | PxWebApi v2 (ny) |
|---|---|---|
| Bas-URL | `https://api.scb.se/OV0104/v1/doris/sv/ssd/` | `https://statistikdatabasen.scb.se/api/v2/` |
| Metod | GET (metadata) + **POST** (data) | **GET** + POST |
| Lanserad | ~2014 | Oktober 2025 |
| Max celler | ~100 000 | 150 000 |
| Rate limit | 30 req / 10 sek (per IP) | 30 req / 10 sek (per IP) |
| Status | Fungerar, **använd denna** | Ny, Swagger: `/api/v2/index.html` |

**Använd v1 som standard.** v2 kan vara instabil. Konverterare v1→v2 finns sedan jan 2026.

---

## v1 API – Så funkar det

### URL-struktur
```
https://api.scb.se/OV0104/v1/doris/{lang}/ssd/{PATH}/{TABELL}
```
- `{lang}`: `sv` eller `en`
- `{PATH}`: Hierarkisk sökväg, t.ex. `BE/BE0101/BE0101A`
- `{TABELL}`: Tabellnamn, t.ex. `BefolkningNy`

OBS: Paths i API:t har **inte** `START/` prefix (det används bara i webgränssnittet).

### Steg 1: Utforska strukturen (GET)
```bash
# Lista ämnesområden
curl -s "https://api.scb.se/OV0104/v1/doris/sv/ssd/" | python3 -m json.tool

# Lista tabeller under Befolkning > Befolkningsstatistik > Folkmängd
curl -s "https://api.scb.se/OV0104/v1/doris/sv/ssd/BE/BE0101/BE0101A/" | python3 -m json.tool
```

### Steg 2: Hämta metadata för en tabell (GET)
```bash
# Returnerar variabeldefinitioner: koder, möjliga värden, tidsperioder
curl -s "https://api.scb.se/OV0104/v1/doris/sv/ssd/BE/BE0101/BE0101A/BefolkningNy" | python3 -m json.tool
```

### Steg 3: Hämta data (POST)
```bash
curl -X POST \
  "https://api.scb.se/OV0104/v1/doris/sv/ssd/BE/BE0101/BE0101A/BefolkningNy" \
  -H "Content-Type: application/json" \
  -d '{
    "query": [
      {"code": "Region",       "selection": {"filter": "item", "values": ["1382"]}},
      {"code": "Civilstand",   "selection": {"filter": "item", "values": ["OG","G","SK","ÄNKL"]}},
      {"code": "Alder",        "selection": {"filter": "item", "values": ["tot"]}},
      {"code": "Kon",          "selection": {"filter": "item", "values": ["1","2"]}},
      {"code": "ContentsCode", "selection": {"filter": "item", "values": ["BE0101N1"]}},
      {"code": "Tid",          "selection": {"filter": "top",  "values": ["5"]}}
    ],
    "response": {"format": "json"}
  }'
```

### Query-format (POST body)
```json
{
  "query": [
    {
      "code": "VariabelKod",
      "selection": {
        "filter": "item|top|all|agg",
        "values": ["värde1", "värde2"]
      }
    }
  ],
  "response": {"format": "json"}
}
```

### Filter-typer
| filter | Beskrivning | Exempel |
|--------|-------------|---------|
| `item` | Specifika värden | `"values": ["1382", "00"]` |
| `top` | Senaste N perioder | `"values": ["5"]` (senaste 5 åren) |
| `all` | Alla värden | `"values": ["*"]` (använd sparsamt!) |
| `agg` | Aggregeringsnivå | `"values": ["Region"]` |

### Svarsformat
`"format"` kan vara: `json`, `json-stat2`, `csv`, `px`, `xlsx`

- **`json`** – enklast att parsa, `columns` + `data[].key` + `data[].values`
- **`json-stat2`** – renast för programmatisk parsing, standardiserat med `dimension` + `value`
- **`csv`** – semikolonseparerat, svensk decimalkomma. Bra för debug.

**OBS:** `json`-formatet returnerar bara koder (t.ex. "1382"), inte klartext ("Falkenberg"). Joina mot metadata eller använd `json-stat2` som inkluderar labels.

---

## Regionkoder

| Kommun | Kod | | Kommun | Kod |
|--------|-----|---|--------|-----|
| **Falkenberg** | **1382** | | Riket | 00 |
| Halmstad | 1380 | | Stockholm | 0180 |
| Laholm | 1381 | | Göteborg | 1480 |
| Varberg | 1383 | | Malmö | 1280 |
| Kungsbacka | 1384 | | Hallands län | 13 |
| Hylte | 1315 | | | |

Variabelkoden för kommun heter oftast `Region`, ibland `Kommun`. **Kolla alltid metadata (GET).**

---

## Tabellkatalog – Relevanta för näringslivsavdelning

### BEFOLKNING (BE)

| Tabell | Path | Innehåll | Period |
|--------|------|----------|--------|
| `BefolkningNy` | `BE/BE0101/BE0101A/BefolkningNy` | Folkmängd per region, civilstånd, ålder, kön | 1968– |
| `BefolkManad` | `BE/BE0101/BE0101A/BefolkManad` | Folkmängd per månad | 2000M01– |
| `FolkmangdNov` | `BE/BE0101/BE0101A/FolkmangdNov` | Folkmängd 1 november per ålder, kön | 2002– |
| `Befforandr` | `BE/BE0101/BE0101G/Befforandr` | Befolkningsförändringar (födda, döda, in-/utflyttade) | 2000–2019 |
| `ManadBefStatRegion` | `BE/BE0101/BE0101G/ManadBefStatRegion` | Befolkningsförändringar per månad | 2000M01– |
| `BefPrognRevN` | `BE/BE0401/BE0401A/BefPrognRevN` | SCB:s befolkningsprognos per kommun | Prognos |

**Variabler (BefolkningNy):**
- `Region`: Kommunkoder (00=Riket, 1382=Falkenberg)
- `Civilstand`: OG (ogift), G (gift), SK (skild), ÄNKL (änka/änkling)
- `Alder`: Enskilda år ("0"–"100+") eller "tot" (totalt)
- `Kon`: 1=män, 2=kvinnor
- `ContentsCode`: BE0101N1 (folkmängd), BE0101N2 (folkökning)
- `Tid`: År ("2024")

### INFLYTTNING / UTRIKES FÖDDA

| Tabell | Path | Innehåll | Period |
|--------|------|----------|--------|
| `UtrikesFoddaR` | `BE/BE0101/BE0101E/UtrikesFoddaR` | Utrikes födda efter region | 2000– |
| `FlyttningarK` | `BE/BE0101/BE0101J/FlyttningarK` | Flyttningar efter kommun, ålder, kön | 1997– |

### UTBILDNING (UF)

| Tabell | Path | Innehåll | Period |
|--------|------|----------|--------|
| `Utbildning` | `UF/UF0506/UF0506B/Utbildning` | Utbildningsnivå per region, ålder, kön | 1985– |

**Variabler (Utbildning):**
- `Region`: Kommunkoder
- `Alder`: Enskilda år (16–74) eller "tot16-74"
- `UtbildningsNiva`:
  - 1 = Förgymnasial <9 år
  - 2 = Förgymnasial 9–10 år
  - 3 = Gymnasial ≤2 år
  - 4 = Gymnasial 3 år
  - 5 = Eftergymnasial <3 år (YH, kortare högskola)
  - 6 = Eftergymnasial ≥3 år (kandidat, master)
  - 7 = Forskarutbildning
  - US = Uppgift saknas
- `Kon`: 1=män, 2=kvinnor
- `Tid`: År

### ARBETSMARKNAD – RAMS (AM) ⚠️

> **OBS:** RAMS avvecklades nov 2022 (sista ref.år: 2021). Ersatt av **BAS** (Befolkningens arbetsmarknadsstatus). RAMS-tabeller uppdateras INTE längre.
>
> **Tidsseriebrott 2019:** Fr.o.m. 2019 bytte RAMS datakälla (AGI istället för KU). Jämför INTE rakt av 2018 vs 2019+. Tabeller med suffix `N` eller under `AM0207Z` = ny tidsserie (2019–2021).

| Tabell | Path | Innehåll | Period |
|--------|------|----------|--------|
| `BefSyssAldKonK` | `AM/AM0207/AM0207H/BefSyssAldKonK` | Befolkning 16+ efter sysselsättning, kommun | 2004–2018 |
| `BefSyssAldKonKN` | `AM/AM0207/AM0207Z/BefSyssAldKonKN` | Samma, ny tidsserie | 2019–2021 |
| `DagSNIK` | `AM/AM0207/AM0207K/DagSNIK` | Dagbefolkning (arbetsplats) per bransch, kommun | 2008–2018 |
| `DagSNIN` | `AM/AM0207/AM0207Z/DagSNIN` | Samma, ny tidsserie | 2019–2021 |
| `NattSNIN` | `AM/AM0207/AM0207Z/NattSNIN` | Nattbefolkning (boende) per bransch, kommun | 2019–2021 |
| `ForetBolFormN` | `AM/AM0207/AM0207Z/ForetBolFormN` | Företagare efter bolagsform, kommun | 2019–2021 |
| `PendlingK` | `AM/AM0207/AM0207L/PendlingK` | Pendlare 16+ över kommungräns | 2004–2018 |
| `PendlingKN` | `AM/AM0207/AM0207Z/PendlingKN` | Pendlare 16–74, ny tidsserie | 2019–2021 |

**Sysselsättning-variabler (BefSyssAldKonKN):**
- `Sysselsattning`: FÖRV (förvärvsarbetande), EJFÖRV (ej förvärvsarbetande)
- `Alder`: Åldersgrupper (16-19, 20-24, 25-29, ..., 70-74)
- `Kon`: 1=män, 2=kvinnor

**Företagare-variabler (ForetBolFormN):**
- `Bolagsform`: FAB (eget AB), EF2 (egenföretagare exkl. AB)

### FÖRETAG & NÄRINGSVERKSAMHET (NV)

| Tabell | Path | Innehåll | Period |
|--------|------|----------|--------|
| `FodbTotAr` | `NV/NV0101/NV0101A/FodbTotAr` | Företag & anställda per bransch, storleksklass | 2008–2013 |
| `FDBR07` | `NV/NV0101/NV0101A/FDBR07` | Företag efter bransch SNI2007 | 2008– |

> **Tips:** För aktuella företagsdata, se SCB Företagsregistrets API (separat, certifikatkrav) – avsnitt längre ner.

### INKOMSTER (HE)

| Tabell | Path | Innehåll | Period |
|--------|------|----------|--------|
| `SamijasomKN` | `HE/HE0110/HE0110A/SamForvInk2` | Sammanräknad förvärvsinkomst per kommun | 1999– |

> **OBS:** Utforska `HE/HE0110/HE0110A/` med GET för att se aktuella tabellnamn – dessa ändras ibland.

### BOSTÄDER & BYGGANDE (BO)

| Tabell | Path | Innehåll | Period |
|--------|------|----------|--------|
| `LagenhetNybK` | `BO/BO0101/BO0101C/LagenhetNybK` | Nybyggda lägenheter per kommun | 1975– |
| `SmahsStatK` | `BO/BO0501/BO0501B/SmahsStatK` | Småhuspriser permanentboende per kommun | Varierar |
| `FastprisLanK` | `BO/BO0501/BO0501A/FastprisLanK` | Fastighetsprisindex per län | Varierar |

### KOMMUNALEKONOMI (OE)

| Tabell | Path | Innehåll | Period |
|--------|------|----------|--------|
| `SnijForandr` | `OE/OE0101/OE0101A/SnijForandr` | Kommunal skattesats | Varierar |
| `KmEkResultat` | `OE/OE0107/OE0107A/KmEkResultat` | Kommunens ekonomiska resultat | Varierar |

---

## Python-hjälpfunktioner

```python
import requests
import json
import time

BASE = "https://api.scb.se/OV0104/v1/doris/sv/ssd"

def scb_meta(path: str) -> dict:
    """GET metadata/variabler för en tabell eller nivå."""
    resp = requests.get(f"{BASE}/{path}")
    resp.raise_for_status()
    return resp.json()

def scb_query(path: str, query_items: list, fmt: str = "json"):
    """POST data från en tabell. Hanterar rate limiting."""
    payload = {"query": query_items, "response": {"format": fmt}}
    resp = requests.post(f"{BASE}/{path}", json=payload)
    if resp.status_code == 429:
        time.sleep(11)
        resp = requests.post(f"{BASE}/{path}", json=payload)
    resp.raise_for_status()
    if fmt in ("json", "json-stat", "json-stat2"):
        return resp.json()
    return resp.text

def falkenberg(code="Region"):
    """Standardfilter för Falkenberg."""
    return {"code": code, "selection": {"filter": "item", "values": ["1382"]}}

def riket_och_falkenberg(code="Region"):
    """Filter för Riket + Falkenberg (för jämförelse)."""
    return {"code": code, "selection": {"filter": "item", "values": ["00", "1382"]}}

def senaste(n=5):
    """Filter för senaste N tidsperioder."""
    return {"code": "Tid", "selection": {"filter": "top", "values": [str(n)]}}

def kon_totalt():
    """Båda kön."""
    return {"code": "Kon", "selection": {"filter": "item", "values": ["1", "2"]}}
```

### Exempel: Utbildningsnivå Falkenberg vs Riket
```python
data = scb_query("UF/UF0506/UF0506B/Utbildning", [
    riket_och_falkenberg(),
    {"code": "Alder",           "selection": {"filter": "item", "values": ["tot16-74"]}},
    {"code": "UtbildningsNiva", "selection": {"filter": "item", "values": ["1","2","3","4","5","6","7"]}},
    kon_totalt(),
    senaste(1)
])

# Summera män+kvinnor per region och utbildningsnivå
from collections import defaultdict
sums = defaultdict(lambda: defaultdict(int))
for row in data["data"]:
    region, niva, kon, year = row["key"]
    sums[region][niva] += int(row["values"][0])

# Beräkna andelar
for region in sums:
    total = sum(sums[region].values())
    print(f"\n{'Falkenberg' if region == '1382' else 'Riket'}:")
    for niva in sorted(sums[region]):
        andel = sums[region][niva] / total * 100
        print(f"  Nivå {niva}: {sums[region][niva]:>8,} ({andel:.1f}%)")
```

### Exempel: Pendlingsdata
```python
data = scb_query("AM/AM0207/AM0207Z/PendlingKN", [
    falkenberg(),
    kon_totalt(),
    senaste(3)
])
```

### Exempel: Befolkningsförändring per månad
```python
data = scb_query("BE/BE0101/BE0101G/ManadBefStatRegion", [
    falkenberg(),
    {"code": "ContentsCode", "selection": {"filter": "item", "values": ["BE0101AJ"]}},
    senaste(12)
])
```

---

## JavaScript (Node.js / fetch)

```javascript
const BASE = "https://api.scb.se/OV0104/v1/doris/sv/ssd";

async function scbQuery(path, queryItems, format = "json") {
  const resp = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: queryItems, response: { format } })
  });
  if (!resp.ok) throw new Error(`SCB ${resp.status}: ${resp.statusText}`);
  return format === "csv" ? resp.text() : resp.json();
}

// Folkmängd Falkenberg senaste 5 år
const data = await scbQuery("BE/BE0101/BE0101A/BefolkningNy", [
  { code: "Region",       selection: { filter: "item", values: ["1382", "00"] } },
  { code: "Civilstand",   selection: { filter: "item", values: ["OG","G","SK","ÄNKL"] } },
  { code: "Alder",        selection: { filter: "item", values: ["tot"] } },
  { code: "Kon",          selection: { filter: "item", values: ["1","2"] } },
  { code: "ContentsCode", selection: { filter: "item", values: ["BE0101N1"] } },
  { code: "Tid",          selection: { filter: "top",  values: ["5"] } }
]);
```

---

## v2 API – Kort referens

v2 använder GET med query params. Tabell-ID:n är `TABxxxx` (numeriskt, inte hierarkiskt).

```bash
# Metadata
curl "https://statistikdatabasen.scb.se/api/v2/tables/TAB5974"

# Data med GET
curl "https://statistikdatabasen.scb.se/api/v2/tables/TAB5974/data?valueCodes[Region]=1382&valueCodes[Tid]=top(5)&outputFormat=json"
```

Swagger: `https://statistikdatabasen.scb.se/api/v2/index.html`

---

## SCB Företagsregistrets API (separat)

**Inte PxWeb** – separat REST-API med certifikatautentisering.

- **Avgiftsfritt** sedan juni 2025
- Kontakt: `scbforetag@scb.se` (godkänn villkor → få .pfx-certifikat)
- Data: alla juridiska personer, arbetsställen, SNI, storleksklass, adress
- Filtrering per kommun, bransch, orgnr
- Max 2000 rader/anrop, 10 req/10 sek
- Uppdateras varje natt (mån–fre)

Mest relevant för **aktuella, enskilda** företagsdata. Statistikdatabasen ger historisk, aggregerad statistik.

---

## Instruktioner

1. **Tolka användarens fråga** – Identifiera vilken typ av data som efterfrågas
2. **Välj rätt tabell** – Använd tabellkatalogen ovan. Om osäker, utforska med GET
3. **Hämta metadata först** – Kör GET på tabellens path för att se exakta variabelkoder och tillgängliga värden/år
4. **Bygg query** – POST med korrekt JSON body. Inkludera alltid Falkenberg (1382), gärna Riket (00) för jämförelse
5. **Bearbeta** – SCB returnerar **antal**, inte procent. Beräkna andelar själv. Summera kön vid behov.
6. **Presentera tydligt** – Tabellformat, jämför mot riket, ange senaste tillgängliga år

## Vanliga misstag att undvika
- **Glöm inte metadata-steget.** Variabelkoder och möjliga värden varierar mellan tabeller.
- **Blanda inte gamla och nya RAMS-serier.** Tidsseriebrott 2019 pga AGI→KU.
- **`"filter": "all"`** kan ge enorma resultat som spräcker cell-limiten. Filtrera!
- **csv-format** har semikolon och svensk decimalkomma (`,` inte `.`).
- **json returnerar bara koder**, inte klartext. Joina mot metadata vid behov.
- **Paths i API:t har INTE `START/` prefix.** Webb-gränssnittet visar `START__BE__BE0101...` men API:t vill ha `BE/BE0101/...`
- **Senaste år: använd `"filter": "top"`** istället för att hårdkoda år.
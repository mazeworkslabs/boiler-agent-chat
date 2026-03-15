---
name: grafisk-profil
description: "Falkenbergs kommuns kompletta grafiska profil — färger, typsnitt, logotyper, designmönster. Använd vid skapande av presentationer, dokument, dashboards och annat visuellt material."
trigger: När visuellt material skapas — presentationer, dashboards, dokument, diagram
---

# Falkenbergs Kommun — Grafisk Profil

## Logotyper (tillgängliga i sandbox som `assets/logos/`)

| Fil | Användning |
|-----|------------|
| `assets/logos/fk-logo-white-horizontal.svg` | Vit liggande — mörka bakgrunder (SVG) |
| `assets/logos/fk-logo-black-horizontal.png` | Svart liggande — ljusa bakgrunder |
| `assets/logos/fk-logo-white-stacked.png` | Vit stående — mörka bakgrunder, begränsat utrymme |
| `assets/logos/fk-logo-black-stacked.png` | Svart stående — ljusa bakgrunder, begränsat utrymme |

### Placering
- Placeras i **nedre högra hörnet** (standard)
- Liggande variant är standard; stående vid begränsat utrymme
- **Vit logo** på mörka bakgrunder, **svart logo** på ljusa

---

## Färgpalett

### Primära färger (använd ofta)

| Namn | Hex | RGB (python-pptx) | Text |
|------|-----|-----|------|
| Kommunblå | `#1f4e99` | `RGBColor(0x1F, 0x4E, 0x99)` | Vit |
| Cyan | `#009fe3` | `RGBColor(0x00, 0x9F, 0xE3)` | Vit |
| Ängsgrön | `#52ae32` | `RGBColor(0x52, 0xAE, 0x32)` | Vit |

### Sekundära färger

| Namn | Hex | RGB | Text |
|------|-----|-----|------|
| Marinblå | `#13153b` | `RGBColor(0x13, 0x15, 0x3B)` | Vit |
| Blåklint | `#607ebe` | `RGBColor(0x60, 0x7E, 0xBE)` | Vit |
| Himmelsblå | `#86cedf` | `RGBColor(0x86, 0xCE, 0xDF)` | Svart |
| Kvällsblå | `#133E4D` | `RGBColor(0x13, 0x3E, 0x4D)` | Vit |
| Havsvik | `#0f8c9d` | `RGBColor(0x0F, 0x8C, 0x9D)` | Vit |
| Buteljgrön | `#146647` | `RGBColor(0x14, 0x66, 0x47)` | Vit |
| Blåstång | `#77bfb3` | `RGBColor(0x77, 0xBF, 0xB3)` | Svart |

### Accentfärger

| Namn | Hex | RGB | Text |
|------|-----|-----|------|
| Vinbär | `#ab0d1f` | `RGBColor(0xAB, 0x0D, 0x1F)` | Vit |
| Höstblad | `#f06e4e` | `RGBColor(0xF0, 0x6E, 0x4E)` | Svart |
| Havtorn | `#f39200` | `RGBColor(0xF3, 0x92, 0x00)` | Svart |
| Fbg-gul | `#ffd000` | `RGBColor(0xFF, 0xD0, 0x00)` | Svart |
| Magenta | `#e6007e` | `RGBColor(0xE6, 0x00, 0x7E)` | Vit |
| Stål | `#3d405b` | `RGBColor(0x3D, 0x40, 0x5B)` | Vit |

### Diagram-färger (5 kommunblå-toner för stapel/linje-diagram)

```python
CHART_COLORS = ["#1f4e99", "#009fe3", "#52ae32", "#f39200", "#607ebe"]
```

---

## Typsnitt

| Roll | Typsnitt | Vikt | Google Fonts |
|------|----------|------|--------------|
| Rubriker (h1, h2) | Montserrat | ExtraBold 800 | Ja |
| Underrubriker | Montserrat | Light 300 | Ja |
| Brödtext | Lato | Regular 400 | Ja |

### Storlekar

| Element | HTML (Tailwind) | python-pptx (Pt) |
|---------|-----------------|-------------------|
| H1 titel | `text-7xl` | `Pt(44)` |
| H2 sektionsrubrik | `text-5xl` | `Pt(32)` |
| H3 | `text-2xl`–`text-3xl` | `Pt(24)` |
| Brödtext | `text-lg`–`text-xl` | `Pt(16)` |
| Bildtexter | `text-sm` | `Pt(12)` |

### Google Fonts (för HTML-artifacts)

```html
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;800&family=Lato:wght@300;400&display=swap" rel="stylesheet">
```

---

## Designmönster

### Rekommenderade färgkombinationer

| Slide-typ | Bakgrund | Logo |
|-----------|----------|------|
| Titel | Kommunblå `#1f4e99` | Vit |
| Innehåll | Vit / ljus gradient | Svart |
| Statistik/data | Vit | Svart |
| Citat/highlight | Cyan `#009fe3` | Vit |
| Avslut/tack | Kommunblå eller Ängsgrön | Vit |

### Riktlinjer
- Logo i nedre högra hörnet
- Variera layouter: 2-kolumner, stor siffra + text, diagram + text
- Varje slide ska ha ett visuellt element — inte bara text
- `rounded-2xl` på kort/boxar, `shadow-xl` på vita kort
- Lucide-ikoner via CDN för HTML-artifacts

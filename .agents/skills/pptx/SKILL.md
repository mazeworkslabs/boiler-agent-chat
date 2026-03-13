---
name: pptx
description: "Skapa PowerPoint-presentationer (.pptx) med python-pptx via run_code-verktyget. Använd Falkenbergs kommuns grafiska profil med färger, typsnitt och logotyper."
---

# Presentationer med python-pptx

Skapa presentationer med `python-pptx` via `run_code`-verktyget. Använd INTE pptxgenjs eller Node.js — vår sandbox kör Python.

## Grafisk profil — Falkenbergs kommun

### Färger (hex)
| Användning | Hex | RGB |
|-----------|-----|-----|
| Primär | `#1B5E7B` | `RGBColor(0x1B, 0x5E, 0x7B)` |
| Primär mörk | `#0D3B52` | `RGBColor(0x0D, 0x3B, 0x52)` |
| Primär ljus | `#4A9BC7` | `RGBColor(0x4A, 0x9B, 0xC7)` |
| Sekundär/guld | `#E8A838` | `RGBColor(0xE8, 0xA8, 0x38)` |
| Accent/grön | `#2E8B57` | `RGBColor(0x2E, 0x8B, 0x57)` |
| Mörk text | `#1A1E2E` | `RGBColor(0x1A, 0x1E, 0x2E)` |
| Ljus bakgrund | `#F7F8FA` | `RGBColor(0xF7, 0xF8, 0xFA)` |

### Typsnitt
- **Rubriker**: Georgia, 36–44pt (titel), 20–24pt (underrubrik)
- **Brödtext**: Calibri, 14–16pt
- **Bildtexter**: Calibri, 10–12pt

### Logotyper (tillgängliga i sandbox)
- `assets/logos/fk-logo-black-horizontal.png` — Svart liggande
- `assets/logos/fk-logo-color-horizontal.png` — Färg liggande
- `assets/logos/fk-logo-black-stacked.png` — Svart stående
- `assets/logos/fk-logo-color-stacked.png` — Färg stående
- `assets/logos/fk-logo-white-stacked.png` — Vit stående (för mörka bakgrunder)

## Grundmall

```python
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

# Grafisk profil
PRIMARY = RGBColor(0x1B, 0x5E, 0x7B)
PRIMARY_DARK = RGBColor(0x0D, 0x3B, 0x52)
PRIMARY_LIGHT = RGBColor(0x4A, 0x9B, 0xC7)
SECONDARY = RGBColor(0xE8, 0xA8, 0x38)
ACCENT = RGBColor(0x2E, 0x8B, 0x57)
DARK = RGBColor(0x1A, 0x1E, 0x2E)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)

def add_text(slide, left, top, width, height, text,
             size=14, font="Calibri", bold=False, color=DARK, align=PP_ALIGN.LEFT):
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = text
    p.font.size = Pt(size)
    p.font.name = font
    p.font.bold = bold
    p.font.color.rgb = color
    p.alignment = align
    return box

def set_bg(slide, color):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color

# Titelsida
slide = prs.slides.add_slide(prs.slide_layouts[6])
set_bg(slide, PRIMARY_DARK)
add_text(slide, 1, 2, 11, 1.5, "Titel", size=44, font="Georgia", bold=True, color=WHITE)
add_text(slide, 1, 3.7, 11, 0.8, "Underrubrik", size=20, color=PRIMARY_LIGHT)
slide.shapes.add_picture("assets/logos/fk-logo-white-stacked.png", Inches(10.5), Inches(5.5), Inches(2))

prs.save("presentation.pptx")
```

## Inkludera diagram (matplotlib → bild → slide)

```python
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(8, 5))
ax.bar(["A", "B", "C"], [10, 20, 15], color="#1B5E7B")
ax.set_title("Diagram", fontfamily="Georgia")
plt.tight_layout()
plt.savefig("chart.png", dpi=200, bbox_inches="tight")
plt.close()

# Lägg in i presentation
slide = prs.slides.add_slide(prs.slide_layouts[6])
slide.shapes.add_picture("chart.png", Inches(1), Inches(1.5), Inches(8))
```

## Design-riktlinjer
- Använd `prs.slide_layouts[6]` (Blank) för full kontroll
- Mörk bakgrund (PRIMARY_DARK) för titel + avslut, ljus för innehåll
- Logotyp i hörnet på varje slide eller på titel + avslut
- Variera layouter: 2-kolumner, stor siffra + text, diagram + text
- Minst 0.5" marginaler, 0.3–0.5" mellan element
- Varje slide ska ha ett visuellt element — inte bara text
- Filen sparas automatiskt som nedladdningsbar .pptx

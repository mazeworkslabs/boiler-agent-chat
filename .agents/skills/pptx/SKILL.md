---
name: pptx
description: "Skapa PowerPoint-presentationer (.pptx) med python-pptx via run_code-verktyget."
---

# Presentationer med python-pptx

Skapa presentationer med `python-pptx` via `run_code`-verktyget.

## VIKTIGA REGLER
- Kör ALL kod i ETT enda run_code-anrop — dela INTE upp i flera anrop
- Avsluta ALLTID med `prs.save("filnamn.pptx")` och `print("OK")`
- Testa att logotyper finns med `os.path.exists()` innan du lägger till dem
- Använd ALLTID färger och typsnitt från grafisk-profil-skillen
- Logotyper finns i `assets/logos/`

## Grundmall

```python
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

# Falkenbergs grafiska profil
KOMMUNBLA = RGBColor(0x1F, 0x4E, 0x99)
MARINBLA = RGBColor(0x13, 0x15, 0x3B)
CYAN = RGBColor(0x00, 0x9F, 0xE3)
ANGSGRON = RGBColor(0x52, 0xAE, 0x32)
HAVTORN = RGBColor(0xF3, 0x92, 0x00)
STAL = RGBColor(0x3D, 0x40, 0x5B)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
DARK = RGBColor(0x13, 0x15, 0x3B)

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)

def add_text(slide, left, top, width, height, text,
             size=16, font="Lato", bold=False, color=DARK, align=PP_ALIGN.LEFT):
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
set_bg(slide, KOMMUNBLA)
add_text(slide, 1, 2, 11, 1.5, "Titel", size=44, font="Montserrat", bold=True, color=WHITE)
add_text(slide, 1, 3.7, 11, 0.8, "Underrubrik", size=20, font="Montserrat", color=CYAN)
slide.shapes.add_picture("assets/logos/fk-logo-white-stacked.png", Inches(10.5), Inches(5.5), Inches(2))

prs.save("presentation.pptx")
```

## Inkludera diagram (matplotlib → bild → slide)

```python
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(8, 5))
ax.bar(["A", "B", "C"], [10, 20, 15], color=["#1f4e99", "#009fe3", "#52ae32"])
ax.set_title("Diagram", fontfamily="sans-serif", fontweight="bold")
plt.tight_layout()
plt.savefig("chart.png", dpi=200, bbox_inches="tight")
plt.close()

slide = prs.slides.add_slide(prs.slide_layouts[6])
slide.shapes.add_picture("chart.png", Inches(1), Inches(1.5), Inches(8))
```

## Design-riktlinjer
- Använd `prs.slide_layouts[6]` (Blank) för full kontroll
- Kommunblå bakgrund för titel + avslut, vit för innehåll
- Vit logo på mörka bakgrunder, svart logo på ljusa
- Variera layouter: 2-kolumner, stor siffra + text, diagram + text
- Minst 0.5" marginaler, 0.3–0.5" mellan element
- Varje slide ska ha ett visuellt element — inte bara text

# Export for print and the screen

The export turns the graph into a file: a vector PDF or a picture for printing, from a photo print to an A0 poster or a glued wall of sheets, or SVG and PNG for the screen. It exports what the graph shows — in «Roots», the lines and the kin around them — with portraits and names in any script.

Other guides: [interface](interface.md) · [data](data.md) · [import](import.md).

![Print: reading distance, a larger sheet in one click, an area of the graph, tiles](https://raw.githubusercontent.com/vladushked/genealogy-graph-media/main/guides/export-print.gif)

Open the graph's side panel (the gear), the **Export** section, **Export…**. **Purpose** chooses **Print** or **Screen**. The preview is the sheet itself — paper, margins, bleed, crop marks and the part of the graph it holds — redrawn on every change, and the dialog remembers its settings.

## Print

**Print starts from reading, not from the sheet.** **How it will be looked at** sets the size of the names:

| Choice | Names |
|---|---|
| In hands, ~40 cm | 9 pt |
| On a table or a wall nearby, ~1 m | 14 pt |
| On a wall from afar, ~2 m | 24 pt |
| Own name size | from 6 pt |

The name size fixes the scale, and a line under the settings says what the print will actually give: «Names 9 pt · letters 3.2 mm — read from ~40 cm», orange when names come out smaller than asked, red below 6 pt («unreadable»). A whole tree squeezed onto A0 no longer looks fine and prints at 1 mm.

### What to print

- **Whole graph** on one sheet, as large as the sheet allows. When names come out smaller than asked, the dialog names the smallest standard sheet that would do and takes it in one click («Take A2»), or says there is no such sheet («1.80 m × 1.78 m») and points to **Area**, **Tiles** or a roll. **Lay the graph out for the sheet** lays the graph out again for the sheet's proportions, with less empty space. On a plotter roll the width is fixed and the length follows the graph, up to 5 m (the PDF limit).
- **Area** on one sheet: over a miniature of the whole graph lies a frame of the sheet's shape, sized by the reading scale; drag it, or click where it should go, to print that part — your branch on A4 or on 10×15 photo paper.
- **Tiles**: the graph at the reading scale over a grid of sheets with an overlap (10 mm by default), in whichever orientation needs fewer sheets. Each sheet carries «Sheet 5 of 12 · row 2, column 1» and a dashed line where the next sheet is glued over. PDF only.

### Paper

ISO A6–2A0 and B4–B0; photo 10×15 to 60×90 cm; US Letter, Legal, Tabloid; plotter rolls 610, 914 and 1067 mm; any custom size. **Orientation** is automatic or fixed; **Margins** in mm.

### Files

- **PDF** is vector, the font embedded: sharp at any size, the format for a print shop.
- **PNG** and **JPEG** are rendered at 150, 300 or 600 dpi, with the resolution written into the file so a photo lab prints them at the right size. A page too large for the browser's canvas is refused with the highest dpi that fits.
- Portraits are embedded at the resolution the print needs (the largest person at 300 dpi, up to 1024 px).
- **For a print shop**: **Bleed 3 mm** (the background runs past the trim, no white border after cutting) and **Crop marks** at the corners, outside the bleed.

## Screen

**Screen** exports SVG — vector, for the screen and for editing — or PNG of the whole graph or the visible area, in the graph's own proportions. SVG and PNG are drawn by Obsidian itself and use the system fonts for any script.

## Fonts

The PDF's bundled font, DejaVu Sans, covers Latin (with Polish, Czech, Turkish and Vietnamese letters), Greek, Cyrillic, Armenian, Georgian, Hebrew and Arabic; Arabic is joined, and right-to-left names are written in display order.

For Chinese, Japanese, Korean, Indic and other scripts, put TrueType fonts (`.ttf`) into the vault and list them in **Settings → Fonts for PDF**, one path per line (for example Noto Sans SC, Noto Sans KR). Each name is written with the first font that has all its letters, and the export says which letters no font has. OpenType/CFF fonts (`.otf`) and collections (`.ttc`) cannot be embedded.

## On a phone or a tablet

A download does nothing in the mobile app, so the file is saved into the vault — into the attachments folder — and opens there; share it from Obsidian.

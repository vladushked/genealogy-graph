import type { jsPDF } from 'jspdf';

/**
 * Text of an exported PDF in any script. jsPDF writes a string with one embedded TrueType font and knows nothing of
 * fallback, so a name is split into runs, each written with the first font that has its letters: the bundled DejaVu
 * Sans (Latin, Greek, Cyrillic, Armenian, Georgian, Hebrew, Arabic), then the fonts chosen in the settings (Chinese,
 * Japanese, Korean, Indic…). Arabic is shaped by jsPDF; right-to-left text is reordered for display.
 */

/** A TrueType font for the PDF: its name in jsPDF and its file as base64. */
export interface PdfFontFile { name: string; base64: string }

/** Whether a font file has TrueType outlines (`00 01 00 00` or `true`), the kind jsPDF can embed. */
export function isTrueType(bytes: Uint8Array): boolean {
  const tag = String.fromCharCode(...bytes.subarray(0, 4));
  return tag === '\u0000\u0001\u0000\u0000' || tag === 'true';
}

export interface TextRun { font: number; text: string }

/** Spaces, digits and punctuation: they stay in the font of the letters around them. */
const NEUTRAL = /[\s\d\p{P}\p{S}]/u;
const ARABIC = /[\u0600-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;
const HEBREW = /[\u0590-\u05ff\ufb1d-\ufb4f]/;
/**
 * «Allah» as one ligature (U+FDF2), which few fonts have: its letters in their joined forms, kept apart by a ZWNJ so
 * jsPDF does not join them into the ligature again.
 */
const ALLAH = String.fromCharCode(0xfe8d, 0xfedf, 0x200c, 0xfee0, 0xfeea);

/**
 * Runs of text by font: each letter takes the first font that has it; neutral characters stay with the run they are
 * in when its font has them. Letters no font has are reported and left in the current run.
 */
export function fontRuns(text: string, covers: Array<(code: number) => boolean>): { runs: TextRun[]; missing: string[] } {
  const runs: TextRun[] = []; const missing = new Set<string>();
  for (const char of text) {
    const code = char.charCodeAt(0);
    const current = runs[runs.length - 1];
    let font: number;
    if (current && NEUTRAL.test(char) && covers[current.font](code)) font = current.font;
    else {
      const found = covers.findIndex((has) => has(code));
      if (found < 0 && !/\s/.test(char)) missing.add(char);
      font = found >= 0 ? found : current?.font ?? 0;
    }
    if (current && current.font === font) current.text += char; else runs.push({ font, text: char });
  }
  return { runs, missing: [...missing] };
}

interface FontMetadata { characterToGlyph(code: number): number }
type ShapingApi = jsPDF & { processArabic?(text: string): string };

/** Writes text into a PDF with the fonts it was given, collecting the letters none of them has. */
export class PdfText {
  readonly missing = new Set<string>();
  private readonly covers: Array<(code: number) => boolean> = [];

  constructor(private readonly pdf: jsPDF, private readonly fonts: PdfFontFile[]) {
    for (const font of fonts) {
      pdf.addFileToVFS(`${font.name}.ttf`, font.base64);
      pdf.addFont(`${font.name}.ttf`, font.name, 'normal');
      pdf.setFont(font.name, 'normal');
      const metadata = (pdf.getFont() as unknown as { metadata?: FontMetadata }).metadata;
      this.covers.push((code) => Boolean(metadata?.characterToGlyph(code)));
    }
    pdf.setFont(fonts[0].name, 'normal');
  }

  /** `text` at `x`, `y` (the baseline), aligned as a label is. */
  write(text: string, x: number, y: number, align: 'left' | 'center' | 'right') {
    const pdf = this.pdf;
    // Arabic letters become their contextual forms, in display order, before the fonts are asked for them: jsPDF
    // writes those forms and leaves text already in them alone.
    let shaped = text;
    if (ARABIC.test(text)) {
      shaped = (pdf as ShapingApi).processArabic?.(text) ?? text;
      if (!this.covers.some((has) => has(0xfdf2))) shaped = shaped.replace(/\ufdf2/g, ALLAH);
    }
    const { runs, missing } = fontRuns(shaped, this.covers);
    for (const char of missing) this.missing.add(char);
    // Hebrew is written in logical order and reordered by jsPDF's bidi engine as a right-to-left line; Arabic is
    // already in display order.
    const rtl = HEBREW.test(text) && !ARABIC.test(text) ? { isInputVisual: false, isOutputVisual: true, isInputRtl: true, isOutputRtl: false } : {};
    if (runs.length <= 1) {
      pdf.setFont(this.fonts[runs[0]?.font ?? 0].name, 'normal');
      pdf.text(shaped, x, y, { align, ...rtl });
      return;
    }
    const widths = runs.map((run) => { pdf.setFont(this.fonts[run.font].name, 'normal'); return pdf.getTextWidth(run.text); });
    const total = widths.reduce((sum, width) => sum + width, 0);
    let left = align === 'left' ? x : align === 'center' ? x - total / 2 : x - total;
    runs.forEach((run, index) => {
      pdf.setFont(this.fonts[run.font].name, 'normal');
      pdf.text(run.text, left, y, { align: 'left', ...rtl });
      left += widths[index];
    });
    pdf.setFont(this.fonts[0].name, 'normal');
  }
}

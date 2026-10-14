import { browser, expect } from '@wdio/globals';
import { openVault } from './helpers';

/**
 * Catches the files the dialog saves: the blob behind each link it clicks to download. Object URLs keep working, as
 * the dialog also makes them for portraits.
 */
const captureDownloads = () => browser.executeObsidian(() => {
  const win = window as unknown as { exported: Array<{ blob: Blob; name: string }>; blobs: Map<string, Blob> };
  win.exported = []; win.blobs = new Map();
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob: Blob) => { const url = create(blob); win.blobs.set(url, blob as Blob); return url; };
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    const blob = win.blobs.get(this.href);
    if (blob && this.download) win.exported.push({ blob, name: this.download });
  };
});
const exported = () => browser.executeObsidian(async () => Promise.all((window as unknown as { exported: Array<{ blob: Blob; name: string }> }).exported
  .map(async ({ blob, name }) => ({ type: blob.type, size: blob.size, name, head: await blob.slice(0, 600).text() }))));

async function openExport() {
  const header = browser.$('.graph-control-section-header=Экспорт');
  const section = header.parentElement().parentElement().parentElement();
  if ((await section.getAttribute('class')).includes('is-collapsed')) await header.click();
  await section.$('button=Экспорт…').click();
  await browser.$('.genealogy-export').waitForDisplayed();
}

describe('[EXPORT] export', () => {
  before(async () => { await openVault('scenarios'); await captureDownloads(); });

  it('[EXPORT-01] print: a vector PDF of the sheet, and a notice of the letters no font has', async () => {
    await openExport();
    const dialog = browser.$('.genealogy-export');
    await dialog.$('.genealogy-export-segments').$('button=Печать').click();
    await dialog.$('button=PDF').click();
    await expect(browser.$('.genealogy-export-status')).toHaveText(expect.stringContaining('PDF векторный'));
    await browser.$('.genealogy-export-side').$('button=Сохранить файл').click();
    await browser.waitUntil(async () => (await exported()).length === 1, { timeout: 60000 });
    const [pdf] = await exported();
    expect(pdf.head.startsWith('%PDF')).toBe(true);
    expect(pdf.size).toBeGreaterThan(50000);
    expect(pdf.name).toMatch(/^genealogy-graph-.+\.pdf$/);
    // 🙂 and 王小明 are in the vault; the bundled font has neither.
    await expect(browser.$('.notice-container')).toHaveText(expect.stringContaining('В шрифтах PDF нет букв'));
  });

  it('[EXPORT-02] screen: SVG of the whole graph with the font embedded', async () => {
    await openExport();
    const dialog = browser.$('.genealogy-export');
    await dialog.$('button=Экран').click();
    await dialog.$('button=SVG').click();
    await browser.$('.genealogy-export-side').$('button=Сохранить файл').click();
    await browser.waitUntil(async () => (await exported()).length === 2, { timeout: 30000 });
    const svg = (await exported())[1];
    expect(svg.type).toBe('image/svg+xml');
    expect(svg.head).toContain('<svg');
    expect(svg.name).toBe('genealogy-graph.svg');
  });
});

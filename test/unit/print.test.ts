import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canvasFits, clampCenter, fitPage, frameSize, jpegWithDpi, maxDpi, mmPerUnit, namePt, paperById, pixels, pngWithDpi,
  readability, readingDistance, regionPage, restoreExport, rollPage, sheetSize, smallestPaper, tilePages,
} from '../../src/print';
import { setLanguage } from '../../src/i18n';

// Messages and labels below are the Russian ones.
setLanguage('ru');

const graph = { x: 0, y: 0, width: 6922, height: 6663 }; // the 918-person test tree
const close = (actual: number, expected: number, digits = 2) => assert.equal(actual.toFixed(digits), expected.toFixed(digits));

test('a name size fixes the millimetres per graph unit, and back', () => {
  close(mmPerUnit(9) * 11, 9 * 25.4 / 72);
  close(namePt(mmPerUnit(14)), 14);
});

test('the whole test tree on A0 gives names too small to read; at 9 pt it is two metres wide', () => {
  const page = fitPage(graph, sheetSize(paperById('A0'), 'auto', 1, { w: 0, h: 0 }), 10);
  assert.ok(namePt(page.scale) < 4, `A0 names: ${namePt(page.scale)} pt`);
  assert.equal(readability(namePt(page.scale), 9), 'small');
  close(graph.width * mmPerUnit(9) / 1000, 2.0, 1);
  assert.equal(smallestPaper(graph, mmPerUnit(9), 10), null, 'no standard sheet holds it');
  assert.deepEqual(smallestPaper({ x: 0, y: 0, width: 1000, height: 700 }, mmPerUnit(9), 10)?.paper.id, 'B4');
});

test('reading distance follows the presets and readability compares with the target', () => {
  close(readingDistance(9), 0.4); close(readingDistance(14), 1); close(readingDistance(24), 2);
  assert.ok(readingDistance(11) > 0.4 && readingDistance(11) < 1);
  assert.equal(readability(9, 9), 'ok'); assert.equal(readability(7, 9), 'near'); assert.equal(readability(5, 9), 'small');
});

test('auto orientation follows the shape; custom paper takes its own size', () => {
  assert.deepEqual(sheetSize(paperById('A4'), 'auto', 2, { w: 0, h: 0 }), { w: 297, h: 210 });
  assert.deepEqual(sheetSize(paperById('A4'), 'auto', 0.5, { w: 0, h: 0 }), { w: 210, h: 297 });
  assert.deepEqual(sheetSize(paperById('photo-10x15'), 'portrait', 2, { w: 0, h: 0 }), { w: 100, h: 150 });
  assert.deepEqual(sheetSize(paperById('custom'), 'landscape', 1, { w: 300, h: 800 }), { w: 800, h: 300 });
});

test('a fitted page centres the graph and fills the printable area', () => {
  const page = fitPage({ x: 0, y: 0, width: 200, height: 100 }, { w: 210, h: 297 }, 5);
  close(page.view.width * page.scale, 200); close(page.view.height * page.scale, 287);
  close(page.view.x + page.view.width / 2, 100); close(page.view.y + page.view.height / 2, 50);
});

test('a roll keeps the readable scale unless the graph is wider than the roll', () => {
  const scale = mmPerUnit(9);
  const page = rollPage(graph, 914, 10, scale);
  assert.ok(page.scale < scale, 'narrowed to the roll');
  close(page.view.width * page.scale, 894);
  const small = rollPage({ x: 0, y: 0, width: 1000, height: 3000 }, 914, 10, scale);
  close(small.scale, scale); close(small.trimH, 3000 * scale + 20);
});

test('the region frame has the sheet shape at the readable scale and stays over the graph', () => {
  const sheet = { w: 150, h: 100 };
  const frame = frameSize(sheet, 0, mmPerUnit(9));
  close(frame.width / frame.height, 1.5);
  const page = regionPage({ x: 50, y: 50 }, sheet, 0, mmPerUnit(9));
  close(page.view.width, frame.width);
  assert.deepEqual(clampCenter({ x: -1000, y: 99999 }, frame, graph), { x: frame.width / 2, y: graph.height - frame.height / 2 });
  assert.deepEqual(clampCenter({ x: 5, y: 5 }, { width: 9000, height: 10 }, graph).x, graph.width / 2);
});

test('tiles cover the graph with overlapping sheets', () => {
  const scale = mmPerUnit(9);
  const { cols, rows, pages } = tilePages(graph, { w: 297, h: 420 }, 10, 10, scale);
  assert.equal(pages.length, cols * rows);
  const first = pages[0].view; const right = pages[1].view;
  close((first.x + first.width - right.x) * scale, 10);
  const last = pages[pages.length - 1].view;
  assert.ok(first.x <= graph.x && first.y <= graph.y);
  assert.ok(last.x + last.width >= graph.x + graph.width && last.y + last.height >= graph.y + graph.height);
  assert.equal(pages[1].label, `Лист 2 из ${cols * rows} · ряд 1, столбец 2`);
});

test('raster size, canvas limits and the highest dpi that fits', () => {
  assert.equal(pixels(100, 300), 1181);
  assert.ok(canvasFits(pixels(841, 300), pixels(1189, 300)));
  assert.ok(!canvasFits(pixels(1189, 600), pixels(1682, 600)));
  const dpi = maxDpi(1189, 1682);
  assert.ok(canvasFits(pixels(1189, dpi), pixels(1682, dpi)) && !canvasFits(pixels(1189, dpi + 5), pixels(1682, dpi + 5)));
});

test('dpi is written into PNG and JPEG headers', () => {
  // A minimal PNG: signature, IHDR, IEND.
  const png = Uint8Array.from(Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000049454e44ae426082', 'hex'));
  const out = pngWithDpi(png, 300);
  const text = Buffer.from(out).toString('latin1');
  assert.ok(text.indexOf('pHYs') > text.indexOf('IHDR') && text.indexOf('pHYs') < text.indexOf('IEND'));
  const at = text.indexOf('pHYs') + 4;
  assert.equal(Buffer.from(out).readUInt32BE(at), 11811);
  assert.equal(pngWithDpi(out, 150).length, out.length, 'an existing pHYs is replaced');
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const marked = jpegWithDpi(jpeg, 300);
  assert.deepEqual([marked[13], marked[14] * 256 + marked[15], marked[16] * 256 + marked[17]], [1, 300, 300]);
});

test('export settings restore with defaults and bounds', () => {
  const restored = restoreExport({ paper: 'A0', dpi: 299, margin: 999, mode: 'tiles', reading: 'far' });
  assert.deepEqual([restored.paper, restored.dpi, restored.margin, restored.mode, restored.reading], ['A0', 300, 50, 'tiles', 'far']);
  assert.equal(restoreExport(null).purpose, 'print');
});

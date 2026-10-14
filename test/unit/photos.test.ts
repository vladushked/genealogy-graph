import assert from 'node:assert/strict';
import test from 'node:test';
import { imageMime, resolvePhotoFile } from '../../src/photos';

const files = new Map([
  ['portrait.jpg', { extension: 'jpg', path: 'portrait.jpg' }],
  ['source.pdf', { extension: 'pdf', path: 'source.pdf' }],
  ['Pasted image 20251127002215.png', { extension: 'png', path: 'Pasted image 20251127002215.png' }],
]);
const resolve = (link: string) => files.get(link) ?? null;

test('explicit photo takes priority over embedded images', () => {
  const file = resolvePhotoFile('[[portrait.jpg|Фото]]', [
    { link: 'source.pdf' }, { link: 'Pasted image 20251127002215.png' },
  ], resolve);
  assert.equal(file?.path, 'portrait.jpg');
});

test('first embedded image is used when photo property is empty; PDFs are skipped', () => {
  const file = resolvePhotoFile(undefined, [
    { link: 'source.pdf' }, { link: 'Pasted image 20251127002215.png' },
  ], resolve);
  assert.equal(file?.path, 'Pasted image 20251127002215.png');
  assert.equal(imageMime('PDF'), null);
  assert.equal(imageMime('PNG'), 'image/png');
});

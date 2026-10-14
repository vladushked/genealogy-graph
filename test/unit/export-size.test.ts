import assert from 'node:assert/strict';
import test from 'node:test';
import { imagePixels } from '../../src/scene';

test('free-form image size follows the graph aspect ratio and stays within canvas limits', () => {
  assert.deepEqual(imagePixels({ x: 0, y: 0, width: 400, height: 200 }), [800, 400]);
  const [width, height] = imagePixels({ x: -5000, y: 0, width: 20000, height: 5000 });
  assert.equal(width, 8000);
  assert.equal(height, 2000);
});

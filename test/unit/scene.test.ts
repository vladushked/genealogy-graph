import assert from 'node:assert/strict';
import test from 'node:test';
import { NODE_RADIUS, renderSvg, sceneBounds, visualRadius, spouseCapsule, spouseGroups, labelSide, labelLayout, labelLines, deceasedColor, nodeRadius, SPOUSE_COLOR, SPOUSE_PAD, PATH_COLOR, type Scene } from '../../src/scene';
import { nameLines } from '../../src/model';

test('SVG export includes embedded portrait, Cyrillic label and typed relations', () => {
  const scene: Scene = {
    nodes: [
      { id: 'one', name: 'Иван <Первый>', generation: -1, x: 0, y: 0, color: '#ffffff', image: 'data:image/png;base64,AAAA', lifeYears: '1915?–1980' },
      { id: 'two', name: 'Мария', generation: 0, x: 100, y: 100, color: '#aabbcc' },
    ],
    edges: [{ from: 'one', to: 'two', relation: 'parent' }],
  };
  const svg = renderSvg(scene, sceneBounds(scene), 400, 300);
  assert.match(svg, /Иван &lt;Первый&gt;/);
  assert.match(svg, /1915\?–1980/);
  assert.equal(svg.match(/<text/g)?.length, 3); // A living person with no birth year gets no years line.
  assert.match(svg, /data:image\/png;base64,AAAA/);
  assert.match(svg, /marker-end="url\(#arrow\)"/);
  assert.doesNotMatch(svg, /Иван <Первый>/);
});

test('generation distance, portraits and selection change node size', () => {
  const ordinary = visualRadius(2, 2, false, false);
  assert.ok(visualRadius(5, 2, false, false) < ordinary);
  assert.ok(visualRadius(5, 2, true, false) > visualRadius(5, 2, false, false));
  assert.ok(visualRadius(5, 2, false, true) > visualRadius(5, 2, false, false));
});

test('more connections grow nodes with a bounded size while keeping portrait and selection bonuses', () => {
  const radius = (connections: number) => visualRadius(2, 2, false, false, connections);
  assert.equal(radius(0), visualRadius(2, 2, false, false));
  assert.ok(radius(1) > radius(0));
  assert.ok(radius(4) > radius(1));
  assert.ok(radius(12) > radius(4));
  assert.equal(radius(1000), radius(20));
  assert.equal(radius(1000), radius(0) * 2.6);
  assert.equal(visualRadius(2, 2, true, true, 4), radius(4) + 15);
  assert.ok(visualRadius(5, 2, false, false, 4) < radius(4));
});

test('exported node circles and links use the size calculated from connection count', () => {
  const scene: Scene = {
    nodes: [
      { id: 'hub', name: 'А', generation: 0, x: 0, y: 0, color: '#fff', radius: visualRadius(0, 0, false, false, 12) },
      { id: 'leaf', name: 'Б', generation: 1, x: 200, y: 0, color: '#fff', radius: visualRadius(0, 0, false, false, 1) },
    ],
    edges: [{ from: 'hub', to: 'leaf', relation: 'parent' }],
  };
  const svg = renderSvg(scene, sceneBounds(scene), 400, 300);
  const hub = Math.round(scene.nodes[0].radius! * 10) / 10;
  assert.ok(hub > 2 * NODE_RADIUS, 'a well-connected person is much larger');
  assert.match(svg, new RegExp(`<circle cx="0" cy="0" r="${hub}"`));
  assert.match(svg, new RegExp(`<line x1="${hub}" y1="0"`));
});

test('the shape around spouses hugs both circles, the larger one wrapping more', () => {
  const scene: Scene = {
    nodes: [
      { id: 'a', name: 'А', generation: 1, x: 0, y: 0, color: '#fff', radius: 32, image: 'data:image/png;base64,AAAA' },
      { id: 'b', name: 'Б', generation: 1, x: 60, y: 0, color: '#fff', radius: 22 },
    ],
    edges: [{ from: 'a', to: 'b', relation: 'spouse' }],
  };
  const [a, b] = scene.nodes;
  const { outline } = spouseCapsule(a, b);
  // Every point lies on one of the widened circles, never inside both.
  for (const point of outline) {
    const fromA = Math.hypot(point.x - a.x, point.y - a.y) - (nodeRadius(a) + SPOUSE_PAD);
    const fromB = Math.hypot(point.x - b.x, point.y - b.y) - (nodeRadius(b) + SPOUSE_PAD);
    assert.ok(Math.abs(fromA) < 1e-9 || Math.abs(fromB) < 1e-9);
    assert.ok(fromA > -1e-9 && fromB > -1e-9, 'the outline encloses both circles');
  }
  // Same turning direction whatever the orientation, so merged capsules fill as one shape.
  const turning = (points: { x: number; y: number }[]) => Math.sign(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0));
  assert.equal(turning(outline), turning(spouseCapsule(b, a).outline));
  assert.equal(turning(outline), turning(spouseCapsule(a, { ...b, x: 0, y: -60 }).outline));
  const svg = renderSvg(scene, sceneBounds(scene), 400, 300);
  assert.match(svg, new RegExp(`<g opacity="[0-9.]+"><path d="M[^"]*Z" fill="${SPOUSE_COLOR}"/></g>`));
  assert.match(svg, /width="64" height="64"/);
});

test('spouses linked through a shared spouse form one group', () => {
  const spouse = (from: string, to: string) => ({ from, to, relation: 'spouse' as const });
  const groups = spouseGroups([spouse('a', 'b'), spouse('c', 'b'), spouse('x', 'y'), { from: 'a', to: 'k', relation: 'parent' as const }]);
  assert.deepEqual(groups.map((group) => group.length).sort(), [1, 2]);
});

test('names go beside a couple, on the outer sides', () => {
  assert.equal(labelSide({ x: 0, y: 0 }, []), 'below');
  assert.equal(labelSide({ x: 0, y: 0 }, [{ x: 50, y: 5 }]), 'left');
  assert.equal(labelSide({ x: 50, y: 5 }, [{ x: 0, y: 0 }]), 'right');
  assert.equal(labelSide({ x: 0, y: 0 }, [{ x: -50, y: 0 }, { x: 50, y: 0 }]), 'below', 'between two spouses');
  assert.equal(labelSide({ x: 0, y: 0 }, [{ x: 5, y: 50 }]), 'below', 'a spouse above or below');
});

test('SVG veils portraits of deceased people and highlights a route', () => {
  const scene: Scene = {
    nodes: [
      { id: 'a', name: 'А', generation: 0, x: 0, y: 0, color: '#7299ef', radius: 32, deceased: true, pathHighlighted: true, image: 'data:image/png;base64,AAAA' },
      { id: 'b', name: 'Б', generation: 1, x: 120, y: 0, color: '#7299ef', dimmed: true },
    ],
    edges: [{ from: 'a', to: 'b', relation: 'parent', pathHighlighted: true }],
  };
  const svg = renderSvg(scene, sceneBounds(scene), 400, 300);
  assert.match(svg, /fill="#000" fill-opacity="0.4"/);
  assert.match(svg, /clip-path="url\(#portrait\)"/);
  assert.match(svg, /clipPathUnits="objectBoundingBox"/);
  assert.match(svg, new RegExp(`stroke="${PATH_COLOR}"`));
  assert.match(svg, /marker-end="url\(#path-arrow\)"/);
  assert.match(svg, /opacity="0.2"/);
  assert.match(renderSvg(scene, sceneBounds(scene), 400, 300, undefined, true), /stroke="#aa6200"/);
});

test('deceased people keep a darker shade of their generation color', () => {
  const dark = deceasedColor('#7299ef');
  const channels = (color: string) => [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
  const [r, g, b] = channels(dark);
  assert.ok(r + g + b < channels('#7299ef').reduce((sum, value) => sum + value, 0) * 0.7);
  assert.ok(b > r && b > g); // Still reads as the same blue generation.
  const svg = renderSvg({ nodes: [{ id: 'a', name: 'А', generation: 0, x: 0, y: 0, color: '#7299ef', deceased: true }], edges: [] }, { x: -50, y: -50, width: 100, height: 100 }, 100, 100);
  assert.match(svg, new RegExp(`fill="${dark}"`));
  assert.doesNotMatch(svg, /fill-opacity/);
});

test('generation sizes shrink step by step from the larger end; heat runs from blue to red', async () => {
  const { generationRadius, heatColor } = await import('../../src/scene');
  const range = { min: -4, max: 1 };
  const oldest = generationRadius(-4, range, true, false, false);
  assert.ok(oldest > generationRadius(-3, range, true, false, false));
  assert.equal(generationRadius(1, range, false, false, false), oldest, 'younger-larger mirrors older-larger');
  assert.ok(generationRadius(null, range, true, false, false) < oldest);
  assert.ok(generationRadius(1, range, true, false, false) >= 9);
  assert.ok(oldest > 2.5 * generationRadius(1, range, true, false, false), 'size differences are easy to see');
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [coldR, , coldB] = rgb(heatColor(0, 10)); const [hotR, , hotB] = rgb(heatColor(10, 10));
  assert.ok(coldB > coldR && hotR > hotB);
  assert.match(heatColor(3, 10), /^#[0-9a-f]{6}$/);
});

test('a name splits at the surname, with the birth surname above; names without a surname stay on one line', () => {
  assert.deepEqual(nameLines('Зуев Тимофей Ильич', 'Зуев'), ['Зуев', 'Тимофей Ильич']);
  assert.deepEqual(nameLines('Зуева Ольга Ильинична (Мельникова)', 'Зуева'), ['Зуева (Мельникова)', 'Ольга Ильинична']);
  assert.equal(nameLines('Софья Алексеевна', ''), undefined);
  assert.equal(nameLines('Солюшка', null), undefined);
  assert.equal(nameLines('Иванов', 'Иванов'), undefined);
  assert.equal(nameLines('Мария Петрова', 'Иванова'), undefined, 'a name not starting with the surname is left as is');
  assert.deepEqual(labelLines({ name: 'Софья Алексеевна' }), ['Софья Алексеевна']);
});

test('label lines stack under the circle, or centre beside it', () => {
  const below = labelLayout({ x: 0, y: 0 }, 20, 'below', true, 2);
  assert.deepEqual(below.nameY, [35, 48]);
  assert.equal(below.yearsY, 62);
  const side = labelLayout({ x: 0, y: 0 }, 20, 'left', true, 2);
  assert.equal(side.align, 'right');
  const middle = (side.nameY[0] - 11 + side.yearsY) / 2;
  assert.ok(Math.abs(middle) < 4, `block centred on the node: ${middle}`);
  assert.deepEqual(labelLayout({ x: 0, y: 0 }, 20, 'right', false, 1).nameY, [4]);
});

// After record.media.ts: the captured frames become readme/demo.gif of the media repository (see recording.ts) with their
// real timing (sped up by SPEED), and the screenshots there are scaled to 1200×800. Needs ffmpeg.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
/** The clone of the media repository the files go to (see recording.ts). */
const mediaDir = path.resolve(process.env.MEDIA_DIR ?? path.join(dir, '..', '..', '..', 'genealogy-graph-media'));
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

/** A GIF from captured frames with their real timing sped up by `speed`, `width` pixels wide. */
function gif(frames, listFile, out, { width, speed, fps = 12, colors = 192 }) {
  const list = frames.map((frame, i) => {
    const next = frames[i + 1]?.t ?? frame.t + 1500;
    return `file '${frame.file}'\nduration ${((next - frame.t) / 1000 / speed).toFixed(3)}`;
  });
  // The concat demuxer takes the last frame's duration only when that frame is listed once more.
  list.push(`file '${frames.at(-1).file}'`);
  fs.writeFileSync(listFile, `${list.join('\n')}\n`);
  ffmpeg('-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    '-loop', '0', out);
  return `${path.basename(out)}: ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`;
}

// `node assemble.mjs guides`: the clips of guides.media.ts become guides/<clip>.gif of the media repository, smaller and lighter
// than the README GIF; the card screenshot is scaled down.
if (process.argv[2] === 'guides') {
  const clips = path.join(dir, '.frames-guides');
  const media = path.join(mediaDir, 'guides');
  fs.mkdirSync(media, { recursive: true });
  for (const name of fs.readdirSync(clips)) {
    const meta = path.join(clips, name, 'frames.json');
    if (!fs.existsSync(meta)) continue;
    const { frames, width } = JSON.parse(fs.readFileSync(meta, 'utf8'));
    console.log(gif(frames, path.join(clips, name, 'list.txt'), path.join(media, `${name}.gif`), { width, speed: 1.15, fps: 10, colors: 128 }));
  }
  const card = path.join(media, 'data-card.png');
  if (fs.existsSync(card)) { ffmpeg('-i', card, '-vf', 'scale=900:-1:flags=lanczos', path.join(media, '.data-card.png')); fs.renameSync(path.join(media, '.data-card.png'), card); }
  fs.rmSync(clips, { recursive: true, force: true });
  process.exit(0);
}

const framesDir = path.join(dir, '.frames');
const SPEED = 1.35;
const WIDTH = 880;

const frames = JSON.parse(fs.readFileSync(path.join(framesDir, 'frames.json'), 'utf8'));
const demo = path.join(mediaDir, 'readme', 'demo.gif');
fs.mkdirSync(path.dirname(demo), { recursive: true });
console.log(gif(frames, path.join(framesDir, 'list.txt'), demo, { width: WIDTH, speed: SPEED }));

const screens = path.join(mediaDir, 'readme', 'screenshots');
for (const file of fs.readdirSync(screens).filter((name) => name.endsWith('.png'))) {
  const source = path.join(screens, file);
  const scaled = path.join(screens, `.${file}`);
  ffmpeg('-i', source, '-vf', 'scale=1200:800:flags=lanczos', scaled);
  fs.renameSync(scaled, source);
}
fs.rmSync(framesDir, { recursive: true, force: true });

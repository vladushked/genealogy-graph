// After record.media.ts: the captured frames become docs/media/demo.gif with their real timing (sped up by SPEED),
// and the screenshots are scaled to the 1200×800 the community directory takes. Needs ffmpeg.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const framesDir = path.join(dir, '.frames');
const SPEED = 1.35;
const WIDTH = 880;

const frames = JSON.parse(fs.readFileSync(path.join(framesDir, 'frames.json'), 'utf8'));
const list = frames.map((frame, i) => {
  const next = frames[i + 1]?.t ?? frame.t + 1500;
  return `file '${frame.file}'\nduration ${((next - frame.t) / 1000 / SPEED).toFixed(3)}`;
});
// The concat demuxer takes the last frame's duration only when that frame is listed once more.
list.push(`file '${frames.at(-1).file}'`);
fs.writeFileSync(path.join(framesDir, 'list.txt'), `${list.join('\n')}\n`);

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const scale = `fps=12,scale=${WIDTH}:-1:flags=lanczos`;
ffmpeg('-f', 'concat', '-safe', '0', '-i', path.join(framesDir, 'list.txt'),
  '-vf', `${scale},split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
  '-loop', '0', path.join(dir, 'demo.gif'));

const screens = path.join(dir, 'screenshots');
for (const file of fs.readdirSync(screens).filter((name) => name.endsWith('.png'))) {
  const source = path.join(screens, file);
  const scaled = path.join(screens, `.${file}`);
  ffmpeg('-i', source, '-vf', 'scale=1200:800:flags=lanczos', scaled);
  fs.renameSync(scaled, source);
}
fs.rmSync(framesDir, { recursive: true, force: true });
console.log(`demo.gif: ${(fs.statSync(path.join(dir, 'demo.gif')).size / 1e6).toFixed(1)} MB`);

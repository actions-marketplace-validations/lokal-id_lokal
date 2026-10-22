// Renders the demo animations and writes the GIFs the READMEs use to docs/assets, and MP4s for posts to out/.
// Needs ffmpeg on PATH for the GIFs.
//
//   npm ci --ignore-scripts && npm run render
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const ASSETS = '../assets';
// [composition, GIF in docs/assets, frames per second, colors]
const JOBS = [
  ['AgentDemoEN', 'demo.gif', 15, 96],
  ['AgentDemoID', 'demo.id.gif', 15, 96],
  ['ExtensionDemoEN', 'extension-demo.gif', 12, 128],
  ['ExtensionDemoID', 'extension-demo.id.gif', 12, 128],
];

mkdirSync('out', { recursive: true });
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
for (const [id, gif, fps, colors] of JOBS) {
  const mp4 = `out/${id}.mp4`;
  run('npx', ['remotion', 'render', id, mp4, '--log=error']);
  const filter = `fps=${fps},scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=${id.startsWith('Agent') ? 'none' : 'bayer:bayer_scale=4'}:diff_mode=rectangle`;
  run('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-vf', filter, `${ASSETS}/${gif}`]);
  console.log(`${mp4} and docs/assets/${gif}`);
}

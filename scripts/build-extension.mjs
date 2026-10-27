// Builds the browser extension into packages/extension/dist/ and packs it as release/lokal-extension-<version>.zip, ready
// for the Chrome Web Store or "Load unpacked". Its version follows the npm release.
//
//   node scripts/build-extension.mjs            dist/ and the zip
//   node scripts/build-extension.mjs --test     also runs on http://127.0.0.1, for scripts/test-extension.mjs
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'packages/extension');
const test = process.argv.includes('--test');
const DIST = path.join(EXT, test ? 'dist-test' : 'dist');
const { version } = JSON.parse(readFileSync(path.join(ROOT, 'packages/core/package.json'), 'utf8'));
const { MATCHES } = await import(pathToFileURL(path.join(EXT, 'src/sites.ts')).href);
const matches = test ? [...MATCHES, 'http://127.0.0.1/*'] : MATCHES;

rmSync(DIST, { recursive: true, force: true });
await build({
  absWorkingDir: ROOT,
  entryPoints: {
    background: path.join(EXT, 'src/background.ts'),
    content: path.join(EXT, 'src/content.ts'),
    'page-clipboard': path.join(EXT, 'src/page-clipboard.ts'),
    popup: path.join(EXT, 'src/popup.ts'),
  },
  outdir: DIST,
  // The .xlsx, .docx, and PDF readers from packages/mcp use Buffer and node:zlib; the browser gets small shims.
  alias: { 'node:zlib': path.join(EXT, 'src/shims/zlib.ts') },
  inject: [path.join(EXT, 'src/shims/buffer.ts')],
  bundle: true,
  format: 'iife',
  target: 'chrome111',
  // Store reviewers read the code: keep it readable.
  minify: false,
  legalComments: 'none',
  logLevel: 'warning',
});

const icons = Object.fromEntries([16, 32, 48, 128].map((size) => [size, `icons/${size}.png`]));
const manifest = {
  manifest_version: 3,
  name: '__MSG_name__',
  short_name: 'Lokal',
  description: '__MSG_description__',
  default_locale: 'en',
  version,
  homepage_url: 'https://github.com/lokal-id/lokal',
  minimum_chrome_version: '111',
  icons,
  action: { default_popup: 'popup.html', default_icon: icons },
  background: { service_worker: 'background.js' },
  permissions: ['storage', 'activeTab'],
  content_scripts: [
    { matches, js: ['page-clipboard.js'], run_at: 'document_start', world: 'MAIN' },
    { matches, js: ['content.js'], run_at: 'document_start' },
  ],
};
writeFileSync(path.join(DIST, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(path.join(EXT, 'src/popup.html'), path.join(DIST, 'popup.html'));
cpSync(path.join(EXT, 'icons'), path.join(DIST, 'icons'), { recursive: true });
cpSync(path.join(EXT, '_locales'), path.join(DIST, '_locales'), { recursive: true });
cpSync(path.join(ROOT, 'LICENSE'), path.join(DIST, 'LICENSE'));

// A plain zip (deflate, no extra fields), so building needs nothing beyond Node.
function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function zip(dir) {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(dir);
  const local = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(path.relative(dir, file).split(path.sep).join('/'));
    const data = readFileSync(file);
    const packed = deflateRawSync(data, { level: 9 });
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0x21, 12); // 1980-01-01, so the zip is the same on every build
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    header.copy(entry, 8, 6, 28);
    entry.writeUInt32LE(offset, 42);
    local.push(header, name, packed);
    central.push(entry, name);
    offset += header.length + name.length + packed.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

if (!test) {
  const out = path.join(EXT, `release/lokal-extension-${version}.zip`);
  const archive = zip(DIST);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, archive);
  console.log(`${path.relative(ROOT, DIST)}/ and ${path.relative(ROOT, out)} (${Math.round(archive.length / 1024)} KB)`);
} else {
  console.log(`${path.relative(ROOT, DIST)}/ (runs on http://127.0.0.1 too)`);
}

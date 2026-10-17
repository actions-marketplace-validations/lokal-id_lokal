// Builds @lokal-id/mcp as one file, dist/cli.js, with its third-party dependencies (the MCP SDK, zod, and theirs)
// inside. Installing it then fetches only our two packages, both built from the lockfile in CI and published with
// provenance, instead of resolving a dependency tree with version ranges on every user's machine, where one
// compromised release anywhere in it would reach them. @lokal-id/core stays a dependency: it has none of its own and
// reads its region data from its own package folder.
//
//   node scripts/bundle-mcp.mjs
import { build } from 'esbuild';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'packages/mcp/dist');

rmSync(DIST, { recursive: true, force: true });
const result = await build({
  absWorkingDir: ROOT,
  entryPoints: [path.join(ROOT, 'packages/mcp/src/cli.ts')],
  outfile: path.join(DIST, 'cli.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['@lokal-id/core', '@lokal-id/core/*'],
  // Some bundled packages are CommonJS and call require() for Node built-ins.
  banner: { js: "import { createRequire as __lokalCreateRequire } from 'node:module';\nconst require = __lokalCreateRequire(import.meta.url);" },
  legalComments: 'eof',
  metafile: true,
  logLevel: 'warning',
});

// The licenses of everything bundled, as their MIT, ISC, and BSD licenses require.
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (m) packages.set(m[1], path.join(ROOT, input.slice(0, input.indexOf(m[0]) + m[0].length)));
}
const sections = [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([name, dir]) => {
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.md|\.txt)?$/i.test(f));
  if (!file) throw new Error(`${name} has no license file to ship with the bundle.`);
  return `## ${name} ${pkg.version} (${pkg.license})\n\n${readFileSync(path.join(dir, file), 'utf8').trim()}\n`;
});
writeFileSync(
  path.join(DIST, 'THIRD_PARTY_LICENSES.md'),
  `# Third-party licenses\n\ndist/cli.js includes the following packages.\n\n${sections.join('\n')}`,
);
if (!existsSync(path.join(DIST, 'cli.js'))) throw new Error('Bundle missing.');
console.log(`packages/mcp/dist/cli.js with ${packages.size} bundled packages`);

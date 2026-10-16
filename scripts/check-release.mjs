// Checks that every place holding the npm release version agrees, and with the tag if one is given.
//   node scripts/check-release.mjs          all versions match each other
//   node scripts/check-release.mjs v0.2.3   ...and match the tag
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const json = (path) => JSON.parse(read(path));

const core = json('packages/core/package.json');
const mcp = json('packages/mcp/package.json');
const server = json('server.json');
const npmEntry = server.packages.find((p) => p.registryType === 'npm' && p.identifier === mcp.name);
const serverTs = read('packages/mcp/src/server.ts').match(/const VERSION = '([^']+)'/)?.[1];

const found = {
  'packages/core/package.json': core.version,
  'packages/mcp/package.json': mcp.version,
  'packages/mcp/package.json dependencies["@lokal-id/core"]': mcp.dependencies[core.name]?.replace(/^\^/, ''),
  'packages/mcp/src/server.ts VERSION': serverTs,
  '.claude-plugin/plugin.json': json('.claude-plugin/plugin.json').version,
  'server.json version': server.version,
  [`server.json packages[${mcp.name}].version`]: npmEntry?.version,
};

const tag = process.argv[2];
const expected = tag ? tag.replace(/^v/, '') : core.version;
const errors = Object.entries(found)
  .filter(([, version]) => version !== expected)
  .map(([where, version]) => `${where} is ${version ?? 'missing'}, expected ${expected}`);

if (mcp.mcpName !== server.name) errors.push(`packages/mcp/package.json mcpName ${mcp.mcpName} does not match server.json name ${server.name}`);

if (errors.length) {
  for (const error of errors) console.error(`::error::${error}`);
  process.exit(1);
}
console.log(`All versions are ${expected}${tag ? ` and match tag ${tag}` : ''}.`);

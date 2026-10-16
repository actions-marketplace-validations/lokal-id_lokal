#!/usr/bin/env node
// lokal-mcp          → MCP server over stdio
// lokal-mcp guard    → Claude Code hook (reads the hook event from stdin)
const command = process.argv[2];

if (command === 'guard') {
  const { runGuard } = await import('./guard.ts');
  await runGuard();
} else if (command === undefined || command === 'serve') {
  const { runServer } = await import('./server.ts');
  await runServer();
} else {
  process.stderr.write('Usage: lokal-mcp [serve|guard]\n');
  process.exitCode = 1;
}

#!/usr/bin/env node
// lokal-mcp                  → MCP server over stdio
// lokal-mcp serve --http     → MCP server over Streamable HTTP (data tools only), for ChatGPT and Claude.ai connectors
// lokal-mcp guard            → hook for Claude Code, Codex CLI, Cursor, and Gemini CLI (reads the event from stdin)
// lokal-mcp proxy            → Samaran Proxy: masks personal data in OpenAI and Anthropic API calls
// lokal-mcp kembaran         → replaces personal data in dumps and exports with realistic stand-ins
// lokal-mcp scan             → finds personal data in files before they are committed (pre-commit hooks, CI)
// lokal-mcp audit            → summarizes the audit log (.lokal/audit.jsonl)
const [command, ...args] = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (command === 'guard') {
  const { runGuard } = await import('./guard.ts');
  await runGuard();
} else if (command === 'kembaran') {
  const { runKembaran } = await import('./kembaran-files.ts');
  runKembaran(args);
} else if (command === 'scan') {
  const { runScan } = await import('./scan.ts');
  runScan(args);
} else if (command === 'audit') {
  const { runAudit } = await import('./audit.ts');
  runAudit(args);
} else if (command === 'proxy') {
  const { runProxy } = await import('./proxy.ts');
  await runProxy(args);
} else if ((command === undefined || command === 'serve') && args.includes('--http')) {
  const { startHttpServer } = await import('./server.ts');
  const host = option('host') ?? '127.0.0.1';
  const port = Number(option('port') ?? process.env.PORT ?? 3000);
  await startHttpServer(port, host);
  process.stderr.write(`Lokal MCP server on http://${host}:${port}/mcp (data tools only; put it behind HTTPS for remote clients)\n`);
} else if (command === undefined || command === 'serve') {
  const { runServer } = await import('./server.ts');
  await runServer();
} else {
  process.stderr.write('Usage: lokal-mcp [serve [--http [--port 3000] [--host 127.0.0.1]] | guard | proxy [--help] | kembaran [--help] | scan [--help] | audit [--help]]\n');
  process.exitCode = 1;
}

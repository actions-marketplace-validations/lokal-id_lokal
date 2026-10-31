# What stays on your machine, and what can reach the network

[Bahasa Indonesia](network.id.md)

Lokal detects and masks personal data locally. It has no server, no account, and no telemetry, and it never sends text to a model to find personal data. This page lists, for each part, what it reads, where values are kept, and every network connection it makes. Each row was checked against the source code.

| Part | Network connections | Where real values are kept |
|---|---|---|
| `@lokal-id/core`, `lokal-id` (Python) | None. Region codes, postal codes, and holidays are bundled. | In your process, in the `Samaran` object, for as long as you keep it. |
| MCP server (stdio), with the Claude Code plugin or `npx` | None while it runs. `npx` downloads the package from the npm registry when it is first started. | In the server's memory, until `clear_vault`, `vaultTtlMinutes` without use, or the end of the session. Never written to disk. |
| MCP server over HTTP (`serve --http`) | Listens on `127.0.0.1:3000` unless you choose another address. No outgoing connections. It serves the data tools only; the file tools are left out. | None: the data tools do not mask. |
| Samaran Guard (hook) | None. It reads the files an agent is about to read, on your machine. | None. It counts values and decides; it keeps nothing. |
| `lokal-mcp scan` | None. With `--staged` or `--diff` it runs `git` locally. | None. Findings show partly masked values. |
| GitHub Action | Installs `@lokal-id/mcp` from npm on the runner. If a push has no parent commit, it fetches that commit from your own repository. | None. Annotations show partly masked values. |
| `lokal-mcp kembaran`, `anonymize_file` | None. | None. The output holds made-up people. |
| Audit log, `lokal-mcp audit` | None. | No values. Each line holds counts per type, an action, and a file or API path. |
| **Samaran Proxy** | Listens on `127.0.0.1:8787`. Sends **masked** requests to the upstream you set (OpenAI and Anthropic by default). Sends requests with a `route` type **unmasked** to the local endpoint in `.samaran.json`, and nowhere else. | In memory, for one request: values are restored in the answer and forgotten. |
| Optional NER model (`lokal-id[ner]`, Python) | Downloads the model from Hugging Face once (1.3 GB for `gold`, 440 MB for `fast`), at a pinned revision, unless you load it from a folder with `model_path`. It runs locally after that. | In your process, like the rest of the Python library. |
| Lokal's NER model (`@lokal-id/ner`, Node; `"ner": true` in `.samaran.json` for the MCP server and proxy) | Downloads the model (125 MB) once from the GitHub release [`ner-base-v1`](https://github.com/lokal-id/lokal/releases/tag/ner-base-v1) and checks each file against the SHA-256 in the package, unless you load it from a folder with `modelPath`. It runs locally after that, in WebAssembly. | In your process. Nothing is sent: the model reads the text on your machine. |
| Vercel AI SDK middleware | None of its own. The app's model call carries masked text. | In memory, for one call. |
| Browser extension | None. It makes no network requests. The AI site sends what you submit, after the extension has masked it. Its permissions are `storage` and `activeTab`, and it runs only on the AI sites listed in its manifest. | In the browser's session storage, in memory only, until the browser closes or you choose **Forget all real values**. |

## What reaches a model provider

- **Through the MCP file tools:** placeholders such as `[NIK_1]`, never the values. A type whose policy is `allow` is shown as it is. A file with a `block` type is refused.
- **Through the proxy or the AI SDK middleware:** the masked request. The answer is restored on your side.
- **Through the browser extension:** the masked message or file.
- **Not covered:** anything you or an agent sends past Lokal, such as a raw file read without the guard, a prompt sent with `#izinkan-pii`, or images and scanned PDFs, which Samaran cannot read. See [What each integration covers](../README.md#what-each-integration-covers).

## Things to know

- **Routing sends real data.** A `route` endpoint receives the request unmasked. `lokal-mcp check` warns when it is not on this machine or a private network.
- **Proxy address.** Started with `--host 0.0.0.0`, the proxy can be reached from your network, and it sees real data. Keep it on `127.0.0.1`, or behind a firewall. The [Docker Compose example](../examples/proxy-ollama) publishes it on `127.0.0.1` only.
- **API keys.** The proxy passes your provider key through to the provider and keeps nothing. It does not send that key to a `route` endpoint. It sends `LOKAL_ROUTE_API_KEY` there instead, if you set one.
- **Package downloads.** `npx`, `npm install`, and `pip install` reach their registries. Pin a version, as the plugin does (`@lokal-id/mcp@<version>`). Releases are published from GitHub Actions with npm provenance and PyPI Trusted Publishing.

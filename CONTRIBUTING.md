# Contributing to Lokal

Thanks for helping make AI agents work better for Indonesia. Issues and pull requests are welcome in English or Bahasa Indonesia.

> [!IMPORTANT]
> **Never paste real personal data** (NIK, phone numbers, names, addresses, health data) into an issue, pull request, test, or fixture. Use made-up values. If you need a structurally valid NIK, change the last four digits of the examples in this repo, such as `3201011508950001`.

## Ways to contribute

- **Detection reports.** A value Samaran missed, or something it masked that is not personal data. These are the most useful reports. Use the *Detection report* issue template.
- **Reference data updates.** A new Kepmendagri region decree, the next year's SKB holiday list, or new carrier prefixes. Include a link to the official source.
- **Skill improvements.** Conventions that agents still get wrong when building Indonesian apps, with an example of what the agent produced.
- **Code.** Bug fixes, new MCP tools, or items from the [roadmap](README.md#roadmap). For anything large, open an issue first so we can agree on the approach.

If you find a way to get personal data past Samaran or the guard, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development setup

You need Node.js 24 for development, because the tests run TypeScript directly. The published packages support Node.js 20 and later.

```sh
git clone https://github.com/lokal-id/lokal.git
cd lokal
npm install
npm run build      # builds core and mcp, then bundles hooks/samaran-guard.mjs
npm test           # unit tests, MCP server end to end, guard
npm run typecheck
```

To try your changes in Claude Code without installing anything:

```sh
claude --plugin-dir .
```

This loads the skills and the guard hook from your checkout, but the plugin's MCP server still comes from npm. To test MCP server changes, register your local build as well:

```sh
claude mcp add lokal-dev -- node /absolute/path/to/lokal/packages/mcp/dist/cli.js
```

`npm run eval` runs the cases in `evals/cases.mjs` in real Claude Code sessions, with and without the plugin. It needs the `claude` CLI signed in and uses real tokens, so you do not need to run it for most changes.

### Python

The Python package in `python/` is a port of `packages/core` and must give the same results. You need [uv](https://docs.astral.sh/uv/):

```sh
cd python
uv run pytest        # unit tests and the parity vectors
uv run mypy          # strict typing
uv run ruff check src tests scripts
```

The parity vectors in `python/tests/vectors` are generated from the TypeScript build. **Any change to `packages/core/src` must be mirrored in `python/src/lokal`, and any change to the file readers in `packages/mcp/src` (`files.ts`, `pdf.ts`, `xlsx.ts`, `docx.ts`) in `python/src/lokal/files`**, then:

```sh
npm run build && node python/scripts/gen_vectors.mjs   # regenerate from TypeScript
cd python && uv run pytest                            # Python must still match
```

After regenerating region data in `packages/core/data`, run `uv run python scripts/sync_data.py` in `python/` to copy it into the package. CI checks both.

## Where things live

| Path | Contents |
|---|---|
| `packages/core/src/samaran/` | PII detectors, field and header rules, masking |
| `packages/core/src/holidays.ts` | Holidays and *cuti bersama* per year, with the source link |
| `packages/core/src/phone.ts` | Carrier prefixes and area codes |
| `packages/core/data/` | Region and postal code data (see its README to regenerate) |
| `packages/mcp/src/server.ts` | MCP tools |
| `packages/mcp/src/guard.ts`, `shell-reads.ts` | Samaran Guard hook and the shell command parser |
| `packages/mcp/src/files.ts`, `pdf.ts`, `xlsx.ts`, `docx.ts` | File readers for `scan_pii`, `read_file_masked`, and the guard |
| `packages/mcp/test/pdf-builder.ts` | Hand-built PDFs for the reader's tests and the Python parity vectors |
| `skills/` | `SKILL.md` files |
| `evals/` | End-to-end evaluation |
| `python/src/lokal/` | The Python port: one module per TypeScript file, patterns copied verbatim |
| `python/scripts/gen_vectors.mjs` | Generates the parity vectors from the TypeScript build |
| `docs/assets/` | README diagrams: [Archify](https://github.com/tt-a1i/archify) sources (`*.archify.json`) and their exported SVGs |

## Pull request guidelines

- **Add tests.** Every behavior change needs a test. Detection changes need both a positive case (what should now be caught) and a negative case (similar text that must not be caught), because false positives make the guard annoying enough that people turn it off.
- **Commit the bundled hook.** The plugin runs `hooks/samaran-guard.mjs` directly. If you change anything under `packages/mcp/src` or `packages/core/src`, run `npm run build` and include the updated bundle. CI fails if it is out of date.
- **Keep `@lokal-id/core` and `lokal-id` dependency-free.** The TypeScript package runs in browsers and inside the hook, which has a 10-second time limit; the Python one installs anywhere.
- **Change TypeScript and Python together**, and regenerate the parity vectors (see above). CI fails if they disagree.
- **Cite official sources** for reference data: Kemendagri decrees, SKB 3 Menteri, legislation from JDIH, and so on.
- **Update the docs** when you change behavior: `README.md`, `README.id.md`, and `CHANGELOG.md` under *Unreleased*.
- Keep pull requests focused on one change. Small PRs get reviewed faster.

## Releasing (maintainers)

Releases are published by GitHub Actions from a tag, never from a local checkout: a local `dist/` can be older than the code.

- **npm and the MCP Registry:** bump the version in `packages/core/package.json`, `packages/mcp/package.json` (and its `@lokal-id/core` dependency), `.claude-plugin/plugin.json`, the pinned `@lokal-id/mcp@X.Y.Z` in `.mcp.json`, both versions in `server.json`, and `VERSION` in `packages/mcp/src/server.ts`. `node scripts/check-release.mjs` confirms they agree. Run `npm run build` and commit the rebuilt hook, then push a tag `vX.Y.Z`. The *Release* workflow tests that commit, publishes `@lokal-id/core` and then `@lokal-id/mcp` through npm Trusted Publishing, and publishes `server.json` to the MCP Registry with GitHub OIDC. If a step fails, run the workflow again by hand: anything already published is skipped.
- **PyPI:** bump `python/pyproject.toml` and `__version__` in `python/src/lokal/__init__.py`, then push a tag `py-vX.Y.Z`. The *Publish Python package* workflow builds, tests, and uploads from that commit through Trusted Publishing.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

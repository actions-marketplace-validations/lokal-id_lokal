# Security policy

Lokal exists to keep personal data away from AI models, so a way around it is a security issue, even when nothing crashes.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability**.

Include:

- What you ran (the prompt, tool call, or shell command) and what reached the model or the output
- The Lokal version, your OS, and the agent or MCP client you used
- **Made-up data only.** Never include real personal data, even in a private report

We aim to acknowledge reports within 7 days and to agree on a disclosure date with you once a fix is ready.

## In scope

- Personal data that reaches the model even though Samaran Guard is on, through `Read`, `Grep`, or a shell command the guard is meant to intercept
- Original values leaking through masked output, such as `scan_pii` previews or `read_file_masked`
- MCP file tools reading or writing outside `LOKAL_ROOT`
- Weaknesses in how releases are built and published (`.github/workflows`), or a published package that differs from what the tagged commit builds
- Placeholders that unmask to the wrong person's data
- A rule in `.samaran.json` that is accepted but silently matches nothing, or a broken `.samaran.json` that a file tool ignores
- Any network request from the MCP server's stdio mode, the guard, the scanner, the browser extension, or the libraries

## Out of scope

These are known limitations, documented in the [README](README.md#limitations). Improvements are welcome as regular issues or pull requests:

- Personal data that the detectors do not recognize (use the *Detection report* issue template, with made-up data)
- Scripts that deliberately print a data file. `SAMARAN_GUARD=strict` blocks one-liners such as `python -c "print(open(...).read())"`; a script saved in a file is not read
- File formats that are reported as *not scanned* (scanned or encrypted PDFs, `.xls`, images)
- The guard allowing a command when its input is malformed. By default it fails open, so that a bug in the guard cannot lock you out of your agent; `SAMARAN_GUARD=strict` makes it fail closed

## How releases are protected

- `@lokal-id/core` and `lokal-id` (PyPI) have no dependencies. `@lokal-id/mcp` depends only on `@lokal-id/core` at the exact same version; the MCP SDK and zod are bundled into it from the lockfile, so installing it fetches no third-party packages.
- Every release is built from a tag by GitHub Actions and published with Trusted Publishing. No npm or PyPI token exists to be stolen.
- The job that installs dependencies and runs the build has no publishing rights. The job that publishes installs and runs nothing; it uploads the files the first job built.
- Dependencies come only from the lockfiles, with install scripts off, and their registry signatures are checked. GitHub Actions are pinned to commits.
- npm packages carry a provenance attestation that links them to the commit and the workflow run that built them.

To check what you installed:

```sh
npm view @lokal-id/mcp dependencies   # { '@lokal-id/core': '<same version>' }
npm audit signatures                  # in your project: verifies signatures and provenance of what npm installed
```

On npmjs.com, the package page shows the provenance under *Provenance*, with a link to the exact workflow run. A Lokal version without provenance did not come from this repository's workflow; please report it.

## Supported versions

Lokal is pre-1.0. Security fixes go into the latest release only.

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
- Placeholders that unmask to the wrong person's data

## Out of scope

These are known limitations, documented in the [README](README.md#limitations). Improvements are welcome as regular issues or pull requests:

- Personal data that the detectors do not recognize (use the *Detection report* issue template, with made-up data)
- Scripts that deliberately print a data file, such as `python -c "print(open(...).read())"`
- File formats that are reported as *not scanned* (PDF, `.xls`, images)
- The guard allowing a command when its input is malformed. It fails open on purpose, so that a bug in the guard cannot lock you out of your agent

## Supported versions

Lokal is pre-1.0. Security fixes go into the latest release only.

# Stress test

`npm run build && npm run stress` (or `node --expose-gc evals/stress/run.mjs [--quick]`) measures how fast Lokal is, and checks that it stays correct and bounded, on large and hostile input. Every value is made up: the documents come from the [benchmark generator](../bench/corpus.mjs). The script exits with 1 if a check fails:

- something leaks;
- a count is wrong;
- a request errors;
- a hook runs past its time limit.

## Results

These are from 0.13.0 on a 16-core Windows laptop with Node 24. The full run takes about two minutes.

| Check | Size | Result |
|---|---|---|
| `detectPii`, CSV export | 10 MB | 3.0 s (3.4 MB/s) |
| `detectPii`, JSON log lines | 10 MB | 3.0 s (3.4 MB/s) |
| `detectPii`, chat and prose | 5 MB | 1.1 s (4.8 MB/s) |
| Hostile: 2 MB line of `Nama: Nama: …` | 2 MB | 1.8 s (was 35 s for 400 KB before 0.13.0) |
| Hostile: 2 MB of digits and dashes | 2 MB | 0.3 s |
| Hostile: capitalized words, escaped JSON, commas, no spaces, emoji | 0.5–2 MB each | 0.05–0.6 s |
| Samaran mask + unmask, chat messages | 880 messages | 0.16 ms per message |
| One vault with 100,000 distinct values | 100k | 8.8 s, linear; 17 MB of heap |
| `Kembaran.texts`, SQL dump + CSV | 5 MB | 2.3 s, no real value left |
| Proxy, 3,000 requests, 64 concurrent | 3k | 850 req/s, p50 67 ms, p99 265 ms, no error, every answer restored, no detected value upstream |
| Proxy, one prompt holding a 2 MB CSV | 2 MB | 0.7 s |
| Guard hook, `Read` of a clean CSV | 1 call | 217 ms (most of it Node starting) |
| Guard hook, `Read` of a 1 MB CSV with data | 1 call | 535 ms |
| Guard hook, `Read` of a 20 MB CSV with data | 1 call | 1.8 s (it samples the first 5 MB) |
| MCP `read_file_masked`, 20 MB CSV | 1 call | 0.1 s (returns the first 5,000 lines) |
| `lokal-mcp scan`, 500 files | 500 files | 1.0 s |

The hostile inputs are what an attacker could put in a file to slow the guard past its time limit, or in a prompt to tie up the proxy:

- one line of thousands of labels;
- megabytes of digits;
- JSON escaped three times;
- a 50,000-column header;
- emoji.

Detection time grows linearly with the input in all of them.

## Python

The Python port is linear too, and about ten times slower:

| Check | Result |
|---|---|
| `detect_pii`, benchmark documents | 0.3 MB/s |
| Hostile 1.6 MB of `Nama:` | 7 s |
| Hostile 1.6 MB of digits | 4.7 s |
| `Kembaran.texts`, 0.3 MB | 1.9 s |

A Python backend that masks prompts should cap their size, as the proxy's callers do with their request limits.

## Optional NER model

`lokal.samaran.ner.NerNames` costs about 20 ms per short document in batches and 42 ms one at a time, on CPU. That is about 4,600 characters a second, against Samaran's rules at about 0.2 ms per document. It also takes 8 seconds to load. Use it where recall on names matters more than speed: batch jobs, exports, and data sent to a vendor. Do not put it on the guard's path.

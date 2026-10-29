# Samaran benchmark

How well Samaran finds Indonesian personal data, per type, on documents it was not tuned on.

```sh
npm run build
npm run bench                          # test split, compared with baseline.json (CI runs this)
npm run bench -- --split dev --misses  # dev split, with every miss and false positive
npm run bench -- --export out/         # the corpus as JSON Lines, to score another tool on the same documents
```

## The corpus

[`corpus.mjs`](corpus.mjs) builds made-up documents from 70 templates per split, 40 documents each, in eleven formats: forms, chat, mixed Indonesian and English, informal spelling, unlabelled text, JSON, CSV, logs, OCR output (including misread characters), letters, and traps with no personal data at all (invoice numbers, trace ids, call center numbers, prices, timestamps). Every value of personal data is labelled with its type and position.

Nobody in it is real. Names are random pairs of common first names and surnames; numbers are random with a valid structure: a NIK has a real district code and a possible birth date, a card number passes the Luhn check, a phone number has a real operator prefix. The same seed gives the same corpus on every machine.

| Split | Use | Templates | Names |
|---|---|---|---|
| `dev` | Work on the detectors; read its misses as much as you like | Own set | Own pool |
| `test` | Held out: only for reporting | Different set | Different first names and surnames |

Each split has 2,800 documents and over 6,000 labelled values, at least 200 of every type, so a type's number moves by 0.5 points or less per value. The name pools have 24 male and 24 female first names and 32 surnames per split. For every number the runner also prints a 95% Wilson interval: how far it could move on another corpus of the same size and kind. Two numbers whose intervals overlap may not differ at all.

`CORPUS_VERSION` in `corpus.mjs` goes up whenever templates or name pools change, and numbers from different corpus versions are not compared: the baseline check fails until the baseline is refreshed. Corpus 1 (30 templates, 1,200 documents per split) is what the results for 0.8.3 in `results/` were measured on.

The corpus is public, so the held-out split is held out by agreement: **do not change a detector to fix a test document.** When the test split shows a gap, write a dev template for it, fix the detector against that, and let the test number follow. Changes to test templates are only for labelling mistakes, and say so in the commit.

## What is measured

For each type:

- **precision**: detections of this type that land on a labelled value of this type
- **recall**: labelled values found with the right type
- **F1**: the harmonic mean of the two
- **protected**: labelled values with every letter and digit masked, by a detection of any type. This is the number that matters for privacy: a NIK masked as a KK still never reaches the model.

A detection outside every labelled value is a **false positive**. Some text is neutral: the district and city after a street address do not identify a household, so masking them is not a false positive and leaving them is not a leak.

## The baseline

[`baseline.json`](baseline.json) holds the test split's numbers for the current release. CI fails when the overall number or the number of a type with at least 20 labelled values drops by more than 0.5 points (protected), 1 point (recall), or 2 points (precision). After a deliberate change, such as a detector that trades a little precision for recall, run `npm run bench -- --update-baseline` and explain the trade in the pull request.

The corpus uses the district codes in Lokal's wilayah data, so an update of that data changes the generated NIKs. Run the benchmark after a data update and refresh the baseline if the numbers moved for that reason alone.

Results for each release are kept in [`results/`](results/).

## Limits

- Templates are written by people who know the detectors. The test split keeps the names and phrasing apart, but it cannot be as varied as real data. It measures progress and regressions, not how Samaran will do on any particular company's logs.
- One template becomes many documents, so a miss in one template repeats. Read the per-format table with that in mind.
- The older hand-written cases in [`../hard/pii-bench.mjs`](../hard/pii-bench.mjs) (`npm run eval:pii`) stay: they are hard, specific traps that a template cannot express, and they were used for tuning, so they are not a held-out score.

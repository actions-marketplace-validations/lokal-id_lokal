# Chat corpus

How well Samaran finds people's names written the way people chat: with no label or cue in front of them, mostly in lower case.

```sh
npm run build
npm run bench:chat                          # test split
npm run bench:chat -- --split dev --misses  # dev split, with every miss and false positive
npm run bench:chat -- --export out/         # the corpus as JSON Lines, to run the optional NER model on it
npm run bench:chat -- --extra FILE          # Samaran's matches plus another detector's (JSON Lines of { id, matches })
```

## Why a second corpus

The [main benchmark](../bench/README.md) has a few chat templates, but most of its names come with a label or a cue: "Nama:", "atas nama", "pak", a column. Chat often has none:

- `saya di chat sama rianto surya tadi pagi`
- `ada yang ngeliat minan minanto ga ya`
- `motornya dodi mogok lagi di depan indomaret`

A detector that only knows cues misses these names, and the main benchmark does not show it.

## The corpus

[`corpus.mjs`](corpus.mjs) builds made-up chat messages, support tickets, and WhatsApp exports from about 40 templates per split, 50 documents each:

- **Contexts.** A name as subject, object, possessor, someone addressed, in a list, after a cue ("pak", "atas nama"), or as a WhatsApp sender. Ten templates per split are traps with no name at all, such as places, shops, food, and words that are also names ("bunga mawar … indah").
- **Writing styles.** 55% of the messages are all lower case, 25% use proper case, 15% use proper case with the names in lower case, and 5% are all capitals.
- **Names.** Half are common Indonesian names. The other half are made up from syllables ("zubendi", "Wujimra Lorcawati"), so a detector cannot pass by knowing a list of names. Names have one, two, or three words.

| Split | Use | Templates | Names |
|---|---|---|---|
| `dev` | Work on the detectors; read its misses as much as you like | Own set | Own common names, own made-up names |
| `test` | Held out: only for reporting | Different set | Different common names, different made-up names |

As with the main benchmark, the test split is held out by agreement. **Do not change a detector to fix a test document.** When the test split shows a gap, write a dev template for it and fix the detector against that.

A name counts as protected when every letter of it is masked, by a detection of any type. A detection outside every name is a false positive.

## Results

Test split, corpus 1, 1,900 documents, 1,800 names:

| | Names protected | 95% CI | Lower-case messages | False positives |
|---|---|---|---|---|
| Rules alone (0.13.0) | 19.5% | 17.7–21.4% | 11.1% | 0 |
| Rules + NER `fast` (0.13.0) | 30.2% | 28.1–32.3% | 12.6% | 5 |
| Rules + NER `fast` (lower-case names in sentences) | 62.2% | 60.0–64.4% | 59.5% | 2 |
| Rules + NER `gold` | **89.3%** | 87.8–90.7% | **89.4%** | **0** |

`gold` and `fast` are the two models of the [optional NER](../../python/README.md#names-the-rules-do-not-know-an-optional-ner-model) in the Python library. The rules alone are what the TypeScript package, the MCP server, the guard, and the proxy use.

## Limits

- Templates are written by people who know the detectors, and real chat is more varied: typos, mixed languages, nicknames shortened to one syllable ("dod"). The corpus measures progress and regressions. It does not tell you how Samaran will do on any particular chat log.
- A made-up name is harder than most real ones, because no model has seen it. Results on common names are higher: see the per-name rows that the runner prints.

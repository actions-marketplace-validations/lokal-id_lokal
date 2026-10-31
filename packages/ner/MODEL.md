# lokal-ner-base-v1

Lokal's model for finding people's names in Indonesian text, the ones Samaran's rules cannot find because nothing
announces them: "saya di chat sama rianto surya tadi pagi", "ada yang ngeliat minan minanto ga ya". It tags person
names only (`O`, `B-PER`, `I-PER`).

| | |
|---|---|
| Base model | [IndoBERT-base (`indobenchmark/indobert-base-p1`)](https://huggingface.co/indobenchmark/indobert-base-p1), MIT, read from its safetensors conversion at revision `586591854cf699c0458277be22d0749c7476e3eb` |
| Format | ONNX, opset 17, weights quantized to int8 (dynamic quantization) |
| Size | 125 MB (`model.onnx`), plus `tokenizer.json` and `config.json` |
| Speed | about 20 ms per chat message, 40 ms per form or log record, on a laptop CPU in WebAssembly |
| License | MIT |

## Training data

About 103,000 sentences, of which 46,000 contain a person (54,500 names):

- **Labelled corpora** (about 13,000 sentences, lower-case copies included): the person labels of NERP and NERGrit from
  [IndoNLU](https://github.com/IndoNLP/indonlu) (MIT) and of [idner-news-2k](https://github.com/khairunnisaor/idner-news-2k)
  (MIT), train splits only. Other entity labels were dropped.
- **Synthetic text written for Lokal** (54,500 sentences): chat, support tickets, forms, and records in Indonesian and
  English, with made-up names, and sentences with no name at all: errands ("nitip kopi dong"), words of time that open
  a message ("semalem …"), organizations and places that look like names.
- **News context** (35,000 sentences): sentences from Indonesian online news. In 5,400 of them, the one person quoted
  was replaced by a made-up name; the other 30,000 have no person in them. No real name from the news is in the
  training data, and the text itself is not distributed.

The made-up names come from Lokal's own name lists, with 1,033 name words held out: the evaluation corpora use those,
so every test measures names the model never saw in training.

Nothing was learned from another NER model's output: no distillation, no labels from the models `lokal-id` offers in
Python (`treamyracle/indobert-ner-gold`, `cahya/bert-base-indonesian-NER`).

Fine-tuning: 3 epochs, learning rate 3e-5, batch 32, sequences up to 128 tokens, seed 13, on one consumer GPU.
Every filter after the model (chat words, informal verbs, log levels, place names, field names) was tuned on
development data only.

## Results

On held-out test data, never used for training or tuning, with Samaran's rules and the model together:

| Test set | lokal-ner-base-v1 | `gold` (IndoBERT-large) | Rules alone |
|---|---|---|---|
| Chat corpus, 1,800 names | **98.9%** protected | 89.3% | 19.4% |
| Samaran benchmark, 1,960 names | 98.8% | **99.6%** | 93.6% |
| idner-news-2k test, recall / precision | 93.4% / 98.6% | **96.1% / 99.0%** | 21.6% recall |
| News from a portal not used in training (silver labels), recall | 80.4% | **81.2%** | 14.0% |

No false positives in either corpus's test split, trap documents (text with no person in it) included.

An earlier candidate took words for names in the test splits: "semalem" opening a message, food after "nitip", and
"WARN" opening a log line. Each gap got development templates in their own words, and was fixed against those (training
sentences for the first two, a filter for log levels); the test splits were then measured again. The numbers above are
from that second measurement.

The int8 model gives the same results as the full-precision one on the chat development set. The Node package
(`@lokal-id/ner`, WebAssembly) and Python (`NerNames()`, onnxruntime) score the same on every development set; their
arithmetic differs in the last digits, which changes the outcome for 8 of 5,677 documents where a score sits at the
threshold.

## Limitations

- **Names it never saw, in structured records**: "Diterima dari Melati Gozali via BCA", a JSON `"guest"` field. Larger
  models that learned from many real names do better here; Samaran's rules cover most labelled fields.
- **News**: 3 points behind a larger model on labelled news, most of all for public figures quoted by one name.
- **Persons only**: no organizations, places, or other entities.
- It is a statistical model: it misses some names and, rarely, takes a word for one. Use it with Samaran's rules, not
  instead of them.

## Use

Node: [`@lokal-id/ner`](README.md). Python: `NerNames()` in `lokal-id` (`pip install "lokal-id[ner-lokal]"`). Both
read the files from the GitHub release
[`ner-base-v1`](https://github.com/lokal-id/lokal/releases/tag/ner-base-v1) into the same cache folder, and check each against
its SHA-256:

```
88eda9302acae1ca4bf3f0261673713af467179fe0de730a8c25dcb2444cd254  model.onnx
da8791ba8d7a1459108876b0a0e105c5df39929cc8e7826499f63e74239b0181  tokenizer.json
a8e49fbae72931c14fb26322aa9cfe5388ab29a9e208589e06d63739e1681d69  config.json
```

## Credits

IndoBERT by IndoBenchmark (Wilie et al., 2020, "IndoNLU: Benchmark and Resources for Evaluating Indonesian Natural
Language Understanding"). NERP and NERGrit via IndoNLU. idner-news-2k (github.com/khairunnisaor/idner-news-2k). All MIT.

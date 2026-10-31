# @lokal-id/ner

Finds Indonesian people's names that nothing announces, for [Samaran](../../README.md): no "Nama:", no "a.n.", no
"Bapak", just a name in a sentence.

```
saya di chat sama rianto surya tadi pagi        → saya di chat sama [NAME_1] tadi pagi
ada yang ngeliat minan minanto ga ya            → ada yang ngeliat [NAME_2] ga ya
```

It runs [Lokal's own model](MODEL.md), IndoBERT-base fine-tuned for person names, on the CPU in WebAssembly
(onnxruntime-web: no native binaries, no install scripts). The text never leaves the machine.

```
npm install @lokal-id/core @lokal-id/ner
```

```ts
import { Samaran } from '@lokal-id/core';
import { NerNames } from '@lokal-id/ner';

const ner = await NerNames.load(); // the first time: downloads the model (125 MB) and checks its SHA-256
const samaran = new Samaran();

const text = 'saya di chat sama rianto surya tadi pagi, NIK 3201011508950001';
const { text: masked } = samaran.mask(text, await ner.find(text));
// → 'saya di chat sama [NAME_1] tadi pagi, NIK [NIK_1]'
```

`ner.find(text)` returns NAME matches with offsets into the text. Pass them to `samaran.mask`, `samaran.scan`, or
`detectPii(text, { extra })`: Samaran's own matches win where they overlap.

## Options

```ts
await NerNames.load({
  modelPath: './models/lokal-ner-base-v1', // a folder with model.onnx, tokenizer.json, config.json: offline use
  minScore: 0.7,                           // the model's confidence below which a name is dropped
  threads: 2,                              // default: half the CPUs, at most 4
  download: false,                         // fail instead of downloading when the model is not cached
});
```

The model is cached in `LOKAL_NER_DIR`, or `~/.cache/lokal-id/ner` (`%LOCALAPPDATA%\lokal-id\ner` on Windows).
`downloadModel(dir)` fetches it ahead of time, for a container image or a machine without internet later.

## MCP server and proxy

With `"ner": true` in `.samaran.json`, `read_file_masked`, `scan_pii` (at `min_confidence: "medium"`), and Samaran
Proxy add the model's names. Install the package next to the server:

```
npx -y -p @lokal-id/mcp -p @lokal-id/ner lokal-mcp
```

The guard hook stays rules-only: it has to answer in milliseconds.

## How good is it

On held-out test data, rules and model together: 98.9% of names in chat (19.4% rules alone), 98.8% in Samaran's
benchmark (93.6% rules alone), 93.4% of people in news, with no false positives in the test corpora. See
[MODEL.md](MODEL.md) for the data, the results, and the limits.

In Python, the same model is `lokal.samaran.ner.NerNames()` (`pip install "lokal-id[ner-lokal]"`), sharing this cache
folder; it also offers two larger models from their authors.

## License

MIT. The model is MIT too; see [MODEL.md](MODEL.md) for what it was trained on and credits.

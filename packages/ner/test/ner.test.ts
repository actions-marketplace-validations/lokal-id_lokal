import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Samaran } from '@lokal-id/core';
import { WordPiece } from '../src/wordpiece.ts';
import { MODEL, NerNames, modelDir } from '../src/index.ts';

const vocab = new Map(
  ['[PAD]', '[UNK]', '[CLS]', '[SEP]', 'saya', 'sama', 'ri', '##anto', 'surya', ',', '.', 'cafe', '王', '##s'].map(
    (t, i) => [t, i],
  ),
);
const wp = new WordPiece(vocab);
const pieces = (text: string) => wp.encode(text).map((t) => [[...vocab.keys()][t.id], text.slice(t.start, t.end)]);

test('WordPiece: potongan kata dengan offset ke teks asli', () => {
  assert.deepEqual(pieces('saya sama Rianto Surya.'), [
    ['saya', 'saya'], ['sama', 'sama'], ['ri', 'Ri'], ['##anto', 'anto'], ['surya', 'Surya'], ['.', '.'],
  ]);
});

test('WordPiece: huruf kecil, tanpa aksen, tanda baca dan CJK berdiri sendiri, kata asing jadi [UNK]', () => {
  assert.deepEqual(pieces('Café,王 xyz'), [['cafe', 'Café'], [',', ','], ['王', '王'], ['[UNK]', 'xyz']]);
  // Control characters go; a tab or line break separates words.
  assert.deepEqual(pieces('saya​\tsama\nsurya'), [['saya', 'saya'], ['sama', 'sama'], ['surya', 'surya']]);
});

test('WordPiece: offset dalam satuan UTF-16 setelah emoji', () => {
  const text = '😀 saya';
  const [unk, saya] = wp.encode(text);
  assert.equal(text.slice(unk!.start, unk!.end), '😀');
  assert.equal(text.slice(saya!.start, saya!.end), 'saya');
});

test('MODEL: setiap file punya SHA-256 dan ukuran', () => {
  for (const f of Object.values(MODEL.files)) {
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
    assert.ok(f.size > 0);
  }
  assert.ok(MODEL.url.startsWith('https://github.com/lokal-id/lokal/releases/download/'));
});

// With the model (LOKAL_NER_MODEL=folder, or in the cache): never downloaded by the test suite.
const dir = process.env['LOKAL_NER_MODEL'] ?? modelDir();
test('NerNames: nama tanpa label di chat', { skip: !existsSync(`${dir}/model.onnx`) && 'model tidak ada' }, async () => {
  const ner = await NerNames.load({ modelPath: dir });
  try {
    const text = 'saya di chat sama rianto surya tadi pagi, terus ada yang ngeliat minan minanto ga ya';
    assert.deepEqual((await ner.find(text)).map((m) => m.value), ['rianto surya', 'minan minanto']);
    assert.deepEqual(await ner.find('Nitip ya kak, makasih. retry=1 status=ok'), []);
    const masked = new Samaran().mask(text, await ner.find(text)).text;
    assert.equal(masked, 'saya di chat sama [NAME_1] tadi pagi, terus ada yang ngeliat [NAME_2] ga ya');
    // Text longer than one window of the model (512 tokens), on one line: the name at its end is still found.
    const parts = [
      'rapat anggaran dibahas lagi minggu depan', 'jalan ke kantor macet parah dari pagi',
      'stok gudang tinggal sedikit jadi harus pesan lagi', 'laporan bulanan belum dikirim ke pusat',
      'printer di lantai dua rusak lagi', 'tagihan listrik naik bulan ini', 'jadwal piket ganti mulai senin',
      'wifi kantor sering putus kalau hujan',
    ];
    const long = `${Array.from({ length: 70 }, (_, i) => `${parts[i % 8]} nomor ${i}`).join(', ')}, lalu budi hartono datang telat`;
    const hidden = new Samaran().mask(long, await ner.find(long)).text;
    assert.ok(!/budi|hartono/.test(hidden), hidden.slice(-80));
  } finally {
    await ner.close();
  }
});

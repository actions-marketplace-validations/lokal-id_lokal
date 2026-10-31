// Gaps an independent evaluation of 0.16.1 found, each with its look-alikes that must stay clean. Written in this
// repository's own words: the evaluation's cases are not copied here. Every person and number is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Samaran, detectPii } from '../src/index.ts';

const found = (text: string) => detectPii(text).map((m) => `${m.type}:${m.value}`);

test('NIK dan KK bertitik tertangkap tanpa label titik dua; nominal dan versi bertitik tidak', () => {
  assert.deepEqual(found('pemohon (NIK 3175.0912.0390.0002) sudah datang'), ['NIK:3175.0912.0390.0002']);
  assert.deepEqual(found('No. KTP 3175.0912.0390.0002'), ['NIK:3175.0912.0390.0002']);
  assert.deepEqual(found('tolong cek 3175.0912.0390.0002 ya'), ['NIK:3175.0912.0390.0002']);
  assert.deepEqual(found('KK 32.01.01.150895.0001'), ['KK:32.01.01.150895.0001']);
  assert.deepEqual(found('ktp 320101.150895.0001'), ['NIK:320101.150895.0001']);
  for (const clean of ['transfer Rp 12.500.000.000 ke kas', 'build 2026.10.31.1200 rilis', 'versi 1.2.3.4', 'populasi 1.250.000.000.000 bintang']) {
    assert.deepEqual(found(clean), [], clean);
  }
});

test('alamat perumahan tanpa "Jl." dan kunci pengiriman', () => {
  assert.deepEqual(found('{"ship_to": "Komp. Griya Kenanga 6"}'), ['ADDRESS:Komp. Griya Kenanga 6']);
  assert.deepEqual(found('{"alamat_kirim": "Taman Sari Indah C3"}'), ['ADDRESS:Taman Sari Indah C3']);
  assert.deepEqual(found('kirim ke Komp. Griya Kenanga 6 ya kak'), ['ADDRESS:Komp. Griya Kenanga 6']);
  assert.deepEqual(found('Kenanga Residence Blok C2 No. 5, Bekasi'), ['ADDRESS:Blok C2 No. 5']);
  for (const clean of ['Perum Bulog 2 gudang penuh', 'komplek 3 orang', 'cluster 2 unit tersisa', 'perumahan 45 rumah', 'blok A dan blok B rapat jam 2']) {
    assert.deepEqual(found(clean), [], clean);
  }
});

test('kolom nama di CSV tanpa header bermakna, termasuk nama yang tidak ada di daftar', () => {
  const csv = 'c1,c2,c3\nBudi Santoso,Bogor,120000\nKaleandra Wirasena,Depok,50000\nSiti Aminah,Bekasi,75000\nYohanes Tumbelaka,Bandung,9000\n';
  assert.deepEqual(
    detectPii(csv).filter((m) => m.type === 'NAME').map((m) => m.value),
    ['Budi Santoso', 'Kaleandra Wirasena', 'Siti Aminah', 'Yohanes Tumbelaka'],
  );
  for (const m of detectPii(csv)) assert.equal(csv.slice(m.start, m.end), m.value);
  // With CRLF too: offsets stay right.
  const crlf = csv.replace(/\n/g, '\r\n');
  for (const m of detectPii(crlf)) assert.equal(crlf.slice(m.start, m.end), m.value);
  // Products and cities are not people.
  assert.deepEqual(found('c1,c2\nIndomie Goreng,3500\nAqua Botol,4000\nTeh Pucuk,3000\nKopi Kapal Api,2000\n'), []);
  assert.deepEqual(found('a;b\nBogor;1\nDepok;2\nBekasi;3\nTangerang;4\n'), []);
});

test('ID teknis di log pembayaran bukan rekening, durasi bukan nomor HP', () => {
  for (const clean of [
    '2026-10-31 10:00:01 INFO payment-svc transfer trace_id=7340958123094857',
    'INFO bca-callback trace_id=7340958123094857 status=OK',
    '[va-service] traceId=7340958123094857',
    'tf berhasil, ref 7340958123094857',
    'id transaksi 7340958123094857 via BCA',
    'waktu proses 0812345678 ms',
    'duration=0856123456',
  ]) {
    assert.deepEqual(found(clean), [], clean);
  }
  assert.deepEqual(found('transfer ke rek 7340958123094857'), ['BANK_ACCOUNT:7340958123094857']);
  assert.deepEqual(found('no rek BCA 7340958123094857'), ['BANK_ACCOUNT:7340958123094857']);
  assert.deepEqual(found('hp 0812345678 ms dulu'), ['PHONE:0812345678']);
  assert.deepEqual(found('durasi telp: 0812-3456-7890'), ['PHONE:0812-3456-7890']);
});

test('nama yang juga ditulis huruf kecil dipulihkan sesuai huruf di sekitarnya', () => {
  const s = new Samaran();
  s.mask('nama: Paijo');
  const { text } = s.mask('aku paijo yg td chat');
  assert.equal(text, 'aku [NAME_1] yg td chat', 'one person, one placeholder');
  assert.equal(s.unmask(text), 'aku paijo yg td chat');
  assert.equal(s.unmask('Halo [NAME_1], pesanan dikirim'), 'Halo Paijo, pesanan dikirim');
  assert.equal(s.unmask('[NAME_1]'), 'Paijo');
  const only = new Samaran();
  only.mask('nama: paijo');
  assert.equal(only.unmask('Halo [NAME_1]'), 'Halo paijo', 'a name only ever written in lower case stays so');
});

test('putaran 2: nama bergaris bawah, bin/binti, inisial di depan, dan nama huruf besar yang berhenti di kata kerja', () => {
  assert.deepEqual(found('{"role":"user","name":"Budi_Santoso","content":"halo"}'), ['NAME:Budi_Santoso']);
  assert.deepEqual(found('name: build_and_test'), []);
  assert.deepEqual(found('Kemudian Fatimah binti Abdullah datang'), ['NAME:Fatimah binti Abdullah']);
  assert.deepEqual(found('AHMAD BIN HASAN'), ['NAME:AHMAD BIN HASAN']);
  assert.deepEqual(found('yang hadir R. Ayu Kusumawardhani dan Budi'), ['NAME:R. Ayu Kusumawardhani']);
  assert.deepEqual(found('Saksi melihat SUPRIYADI ALIAS UDIN TELAH MENGAMBIL motor'), ['NAME:SUPRIYADI ALIAS UDIN']);
  for (const clean of ['Pasal 5 ayat 2 UU No. 27', 'J. P. Morgan Chase', 'sesuai P.T. Bank Mandiri', 'IMEI: 356938035643809']) {
    assert.deepEqual(found(clean), [], clean);
  }
  assert.deepEqual(found('nama: Siti Menik'), ['NAME:Siti Menik'], 'men- is not cut: Menik, Mentari are names');
  assert.deepEqual(found('kirim ke Kp. Rawa Bebek RT 04/09, Bekasi'), ['ADDRESS:Kp. Rawa Bebek RT 04/09']);
});

test('Kembaran: NIK yang tidak dikenali detektor tetap diganti lewat strukturnya, dan panggilan ikut nama lengkap', async () => {
  const { Kembaran } = await import('../src/kembaran.ts');
  const sql = "INSERT INTO t VALUES ('3276-0101.0180 0001', 'x');\nINSERT INTO t VALUES ('32760101.01800002', 'y');";
  assert.deepEqual(detectPii(sql), [], 'the detector misses both');
  const r = new Kembaran({ secret: 's' }).texts([sql]);
  assert.ok(!r.files[0]!.text.replace(/\D/g, '').includes('3276010101800001'));
  assert.ok(!r.files[0]!.text.replace(/\D/g, '').includes('3276010101800002'));
  assert.deepEqual(r.files[0]!.crossed, { NIK: 2 });
  const csv = 'nama,catatan\nSiti Aminah,Bu Siti minta dikirim pagi\nBudi Santoso,Pak Budi sudah bayar\nBudi Hartono,-\n';
  const [row1, row2] = new Kembaran({ secret: 's' }).texts([csv]).files[0]!.text.split('\n').slice(1);
  assert.equal(row1!.split(',')[1], `Bu ${row1!.split(' ')[0]} minta dikirim pagi`, 'Bu Siti follows Siti Aminah');
  assert.notEqual(row2!.split(',')[1], `Pak ${row2!.split(' ')[0]} sudah bayar`, 'two Budis: no guess');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAlamat } from '../src/wilayah.ts';

const brief = (address: string) => {
  const r = parseAlamat(address);
  return { code: r.code, confidence: r.confidence, street: r.street, rt: r.rt, rw: r.rw, postalCode: r.postalCode };
};

test('a full address with commas and level words', () => {
  const r = parseAlamat('Jl. Melati No. 12 RT 003/RW 005, Kel. Cempaka Putih Timur, Kec. Cempaka Putih, Jakarta Pusat 10510');
  assert.equal(r.code, '31.71.05.1001');
  assert.equal(r.confidence, 'high');
  assert.equal(r.street, 'Jl. Melati No. 12');
  assert.equal(r.rt, '003');
  assert.equal(r.rw, '005');
  assert.equal(r.postalCode, '10510');
  assert.equal(r.kelurahanDesa?.name, 'Cempaka Putih Timur');
  assert.equal(r.kecamatan?.name, 'Cempaka Putih');
  assert.equal(r.kabupatenKota?.name, 'Kota Administrasi Jakarta Pusat');
  assert.equal(r.provinsi?.code, '31');
  assert.deepEqual(r.inferred, ['provinsi']);
  assert.deepEqual(r.issues, []);
  assert.equal(
    r.formatted,
    'Jl. Melati No. 12, RT 003/RW 005, Kelurahan Cempaka Putih Timur, Kecamatan Cempaka Putih, Kota Administrasi Jakarta Pusat, Daerah Khusus Ibukota Jakarta 10510',
  );
});

test('lowercase, no commas, RT/RW written short', () => {
  assert.deepEqual(brief('jl margonda raya no 100 rt 3/5 kemiri muka beji depok 16423'), {
    code: '32.76.06.1004',
    confidence: 'high',
    street: 'jl margonda raya no 100',
    rt: '003',
    rw: '005',
    postalCode: '16423',
  });
  // A street with nothing marking its end does not swallow the village after it.
  assert.equal(parseAlamat('jl. melati wuwur gabus pati 59173').code, '33.18.11.2001');
});

test('capitals and abbreviations as on a KTP', () => {
  assert.equal(parseAlamat('alamat: ds. ciherang kec. pacet kab. cianjur').code, '32.03.10.2001');
  assert.equal(parseAlamat('Gg. Mawar 3, Ds. Sukamaju, Kec. Cibungbulang, Kab. Bogor, Jabar').code, '32.01.16.2013');
  const r = parseAlamat('Dsn. Krajan RT 2 RW 1 Ds. Sumberejo Kec. Batu Kota Batu');
  assert.equal(r.code, '35.79.01.2005');
  assert.equal(r.street, 'Dsn. Krajan');
});

test('short names for Jakarta, Tangerang Selatan, and provinces', () => {
  assert.equal(parseAlamat('Kebayoran Baru, Jaksel').code, '31.74.07');
  assert.equal(parseAlamat('Pondok Aren, Tangsel').code, '36.74.03');
  assert.equal(parseAlamat('Medan Baru, Medan, Sumut').code, '12.71.17');
  assert.equal(parseAlamat('Depok, Sleman, DIY').code, '34.04.07', 'Depok the kecamatan in Sleman, not Kota Depok');
});

test('"Kota" and "Kab." tell the kota from the kabupaten; without them it is a guess', () => {
  assert.equal(parseAlamat('Kota Bogor').code, '32.71');
  assert.equal(parseAlamat('Kab. Bogor').code, '32.01');
  const r = parseAlamat('Bogor');
  assert.equal(r.confidence, 'low');
  assert.deepEqual(r.alternatives.map((w) => w.code), ['32.71']);
});

test('a kode pos that belongs elsewhere is reported, one that is not registered too', () => {
  const r = parseAlamat('Kemiri Muka, Beji, Depok 16424');
  assert.equal(r.code, '32.76.06.1004');
  assert.notEqual(r.confidence, 'high');
  assert.deepEqual(r.issues, ['Kode pos 16424 bukan milik Kelurahan Kemiri Muka (kode posnya 16423).']);
  assert.deepEqual(parseAlamat('Kemiri Muka, Beji, Depok 16999').issues, ['Kode pos 16999 tidak terdaftar.']);
});

test('the kode pos fills in the kelurahan the address leaves out', () => {
  const r = parseAlamat('Jalan Diponegoro 22 Bandung 40115');
  assert.equal(r.code, '32.73.09.1003');
  assert.deepEqual(r.inferred, ['provinsi', 'kecamatan', 'kelurahanDesa']);
  assert.equal(r.street, 'Jalan Diponegoro 22');
  const only = parseAlamat('16424');
  assert.equal(only.code, '32.76.06.1005');
  assert.equal(only.confidence, 'low');
});

test('a named village that is not in the data is reported, and the rest still found', () => {
  const r = parseAlamat('KP. RAWA BADAK RT 01 RW 02 DESA SUKAMAJU KEC. CILEBAR KAB. KARAWANG');
  assert.equal(r.code, '32.15.30');
  assert.deepEqual(r.issues, ['Kelurahan/desa Sukamaju tidak ditemukan di Kecamatan Cilebar menurut data Kemendagri.']);
});

test('a city inside a street name does not win over the kecamatan after it', () => {
  const r = parseAlamat('Jl. Raya Bogor KM 30, Cimanggis, Depok');
  assert.equal(r.code, '32.76.02');
  assert.equal(r.street, 'Jl. Raya Bogor KM 30');
  assert.equal(parseAlamat('Jl. Bogor Raya No 5, Cibubur, Ciracas, Jakarta Timur').code, '31.75.09.1002');
});

test('a kecamatan and kelurahan with the same name: the kecamatan, unless something points at the kelurahan', () => {
  assert.equal(parseAlamat('Kuta, Badung, Bali').code, '51.03.01');
  assert.equal(parseAlamat('Kel. Kuta, Kuta, Badung').code, '51.03.01.1002');
  assert.equal(parseAlamat('Sumbersari, Jember 68121').code, '35.09.21.1002', 'the kode pos is the kelurahan’s');
});

test('names written with or without spaces and apostrophes', () => {
  assert.equal(parseAlamat('Ds. Suka Maju, Kec. Cibungbulang, Kab. Bogor').code, parseAlamat('Ds. Sukamaju, Kec. Cibungbulang, Kab. Bogor').code);
  assert.equal(parseAlamat('Murung Ta’al, Labuan Amas Selatan, Hulu Sungai Tengah').code, '63.07.03.2015');
});

test('text with no region in it', () => {
  const r = parseAlamat('tolong kirim besok pagi ya');
  assert.equal(r.code, undefined);
  assert.equal(r.confidence, 'none');
  assert.equal(parseAlamat('').confidence, 'none');
});

test('Google Maps style: shortened words, a Plus Code, the province written out', () => {
  const r = parseAlamat('Jl. Kenanga No.8, Gandaria Utara, Kec. Kby. Baru, Kota Jakarta Selatan, Daerah Khusus Ibukota Jakarta 12140');
  assert.equal(r.code, '31.74.07.1009');
  assert.equal(r.confidence, 'high');
  assert.equal(parseAlamat('Jl. Mawar No.3, Kec. Metro Bar., Kota Metro, Lampung').code, '18.72.03');
  assert.equal(parseAlamat('Jl. Anggrek 4, Tj. Priok, Kota Jkt Utara').code, '31.72.02');
  assert.equal(brief('92JW+6X7, Jl. Kenanga No. 2, Beji, Depok').street, 'Jl. Kenanga No. 2');
});

test('a kelurahan named with its kecamatan wins over the kelurahan that owns a wrong kode pos', () => {
  const r = parseAlamat('Jl. Tulip 5, Lengkong Gudang, Serpong, Tangerang Selatan 15311');
  assert.equal(r.code, '36.74.01.1004');
  assert.deepEqual(r.issues, ['Kode pos 15311 bukan milik Kelurahan Lengkong Gudang (kode posnya 15321).']);
});

test('"Kel." prefers a kelurahan and "Desa" a desa; a dusun is part of the street', () => {
  assert.equal(parseAlamat('Gg. Mawar, Kel. Kamal').code, '31.73.06.1004');
  const r = parseAlamat('Dusun Donomulyo, Desa Adipuro');
  assert.equal(r.street, 'Dusun Donomulyo');
  assert.equal(r.kelurahanDesa?.name, 'Adipuro');
});

test('level words and province names inside other names', () => {
  assert.deepEqual(brief('Jalan Kota Baru No. 3'), { code: undefined, confidence: 'none', street: 'Jalan Kota Baru No. 3', rt: undefined, rw: undefined, postalCode: undefined });
  assert.equal(parseAlamat('Jl. Merpati, Sidodadi, Lampung Timur').kabupatenKota?.code, '18.07');
});

test('RT/RW and kode pos written with a colon, numbers in names written as Roman numerals', () => {
  const r = parseAlamat('Jl. Rambutan Rt:30 Rw:10 Kode Pos:30144 Kecamatan: Ilir Barat II');
  assert.equal(r.street, 'Jl. Rambutan');
  assert.equal(r.rt, '030');
  assert.equal(r.rw, '010');
  assert.equal(r.postalCode, '30144');
  assert.equal(r.kecamatan?.name, 'Ilir Barat Dua');
});

test('names with a typo, inside the kota or kabupaten the address names', () => {
  const kab = parseAlamat('Kp. Nagrog RT 13 RW 03, Kab. Tasikmalayah');
  assert.equal(kab.kabupatenKota?.code, '32.06');
  assert.ok(kab.issues.includes('"Tasikmalayah" dibaca sebagai Kabupaten Tasikmalaya.'));
  assert.equal(kab.confidence, 'medium');
  const kec = parseAlamat('Jl. Melati 5, Cibinog, Kab. Bogor');
  assert.equal(kec.code, '32.01.01');
  assert.deepEqual(kec.issues, ['"Cibinog" dibaca sebagai Kecamatan Cibinong.']);
  assert.equal(parseAlamat('Jl. Anggrek 2, Kec. Tanah Sereal, Kota Bogor').code, '32.71.06');
});

test('a real name is not read as a typo of another', () => {
  const r = parseAlamat('Jl. Raya Metro Wates Km 05, Desa Purwodadi');
  assert.equal(r.kelurahanDesa?.name, 'Purwodadi');
  assert.equal(r.confidence, 'low');
  assert.equal(parseAlamat('Gg. Bukit 2, Jaga Baya I, Way Halim, Kota Bandar Lampung').code, '18.71.15');
});

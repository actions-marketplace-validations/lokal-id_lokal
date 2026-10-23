// Coverage of the personal data categories in UU PDP Pasal 4, plus Indonesian identifiers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPii, maskPii, UU_PDP_CATEGORY, partialMask } from '../src/index.ts';

const found = (text: string) => detectPii(text).map((m) => `${m.type}:${m.value}`);

test('data pribadi umum: nama, jenis kelamin, agama, status perkawinan, kewarganegaraan', () => {
  assert.deepEqual(found('nama: budi santoso'), ['NAME:budi santoso']);
  assert.deepEqual(found('NAMA : BUDI SANTOSO'), ['NAME:BUDI SANTOSO']);
  assert.deepEqual(found('Agama: Islam, Status Perkawinan: Kawin'), ['RELIGION:Islam', 'MARITAL_STATUS:Kawin']);
  assert.deepEqual(found('Agama: Islam Status Perkawinan: Kawin'), ['RELIGION:Islam', 'MARITAL_STATUS:Kawin']);
  assert.deepEqual(found('dia beragama Katolik'), ['RELIGION:Katolik']);
  assert.deepEqual(found('Jenis Kelamin: Perempuan; Kewarganegaraan: WNI'), [
    'GENDER:Perempuan',
    'NATIONALITY:WNI',
  ]);
});

test('tanggal dan tempat lahir', () => {
  assert.deepEqual(found('lahir 15 Agustus 1995, tgl lahir 15-08-1995'), [
    'BIRTH_DATE:15 Agustus 1995',
    'BIRTH_DATE:15-08-1995',
  ]);
  assert.deepEqual(found('Tempat/Tgl Lahir : BOGOR, 15-08-1995'), ['BIRTH_DATE:BOGOR, 15-08-1995']);
});

test('data pribadi spesifik: kesehatan', () => {
  assert.deepEqual(found('Pasien didiagnosis HIV dan diabetes tipe 2'), ['HEALTH:HIV dan diabetes tipe 2']);
  assert.deepEqual(found('anak saya positif covid, ibu saya pasien kanker payudara'), [
    'HEALTH:covid',
    'HEALTH:kanker payudara',
  ]);
  // Everyday uses of the same verbs are not health data.
  assert.deepEqual(found('perusahaan menderita kerugian, tanggapan positif dari pelanggan'), []);
});

test('data pribadi spesifik: keuangan, catatan kejahatan, biometrik', () => {
  assert.deepEqual(found('Gaji saya 8 juta, saldo rekening 25 juta'), ['FINANCIAL:8 juta', 'FINANCIAL:25 juta']);
  assert.deepEqual(found('pendapatan perusahaan naik 20 persen'), []);
  assert.deepEqual(found('Catatan Kriminal: pernah ditahan 2019'), ['CRIMINAL_RECORD:pernah ditahan 2019']);
  assert.deepEqual(found('foto_ktp: uploads/ktp/8812.jpg'), ['BIOMETRIC:uploads/ktp/8812.jpg']);
  assert.equal(UU_PDP_CATEGORY.HEALTH, 'spesifik');
  assert.equal(UU_PDP_CATEGORY.FINANCIAL, 'spesifik');
  assert.equal(UU_PDP_CATEGORY.NAME, 'umum');
});

test('pengenal: KK, paspor, SIM, NIP, IP, koordinat', () => {
  assert.deepEqual(found('No KK 3201010101200001'), ['KK:3201010101200001']);
  assert.deepEqual(found('Paspor: A1234567'), ['PASSPORT:A1234567']);
  assert.deepEqual(found('No SIM 950812345678'), ['SIM:950812345678']);
  assert.deepEqual(found('NIP 19950815 202012 1 001'), ['NIP:19950815 202012 1 001']);
  assert.deepEqual(found('login dari 182.253.10.15 versi 1.2.3.4, bind 0.0.0.0'), ['IP:182.253.10.15']);
  assert.deepEqual(found('lokasi -6.200000, 106.816666'), ['GEO:-6.200000, 106.816666']);
  // SIM label only applies to the number right after it.
  assert.deepEqual(found('No SIM 950812345678, NIK 3201011508950001'), [
    'SIM:950812345678',
    'NIK:3201011508950001',
  ]);
});

test('kolom sensitif di CSV dan JSON ikut disamarkan', () => {
  assert.deepEqual(found('nama,agama,diagnosa,gaji,jk\nBudi Santoso,Islam,Hipertensi,8000000,L'), [
    'NAME:Budi Santoso',
    'RELIGION:Islam',
    'HEALTH:Hipertensi',
    'FINANCIAL:8000000',
    'GENDER:L',
  ]);
  assert.deepEqual(found('{"nama_pelanggan": "siti", "tgl_lahir": "1995-08-15", "gol_darah": "O"}'), [
    'NAME:siti',
    'BIRTH_DATE:1995-08-15',
    'HEALTH:O',
  ]);
  assert.deepEqual(found('GET /daftar?nama=Budi&email=budi@x.id&hp=081234567890'), [
    'NAME:Budi',
    'EMAIL:budi@x.id',
    'PHONE:081234567890',
  ]);
});

test('kode, skema, dan konfigurasi tidak dianggap data pribadi', () => {
  const code = [
    'interface User { nama: string; phone: string }',
    'const email = user.email',
    'nik: z.string().length(16)',
    'const address = url; address = arguments[1]',
    'name: Build and test',
    '  - name: Checkout',
    'jam 14:30 buka https://lokal.id/nama:budi',
    'nik: wajib diisi',
    'const cache = { ttl: 60000 }',
    'number: { label: "מספר", gender: "m" }',
    'verify(key, alg, signature: BufferSource)',
    'contoh: budi@example.com, admin@toko.test',
  ].join('\n');
  assert.deepEqual(found(code), []);
});

test('key generik "name" hanya confidence medium', () => {
  const [m] = detectPii('name: Default Greeting');
  assert.equal(m?.confidence, 'medium');
  assert.equal(detectPii('Nama: Budi Santoso')[0]?.confidence, 'high');
  assert.deepEqual(detectPii('TTL: Bogor, 15-08-1995').map((x) => x.type), ['BIRTH_DATE']);
  assert.deepEqual(detectPii('jenis_kelamin: L').map((x) => x.value), ['L']);
});

test('mask dan partial untuk jenis baru', () => {
  const { text } = maskPii('Agama: Islam, didiagnosis TBC, gaji 8 juta, NIP 199508152020121001');
  assert.equal(text, 'Agama: [RELIGION_1], didiagnosis [HEALTH_1], gaji [FINANCIAL_1], NIP [NIP_1]');
  assert.equal(partialMask('IP', '182.253.10.15'), '182.253.*.*');
  assert.equal(partialMask('HEALTH', 'HIV'), '***');
  assert.equal(partialMask('KK', '3201010101200001'), '3201********0001');
});

test('key ip hanya untuk alamat IP, bukan versi paket di lockfile', () => {
  assert.deepEqual(found('"ip-address": "^10.2.0"'), []);
  assert.deepEqual(found('ip_address: 2.0.1'), []);
  assert.deepEqual(found('client_ip: 182.253.10.15'), ['IP:182.253.10.15']);
  assert.deepEqual(found('"remote_addr": "2001:db8::1"').map((x) => x.split(':')[0]), ['IP']);
});

test('data anak dan catatan sipil: NISN dan nomor akta', () => {
  assert.deepEqual(found('NISN 0123456789 atas nama Nayla Zahra'), ['NISN:0123456789', 'NAME:Nayla Zahra']);
  assert.deepEqual(found('Nomor akta kelahiran: 3175-LU-01022010-0123'), ['AKTA:3175-LU-01022010-0123']);
  assert.deepEqual(found('akta kelahiran no. 3201-LT-12052018-0042'), ['AKTA:3201-LT-12052018-0042']);
  assert.equal(UU_PDP_CATEGORY.NISN, 'spesifik');
  assert.equal(partialMask('NISN', '0123456789'), '*******789');
  // A ten-digit number without the word NISN is not one.
  assert.deepEqual(found('Order 0123456789 dikirim'), []);
});

test('Penjelasan Pasal 4 ayat (2): genetika, hasil tes, daftar cekal', () => {
  assert.deepEqual(found('anaknya pembawa sifat thalassemia beta'), ['HEALTH:thalassemia beta']);
  assert.deepEqual(found('Ibu Melati dinyatakan BRCA1 positif'), ['NAME:Melati', 'HEALTH:BRCA1 positif']);
  assert.deepEqual(found('hasil tes HIV reaktif'), ['HEALTH:HIV reaktif']);
  assert.deepEqual(found('Yang bersangkutan masuk daftar cekal sejak Maret'), ['CRIMINAL_RECORD:masuk daftar cekal']);
  assert.deepEqual(found('pernah ditahan kasus narkoba tahun 2019'), ['CRIMINAL_RECORD:pernah ditahan kasus narkoba']);
  // The law's own wording describes the categories; it names no one.
  assert.deepEqual(
    found(
      'antara lain catatan kepolisian dan pencantuman dalam daftar pencegahan atau penangkalan. Perubahan data riwayat penyakit yang berpotensi membahayakan.',
    ),
    [],
  );
});

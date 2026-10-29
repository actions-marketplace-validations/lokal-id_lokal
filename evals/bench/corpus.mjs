// The Samaran benchmark corpus: made-up Indonesian documents with every piece of personal data labelled by type and
// position. Nothing here is a real person: names are random pairs from common first names and surnames, and numbers
// are random with a valid structure (a NIK has a real district code and a possible birth date, a card passes Luhn).
//
// Two splits use different templates and different name pools:
//   dev   for working on the detectors; look at its misses as much as you like.
//   test  held out: only for reporting. Do not tune a detector on a test document; add a dev template instead.
//
// generate({ split, seed, perTemplate }) returns documents { id, split, format, text, spans: [{ start, end, type }],
// neutral: [{ start, end }] }: neutral text is neither personal data nor a place where a detection is wrong.
// The same arguments give the same corpus on every machine.

import { listWilayah } from '../../packages/core/dist/wilayah.js';

// --- deterministic randomness ------------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  constructor(seed) {
    this.next = mulberry32(seed);
  }
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }
  chance(p) {
    return this.next() < p;
  }
  digits(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += String(this.int(0, 9));
    return s;
  }
}

const pad = (n, width = 2) => String(n).padStart(width, '0');

// --- name pools: dev and test do not share first names --------------------------------------------------------

const POOLS = {
  dev: {
    male: ['Budi', 'Agus', 'Dedi', 'Rizky', 'Fajar', 'Hendra', 'Andi', 'Wahyu', 'Bayu', 'Arief', 'Dimas', 'Yusuf'],
    female: ['Siti', 'Dewi', 'Rina', 'Ayu', 'Putri', 'Fitri', 'Indah', 'Maya', 'Ratna', 'Wulan', 'Nadia', 'Sari'],
    last: ['Santoso', 'Wibowo', 'Saputra', 'Hidayat', 'Pratama', 'Kusuma', 'Rahayu', 'Setiawan', 'Nugroho', 'Siregar', 'Nasution', 'Harahap', 'Wijaya', 'Gunawan', 'Lubis', 'Sinaga'],
  },
  test: {
    male: ['Eko', 'Rudi', 'Teguh', 'Ilham', 'Gilang', 'Yoga', 'Reza', 'Imam', 'Hafiz', 'Bima', 'Rangga', 'Danu'],
    female: ['Lestari', 'Anisa', 'Tiara', 'Yuni', 'Rahma', 'Desi', 'Novi', 'Citra', 'Melati', 'Intan', 'Sekar', 'Laila'],
    last: ['Hutapea', 'Simanjuntak', 'Tanjung', 'Purba', 'Manurung', 'Pane', 'Daulay', 'Halim', 'Permana', 'Suryadi', 'Ramadhan', 'Firmansyah', 'Maulana', 'Kurniawan', 'Hasibuan', 'Batubara'],
  },
};

const DOMAINS = { dev: ['posku.id', 'surelku.com', 'mailcontoh.co.id'], test: ['kotakpos.id', 'suratku.net', 'pesanan-contoh.com'] };
const STREETS = ['Melati', 'Kenanga', 'Mawar', 'Anggrek', 'Flamboyan', 'Cempaka', 'Merdeka', 'Pahlawan', 'Diponegoro', 'Sudirman', 'Kartini', 'Cendana', 'Nangka', 'Rambutan', 'Garuda'];
const BANKS = ['BCA', 'BRI', 'BNI', 'Mandiri', 'BSI', 'CIMB Niaga', 'Permata'];
const PREFIXES = ['0811', '0812', '0813', '0821', '0822', '0852', '0853', '0857', '0858', '0877', '0878', '0896', '0838', '0881'];
const HEALTH = ['diabetes', 'hipertensi', 'asma', 'TBC', 'DBD', 'kanker', 'stroke', 'HIV', 'gagal ginjal', 'epilepsi'];
const RELIGIONS = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu'];
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const PLATE_AREAS = ['B', 'D', 'F', 'L', 'AB', 'H', 'N', 'BK', 'DK', 'KT'];

let districts;
function allDistricts() {
  if (!districts) {
    districts = [];
    for (const province of listWilayah()) {
      for (const regency of listWilayah(province.code)) {
        for (const district of listWilayah(regency.code)) districts.push(district);
      }
    }
  }
  return districts;
}

// --- one made-up person per document ---------------------------------------------------------------------------

function person(rng, split) {
  const pool = POOLS[split];
  const female = rng.chance(0.5);
  const first = rng.pick(female ? pool.female : pool.male);
  const last = rng.pick(pool.last);
  const district = rng.pick(allDistricts());
  const regionDigits = district.code.replace(/\./g, '');
  const day = rng.int(1, 28);
  const month = rng.int(1, 12);
  const year = rng.int(1960, 2005);
  const nik = `${regionDigits}${pad(day + (female ? 40 : 0))}${pad(month)}${pad(year % 100)}${pad(rng.int(1, 150), 4)}`;
  const kk = `${regionDigits}${pad(rng.int(1, 28))}${pad(rng.int(1, 12))}${pad(rng.int(10, 24))}${pad(rng.int(1, 999), 4)}`;
  const phone = `${rng.pick(PREFIXES)}${rng.digits(rng.pick([7, 8]))}`;
  const city = district.path.split(', ')[1];
  return {
    female,
    first,
    last,
    full: `${first} ${last}`,
    district,
    city,
    day,
    month,
    year,
    nik,
    kk,
    phone,
    email: `${first.toLowerCase()}${rng.pick(['.', '_', ''])}${last.toLowerCase()}${rng.chance(0.5) ? rng.int(1, 99) : ''}@${rng.pick(DOMAINS[split])}`,
    bank: rng.pick(BANKS),
    account: rng.digits(rng.pick([10, 10, 13, 15])),
    street: `Jl. ${rng.pick(STREETS)} No. ${rng.int(1, 120)}`,
    rt: `RT ${pad(rng.int(1, 15), 3)}/RW ${pad(rng.int(1, 12), 3)}`,
    npwp: `${rng.digits(2)}.${rng.digits(3)}.${rng.digits(3)}.${rng.digits(1)}-${rng.digits(3)}.${rng.digits(3)}`,
    bpjs: `000${rng.digits(10)}`,
    passport: `${rng.pick(['A', 'B', 'C', 'E'])}${rng.digits(7)}`,
    plate: `${rng.pick(PLATE_AREAS)} ${rng.int(1000, 9999)} ${String.fromCharCode(65 + rng.int(0, 25), 65 + rng.int(0, 25), 65 + rng.int(0, 25))}`,
    card: card(rng),
    health: rng.pick(HEALTH),
    blood: rng.pick(['A', 'B', 'AB', 'O']),
    religion: rng.pick(RELIGIONS),
  };
}

function card(rng) {
  const digits = [rng.pick(['4', '5']), ...rng.digits(14)].map(Number);
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = digits[14 - i];
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  digits.push((10 - (sum % 10)) % 10);
  const s = digits.join('');
  return `${s.slice(0, 4)} ${s.slice(4, 8)} ${s.slice(8, 12)} ${s.slice(12)}`;
}

function phoneAs(rng, phone, style = rng.int(0, 4)) {
  const rest = phone.slice(1);
  switch (style) {
    case 0:
      return phone;
    case 1:
      return `${phone.slice(0, 4)}-${phone.slice(4, 8)}-${phone.slice(8)}`;
    case 2:
      return `+62 ${rest.slice(0, 3)}-${rest.slice(3, 7)}-${rest.slice(7)}`;
    case 3:
      return `62${rest}`;
    default:
      return `+62${rest}`;
  }
}

// --- slots ---------------------------------------------------------------------------------------------------------
// A template is text with {SLOT} or {SLOT:variant}. A slot named after a PII type is labelled with that type; a slot
// starting with ~ is filler that is not personal data (order numbers, prices, times): a detection there is a false
// positive.

function fillSlot(rng, p, name, variant) {
  switch (name) {
    case 'NAME':
      if (variant === 'first') return p.first;
      if (variant === 'lower') return p.full.toLowerCase();
      if (variant === 'upper') return p.full.toUpperCase();
      return p.full;
    case 'NIK':
      if (variant === 'spaced') return `${p.nik.slice(0, 4)} ${p.nik.slice(4, 8)} ${p.nik.slice(8, 12)} ${p.nik.slice(12)}`;
      // OCR misreads: O for 0, l for 1, and a stray space.
      if (variant === 'ocr') return `${p.nik.slice(0, 6).replace(/0/g, 'O')} ${p.nik.slice(6).replace(/1/g, 'l')}`;
      return p.nik;
    case 'KK':
      return p.kk;
    case 'PHONE':
      return phoneAs(rng, p.phone, variant === undefined ? undefined : Number(variant));
    case 'EMAIL':
      return p.email;
    case 'BANK_ACCOUNT':
      return p.account;
    case 'NPWP':
      return p.npwp;
    case 'BPJS':
      return p.bpjs;
    case 'PASSPORT':
      return p.passport;
    case 'PLATE':
      return p.plate;
    case 'CARD':
      return p.card;
    case 'HEALTH':
      // A blood group is health data too; it is on every KTP.
      if (variant === 'blood') return p.blood;
      return p.health;
    case 'RELIGION':
      return variant === 'upper' ? p.religion.toUpperCase() : p.religion;
    case 'BIRTH_DATE':
      if (variant === 'long') return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
      if (variant === 'iso') return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
      return `${pad(p.day)}-${pad(p.month)}-${p.year}`;
    case 'ADDRESS':
      // The street, house number, and RT/RW point at one household. The district and city after them do not, so
      // they are neutral: masking them is not a false positive, leaving them is not a leak.
      if (variant === 'street') return p.street;
      if (variant === 'upper') return `${p.street} ${p.rt}`.toUpperCase();
      return { value: `${p.street} ${p.rt}`, neutral: `, Kec. ${p.district.name}, ${p.city}` };
    // filler, not personal data
    case '~BANK':
      return p.bank;
    case '~CITY':
      return p.city;
    case '~ORDER':
      return `INV/2026/${pad(rng.int(1, 12))}/${pad(rng.int(1, 999999), 6)}`;
    case '~SKU':
      return `SKU-${rng.digits(5)}`;
    case '~PRICE':
      return `Rp${rng.int(10, 999)}.${rng.pick(['000', '500'])}`;
    case '~TIME':
      return `2026-${pad(rng.int(1, 12))}-${pad(rng.int(1, 28))} ${pad(rng.int(0, 23))}:${pad(rng.int(0, 59))}:${pad(rng.int(0, 59))}`;
    case '~QTY':
      return String(rng.int(1, 20));
    case '~RESI':
      return `JP${rng.digits(10)}`;
    case '~ID':
      return String(rng.int(1000, 99999));
    case '~VERSION':
      return `v${rng.int(1, 9)}.${rng.int(0, 20)}.${rng.int(0, 9)}`;
    case '~LONGNUM':
      return `2026${rng.digits(12)}`;
    case '~HEX':
      return Array.from({ length: 32 }, () => '0123456789abcdef'[rng.int(0, 15)]).join('');
    case '~HOTLINE':
      return rng.pick(['1500888', '14045', '1500-123', '(021) 500-888']);
    case '~PORT':
      return String(rng.pick([3000, 5432, 8080, 6379]));
    default:
      throw new Error(`unknown slot {${name}}`);
  }
}

function render(template, rng, p) {
  let text = '';
  const spans = [];
  const neutral = [];
  let last = 0;
  for (const m of template.matchAll(/\{(~?[A-Z_]+)(?::([a-z0-9]+))?\}/g)) {
    text += template.slice(last, m.index);
    const filled = fillSlot(rng, p, m[1], m[2]);
    const { value, neutral: after = '' } = typeof filled === 'string' ? { value: filled } : filled;
    if (!m[1].startsWith('~')) spans.push({ start: text.length, end: text.length + value.length, type: m[1] });
    text += value;
    if (after) neutral.push({ start: text.length, end: text.length + after.length });
    text += after;
    last = m.index + m[0].length;
  }
  text += template.slice(last);
  return { text, spans, neutral };
}

// --- templates -----------------------------------------------------------------------------------------------------
// [format, template]. Formats: form, chat, mixed (Indonesian and English), typo (informal spelling, no spaces),
// unlabelled, json, csv, log, ocr, letter, trap (no personal data at all).

const TEMPLATES = {
  dev: [
    ['form', 'Nama: {NAME}\nNIK: {NIK}\nNo. HP: {PHONE}\nEmail: {EMAIL}\nAlamat: {ADDRESS}'],
    ['form', 'Nama Lengkap : {NAME}\nTanggal Lahir : {BIRTH_DATE}\nAgama : {RELIGION}\nNo. KK : {KK}'],
    ['form', 'Data pemohon\nNama: {NAME}\nNPWP: {NPWP}\nNo. BPJS Kesehatan: {BPJS}\nRekening {~BANK}: {BANK_ACCOUNT}'],
    ['chat', 'halo kak, aku {NAME:first} mau tanya pesanan {~ORDER} kok belum sampai ya. wa aku di {PHONE} aja'],
    ['chat', 'kak refund ke rek {~BANK} {BANK_ACCOUNT} a.n. {NAME} ya, makasih'],
    ['chat', 'Pak, saya {NAME}, NIK {NIK}. Mau ganti nomor HP jadi {PHONE}'],
    ['mixed', 'Hi, my name is {NAME}, my phone number is {PHONE}. Tolong update alamat ke {ADDRESS} ya'],
    ['mixed', 'Please process refund for {NAME}, account {~BANK} {BANK_ACCOUNT}, total {~PRICE}'],
    ['typo', 'nik sy {NIK} hp {PHONE:0} mksh'],
    ['typo', 'tlg cek atas nama {NAME:lower} no hp {PHONE:0} ya gan'],
    ['unlabelled', '{NAME} ({PHONE}) sudah transfer {~PRICE} untuk pesanan {~ORDER}.'],
    ['unlabelled', 'Pengiriman ke {ADDRESS}, penerima {NAME}, resi {~RESI}.'],
    ['json', '{"customer":{"name":"{NAME}","nik":"{NIK}","phone":"{PHONE:3}","email":"{EMAIL}"},"order_id":"{~ORDER}","total":"{~PRICE}"}'],
    ['json', '{"nama":"{NAME}","tgl_lahir":"{BIRTH_DATE:iso}","agama":"{RELIGION}","diagnosa":"{HEALTH}"}'],
    ['csv', 'id,nama,nik,no_hp,email\n{~ID},{NAME},{NIK},{PHONE:0},{EMAIL}'],
    ['csv', 'order_id,sku,qty,penerima,alamat\n{~ORDER},{~SKU},{~QTY},{NAME},"{ADDRESS}"'],
    ['log', '{~TIME} INFO checkout order={~ORDER} user={~ID} phone={PHONE:3} email={EMAIL} total={~PRICE}'],
    ['log', '{~TIME} WARN payment failed card={CARD} name="{NAME}" retry=1'],
    ['ocr', 'PROVINSI JAWA BARAT\nNIK : {NIK}\nNama : {NAME:upper}\nTempat/Tgl Lahir : {~CITY}, {BIRTH_DATE}\nAlamat : {ADDRESS:upper}\nAgama : {RELIGION:upper}'],
    ['ocr', 'SURAT IZIN MENGEMUDI\nNama : {NAME:upper}\nNo. Polisi kendaraan: {PLATE}\nPaspor: {PASSPORT}'],
    ['letter', 'Kepada Yth. {NAME}\n{ADDRESS}\n\nDengan hormat, kami informasikan bahwa klaim Anda untuk perawatan {HEALTH} telah disetujui.'],
    ['letter', 'Yang bertanda tangan di bawah ini, {NAME}, lahir {BIRTH_DATE:long}, NIK {NIK:spaced}, menyatakan bahwa data di atas benar.'],
    ['trap', 'Pesanan {~ORDER} berisi {~QTY} item {~SKU}, total {~PRICE}, dikirim dengan resi {~RESI}.'],
    ['trap', '{~TIME} INFO server started on port {~PORT}, build {~VERSION}, workers={~QTY}'],
    ['trap', 'Masukkan nama dan nomor HP Anda pada formulir, lalu klik Daftar. Promo berlaku sampai {~TIME}.'],
    ['trap', 'No. Invoice {~LONGNUM} untuk PO {~ORDER} sudah lunas. Pertanyaan: call center {~HOTLINE}.'],
    ['trap', '{~TIME} INFO request_id={~HEX} latency_ms={~ID} status=200 path=/api/v1/orders/{~ID}'],
    ['chat', 'td {NAME:first} blg paketnya udh dikirim, coba tanya dia aja kak'],
    ['chat', 'bu, anak saya {NAME:first} lagi sakit {HEALTH}, izin ga masuk dulu ya'],
    ['ocr', 'NIK : {NIK:ocr}\nNama : {NAME:upper}\nGol. Darah : {HEALTH:blood}'],
  ],
  test: [
    ['form', 'NAMA : {NAME}\nNOMOR INDUK KEPENDUDUKAN : {NIK}\nTELEPON : {PHONE}\nALAMAT : {ADDRESS}'],
    ['form', 'Pemohon: {NAME}\nTgl. lahir: {BIRTH_DATE:long}\nKartu Keluarga: {KK}\nE-mail: {EMAIL}'],
    ['form', 'Wajib pajak: {NAME}\nNPWP {NPWP}\nBPJS {BPJS}\nNo. rekening ({~BANK}) {BANK_ACCOUNT}'],
    ['chat', 'min paket {~ORDER} atas nama {NAME} belum dateng nih, tolong telp ke {PHONE} ya'],
    ['chat', 'udah aku tf {~PRICE} dari rekening {~BANK} {BANK_ACCOUNT} atas nama {NAME:first} ya kak'],
    ['chat', 'Selamat siang, saya {NAME}. NIK saya {NIK}, nomor saya {PHONE}. Mohon dibantu.'],
    ['mixed', 'Customer {NAME} complain, katanya paket rusak. Contact: {PHONE}, email {EMAIL}.'],
    ['mixed', 'FYI refund sudah diproses ke {~BANK} {BANK_ACCOUNT} under name {NAME}.'],
    ['typo', 'nik nya {NIK} , nmr wa {PHONE:3}, tq'],
    ['typo', 'atas nama {NAME:lower}, alamat {ADDRESS:street} deket masjid, hp {PHONE:0}'],
    ['unlabelled', 'Hari ini {NAME} datang ambil barang, nomor {PHONE}, bayar {~PRICE} tunai.'],
    ['unlabelled', '{NAME} - {EMAIL} - {PHONE}'],
    ['json', '{"data":{"full_name":"{NAME}","id_number":"{NIK}","mobile":"{PHONE:4}","address":"{ADDRESS}"},"sku":"{~SKU}"}'],
    ['json', '{"pasien":"{NAME}","lahir":"{BIRTH_DATE}","penyakit":"{HEALTH}","agama":"{RELIGION}","kamar":"{~QTY}"}'],
    ['csv', 'nama;nik;telepon;kota\n{NAME};{NIK};{PHONE:1};{~CITY}'],
    ['csv', 'tanggal,order,nama_penerima,hp_penerima,total\n{~TIME},{~ORDER},{NAME},{PHONE:0},{~PRICE}'],
    ['log', '[{~TIME}] ERROR sendOtp failed for msisdn={PHONE:3} user_email={EMAIL} code=500'],
    ['log', '{~TIME} DEBUG payload customer="{NAME}" npwp={NPWP} amount={~PRICE}'],
    ['ocr', 'KARTU TANDA PENDUDUK\nNIK {NIK}\nNama {NAME:upper}\nTempat/Tgl Lahir {~CITY}, {BIRTH_DATE}\nAgama {RELIGION:upper}'],
    ['ocr', 'STNK\nNAMA PEMILIK : {NAME:upper}\nNOMOR REGISTRASI : {PLATE}\nNo. paspor pemilik : {PASSPORT}'],
    ['letter', 'Yth. Bapak/Ibu {NAME}, berdasarkan hasil pemeriksaan, Anda didiagnosis {HEALTH}. Hasil lengkap dikirim ke {EMAIL}.'],
    ['letter', 'Surat kuasa: saya {NAME}, pemegang kartu {CARD}, memberi kuasa untuk menutup rekening {BANK_ACCOUNT}.'],
    ['trap', 'Stok {~SKU} tinggal {~QTY}, harga {~PRICE}, update terakhir {~TIME}.'],
    ['trap', 'Deploy {~VERSION} ke staging selesai pada {~TIME}, port {~PORT}, total request {~ID}.'],
    ['trap', 'Isi kolom NIK dan nomor telepon sesuai KTP. Batas pengisian {~TIME}, biaya admin {~PRICE}.'],
    ['trap', 'Nomor tagihan {~LONGNUM} jatuh tempo {~TIME}. Kantor cabang {~BANK} {~CITY}, telepon {~HOTLINE}.'],
    ['trap', 'trace_id={~HEX} span={~ID} order={~ORDER} sku={~SKU} duration_ms={~QTY}'],
    ['chat', 'kemarin {NAME:first} juga sempet nanya soal ini, tapi belum dibales'],
    ['letter', 'Pasien a.n. {NAME} kontrol rutin {HEALTH} setiap bulan di poli penyakit dalam.'],
    ['ocr', 'NIK. {NIK:ocr}\nNAMA. {NAME:upper}\nAGAMA. {RELIGION:upper}'],
  ],
};

export const SPLITS = Object.keys(TEMPLATES);

export function generate({ split = 'test', seed = split === 'dev' ? 1 : 2, perTemplate = 40 } = {}) {
  const templates = TEMPLATES[split];
  if (!templates) throw new Error(`unknown split ${split}`);
  const rng = new Rng(seed);
  const docs = [];
  for (const [t, [format, template]] of templates.entries()) {
    for (let i = 0; i < perTemplate; i++) {
      const { text, spans, neutral } = render(template, rng, person(rng, split));
      docs.push({ id: `${split}-${t}-${i}`, split, format, text, spans, neutral });
    }
  }
  return docs;
}

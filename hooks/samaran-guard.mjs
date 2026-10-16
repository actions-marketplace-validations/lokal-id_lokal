// packages/mcp/src/guard.ts
import { statSync as statSync3 } from "node:fs";
import path3 from "node:path";

// packages/core/dist/provinces.js
var PROVINCES = {
  "11": "Aceh",
  "12": "Sumatera Utara",
  "13": "Sumatera Barat",
  "14": "Riau",
  "15": "Jambi",
  "16": "Sumatera Selatan",
  "17": "Bengkulu",
  "18": "Lampung",
  "19": "Kepulauan Bangka Belitung",
  "21": "Kepulauan Riau",
  "31": "Daerah Khusus Ibukota Jakarta",
  "32": "Jawa Barat",
  "33": "Jawa Tengah",
  "34": "Daerah Istimewa Yogyakarta",
  "35": "Jawa Timur",
  "36": "Banten",
  "51": "Bali",
  "52": "Nusa Tenggara Barat",
  "53": "Nusa Tenggara Timur",
  "61": "Kalimantan Barat",
  "62": "Kalimantan Tengah",
  "63": "Kalimantan Selatan",
  "64": "Kalimantan Timur",
  "65": "Kalimantan Utara",
  "71": "Sulawesi Utara",
  "72": "Sulawesi Tengah",
  "73": "Sulawesi Selatan",
  "74": "Sulawesi Tenggara",
  "75": "Gorontalo",
  "76": "Sulawesi Barat",
  "81": "Maluku",
  "82": "Maluku Utara",
  "91": "Papua",
  "92": "Papua Barat",
  "93": "Papua Selatan",
  "94": "Papua Tengah",
  "95": "Papua Pegunungan",
  "96": "Papua Barat Daya"
};

// packages/core/dist/nik.js
function parseNik(input, options = {}) {
  const info = { input, valid: false, errors: [], warnings: [] };
  const digits = String(input).replace(/[\s.-]/g, "");
  if (!/^\d{16}$/.test(digits)) {
    info.errors.push({ code: "format", message: "NIK harus terdiri dari 16 digit angka." });
    return info;
  }
  info.nik = digits;
  const pp = digits.slice(0, 2);
  const kk = digits.slice(2, 4);
  const cc = digits.slice(4, 6);
  info.provinceCode = pp;
  info.regencyCode = `${pp}.${kk}`;
  info.districtCode = `${pp}.${kk}.${cc}`;
  const province = PROVINCES[pp];
  if (!province) {
    info.errors.push({ code: "province", message: `Kode provinsi "${pp}" tidak dikenal.` });
  } else {
    info.province = province;
  }
  if (kk === "00" || cc === "00") {
    info.errors.push({ code: "wilayah", message: "Kode kabupaten/kota dan kecamatan tidak boleh 00." });
  }
  const lookup = options.lookupWilayah;
  if (lookup && province) {
    info.regency = lookup(info.regencyCode);
    info.district = lookup(info.districtCode);
    if (!info.regency || !info.district) {
      info.warnings.push({
        code: "wilayah_unknown",
        message: "Kode wilayah tidak ada di data Kemendagri terbaru (bisa jadi kode lama sebelum pemekaran)."
      });
    }
  }
  let day = Number(digits.slice(6, 8));
  const month = Number(digits.slice(8, 10));
  const yy = Number(digits.slice(10, 12));
  if (day > 40) {
    info.gender = "P";
    day -= 40;
  } else {
    info.gender = "L";
  }
  const ref = options.referenceDate ?? /* @__PURE__ */ new Date();
  const year = yy <= ref.getFullYear() % 100 ? 2e3 + yy : 1900 + yy;
  const date = new Date(Date.UTC(year, month - 1, day));
  const realDate = day >= 1 && month >= 1 && month <= 12 && date.getUTCDate() === day && date.getUTCMonth() === month - 1;
  if (!realDate) {
    info.errors.push({ code: "birth_date", message: "Tanggal lahir di NIK tidak valid." });
    info.gender = void 0;
  } else {
    info.birthDate = date.toISOString().slice(0, 10);
  }
  const serial = digits.slice(12);
  info.serial = serial;
  if (serial === "0000") {
    info.errors.push({ code: "serial", message: "Nomor urut NIK tidak boleh 0000." });
  }
  info.valid = info.errors.length === 0;
  return info;
}

// packages/core/dist/phone.js
var MOBILE_PREFIXES = [
  [["0811", "0812", "0813", "0821", "0822", "0823", "0851", "0852", "0853"], "Telkomsel", "Telkomsel"],
  [["0814", "0815", "0816", "0855", "0856", "0857", "0858"], "Indosat", "Indosat Ooredoo Hutchison"],
  [["0895", "0896", "0897", "0898", "0899"], "Tri", "Indosat Ooredoo Hutchison"],
  [["0817", "0818", "0819", "0859", "0877", "0878"], "XL", "XLSmart"],
  [["0831", "0832", "0833", "0838"], "Axis", "XLSmart"],
  [["0881", "0882", "0883", "0884", "0885", "0886", "0887", "0888", "0889"], "Smartfren", "XLSmart"]
];
var OPERATOR_BY_PREFIX = /* @__PURE__ */ new Map();
for (const [prefixes, operator, group] of MOBILE_PREFIXES) {
  for (const p of prefixes)
    OPERATOR_BY_PREFIX.set(p, { operator, group });
}
var AREA_CODES = {
  "21": "Jakarta",
  "22": "Bandung",
  "24": "Semarang",
  "31": "Surabaya",
  "61": "Medan",
  "251": "Bogor",
  "254": "Serang",
  "271": "Surakarta",
  "274": "Yogyakarta",
  "341": "Malang",
  "361": "Denpasar",
  "411": "Makassar",
  "511": "Banjarmasin",
  "541": "Samarinda",
  "542": "Balikpapan",
  "711": "Palembang",
  "751": "Padang",
  "761": "Pekanbaru",
  "778": "Batam"
};
function parsePhone(input) {
  const info = { input, valid: false, errors: [], warnings: [] };
  const clean = String(input).trim().replace(/[\s().\-]/g, "");
  let rest;
  if (clean.startsWith("+62"))
    rest = clean.slice(3);
  else if (clean.startsWith("62") && clean.length >= 10)
    rest = clean.slice(2);
  else if (clean.startsWith("0"))
    rest = clean.slice(1);
  else if (clean.startsWith("8"))
    rest = clean;
  else {
    info.errors.push({ code: "format", message: "Nomor harus diawali 0, 62, atau +62." });
    return info;
  }
  rest = rest.replace(/^0+/, "");
  if (!/^\d+$/.test(rest)) {
    info.errors.push({ code: "format", message: "Nomor telepon hanya boleh berisi angka." });
    return info;
  }
  if (rest.startsWith("8")) {
    info.type = "mobile";
    if (rest.length < 9 || rest.length > 12) {
      info.errors.push({ code: "length", message: "Nomor HP harus 10\u201313 digit (termasuk 0 di depan)." });
      return info;
    }
    const op = OPERATOR_BY_PREFIX.get(`0${rest.slice(0, 3)}`);
    if (op) {
      info.operator = op.operator;
      info.group = op.group;
    } else {
      info.warnings.push({ code: "prefix_unknown", message: `Prefix 0${rest.slice(0, 3)} tidak dikenal.` });
    }
    const national = `0${rest}`;
    info.national = `${national.slice(0, 4)}-${national.slice(4, 8)}-${national.slice(8)}`;
  } else if (/^[2-79]/.test(rest)) {
    info.type = "landline";
    if (rest.length < 7 || rest.length > 11) {
      info.errors.push({ code: "length", message: "Panjang nomor telepon rumah tidak valid." });
      return info;
    }
    const area = [rest.slice(0, 2), rest.slice(0, 3)].find((c) => AREA_CODES[c]);
    if (area) {
      info.areaCode = `0${area}`;
      info.area = AREA_CODES[area];
      info.national = `(0${area}) ${rest.slice(area.length)}`;
    } else {
      info.national = `0${rest}`;
    }
  } else {
    info.errors.push({ code: "format", message: "Nomor telepon Indonesia tidak valid." });
    return info;
  }
  info.e164 = `+62${rest}`;
  if (info.type === "mobile")
    info.whatsapp = `62${rest}`;
  info.valid = true;
  return info;
}

// packages/core/dist/holidays.js
var L = "libur_nasional";
var C = "cuti_bersama";
var DATA = {
  2026: {
    decree: "SKB Nomor 1497 Tahun 2025, Nomor 2 Tahun 2025, Nomor 5 Tahun 2025",
    source: "https://www.setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2026",
    holidays: [
      { date: "2026-01-01", name: "Tahun Baru 2026 Masehi", type: L },
      { date: "2026-01-16", name: "Isra Mikraj Nabi Muhammad saw.", type: L },
      { date: "2026-02-16", name: "Tahun Baru Imlek 2577 Kongzili", type: C },
      { date: "2026-02-17", name: "Tahun Baru Imlek 2577 Kongzili", type: L },
      { date: "2026-03-18", name: "Hari Suci Nyepi (Tahun Baru Saka 1948)", type: C },
      { date: "2026-03-19", name: "Hari Suci Nyepi (Tahun Baru Saka 1948)", type: L },
      { date: "2026-03-20", name: "Idulfitri 1447 H", type: C },
      { date: "2026-03-21", name: "Idulfitri 1447 H", type: L },
      { date: "2026-03-22", name: "Idulfitri 1447 H", type: L },
      { date: "2026-03-23", name: "Idulfitri 1447 H", type: C },
      { date: "2026-03-24", name: "Idulfitri 1447 H", type: C },
      { date: "2026-04-03", name: "Wafat Yesus Kristus", type: L },
      { date: "2026-04-05", name: "Kebangkitan Yesus Kristus (Paskah)", type: L },
      { date: "2026-05-01", name: "Hari Buruh Internasional", type: L },
      { date: "2026-05-14", name: "Kenaikan Yesus Kristus", type: L },
      { date: "2026-05-15", name: "Kenaikan Yesus Kristus", type: C },
      { date: "2026-05-27", name: "Iduladha 1447 H", type: L },
      { date: "2026-05-28", name: "Iduladha 1447 H", type: C },
      { date: "2026-05-31", name: "Hari Raya Waisak 2570 BE", type: L },
      { date: "2026-06-01", name: "Hari Lahir Pancasila", type: L },
      { date: "2026-06-16", name: "1 Muharam Tahun Baru Islam 1448 H", type: L },
      { date: "2026-08-17", name: "Proklamasi Kemerdekaan", type: L },
      { date: "2026-08-25", name: "Maulid Nabi Muhammad saw.", type: L },
      { date: "2026-12-24", name: "Kelahiran Yesus Kristus", type: C },
      { date: "2026-12-25", name: "Kelahiran Yesus Kristus", type: L }
    ]
  },
  2027: {
    decree: "SKB Nomor 1205 Tahun 2026, Nomor 3 Tahun 2026, Nomor 2 Tahun 2026",
    source: "https://setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2027",
    holidays: [
      { date: "2027-01-01", name: "Tahun Baru 2027 Masehi", type: L },
      { date: "2027-01-05", name: "Isra Mikraj Nabi Muhammad saw.", type: L },
      { date: "2027-02-05", name: "Tahun Baru Imlek 2578 Kongzili", type: C },
      { date: "2027-02-06", name: "Tahun Baru Imlek 2578 Kongzili", type: L },
      { date: "2027-03-08", name: "Hari Suci Nyepi (Tahun Baru Saka 1949)", type: L },
      { date: "2027-03-09", name: "Idulfitri 1448 H", type: C },
      { date: "2027-03-10", name: "Idulfitri 1448 H", type: L },
      { date: "2027-03-11", name: "Idulfitri 1448 H", type: L },
      { date: "2027-03-12", name: "Idulfitri 1448 H", type: C },
      { date: "2027-03-15", name: "Idulfitri 1448 H", type: C },
      { date: "2027-03-25", name: "Wafat Yesus Kristus", type: C },
      { date: "2027-03-26", name: "Wafat Yesus Kristus", type: L },
      { date: "2027-03-28", name: "Kebangkitan Yesus Kristus (Paskah)", type: L },
      { date: "2027-05-01", name: "Hari Buruh Internasional", type: L },
      { date: "2027-05-06", name: "Kenaikan Yesus Kristus", type: L },
      { date: "2027-05-17", name: "Iduladha 1448 H", type: L },
      { date: "2027-05-18", name: "Iduladha 1448 H", type: C },
      { date: "2027-05-19", name: "Hari Raya Waisak 2571 BE", type: C },
      { date: "2027-05-20", name: "Hari Raya Waisak 2571 BE", type: L },
      { date: "2027-06-01", name: "Hari Lahir Pancasila", type: L },
      { date: "2027-06-06", name: "1 Muharam Tahun Baru Islam 1449 H", type: L },
      { date: "2027-08-15", name: "Maulid Nabi Muhammad saw.", type: L },
      { date: "2027-08-17", name: "Proklamasi Kemerdekaan", type: L },
      { date: "2027-12-24", name: "Kelahiran Yesus Kristus", type: C },
      { date: "2027-12-25", name: "Kelahiran Yesus Kristus", type: L },
      { date: "2027-12-26", name: "Isra Mikraj Nabi Muhammad saw.", type: L }
    ]
  }
};
var HOLIDAY_YEARS = Object.keys(DATA).map(Number);

// packages/core/dist/samaran/fields.js
var FIELDS = [
  // A column called "pasien" or "pelanggan" holds that person's name.
  ["NAME", "nama|name|full_?name|nama_?lengkap|first_?name|last_?name|middle_?name|given_?name|family_?name|surname|nama_?depan|nama_?tengah|nama_?belakang|nama_?panggilan|nickname|nama_?ibu_?kandung|mother_?s?_?maiden_?name|penerima|pengirim|recipient|pasien|patient|pelanggan|customer|nasabah|karyawan|employee|pegawai|siswa|mahasiswa|student|peserta|pemohon|debitur|pemilik|owner"],
  ["ADDRESS", "alamat|address|full_?address|street|street_?address|domisili|alamat_?domisili|alamat_?ktp|alamat_?rumah|alamat_?pengiriman|shipping_?address|home_?address|billing_?address"],
  ["NIK", "nik|no_?ktp|nomor_?ktp|ktp|nomor_?induk_?kependudukan|national_?id"],
  ["KK", "kk|no_?kk|nomor_?kk|kartu_?keluarga|no_?kartu_?keluarga|nomor_?kartu_?keluarga|family_?card(_?number)?"],
  ["NPWP", "npwp|no_?npwp|nomor_?npwp|tax_?id|tin"],
  ["PASSPORT", "paspor|passport|no_?paspor|nomor_?paspor|passport_?(no|number)"],
  ["SIM", "sim|no_?sim|nomor_?sim|driver_?s?_?licen[cs]e|driving_?licen[cs]e"],
  ["NIP", "nip|nip_?baru|nrp|nomor_?induk_?pegawai"],
  ["BPJS", "bpjs|no_?bpjs|nomor_?bpjs|bpjs_?kesehatan|bpjs_?ketenagakerjaan|kis|no_?kis|jkn|kpj"],
  ["PHONE", "hp|no_?hp|nomor_?hp|nohp|telp|tlp|telepon|telpon|no_?telp|no_?telepon|nomor_?telepon|phone|phone_?number|mobile|mobile_?phone|handphone|whatsapp|wa|no_?wa|nomor_?wa|msisdn"],
  ["EMAIL", "email|e_?mail|surel|alamat_?email|email_?address"],
  ["BANK_ACCOUNT", "rekening|no_?rek|no_?rekening|nomor_?rekening|norek|rek|account_?number|bank_?account|account_?no|va|virtual_?account|no_?va"],
  ["CARD", "card_?number|no_?kartu|nomor_?kartu|kartu_?kredit|credit_?card|cc_?number|pan"],
  ["IP", "ip|ip_?address|ip_?addr|client_?ip|remote_?ip|remote_?addr|x_?forwarded_?for"],
  ["GEO", "lat|lng|lon|latitude|longitude|koordinat|coordinates|coords|geo|geolocation|latlng|lat_?long"],
  ["BIRTH_DATE", "tanggal_?lahir|tgl_?lahir|tgl_?lhr|tanggal_?kelahiran|tempat_?lahir|ttl|tempat_?tanggal_?lahir|tempat_?tgl_?lahir|tempat_?tgl_?lhr|date_?of_?birth|dob|birth_?date|birthdate|birthday|birth_?place|place_?of_?birth"],
  ["GENDER", "jenis_?kelamin|jns_?kelamin|kelamin|gender|sex|jk|l_?p"],
  ["RELIGION", "agama|religion|kepercayaan"],
  ["MARITAL_STATUS", "status_?perkawinan|status_?kawin|status_?pernikahan|status_?nikah|perkawinan|marital_?status|status_?marital"],
  ["NATIONALITY", "kewarganegaraan|warga_?negara|wn|nationality|citizenship"],
  ["HEALTH", "diagnosa|diagnosis|diagnose|penyakit|riwayat_?penyakit|riwayat_?medis|rekam_?medis|kondisi_?medis|kondisi_?kesehatan|keluhan|gejala|alergi|allergy|allergies|golongan_?darah|gol_?darah|blood_?type|hasil_?lab|lab_?result|obat|medication|medications|resep|prescription|icd|icd_?10|medical_?history|medical_?record|disabilitas|disability|kehamilan|pregnancy|status_?vaksin|vaccination_?status|tindakan_?medis"],
  ["FINANCIAL", "gaji|salary|penghasilan|pendapatan|income|saldo|balance|limit_?kredit|credit_?limit|utang|hutang|debt|pinjaman|loan|loan_?amount|cicilan|installment|tunggakan|arrears|skor_?kredit|credit_?score|slik|kolektibilitas|kekayaan|net_?worth|harta"],
  ["CRIMINAL_RECORD", "catatan_?kriminal|catatan_?kepolisian|catatan_?pidana|skck|riwayat_?pidana|riwayat_?kriminal|criminal_?record|criminal_?history|status_?hukum"],
  // Not "signature" or "face": in code those are crypto signatures and UI faces.
  ["BIOMETRIC", "sidik_?jari|fingerprint|foto_?ktp|foto_?wajah|foto_?selfie|selfie|selfie_?ktp|face_?image|face_?photo|face_?embedding|biometri|biometric|biometrik|iris|retina|dna|genetik|genetic|voiceprint|voice_?print|tanda_?tangan|ttd"]
];
var ENTITY = "customer|pelanggan|nasabah|pasien|patient|user|pengguna|member|anggota|karyawan|employee|pegawai|siswa|student|mahasiswa|penerima|pengirim|recipient|sender|ibu|ayah|wali|orang_?tua|pemohon|applicant|debitur|peserta|pemilik|owner|contact|kontak";
var QUALIFIER = `${ENTITY}|lengkap|baru|lama|asli|utama|rumah|kantor|ktp|domisili|pengiriman|pribadi|aktif|1|2`;
var KEY_RES = FIELDS.map(([type, alts]) => [
  type,
  new RegExp(`^(?:(?:${ENTITY})_)?(?:${alts})(?:_(?:${QUALIFIER}))?$`)
]);
function normalizeKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
function fieldType(key) {
  const k = normalizeKey(key);
  if (!k || k.length > 40)
    return void 0;
  for (const [type, re] of KEY_RES)
    if (re.test(k))
      return type;
  return void 0;
}
function isGenericNameKey(key) {
  return /^(name|nickname)$/.test(normalizeKey(key));
}
function isNamePartKey(key) {
  return /^(?:(?:customer|billing|shipping|user|contact)_)?(?:first|last|middle|given|family)_?name$|^surname$/.test(normalizeKey(key));
}
var NAME_LABEL_WORDS = /^(?:first|last|middle|given|family|sur|name|nama|depan|belakang|tengah|lengkap|full)$/i;
var GENDER_WORD = /^(?:laki-?\s?laki|lelaki|perempuan|pria|wanita|male|female|man|woman|cowok|cewek)$/i;
var GENDER_VALUE = { test: (v) => /^[LPMF]$/.test(v) || GENDER_WORD.test(v) };
var DATE_KEY = /tanggal|tgl|date|dob|birthday|birthdate|ttl/;
var DATE_LIKE = /\d{1,4}[-/. ]\d{1,2}[-/. ]\d{1,4}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}|\b(?:19|20)\d{2}\b/;
var ROLE_KEY = /^(pasien|patient|pelanggan|customer|nasabah|karyawan|employee|pegawai|siswa|mahasiswa|student|peserta|pemohon|debitur|pemilik|owner|penerima|pengirim|recipient)$/;
var EMPTY = /^(?:-+|null|none|nil|n\/?a|undefined|tidak ada|kosong|\?)$/i;
var TYPE_WORDS = /* @__PURE__ */ new Set([
  "string",
  "number",
  "boolean",
  "bool",
  "int",
  "integer",
  "bigint",
  "varchar",
  "char",
  "text",
  "date",
  "datetime",
  "timestamp",
  "float",
  "double",
  "decimal",
  "any",
  "object",
  "array",
  "null",
  "undefined",
  "true",
  "false",
  "required",
  "optional",
  "nullable",
  "unique",
  "str",
  "list",
  "dict",
  "enum",
  "json",
  "uuid",
  "unknown",
  "void"
]);
var DIGIT_TYPES = /* @__PURE__ */ new Set([
  "NIK",
  "KK",
  "NPWP",
  "NIP",
  "SIM",
  "BPJS",
  "PHONE",
  "BANK_ACCOUNT",
  "CARD"
]);
function isPlausibleValue(type, value, key) {
  const v = value.trim();
  if (!v || EMPTY.test(v))
    return false;
  if (TYPE_WORDS.has(v.toLowerCase()))
    return false;
  if (/^\[[A-Z_]+_\d+\]$/.test(v))
    return false;
  if (/[{}<>`$[\]]|=>|^\w+\.\w+\(/.test(v))
    return false;
  if (type === "ADDRESS" && !/\s/.test(v))
    return false;
  if (type !== "ADDRESS" && (/[()]/.test(v) || /^[a-z_$][\w$]*\.[a-z_$][\w$.]*$/i.test(v)))
    return false;
  const digitCount = v.replace(/\D/g, "").length;
  if (DIGIT_TYPES.has(type) && digitCount < 6)
    return false;
  if ((type === "GEO" || type === "IP") && digitCount < 2)
    return false;
  if (type === "EMAIL" && !v.includes("@"))
    return false;
  if (type === "GENDER" && !GENDER_VALUE.test(v))
    return false;
  if (type === "BIRTH_DATE" && DATE_KEY.test(normalizeKey(key))) {
    const serialOk = normalizeKey(key) !== "ttl" && /^\d{5}$/.test(v) && Number(v) >= 7e3 && Number(v) <= 55e3;
    if (!DATE_LIKE.test(v) && !serialOk)
      return false;
  }
  if (type === "NAME") {
    if (!/[A-Za-z]/.test(v) || /[\d_(){}[\]<>=]/.test(v))
      return false;
    if (/^(?:new|this|await|null|undefined|true|false|typeof|function|return|self|None)\b/.test(v))
      return false;
    if (/^[A-Z][a-z]+[A-Z]/.test(v))
      return false;
    const words = v.split(/\s+/);
    if (isNamePartKey(key)) {
      if (words.length > 4 || !words.every((w) => /^[A-Z]/.test(w)) || words.every((w) => NAME_LABEL_WORDS.test(w)))
        return false;
    } else if (isGenericNameKey(key)) {
      if (words.length < 2 || words.length > 5 || !words.every((w) => /^[A-Z]/.test(w)))
        return false;
    } else if (ROLE_KEY.test(normalizeKey(key)) && words.length === 1 && !/^[A-Z]/.test(v)) {
      return false;
    }
  }
  return true;
}

// packages/core/dist/samaran/types.js
var PII_TYPES = [
  "NIK",
  "KK",
  "NPWP",
  "PASSPORT",
  "SIM",
  "NIP",
  "BPJS",
  "PHONE",
  "EMAIL",
  "BANK_ACCOUNT",
  "CARD",
  "PLATE",
  "IP",
  "GEO",
  "NAME",
  "ADDRESS",
  "BIRTH_DATE",
  "GENDER",
  "RELIGION",
  "MARITAL_STATUS",
  "NATIONALITY",
  "HEALTH",
  "FINANCIAL",
  "CRIMINAL_RECORD",
  "BIOMETRIC"
];
var UU_PDP_CATEGORY = Object.fromEntries(PII_TYPES.map((t) => [
  t,
  ["HEALTH", "BIOMETRIC", "CRIMINAL_RECORD", "FINANCIAL", "BANK_ACCOUNT", "CARD"].includes(t) ? "spesifik" : "umum"
]));

// packages/core/dist/samaran/detectors.js
function before(text, index, window = 40) {
  const slice = text.slice(Math.max(0, index - window), index);
  const nl = slice.lastIndexOf("\n");
  return (nl >= 0 ? slice.slice(nl + 1) : slice).toLowerCase();
}
function match(type, start, value, confidence) {
  return { type, start, end: start + value.length, value, confidence };
}
function luhn(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9)
        d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}
function isRealDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
function isNip(d) {
  if (d.length !== 18)
    return false;
  const y = Number(d.slice(0, 4));
  const tmt = Number(d.slice(8, 12));
  const tmtMonth = Number(d.slice(12, 14));
  return y >= 1940 && y <= 2010 && isRealDate(y, Number(d.slice(4, 6)), Number(d.slice(6, 8))) && tmt >= 1970 && tmt <= 2040 && tmt - y >= 17 && tmtMonth >= 1 && tmtMonth <= 12 && /[12]/.test(d[14]);
}
var TEST_CARDS = /* @__PURE__ */ new Set([
  "4111111111111111",
  "4242424242424242",
  "4000056655665556",
  "4012888888881881",
  "4007000000027",
  "4222222222222",
  "5555555555554444",
  "5105105105105100",
  "5200828282828210",
  "2223003122003222",
  "378282246310005",
  "371449635398431",
  "378734493671000",
  "6011111111111117",
  "6011000990139424",
  "3530111333300000",
  "3566002020360505",
  "4811111111111114",
  "5211111111111117",
  "4911111111111113"
]);
var KK_KEYWORD = /\b(kk|kartu keluarga)\b[^\d]*$/;
var SIM_KEYWORD = /\b(sim|surat izin mengemudi|driving licen[cs]e)\b[^\d]*$/;
var NIK_KEYWORD = /\b(nik|ktp|nomor induk kependudukan)\b/;
var NPWP_KEYWORD = /\bnpwp\b/;
var BPJS_KEYWORD = /\b(bpjs|jkn|kis|kartu indonesia sehat|kpj|jamsostek)\b/;
var BANK_KEYWORD = /\b(no\.?\s*rek(ening)?|norek|rekening|rek|account|acc|a\/c|virtual account|va|transfer|tf|bca|bri|bni|mandiri|bsi|cimb|niaga|permata|danamon|btn|jago|seabank|blu|ocbc|panin|maybank|mega|muamalat)\b/;
function detectDigitRuns(text) {
  const out = [];
  const run = /(?<![\d\w.])\d(?:[ -]?\d){7,18}(?![\d\w])/g;
  for (const m of text.matchAll(run)) {
    const value = m[0];
    const digits = value.replace(/\D/g, "");
    const ctx = before(text, m.index);
    const label = ctx.slice(-25);
    const push = (type, confidence) => out.push(match(type, m.index, value, confidence));
    if (/^(08|628)/.test(digits) && parsePhone(digits).valid)
      continue;
    if (digits.length === 16 && KK_KEYWORD.test(label))
      push("KK", "high");
    else if (digits.length >= 12 && digits.length <= 16 && SIM_KEYWORD.test(label))
      push("SIM", "high");
    else if (digits.length === 16 && parseNik(digits).valid)
      push("NIK", "high");
    else if (isNip(digits))
      push("NIP", "high");
    else if (digits.length >= 13 && digits.length <= 19 && /^[3-6]/.test(digits) && luhn(digits)) {
      if (!TEST_CARDS.has(digits))
        push("CARD", "high");
    } else if ((digits.length === 15 || digits.length === 16) && NPWP_KEYWORD.test(ctx))
      push("NPWP", "high");
    else if (digits.length === 16 && NIK_KEYWORD.test(ctx))
      push("NIK", "medium");
    else if ((digits.length === 13 || digits.length === 11) && BPJS_KEYWORD.test(ctx))
      push("BPJS", "high");
    else if (digits.length >= 8 && digits.length <= 18 && BANK_KEYWORD.test(ctx))
      push("BANK_ACCOUNT", "high");
  }
  return out;
}
function detectNpwpFormatted(text) {
  const re = /(?<!\d)\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}(?!\d)/g;
  return [...text.matchAll(re)].map((m) => match("NPWP", m.index, m[0], "high"));
}
function detectPassports(text) {
  const re = /(?<![A-Za-z0-9])[A-Z]{1,2}\s?\d{6,8}(?![A-Za-z0-9])/g;
  return [...text.matchAll(re)].filter((m) => /\b(paspor|passport)\b/.test(before(text, m.index, 30))).map((m) => match("PASSPORT", m.index, m[0], "high"));
}
function detectPhones(text) {
  const out = [];
  const mobile = /(?<![\d+\w])(?:\+62|62|0)[ \t-]?8\d{1,2}(?:[ \t.-]?\d{3,4}){2,3}(?![\d\w])/g;
  for (const m of text.matchAll(mobile)) {
    if (parsePhone(m[0]).valid)
      out.push(match("PHONE", m.index, m[0], "high"));
  }
  const landline = /\((?:\+62[ \t]?|0)\d{2,3}\)[ \t]?\d{3,4}[ \t-]?\d{3,4}(?!\d)|(?<![\d\w])\+62[ \t]?[2-79]\d{1,2}[ \t-]?\d{3,4}[ \t-]?\d{3,4}(?!\d)/g;
  for (const m of text.matchAll(landline))
    out.push(match("PHONE", m.index, m[0], "medium"));
  return out;
}
var RESERVED_EMAIL_DOMAIN = /@(?:[\w-]+\.)*(?:example\.(?:com|net|org)|[\w-]+\.(?:example|test|invalid|localhost))$/i;
function detectEmails(text) {
  const re = /(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g;
  const out = [...text.matchAll(re)].filter((m) => !RESERVED_EMAIL_DOMAIN.test(m[0])).map((m) => match("EMAIL", m.index, m[0], "high"));
  const AT = String.raw`\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\})\s*`;
  const DOT = String.raw`(?:\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\})\s*|\.)`;
  const spelled = new RegExp(String.raw`(?<![\w.+-])[A-Za-z0-9._%+-]+${AT}[A-Za-z0-9-]+(?:${DOT}[A-Za-z0-9-]+)*${DOT}[A-Za-z]{2,}(?![\w-])`, "gi");
  for (const m of text.matchAll(spelled))
    out.push(match("EMAIL", m.index, m[0], "high"));
  return out;
}
function detectIps(text) {
  const out = [];
  const re = /(?<![\d.\w])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.\w])/g;
  for (const m of text.matchAll(re)) {
    const ip = m[0];
    if (/^(0\.|127\.|255\.255\.255\.255)/.test(ip))
      continue;
    if (/\b(versi|version|ver|v)\.?\s*$/.test(before(text, m.index, 12)))
      continue;
    const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
    out.push(match("IP", m.index, ip, priv ? "medium" : "high"));
  }
  return out;
}
function detectCoordinates(text) {
  const out = [];
  const re = /(?<![\d.])(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})(?![\d.])/g;
  for (const m of text.matchAll(re)) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180)
      continue;
    const indonesia = lat >= -11.5 && lat <= 6.5 && lng >= 94 && lng <= 141.5;
    out.push(match("GEO", m.index, m[0], indonesia ? "high" : "medium"));
  }
  return out;
}
var MONTHS = "Januari|Februari|Pebruari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Nopember|Desember|January|February|March|May|June|July|August|October|December|Jan|Feb|Mar|Apr|Jun|Jul|Agu|Agt|Ags|Aug|Sep|Sept|Okt|Oct|Nov|Des|Dec";
var DATE = `\\d{1,2}[-/. ]\\d{1,2}[-/. ]\\d{2,4}|\\d{1,2}\\s+(?:${MONTHS})\\.?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}`;
function detectBirthDates(text) {
  const re = new RegExp(`\\b(?:lahir|kelahiran|born)\\b[^\\n\\d]{0,40}?(${DATE})`, "gi");
  return [...text.matchAll(re)].map((m) => match("BIRTH_DATE", m.index + m[0].length - m[1].length, m[1], "high"));
}
var CONDITIONS = "hiv|aids|odha|tbc|tb paru|tuberkulosis|hepatitis(?: [abc])?|kanker(?: \\w+)?|tumor(?: \\w+)?|diabetes(?: melitus)?|hipertensi|stroke|penyakit jantung|gagal ginjal|cuci darah|covid(?:-19)?|dbd|demam berdarah|malaria|kusta|lepra|skizofrenia|bipolar|depresi(?: berat)?|gangguan jiwa|gangguan mental|odgj|autis(?:me)?|epilepsi|ims|sifilis|gonore|herpes|hamil|keguguran";
var MEDICATIONS = "insulin|metformin|glibenclamide|arv|antiretroviral|obat tbc|rifampisin|isoniazid|kemoterapi|kemo|antidepresan|antipsikotik|fluoxetine|sertraline|risperidone|haloperidol|lithium|metadon|methadone|warfarin|amlodipine|captopril|levothyroxine|tamoxifen|hormon|kb|pil kb";
function detectHealth(text) {
  const out = [];
  const strong = /\b(?:didiagnosis|didiagnosa|terdiagnosis|terdiagnosa|mengidap|terinfeksi|riwayat penyakit|divonis)\s+(?:menderita\s+|mengidap\s+|penyakit\s+)?([^\n,.;:()]{2,60}?)(?=\s+(?:sejak|selama|dan sudah|dan sedang|tapi|namun|sehingga|jadi)\b|[\n,.;:()]|$)/gi;
  for (const m of text.matchAll(strong)) {
    out.push(match("HEALTH", m.index + m[0].length - m[1].length, m[1], "high"));
  }
  const gated = new RegExp(`\\b(?:positif|menderita|terkena|kena|sakit|pasien|penderita|pengidap|penyintas|mengalami|karena|krn|akibat|gara-gara|punya)\\s+((?:penyakit\\s+)?(?:${CONDITIONS}))\\b`, "gi");
  for (const m of text.matchAll(gated)) {
    out.push(match("HEALTH", m.index + m[0].length - m[1].length, m[1], "medium"));
  }
  for (const m of text.matchAll(new RegExp(`\\((${CONDITIONS})\\)`, "gi"))) {
    out.push(match("HEALTH", m.index + 1, m[1], "medium"));
  }
  const treatment = new RegExp(`\\b(?:obat|suntik(?:an)?|minum|konsumsi|terapi|resep)\\s+(${MEDICATIONS})\\b|\\b(kemoterapi|radioterapi|hemodialisa|cuci darah)\\b`, "gi");
  for (const m of text.matchAll(treatment)) {
    const value = m[1] ?? m[2];
    out.push(match("HEALTH", m.index + m[0].length - value.length, value, "medium"));
  }
  const hospital = /\b(?:dirawat|opname|rawat inap|diopname|dioperasi|isolasi)\s+(?:di\s+)?(?:(?:RSUD|RSU|RSIA|RSJ|RSAB|RS|Rumah Sakit|Puskesmas|Klinik)\b[^\n,.;:()]{0,40}?)(?=\s+(?:karena|krn|sejak|selama|dan|tapi|jadi|sampai)\b|[\n,.;:()]|$)/gi;
  for (const m of text.matchAll(hospital))
    out.push(match("HEALTH", m.index, m[0], "medium"));
  return out;
}
function detectFinancial(text) {
  const re = /\b(?:gaji|penghasilan|pendapatan|saldo|utang|hutang|pinjaman|cicilan|tunggakan|limit(?:\s+kartu)?(?:\s+kredit)?)(?:\s+(?:saya|aku|gue|gw|gua|dia|beliau|bulanan|tahunan|per\s+bulan|sebulan|setahun|bersih|kotor|rekening|terakhir|total|di\s+\w+))*\s*(?:sebesar|sekitar|kira-kira|cuma|hanya|adalah|ada|masih|tinggal|sisa|senilai|:|=)?\s*((?:Rp\.?\s?)?\d[\d.,]*(?:\s*(?:rb|ribu|k|jt|juta|m|miliar|milyar|t|triliun)\b)?)/gi;
  const out = [];
  for (const m of text.matchAll(re)) {
    const amount = m[1].replace(/[.,]+$/, "");
    if (!/rp|[a-z]$/i.test(amount) && amount.replace(/\D/g, "").length < 4)
      continue;
    out.push(match("FINANCIAL", m.index + m[0].length - m[1].length, amount, "medium"));
  }
  return out;
}
function detectReligion(text) {
  const re = /\b(?:beragama|agamanya|agama\s+(?:saya|aku|dia|beliau|kami|mereka))\s+(Islam|Kristen(?:\s+Protestan)?|Protestan|Katolik|Katholik|Hindu|Buddha|Budha|Konghucu|Khonghucu|Kong Hu Cu)\b/gi;
  return [...text.matchAll(re)].map((m) => match("RELIGION", m.index + m[0].length - m[1].length, m[1], "high"));
}
var PLATE_REGIONS = "AA|AB|AD|AE|AG|BA|BB|BD|BE|BG|BH|BK|BL|BM|BN|BP|DA|DB|DC|DD|DE|DG|DH|DK|DL|DM|DN|DP|DR|DT|EA|EB|ED|KB|KH|KT|KU|PA|PB|A|B|D|E|F|G|H|K|L|M|N|P|R|S|T|W|Z";
function detectPlates(text) {
  const re = new RegExp(`(?<![A-Za-z0-9])(?:${PLATE_REGIONS})\\s?\\d{1,4}\\s?[A-Z]{1,3}(?![A-Za-z0-9])`, "g");
  const out = [];
  for (const m of text.matchAll(re)) {
    const spaced = /\s\d+\s/.test(m[0]);
    const keyword = /\b(plat|nopol|no\.?\s*pol|tnkb|kendaraan|motor|mobil)\b/.test(before(text, m.index));
    if (!spaced && !keyword)
      continue;
    out.push(match("PLATE", m.index, m[0], keyword ? "high" : "medium"));
  }
  return out;
}
var TITLE_WORDS = /* @__PURE__ */ new Set([
  "bapak",
  "ibu",
  "pak",
  "bu",
  "mas",
  "mbak",
  "kak",
  "bang",
  "presiden",
  "wakil",
  "menteri",
  "direktur",
  "dokter",
  "dr",
  "drs",
  "dra",
  "prof",
  "ir",
  "h",
  "hj",
  "guru",
  "lurah",
  "camat",
  "bupati",
  "walikota",
  "wali",
  "gubernur",
  "kepala",
  "dosen",
  "ketua",
  "manajer",
  "admin",
  "kurir",
  "driver",
  "ustadz",
  "ustadzah",
  "sdr",
  "sdri",
  "saudara",
  "saudari",
  "tn",
  "ny",
  "nn"
]);
var NOT_NAME = new Set("yang dan atau dengan dgn di ke dari dr untuk utk pada dalam ini itu tsb tersebut saya sy aku aq kamu km anda dia beliau kami kita mereka gue gw gua lu nya ya iya yaa ok oke kak sih dong deh nih tuh kok lah kah pun juga aja saja sudah udah sdh belum blm mau ingin pengen pingin minta mohon tolong bisa bisakah boleh akan sedang lagi masih baru tadi kemarin besok nanti sekarang hari sekali sekalian semua para terima kasih makasih selamat pagi siang sore malam halo hai permisi maaf refund transfer tf pesanan pesan order barang paket produk nomor no nik hp wa alamat email rekening rek umur usia lahir tinggal asal sebagai adalah ialah tidak tak gak ga nggak bukan jadi kalau kalo karena krn tapi namun perusahaan kantor toko pt cv ud yayasan koperasi instansi bank kota negara pertiwi jari hamil menyusui rumah tiri mertua kandung terdaftar sendiri ada punya kirim dikirim cek dicek tanya nanya bertanya sama bersama tentang soal mengenai sini situ sana apa siapa gimana bagaimana kenapa mana kapan berapa harap segera langsung dulu lalu kemudian terus menyatakan bahwa yg sekalian islam kristen katolik hindu buddha konghucu jl jln jalan gg gang the and i am is a an of to for want my senin selasa rabu kamis jumat sabtu minggu januari februari maret april mei juni juli agustus september oktober november desember cuma hanya pernah sering selalu benar betul yakin setuju kecewa senang puas bingung orang customer pelanggan pembeli penjual member anggota warga mahasiswa siswa karyawan pegawai seller buyer user pengguna manajemen management direksi pimpinan tim team seluruh keluarga pribadi rt rw satpam ojol cs domain file folder tabel table kolom column variabel fungsi function class akun aplikasi app server database program manfaat pengendali prosesor pemerintah kementerian keuangan negeri daerah republik indonesia rakyat dewan lembaga badan dinas direktorat komisi mahkamah pengadilan kepolisian polri tni sekretariat umum nasional pusat".split(" "));
var NAME_PARTICLES = /* @__PURE__ */ new Set(["bin", "binti", "van", "der", "de", "al", "el", "da", "dos"]);
var ORGANIZATION = /* @__PURE__ */ new Set(["pt", "cv", "ud", "toko", "yayasan", "koperasi", "perusahaan", "bank"]);
var NAME_TOKEN = /[ \t]*([A-Za-z][A-Za-z'’-]*\.?)/y;
function nameAt(text, start, confidence, capitalized = false) {
  const words = [];
  let pos = start;
  while (words.length < 5) {
    NAME_TOKEN.lastIndex = pos;
    const m = NAME_TOKEN.exec(text);
    if (!m)
      break;
    const word = m[1];
    const bare = word.replace(/\.$/, "").toLowerCase();
    const wordStart = m.index + m[0].length - word.length;
    pos = NAME_TOKEN.lastIndex;
    if (!words.length && (TITLE_WORDS.has(bare) || bare === "adalah" || bare === "ialah"))
      continue;
    if (NOT_NAME.has(bare) || bare.endsWith("nya") || !words.length && NAME_PARTICLES.has(bare))
      break;
    if (words.length && TITLE_WORDS.has(bare))
      return void 0;
    if (capitalized && !/^[A-Z]/.test(word) && !NAME_PARTICLES.has(bare))
      break;
    words.push({ start: wordStart, end: wordStart + word.length, bare });
    if (word.endsWith(".") && bare.length > 1)
      break;
  }
  while (words.length && NAME_PARTICLES.has(words[words.length - 1].bare))
    words.pop();
  if (!words.length || ORGANIZATION.has(words[0].bare))
    return void 0;
  const value = text.slice(words[0].start, words[words.length - 1].end).replace(/[.,]+$/, "");
  if (value.replace(/[^A-Za-z]/g, "").length < 2)
    return void 0;
  return match("NAME", words[0].start, value, confidence);
}
var NAME_INTRO = /\b(?:a\.\s?n\.?|a\/n|atas\s+nama|nama\s+(?:lengkap\s+)?(?:saya|aku|ku|gue|gw|sy)|namaku|namanya|nama\s+(?:lengkap\s+)?(?:anak|ibu|bapak|ayah|suami|istri|adik|kakak|teman|orang\s+tua)\s+(?:saya|aku|kami|gue)|bernama|dengan\s+nama|my\s+name\s+is)(?![A-Za-z])[ \t]*(?:[:=][ \t]*)?/gi;
var NAME_CUE = /\b(?:saya|aku|gue|gw)[ \t]*,?[ \t]+|\b(?:halo|hai|hallo|selamat\s+(?:pagi|siang|sore|malam))[ \t]*,?[ \t]*(?:ini|dengan|dgn)[ \t]+|\b(?:penerima|pengirim|pemesan|pembeli)[ \t]+/gi;
var HONORIFIC = /(?<![\w-])(?:Bapak|Ibu|Pak|Bu|Sdr\.?|Sdri\.?|Saudara|Saudari|Mas|Mbak|Kak|Bang|Tn\.|Ny\.|Nn\.)[ \t]+/gi;
function detectNames(text) {
  const out = [];
  const add = (found) => found && out.push(found);
  for (const m of text.matchAll(NAME_INTRO))
    add(nameAt(text, m.index + m[0].length, "high"));
  for (const m of text.matchAll(NAME_CUE))
    add(nameAt(text, m.index + m[0].length, "medium", true));
  for (const m of text.matchAll(HONORIFIC)) {
    const lowercaseOk = /^(?:bapak|ibu|mbak)\b/.test(m[0]);
    add(nameAt(text, m.index + m[0].length, "medium", !lowercaseOk));
  }
  for (const m of text.matchAll(REPORTED_SPEECH)) {
    const word = m[1];
    const bare = word.toLowerCase();
    if (NOT_NAME.has(bare) || TITLE_WORDS.has(bare) || NOT_A_SPEAKER.has(bare))
      continue;
    out.push(match("NAME", m.index + /^\S+[ \t]+/.exec(m[0])[0].length, word, "medium"));
  }
  for (const m of text.matchAll(GREETING_SELF)) {
    const found = nameAt(text, m.index + m[0].length, "medium");
    if (found && !/\s/.test(found.value) && /^\s*(?:[,.!\n]|$)/.test(text.slice(found.end)))
      add(found);
  }
  return out;
}
var REPORTED_SPEECH = /\b(?:tadi|kemarin|kemaren|katanya|kata)[ \t]+([A-Za-z]{3,15})[ \t]+(bilang|ngomong|nanya|nanyain|minta|cerita|nelpon|telpon|ngechat|nge-?wa|kasih\s+tau|ngasih\s+tau)\b/gi;
var NOT_A_SPEAKER = new Set("mama mamah papa papah ayah bunda emak abah suami istri anak adik adek kakak abang teman temen sahabat tetangga bos atasan boss orangnya mereka kalian sistem system aplikasi website web bot google kurir driver ojol sopir penjual pembeli seller admin cs operator petugas dokter perawat bidan guru dosen polisi pacar doi beliau".split(" "));
var GREETING_SELF = /\b(?:halo|hai|hallo|hi|permisi|assalamualaikum|selamat\s+(?:pagi|siang|sore|malam))[ \t]*,?[ \t]*(?:(?:kak|kakak|min|admin|gan|sis|mas|mbak|pak|bu|bang)[ \t]*,?[ \t]+)?(?:ini|sama|dengan|dgn)[ \t]+/gi;
var CHAT_SENDER = /^‎?\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?[ \t]+\d{1,2}[.:]\d{2}(?:[.:]\d{2})?(?:[ \t ]?[AP]M)?\]?(?:[ \t]+-)?[ \t]+([^:\n]{1,60}?):[ \t]/gm;
var CHAT_TITLE = /^(?:Chat WhatsApp dengan|WhatsApp Chat with|Chat dengan|Riwayat chat dengan)[ \t]+([^\n]{1,60}?)[ \t]*$/gim;
var NOT_A_PERSON = /\b(?:toko|shop|store|official|olshop|admin|cs|customer service|support|tim|team|pt|cv|ud|bot|system|sistem|info|layanan|grosir)\b|^(?:error|warn|warning|info|debug|trace|fatal|notice)$/i;
function detectChatSenders(text) {
  const out = [];
  for (const re of [CHAT_SENDER, CHAT_TITLE]) {
    for (const m of text.matchAll(re)) {
      const sender = m[1].replace(/^~\s*/, "").trim();
      if (!new RegExp("\\p{L}", "u").test(sender) || /^[+\d\s()-]+$/.test(sender) || NOT_A_PERSON.test(sender))
        continue;
      const start = m.index + m[0].indexOf(m[1]) + m[1].indexOf(sender);
      out.push(match("NAME", start, sender, "high"));
    }
  }
  return out;
}
var THING_TABLE = /produk|product|barang|item|sku|kategori|categor|menu|toko|store|shop|merchant|brand|merek|layanan|service|paket|package|kota|city|provinsi|province|wilayah|region|kecamatan|kelurahan|desa|district|bank|kurir|courier|ekspedisi|tag|role|permission|setting|config|status|metode|method/i;
function detectSqlInserts(text) {
  const out = [];
  const insert = /\bINSERT\s+INTO\s+([`"\w.]+)\s*\(([^)]{1,2000})\)\s*VALUES\s*/gi;
  for (const m of text.matchAll(insert)) {
    const thingTable = THING_TABLE.test(m[1]);
    const columns = m[2].split(",").map((c) => c.trim().replace(/^[`"[]|[`"\]]$/g, ""));
    const types = columns.map((c) => thingTable && /^(?:nama|name|title|judul)$/i.test(c) ? void 0 : fieldType(c));
    if (!types.some(Boolean))
      continue;
    let i = m.index + m[0].length;
    let col = 0;
    let depth = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "'" || ch === '"') {
        let j = i + 1;
        while (j < text.length && !(text[j] === ch && text[j + 1] !== ch))
          j += text[j] === ch || text[j] === "\\" ? 2 : 1;
        const type = depth === 1 ? types[col] : void 0;
        const value = text.slice(i + 1, j);
        if (type && isPlausibleValue(type, value, columns[col]))
          out.push(match(type, i + 1, value, "high"));
        i = j + 1;
        continue;
      }
      if (ch === "(") {
        depth++;
        if (depth === 1)
          col = 0;
      } else if (ch === ")")
        depth--;
      else if (ch === "," && depth === 1)
        col++;
      else if (ch === ";" && depth === 0)
        break;
      else if (depth === 0 && !/[\s,]/.test(ch))
        break;
      else if (depth === 1 && /\d/.test(ch) && /[(,\s]/.test(text[i - 1])) {
        const num = /^\d+/.exec(text.slice(i))[0];
        const type = types[col];
        if (type && isPlausibleValue(type, num, columns[col]))
          out.push(match(type, i, num, "high"));
        i += num.length;
        continue;
      }
      i++;
    }
  }
  return out;
}
function detectStreetAddresses(text) {
  const out = [];
  const street = /\b(?:Jl|Jln|Jalan|Gg|Gang|Komp|Kompleks|Perum|Perumahan)\.?\s+[A-Za-z0-9][^\n;]{1,80}?(?:\b(?:No|Nomor|Blok|Kav)\.?\s*[A-Za-z]?\d+[A-Za-z]?(?:\/\d+)?(?:,?\s*RT\.?\s*\d{1,3}\s*\/\s*RW\.?\s*\d{1,3})?|\bRT\.?\s*\d{1,3}\s*\/\s*RW\.?\s*\d{1,3})/g;
  for (const m of text.matchAll(street))
    out.push(match("ADDRESS", m.index, m[0], "high"));
  const rtrw = /\bRT\.?\s*0*\d{1,3}\s*\/\s*RW\.?\s*0*\d{1,3}\b/gi;
  for (const m of text.matchAll(rtrw))
    out.push(match("ADDRESS", m.index, m[0], "medium"));
  return out;
}
var NAME_STOP = /\s(?:dan|dengan|yang|nik|hp|no|nomor|umur|usia|alamat|email|tinggal|lahir|asal|dari|di|ke|untuk|sebagai|mau|ingin|minta|tolong)\b/i;
var MULTI_PART = /* @__PURE__ */ new Set(["ADDRESS", "BIRTH_DATE", "HEALTH", "GEO"]);
function cutValue(type, raw) {
  let v = raw;
  const semi = v.search(/[;|&]/);
  if (semi >= 0)
    v = v.slice(0, semi);
  const pair = v.search(/\s+[A-Za-z_][\w.-]*=(?!=)/);
  if (pair >= 0)
    v = v.slice(0, pair);
  if (type === "EMAIL" || type === "IP")
    v = v.split(/\s/, 1)[0];
  const nextColon = v.search(/:(?!\/\/)/);
  if (nextColon > 0) {
    const head = v.slice(0, nextColon);
    const comma = head.lastIndexOf(",");
    if (comma >= 0)
      v = head.slice(0, comma);
    else {
      const words = head.split(/\s+/);
      let cut = words.length - 1;
      for (let i = 1; i < words.length; i++) {
        if (fieldType(words.slice(i).join(" "))) {
          cut = i;
          break;
        }
      }
      v = words.slice(0, cut).join(" ");
    }
  }
  if (MULTI_PART.has(type)) {
    const parts = v.split(",");
    let keep = 1;
    for (; keep < parts.length; keep++) {
      const lead = parts[keep].trim().split(/\s+/).slice(0, 3);
      if (lead.some((_, i) => fieldType(lead.slice(0, i + 1).join(" "))))
        break;
    }
    v = parts.slice(0, keep).join(",");
  } else {
    v = v.split(",")[0];
  }
  if (type === "NAME") {
    const stop = v.search(NAME_STOP);
    if (stop >= 0)
      v = v.slice(0, stop);
    const digit = v.search(/\d/);
    if (digit >= 0)
      v = v.slice(0, digit);
    v = v.split(/\s+/).slice(0, 5).join(" ");
  }
  return v.replace(/[\s.,}\]]+$/, "").trim();
}
var LABEL = /((?:["'`]?[A-Za-z][A-Za-z0-9_./-]*["'`]?[ \t]+){0,4}["'`]?[A-Za-z][A-Za-z0-9_./-]*["'`]?)$/;
function detectLabeledFields(text) {
  const out = [];
  for (const m of text.matchAll(/[ \t]*(?::(?![:\/])|=(?![=>]))[ \t]*/g)) {
    const lineStart = text.lastIndexOf("\n", m.index - 1) + 1;
    const label = LABEL.exec(text.slice(lineStart, m.index).trimEnd());
    if (!label)
      continue;
    const words = label[1].trim().split(/[ \t]+/);
    let type;
    let key = "";
    for (let i = 0; i < words.length && !type; i++) {
      key = words.slice(i).join(" ");
      type = fieldType(key);
    }
    if (!type)
      continue;
    const valueStart = m.index + m[0].length;
    const lineEnd = text.indexOf("\n", valueStart);
    const raw = text.slice(valueStart, lineEnd === -1 ? text.length : lineEnd).replace(/\r$/, "");
    let value;
    let start = valueStart;
    const quote = raw[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      const close = raw.indexOf(quote, 1);
      if (close === -1)
        continue;
      value = raw.slice(1, close);
      start += 1;
    } else {
      value = cutValue(type, raw);
    }
    if (!isPlausibleValue(type, value, key))
      continue;
    out.push(match(type, start, value, isGenericNameKey(key) ? "medium" : "high"));
  }
  return out;
}
function csvFields(line, delimiter) {
  const fields2 = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let j = i + 1;
      while (j < line.length && !(line[j] === '"' && line[j + 1] !== '"'))
        j += line[j] === '"' ? 2 : 1;
      fields2.push({ start: i + 1, end: j });
      i = line.indexOf(delimiter, j);
    } else {
      const next = line.indexOf(delimiter, i);
      fields2.push({ start: i, end: next === -1 ? line.length : next });
      i = next;
    }
    if (i === -1)
      break;
    i += delimiter.length;
  }
  return fields2;
}
function detectCsvColumns(text) {
  const firstBreak = text.indexOf("\n");
  if (firstBreak === -1)
    return [];
  const header = text.slice(0, firstBreak).replace(/\r$/, "");
  const delimiter = [",", ";", "	", "|"].find((d) => header.includes(d));
  if (!delimiter)
    return [];
  const headerFields = csvFields(header, delimiter).map((f) => header.slice(f.start, f.end).trim());
  const secondLine = text.slice(firstBreak + 1).split("\n", 1)[0].replace(/\r$/, "");
  if (headerFields.length < 2 || headerFields.some((h) => h.length > 40 || /[.!?]$/.test(h)) || csvFields(secondLine, delimiter).length !== headerFields.length) {
    return [];
  }
  const columns = headerFields.map((h) => fieldType(h));
  if (!columns.some(Boolean))
    return [];
  const out = [];
  let offset = firstBreak + 1;
  for (const rawLine of text.slice(offset).split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    csvFields(line, delimiter).forEach((f, idx) => {
      const type = columns[idx];
      const cell = line.slice(f.start, f.end);
      const value = cell.trim();
      if (!type || !isPlausibleValue(type, value, headerFields[idx]))
        return;
      const start = offset + f.start + cell.indexOf(value);
      out.push(match(type, start, value, isGenericNameKey(headerFields[idx]) ? "medium" : "high"));
    });
    offset += rawLine.length + 1;
  }
  return out;
}
var DETECTORS = [
  detectDigitRuns,
  detectNpwpFormatted,
  detectPassports,
  detectPhones,
  detectEmails,
  detectIps,
  detectCoordinates,
  detectBirthDates,
  detectHealth,
  detectFinancial,
  detectReligion,
  detectPlates,
  detectNames,
  detectChatSenders,
  detectSqlInserts,
  detectStreetAddresses,
  detectLabeledFields,
  detectCsvColumns
];
function detectPii(text, options = {}) {
  const types = new Set(options.types ?? PII_TYPES);
  const minRank = options.minConfidence === "high" ? 2 : 1;
  const rank = (m) => m.confidence === "high" ? 2 : 1;
  const candidates = DETECTORS.flatMap((d) => d(text)).filter((m) => m.end > m.start && types.has(m.type) && rank(m) >= minRank);
  candidates.sort((a, b) => rank(b) - rank(a) || b.end - b.start - (a.end - a.start) || a.start - b.start);
  const taken = new Uint8Array(text.length + 1);
  const accepted = [];
  for (const c of candidates) {
    let free = true;
    for (let i = c.start; i < c.end && free; i++)
      free = taken[i] === 0;
    if (!free)
      continue;
    taken.fill(1, c.start, c.end);
    accepted.push(c);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

// packages/core/dist/samaran/index.js
function partialMask(type, value) {
  const stars = (n) => "*".repeat(Math.max(n, 3));
  const digits = value.replace(/\D/g, "");
  switch (type) {
    case "NIK":
    case "KK":
      return `${digits.slice(0, 4)}${stars(8)}${digits.slice(-4)}`;
    case "NIP":
    case "SIM":
      return `${stars(digits.length - 3)}${digits.slice(-3)}`;
    case "PASSPORT":
      return `${value.charAt(0)}${stars(5)}${value.slice(-2)}`;
    case "IP": {
      const [a, b] = value.split(".");
      return `${a}.${b}.*.*`;
    }
    case "GEO":
      return value.replace(/(\.\d)\d+/g, "$1***");
    case "BIRTH_DATE":
    case "GENDER":
    case "RELIGION":
    case "MARITAL_STATUS":
    case "NATIONALITY":
    case "HEALTH":
    case "FINANCIAL":
    case "CRIMINAL_RECORD":
    case "BIOMETRIC":
      return stars(3);
    case "PHONE": {
      const national = parsePhone(value).e164?.replace("+62", "0") ?? digits;
      return `${national.slice(0, 4)}${stars(national.length - 8)}${national.slice(-4)}`;
    }
    case "EMAIL": {
      const [user = "", domain = ""] = value.split("@");
      return `${user.charAt(0)}${stars(3)}@${domain}`;
    }
    case "CARD":
    case "BANK_ACCOUNT":
    case "BPJS":
    case "NPWP":
      return `${stars(digits.length - 4)}${digits.slice(-4)}`;
    case "PLATE": {
      const [region = ""] = value.split(/[\s\d]/);
      return `${region} ${stars(4)}`;
    }
    case "NAME":
      return value.split(/\s+/).map((w) => `${w.charAt(0)}${stars(3)}`).join(" ");
    case "ADDRESS":
      return `${value.split(/\s+/)[0]} ${stars(3)}`;
  }
}

// packages/mcp/src/files.ts
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";

// packages/mcp/src/xlsx.ts
import { inflateRawSync } from "node:zlib";
function unzip(buf) {
  const files = /* @__PURE__ */ new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 101010256) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP/xlsx file.");
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 33639248) throw new Error("Corrupt ZIP central directory.");
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataStart, dataStart + compressed);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, inflateRawSync(data));
  }
  return files;
}
function decodeXml(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, (all2, name, dec, hex) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[name.toLowerCase()] ?? all2;
  });
}
function textOf(xml) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join("");
}
function columnIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function csvCell(value) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
function readXlsx(buf) {
  const files = unzip(buf);
  const read = (name) => files.get(name)?.toString("utf8");
  const shared = [...(read("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const rels = /* @__PURE__ */ new Map();
  for (const m of (read("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const sheets = [];
  for (const m of (read("xl/workbook.xml") ?? "").matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeXml(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? "Sheet");
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const xml = rid ? read(rels.get(rid) ?? "") : void 0;
    if (!xml) continue;
    const rows = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const body = c[2] ?? "";
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value = "";
        if (type === "s" && v !== void 0) value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = textOf(body);
        else if (v !== void 0) value = decodeXml(v);
        const idx = ref ? columnIndex(ref) : cells.length;
        while (cells.length < idx) cells.push("");
        cells[idx] = value;
      }
      rows.push(cells);
    }
    const width = Math.max(0, ...rows.map((r) => r.length));
    const csv = rows.map((r) => [...r, ...Array(width - r.length).fill("")].map(csvCell).join(",")).join("\n");
    sheets.push({ name, csv });
  }
  return sheets;
}

// packages/mcp/src/files.ts
var MAX_FILE_BYTES = 5 * 1024 * 1024;
var SKIP_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "coverage",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".turbo",
  ".cache",
  "target"
]);
function toPosix(p) {
  return p.split(path.sep).join("/");
}
function isTextFile(file) {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(8e3);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return !buf.subarray(0, n).includes(0);
  } finally {
    closeSync(fd);
  }
}
function* walkFiles(dir, limit = 5e3) {
  const stack = [dir];
  let count = 0;
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
      } else if (e.isFile()) {
        if (++count > limit) return;
        yield full;
      }
    }
  }
}
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{" && glob.indexOf("}", i) > i) {
      const close = glob.indexOf("}", i);
      re += `(?:${glob.slice(i + 1, close).split(",").map((alt) => globToRegExp(alt).source.slice(1, -1)).join("|")})`;
      i = close;
    } else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}
function loadIgnore(root) {
  const file = path.join(root, ".samaranignore");
  if (!existsSync(file)) return () => false;
  const rules = readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((pattern) => {
    const dirOnly = pattern.endsWith("/");
    const clean = pattern.replace(/^\/|\/$/g, "");
    return { re: globToRegExp(clean), dirOnly, anchored: pattern.replace(/\/$/, "").includes("/") };
  });
  return (absPath) => {
    const rel = toPosix(path.relative(root, absPath));
    if (rel.startsWith("..")) return false;
    const segments = rel.split("/");
    return rules.some(({ re, dirOnly, anchored }) => {
      if (anchored) {
        for (let i = segments.length; i >= 1; i--) {
          if (dirOnly && i === segments.length) continue;
          if (re.test(segments.slice(0, i).join("/"))) return true;
        }
        return false;
      }
      const candidates = dirOnly ? segments.slice(0, -1) : segments;
      return candidates.some((s) => re.test(s));
    });
  };
}
var UNSUPPORTED_DATA = {
  ".xls": "Excel 97-2003 (.xls) is not supported; save it as .xlsx or .csv",
  ".pdf": "PDF is not supported yet",
  ".doc": "Word documents are not supported yet",
  ".docx": "Word documents are not supported yet",
  ".ods": "OpenDocument spreadsheets are not supported yet",
  ".db": "database file",
  ".sqlite": "database file",
  ".sqlite3": "database file",
  ".zip": "archive",
  ".gz": "archive",
  ".rar": "archive",
  ".7z": "archive",
  ".jpg": "image (may be a KTP or selfie photo)",
  ".jpeg": "image (may be a KTP or selfie photo)",
  ".png": "image (may be a KTP or selfie photo)",
  ".heic": "image (may be a KTP or selfie photo)",
  ".webp": "image (may be a KTP or selfie photo)"
};
function loadDocument(file) {
  const ext = path.extname(file).toLowerCase();
  const st = statSync(file);
  if (st.size > MAX_FILE_BYTES) return { kind: "skipped", reason: "larger than 5 MB", dataBearing: true };
  if (ext === ".xlsx" || ext === ".xlsm") {
    try {
      return { kind: "sheets", sheets: readXlsx(readFileSync(file)) };
    } catch (e) {
      return { kind: "skipped", reason: `unreadable spreadsheet: ${e.message}`, dataBearing: true };
    }
  }
  const unsupported = UNSUPPORTED_DATA[ext];
  if (unsupported) return { kind: "skipped", reason: unsupported, dataBearing: true };
  if (!isTextFile(file)) return { kind: "skipped", reason: "binary file", dataBearing: false };
  return { kind: "text", text: readFileSync(file, "utf8") };
}

// packages/mcp/src/shell-reads.ts
import { existsSync as existsSync2, readdirSync as readdirSync2, statSync as statSync2 } from "node:fs";
import path2 from "node:path";
var SHELL_DATA_FILE = /\.(csv|tsv|json|jsonl|ndjson|log|txt|sql|xml|ya?ml|dump|bak|out)(\.\d+)?$/i;
var all = (t) => t;
var READERS = /* @__PURE__ */ new Set([
  "cat",
  "type",
  "gc",
  "get-content",
  "more",
  "less",
  "bat",
  "batcat",
  "head",
  "tail",
  "nl",
  "tac",
  "sed",
  "awk",
  "gawk",
  "cut",
  "sort",
  "uniq",
  "column",
  "jq",
  "yq",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "select-string",
  "sls",
  "import-csv",
  "ipcsv",
  "xxd",
  "od",
  "strings",
  "csvlook",
  "csvcut",
  "mlr",
  "paste",
  "findstr"
]);
var FILTERS = /* @__PURE__ */ new Set([
  ...READERS,
  "tr",
  "fold",
  "fmt",
  "tee",
  "select-object",
  "select",
  "format-table",
  "ft",
  "format-list",
  "fl",
  "out-string",
  "out-host",
  "convertto-json",
  "convertto-csv",
  "where-object",
  "where",
  "?",
  "sort-object",
  "group-object",
  "write-output",
  "echo"
]);
var WRITE_SINKS = /* @__PURE__ */ new Set(["out-file", "set-content", "add-content", "export-csv", "out-null"]);
var PREFIXES = /* @__PURE__ */ new Set(["sudo", "command", "env", "time", "nice", "nohup", "exec", "&", "."]);
function stripHeredocs(command) {
  return command.replace(/(<<-?[ \t]*(['"]?)(\w+)\2)[^\n]*\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\r?\n|$)/g, "$1").replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, "''");
}
function parse(command, powershell) {
  const escape = powershell ? "`" : "\\";
  const pipelines = [];
  let segments = [];
  let words = [];
  let cur = "";
  let quoted = false;
  let started = false;
  const endWord = () => {
    if (started) words.push({ text: cur, quoted });
    cur = "";
    quoted = false;
    started = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length) segments.push(words);
    words = [];
  };
  const endPipeline = () => {
    endSegment();
    if (segments.length) pipelines.push(segments);
    segments = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "'" || c === '"') {
      const close = command.indexOf(c, i + 1);
      const end = close === -1 ? command.length : close;
      cur += command.slice(i + 1, end);
      quoted = started = true;
      i = end;
    } else if (c === escape && i + 1 < command.length && command[i + 1] !== "\n") {
      cur += command[++i];
      started = true;
    } else if (c === "\n" || c === ";" || c === "&" && command[i + 1] === "&" || c === "|" && command[i + 1] === "|") {
      endPipeline();
      if (c !== "\n" && c !== ";") i++;
    } else if (c === "|") {
      endSegment();
    } else if (c === ">" || c === "<") {
      const fd = /^\d$|^&$/.test(cur) ? cur : "";
      if (!fd) endWord();
      cur = "";
      started = false;
      let op = fd + c;
      if (command[i + 1] === ">") op += command[++i];
      if (command[i + 1] === "&") op += command[++i] + (command[i + 1] ?? "");
      if (/&\d$/.test(op)) i++;
      words.push({ text: op, quoted: false });
    } else if (c === " " || c === "	" || c === "\r") {
      endWord();
    } else {
      cur += c;
      started = true;
    }
  }
  endPipeline();
  return pipelines;
}
function programName(word) {
  return path2.basename(word).toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
}
function firstLines(n) {
  return (t) => t.split("\n").slice(0, Math.max(0, n)).join("\n");
}
function lastLines(n, fromLine) {
  return (t) => {
    const lines = t.replace(/\n$/, "").split("\n");
    return (fromLine !== void 0 ? lines.slice(Math.max(0, fromLine - 1)) : lines.slice(-Math.max(1, n))).join("\n");
  };
}
function matching(pattern, opts) {
  let re;
  try {
    const source = opts.fixed ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern.replace(/\\([<>])/g, "\\b");
    re = new RegExp(source, opts.ignoreCase ? "gi" : "g");
  } catch {
    return all;
  }
  if (opts.onlyMatching && !opts.invert) {
    return (t) => t.split("\n").flatMap((l) => [...l.matchAll(re)].map((m) => m[0])).join("\n");
  }
  return (t) => t.split("\n").filter((l) => {
    re.lastIndex = 0;
    return re.test(l) !== Boolean(opts.invert);
  }).join("\n");
}
function fieldList(spec) {
  const parts = spec.split(",").map((p) => /^(\d*)(-?)(\d*)$/.exec(p));
  if (parts.some((p) => !p || !p[1] && !p[3])) return void 0;
  return (n) => parts.some((p) => {
    const from = p[1] ? Number(p[1]) : 1;
    const to = p[2] ? p[3] ? Number(p[3]) : Infinity : from;
    return n >= from && n <= to;
  });
}
function fields(split, keep, joiner) {
  return (t) => t.split("\n").map((l) => split(l).filter((_, i) => keep(i + 1)).join(joiner)).join("\n");
}
function awkSelect(args, positional) {
  const sep = option(args, ["-f", "-F"]) ?? args.find((a) => /^-F./.test(a))?.slice(2);
  const program = positional.find((p) => p.includes("{")) ?? "";
  const m = /^\s*(?:NR\s*[<>]=?\s*\d+\s*)?\{\s*print\s+((?:\$\d+\s*,?\s*)+);?\s*\}\s*$/.exec(program);
  if (!m) return all;
  const wanted = new Set([...m[1].matchAll(/\$(\d+)/g)].map((x) => Number(x[1])));
  if (wanted.has(0)) return all;
  const splitter = sep === void 0 ? /\s+/ : sep.length === 1 ? sep : new RegExp(sep);
  return fields((l) => (sep === void 0 ? l.trim() : l).split(splitter), (n) => wanted.has(n), " ");
}
function option(args, names) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i].toLowerCase();
    for (const n of names) {
      if (a === n) return args[i + 1];
      if (a.startsWith(`${n}=`)) return args[i].slice(n.length + 1);
      if (n.length === 2 && n.startsWith("-") && a.startsWith(n) && a.length > 2) {
        return args[i].slice(2);
      }
    }
  }
  return void 0;
}
var has = (args, ...flags) => args.some((a) => flags.includes(a) || /^-[a-zA-Z]+$/.test(a) && flags.some((f) => /^-[a-zA-Z]$/.test(f) && a.includes(f[1])));
function toSegment(words) {
  const list = [...words];
  while (list.length && (/^[A-Za-z_]\w*=/.test(list[0].text) && !list[0].quoted)) list.shift();
  while (list.length && PREFIXES.has(list[0].text.toLowerCase())) list.shift();
  if (!list.length) return void 0;
  const program = programName(list[0].text);
  const args = [];
  let inputFile;
  let writesToFile = false;
  for (let i = 1; i < list.length; i++) {
    const w = list[i];
    if (!w.quoted && /^(\d|&)?>>?$/.test(w.text)) {
      if (!w.text.startsWith("2")) writesToFile = true;
      i++;
    } else if (!w.quoted && /^\d?>&\d$/.test(w.text)) {
    } else if (!w.quoted && w.text === "<") {
      inputFile = list[++i]?.text;
    } else {
      args.push(w.text);
    }
  }
  const positional = args.filter((a) => !/^--?[A-Za-z]/.test(a) && !/^-\d+$/.test(a));
  return { program, args, positional, inputFile, writesToFile };
}
function selection(seg) {
  const { program, args } = seg;
  const num = (v) => v !== void 0 && /^[+-]?\d+$/.test(v) ? Number(v) : void 0;
  switch (program) {
    case "head": {
      const n = num(option(args, ["-n", "--lines", "-c", "--bytes"])) ?? num(args.find((a) => /^-\d+$/.test(a))?.slice(1));
      return firstLines(Math.abs(n ?? 10));
    }
    case "tail": {
      const raw = option(args, ["-n", "--lines"]) ?? args.find((a) => /^-\d+$/.test(a))?.slice(1);
      if (raw?.startsWith("+")) return lastLines(0, Number(raw.slice(1)));
      return lastLines(Math.abs(num(raw) ?? 10));
    }
    case "grep":
    case "egrep":
    case "fgrep":
    case "rg":
    case "ag":
    case "findstr": {
      if (has(args, "-c", "-l", "-L", "-q", "--count", "--files-with-matches", "--files-without-match", "--quiet")) {
        return void 0;
      }
      const pattern = option(args, ["-e", "--regexp"]) ?? seg.positional[0];
      if (pattern === void 0) return all;
      return matching(pattern, {
        ignoreCase: has(args, "-i", "--ignore-case") || program === "findstr" && has(args, "/i"),
        invert: has(args, "-v", "--invert-match"),
        fixed: program === "fgrep" || has(args, "-F", "--fixed-strings"),
        onlyMatching: has(args, "-o", "--only-matching")
      });
    }
    case "cut": {
      const list = option(args, ["-f", "--fields"]);
      const keep = list === void 0 ? void 0 : fieldList(list);
      if (!keep) return all;
      const delimiter = option(args, ["-d", "--delimiter"]) ?? "	";
      return fields((l) => l.split(delimiter), keep, delimiter);
    }
    case "awk":
    case "gawk":
      return awkSelect(args, seg.positional);
    case "select-string":
    case "sls": {
      const pattern = option(args, ["-pattern"]) ?? seg.positional[0];
      if (pattern === void 0) return all;
      if (has(args, "-quiet", "-list")) return void 0;
      return matching(pattern, {
        ignoreCase: !has(args, "-casesensitive"),
        invert: has(args, "-notmatch"),
        fixed: has(args, "-simplematch")
      });
    }
    case "sed": {
      const script = option(args, ["-e", "--expression"]) ?? seg.positional[0] ?? "";
      const range = /^(\d+)(?:,(\d+))?p$/.exec(script);
      if (has(args, "-n") && range) {
        const from = Number(range[1]);
        const to = Number(range[2] ?? range[1]);
        return (t) => t.split("\n").slice(from - 1, to).join("\n");
      }
      const quit = /^(\d+)q$/.exec(script);
      return quit ? firstLines(Number(quit[1])) : all;
    }
    case "get-content":
    case "gc":
    case "cat":
    case "type": {
      const head = num(option(args, ["-totalcount", "-head", "-first"]));
      const tail = num(option(args, ["-tail", "-last"]));
      if (head !== void 0) return firstLines(head);
      if (tail !== void 0) return lastLines(tail);
      return all;
    }
    case "select-object":
    case "select": {
      const first = num(option(args, ["-first"]));
      const last = num(option(args, ["-last"]));
      if (first !== void 0) return firstLines(first + 1);
      if (last !== void 0) return lastLines(last);
      return all;
    }
    default:
      return all;
  }
}
function expand(raw, cwd, powershell) {
  let word = raw;
  if (process.platform === "win32") word = word.replace(/^\/([a-zA-Z])(?=\/|$)/, "$1:");
  else if (powershell) word = word.replace(/\\/g, "/");
  if (!/[*?]/.test(word)) {
    const file = path2.resolve(cwd, word);
    return SHELL_DATA_FILE.test(file) && existsSync2(file) && statSync2(file).isFile() ? [file] : [];
  }
  const dir = path2.resolve(cwd, path2.dirname(word));
  const re = globToRegExp(path2.basename(word));
  try {
    return readdirSync2(dir).filter((name) => re.test(name) && SHELL_DATA_FILE.test(name)).map((name) => path2.join(dir, name)).filter((f) => statSync2(f).isFile());
  } catch {
    return [];
  }
}
function dataReadsInCommand(command, cwd, powershell = false) {
  const out = [];
  for (const pipeline of parse(stripHeredocs(command), powershell)) {
    let flow = [];
    for (const words of pipeline) {
      const seg = toSegment(words);
      if (!seg) continue;
      const narrow = selection(seg);
      if (WRITE_SINKS.has(seg.program) || !READERS.has(seg.program) && !FILTERS.has(seg.program)) {
        flow = [];
        continue;
      }
      if (!narrow) {
        flow = [];
        continue;
      }
      const files = READERS.has(seg.program) ? [...seg.args, ...seg.inputFile ? [seg.inputFile] : []].flatMap((a) => expand(a, cwd, powershell)) : [];
      flow = files.length ? files.map((file) => ({ file, select: narrow })) : flow.map((r) => ({ file: r.file, select: (t) => narrow(r.select(t)) }));
      if (seg.writesToFile && seg.program !== "tee") flow = [];
    }
    out.push(...flow);
  }
  return out;
}

// packages/mcp/src/guard.ts
var STRICT = [
  "NIK",
  "KK",
  "NPWP",
  "PASSPORT",
  "SIM",
  "NIP",
  "BANK_ACCOUNT",
  "BPJS",
  "CARD",
  "HEALTH",
  "CRIMINAL_RECORD",
  "BIOMETRIC"
];
var BULK_THRESHOLD = 3;
var BYPASS = /#izinkan-pii\b/i;
var DATA_FILE = /\.(csv|tsv|json|jsonl|ndjson|log|txt|sql|xml|ya?ml|dump|bak|out|xlsx|xlsm)(\.\d+)?$/i;
var GREP_MAX_FILES = 300;
var GREP_TYPES = {
  csv: /\.csv$/i,
  tsv: /\.tsv$/i,
  json: /\.(json|jsonl|ndjson)$/i,
  jsonl: /\.jsonl$/i,
  yaml: /\.ya?ml$/i,
  xml: /\.xml$/i,
  sql: /\.sql$/i,
  txt: /\.txt$/i,
  log: /\.log$/i
};
function summarize(matches, examples = true) {
  const counts = /* @__PURE__ */ new Map();
  for (const m of matches) counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
  return [...counts.entries()].map(([type, n]) => {
    const sample = examples ? ` (${partialMask(type, matches.find((m) => m.type === type).value)})` : "";
    return `${type}\xD7${n}${sample}`;
  }).join(", ");
}
function fileTexts(file) {
  try {
    const doc = loadDocument(file);
    if (doc.kind === "skipped") return void 0;
    return doc.kind === "text" ? [doc.text] : doc.sheets.map((s) => s.csv);
  } catch {
    return void 0;
  }
}
function withHeader(full, shown, file) {
  if (!/\.(csv|tsv)$/i.test(file)) return shown;
  const header = full.slice(0, full.indexOf("\n") + 1 || full.length).replace(/\r?\n$/, "");
  return shown.startsWith(header) ? shown : `${header}
${shown}`;
}
function verdict(texts) {
  return verdictOf(texts.flatMap((t) => detectPii(t, { minConfidence: "high" })));
}
function verdictOf(found) {
  const strict = found.some((m) => STRICT.includes(m.type));
  return strict || found.length >= BULK_THRESHOLD ? found : void 0;
}
function shownPii(full, shown, file) {
  const inFile = detectPii(full, { minConfidence: "high" }).filter((m) => shown.includes(m.value));
  const direct = detectPii(withHeader(full, shown, file), { minConfidence: "high" });
  return inFile.length >= direct.length ? inFile : direct;
}
var PROCESS_HINT = "To process the data, run a script that reads the file and writes its results to a file (or prints only counts), or use `write_file_unmasked`.";
function readTool(file, shownAs, ignored) {
  if (!DATA_FILE.test(file) || ignored(file)) return void 0;
  const texts = fileTexts(file);
  const found = texts && verdict(texts);
  if (!found) return void 0;
  return [
    `Samaran blocked reading ${shownAs}: it contains personal data (${summarize(found, false)}).`,
    "Use the `read_file_masked` tool from the lokal MCP server instead: same content, with personal data replaced by stable placeholders.",
    "Write results that need the real values with `write_file_unmasked`.",
    "If the user confirms the file only holds fake data, they can add it to .samaranignore."
  ].join(" ");
}
function shellTool(command, cwd, powershell, ignored) {
  const reads = dataReadsInCommand(command, cwd, powershell).filter((r) => !ignored(r.file));
  const matches = [];
  const files = /* @__PURE__ */ new Set();
  for (const r of reads) {
    for (const full of fileTexts(r.file) ?? []) {
      const shown = r.select(full);
      if (!shown.trim()) continue;
      const here = shownPii(full, shown, r.file);
      matches.push(...here);
      if (verdictOf(here)) files.add(r.file);
    }
  }
  const found = verdictOf(matches);
  if (!found) return void 0;
  const names = [...files.size ? files : new Set(reads.map((r) => r.file))].map((f) => path3.relative(cwd, f) || f);
  return [
    `Samaran blocked this command: it would print personal data from ${names.join(", ")} into the conversation (${summarize(found, false)}).`,
    "To look at the data, use the `read_file_masked` tool from the lokal MCP server (personal data replaced by stable placeholders).",
    PROCESS_HINT,
    "If the user confirms the file only holds fake data, they can add it to .samaranignore."
  ].join(" ");
}
function grepTool(input, cwd, ignored) {
  if (input.output_mode !== "content" || !input.pattern) return void 0;
  const target = path3.resolve(cwd, input.path ?? ".");
  let candidates;
  try {
    candidates = statSync3(target).isDirectory() ? [...walkFiles(target)] : [target];
  } catch {
    return void 0;
  }
  const glob = input.glob ? globToRegExp(input.glob.includes("/") ? input.glob : `**/${input.glob}`) : void 0;
  const typeFilter = input.type ? GREP_TYPES[input.type.toLowerCase()] : void 0;
  if (input.type && !typeFilter) return void 0;
  candidates = candidates.filter((f) => SHELL_DATA_FILE.test(f) && !ignored(f)).filter((f) => !glob || glob.test(path3.relative(target, f).split(path3.sep).join("/")) || glob.test(path3.basename(f))).filter((f) => !typeFilter || typeFilter.test(f)).slice(0, GREP_MAX_FILES);
  let re;
  try {
    re = new RegExp(input.pattern, input["-i"] ? "i" : "");
  } catch {
    re = void 0;
  }
  const after = input["-A"] ?? input["-C"] ?? input.context ?? 0;
  const beforeN = input["-B"] ?? input["-C"] ?? input.context ?? 0;
  const matches = [];
  const files = [];
  for (const file of candidates) {
    for (const full of fileTexts(file) ?? []) {
      const lines = full.split("\n");
      const keep = /* @__PURE__ */ new Set();
      lines.forEach((line, i) => {
        if (re && !re.test(line)) return;
        for (let j = Math.max(0, i - beforeN); j <= Math.min(lines.length - 1, i + after); j++) keep.add(j);
      });
      if (!keep.size) continue;
      const shown = [...keep].sort((a, b) => a - b).map((i) => lines[i]).join("\n");
      const here = shownPii(full, shown, file);
      matches.push(...here);
      if (verdictOf(here)) files.push(file);
    }
  }
  const found = verdictOf(matches);
  if (!found) return void 0;
  const names = (files.length ? files : candidates).slice(0, 5).map((f) => path3.relative(cwd, f) || f);
  return [
    `Samaran blocked this search: the matching lines in ${names.join(", ")} contain personal data (${summarize(found, false)}).`,
    'Search with output_mode "files_with_matches" or "count", or read the file with `read_file_masked` from the lokal MCP server.',
    "Add a glob or type that leaves data files out if you meant to search code."
  ].join(" ");
}
function evaluate(input) {
  if (process.env.SAMARAN_GUARD === "off") return void 0;
  if (input.hook_event_name === "UserPromptSubmit" && input.prompt) {
    if (BYPASS.test(input.prompt)) return void 0;
    const found = detectPii(input.prompt, { types: STRICT, minConfidence: "high" });
    if (!found.length) return void 0;
    return [
      `\u{1F6E1}\uFE0F  Samaran menahan prompt ini: ada data pribadi ${summarize(found)}.`,
      "Prompt akan terkirim ke server model AI. Ganti dengan data contoh atau samarkan dulu,",
      "atau kirim ulang dengan menambahkan #izinkan-pii jika memang disengaja."
    ].join("\n");
  }
  if (input.hook_event_name !== "PreToolUse" || !input.tool_input) return void 0;
  const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  const cwd = input.cwd ?? root;
  const ignored = loadIgnore(root);
  const tool = input.tool_input;
  switch (input.tool_name) {
    case "Read":
      return tool.file_path ? readTool(path3.resolve(root, tool.file_path), tool.file_path, ignored) : void 0;
    case "Grep":
      return grepTool(tool, cwd, ignored);
    case "Bash":
      return tool.command ? shellTool(tool.command, cwd, false, ignored) : void 0;
    case "PowerShell":
      return tool.command ? shellTool(tool.command, cwd, true, ignored) : void 0;
    default:
      return void 0;
  }
}
async function runGuard() {
  try {
    let raw = "";
    for await (const chunk of process.stdin) raw += chunk;
    const message = evaluate(JSON.parse(raw));
    if (message) {
      process.stderr.write(`${message}
`);
      process.exitCode = 2;
    }
  } catch (e) {
    process.stderr.write(`samaran-guard: ${e.message}
`);
  }
}
if (process.argv[1] && /samaran-guard\.m?js$/.test(process.argv[1])) {
  await runGuard();
}
export {
  evaluate,
  runGuard
};

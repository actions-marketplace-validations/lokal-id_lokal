// packages/mcp/src/guard.ts
import { existsSync as existsSync3, statSync as statSync3 } from "node:fs";
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

// packages/core/dist/samaran/types.js
var PII_TYPES = [
  "NIK",
  "KK",
  "NPWP",
  "PASSPORT",
  "SIM",
  "NIP",
  "BPJS",
  "NISN",
  "AKTA",
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
  "BIOMETRIC",
  "CUSTOM"
];
var UU_PDP_CATEGORY = Object.fromEntries(PII_TYPES.map((t) => [
  t,
  ["HEALTH", "BIOMETRIC", "CRIMINAL_RECORD", "FINANCIAL", "BANK_ACCOUNT", "CARD", "NISN"].includes(t) ? "spesifik" : "umum"
]));

// packages/core/dist/samaran/custom.js
var LABEL = /^[A-Z][A-Z_]*[A-Z]$|^[A-Z]$/;
function checkCustomRules(rules) {
  for (const rule of rules) {
    if (!LABEL.test(rule.label ?? "")) {
      throw new RangeError(`Custom rule label "${rule.label}" must be capital letters and underscores, like EMPLOYEE_ID.`);
    }
    if (PII_TYPES.includes(rule.label)) {
      throw new RangeError(`Custom rule label "${rule.label}" is a built-in type; choose another name.`);
    }
    if (rule.pattern === void 0 && !rule.fields?.length) {
      throw new RangeError(`Custom rule ${rule.label} needs a pattern or fields.`);
    }
    if (typeof rule.pattern === "string") {
      try {
        new RegExp(rule.pattern);
      } catch (e) {
        throw new RangeError(`Custom rule ${rule.label}: pattern does not compile (${e.message}).`);
      }
    }
  }
}
var escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function custom(label, start, value) {
  return { type: "CUSTOM", label, start, end: start + value.length, value, confidence: "high" };
}
function byPattern(text, rule) {
  const source = typeof rule.pattern === "string" ? rule.pattern : rule.pattern.source;
  const flags = typeof rule.pattern === "string" ? "" : rule.pattern.flags.replace(/[gy]/g, "");
  const out = [];
  for (const m of text.matchAll(new RegExp(source, `${flags}g`))) {
    if (m[0])
      out.push(custom(rule.label, m.index, m[0]));
  }
  return out;
}
function byLabel(text, rule, names) {
  const re = new RegExp(`(?:^|[^A-Za-z0-9_])(["']?)(?:${names})\\1[ \\t]*[:=][ \\t]*(?:"([^"\\r\\n]*)"|'([^'\\r\\n]*)'|([^\\s,;}\\]"'][^,;}\\]\\r\\n]*))`, "gi");
  const out = [];
  for (const m of text.matchAll(re)) {
    const quoted = m[2] ?? m[3];
    if (quoted !== void 0) {
      if (quoted.trim())
        out.push(custom(rule.label, m.index + m[0].length - 1 - quoted.length, quoted));
      continue;
    }
    const raw = m[4];
    const words = raw.split(/(\s+)/);
    let value = words[0];
    for (let i = 1; i + 1 < words.length && i < 12 && /^[A-Z0-9]/.test(words[i + 1]); i += 2)
      value += words[i] + words[i + 1];
    out.push(custom(rule.label, m.index + m[0].length - raw.length, value));
  }
  return out;
}
function cells(line, delimiter) {
  const out = [];
  let i = 0;
  for (; ; ) {
    let start = i;
    let end;
    if (line[i] === '"') {
      let j = i + 1;
      while (j < line.length && !(line[j] === '"' && line[j + 1] !== '"'))
        j += line[j] === '"' ? 2 : 1;
      start = i + 1;
      end = j;
      i = j + 1;
      while (i < line.length && line[i] !== delimiter)
        i++;
    } else {
      end = line.indexOf(delimiter, i);
      if (end === -1)
        end = line.length;
      i = end;
    }
    out.push({ start, text: line.slice(start, end) });
    if (i >= line.length)
      return out;
    i++;
  }
}
function byColumn(text, rule, wanted) {
  const out = [];
  let columns;
  let delimiter = ",";
  let width = 0;
  for (let pos = 0; pos <= text.length; ) {
    let end = text.indexOf("\n", pos);
    if (end === -1)
      end = text.length;
    const line = text.slice(pos, end).replace(/\r$/, "");
    if (!line.trim()) {
      columns = void 0;
    } else if (columns) {
      const row = cells(line, delimiter);
      if (row.length === width) {
        for (const c of columns) {
          const value = row[c].text.trim();
          if (value)
            out.push(custom(rule.label, pos + row[c].start + row[c].text.indexOf(value), value));
        }
      }
    } else {
      for (const d of [",", "	", ";", "|"]) {
        const header = cells(line, d);
        if (header.length < 2)
          continue;
        const hit = header.flatMap((c, i) => wanted.has(c.text.trim().toLowerCase()) ? [i] : []);
        if (hit.length) {
          columns = hit;
          delimiter = d;
          width = header.length;
          break;
        }
      }
    }
    pos = end + 1;
  }
  return out;
}
function detectCustom(text, rules) {
  const out = [];
  for (const rule of rules) {
    if (rule.pattern !== void 0)
      out.push(...byPattern(text, rule));
    if (rule.fields?.length) {
      out.push(...byLabel(text, rule, rule.fields.map(escape).join("|")));
      out.push(...byColumn(text, rule, new Set(rule.fields.map((f) => f.toLowerCase()))));
    }
  }
  return out;
}

// packages/core/dist/samaran/names.js
var GIVEN_NAMES = new Set(
  // Male
  "agus ahmad akhmad achmad abdul abdur firman adi aditya adit andi andika anton ari arief arif aris bambang benny budiman cahyo dedi deni denny dimas dodi doni edi edy eko erwin fajri fauzi fauzan ferry fikri gilang hadi hafiz haris hasan hendra hendro heru ibnu ilham indra iqbal irfan irwan iwan joko jefri kevin krisna lukman lutfi mahmud muhammad mohammad mochammad muhamad mohamad moh mukhlis nanang oki rahmat rachmat reza ridwan rizal rizky rizki rudi rudy ryan sandi setyo sigit slamet sugeng suryadi syahrul taufik teguh toni tono totok wawan yanto yogi yusuf zainal arya bayu rangga dendi galih hanif hilman habibi jamal kholil nurdin roni rony sahrul samsul sapto sofyan sukarno supardi suparman sutrisno syaiful saiful tatang ujang usman wahyudi yudi yuda zaki antonius yohanes johannes petrus paulus stefanus fransiskus agustinus yosef daniel samuel michael siti rina rini ratna ratih yuni yulia yuliana nurul nining ani anisa annisa aisyah aminah fitri fitria lina lia maya mira nia novi novita nanda nadia nabila rahma ria rika risa rosa sinta shinta susi susan tuti umi widya yanti yati eva evi erna endah diah dyah desi devi dina dini fatimah hana ika irma lilis linda lusi marlina mariam maryam nina nisa novia rosita salsabila tika titin winda yeni zahra farah dewanti ernawati kartini juwita yohana theresia veronika elisabeth kristina maria agnes ningsih sumarni suminah sulastri sundari suparmi tumini warsini asep dadang cecep encep iis euis yayan aep jajang ayi engkos entis odah otong ruslan nunung yeyen yuyun dedeh enok popon dede paijo parman paimin sumarno sukirman sukinah tukiman tukinem wagiman wagiyem painem ngatini ngadimin sutarno sutini sriyati suyatno suyanti subagyo sugiono supriyadi supriyanto susilowati sutopo sutejo jaka danang endang moch abdurrahman husein husin hasanudin hamzah ibrahim ismail yunus musa harun ikhsan ihsan faisal fahmi farhan farid husni ilyas jamil karim khoirul luqman malik mansur munir mustofa nasrul nurhayati nuraini nurlela khadijah zainab halimah hafsah salma syifa naila najwa aulia azizah khairunnisa laila latifah yoseph markus lukas matius benediktus kristian christina christine magdalena natalia natalie clarissa claudia cindy jessica jesica michelle stella vania angelina felicia patricia monica gabriella evelyn vivian steven stevan david jonathan nathan william felix ivan albert alvin andreas hendrik robert richard vincent edwin edward jeffry ricky rico hengky hendry rani riska rizka rifki rafi rafa puspita candra arie dani dicky dony erik fadil johan rendra rian riyan septian tomi wisnu yadi yudha anita bella della dita elsa ema fani fenny fira henny lisa reni resti rita siska sofi tiwi vera vina wina yani yuli tina ira cantika".split(" ")
);
var AMBIGUOUS_GIVEN_NAMES = new Set("budi sri sekar laras murni indah putri putra ayu fajar agung mega intan sari dewi wahyu citra cahya kartika permata bunga suci wulan melati puspa lestari surya eka dwi tri catur imam hari kurnia nur bintang rizqi rezeki mulia setia cinta kasih bagus santi sinar rahayu dian ratu asih mawar mutiara panca bima satria pandu panji puji tari gita okta octa vino yoga angel grace nana ana ida ina sudirman rejeki".split(" "));
var FAMILY_NAMES = new Set("utomo widodo santoso susanto wijaya widjaja saputra saputri pratama pratiwi hidayat hidayah setiawan setiadi kurniawan kurniawati gunawan hartono sutanto suharto susilo wibowo prasetyo prasetya nugraha nugroho purnomo permana ramadhan ramadhani firmansyah hakim rahman rahmawati wahyudi wahyuni handayani kusumawati maharani safitri anggraini puspitasari novitasari wulandari sulistyowati sukmawati suryani haryanto budiman irawan sanjaya tanoto salim suryadi siswanto effendi effendy syahputra sutrisno mulyadi mulyani haryadi sudarsono suryanto purwanto sugiarto sugianto kristanto tjandra chandra hermawan hendrawan darmawan dharmawan ardiansyah pangestu yulianti fitriani oktaviani septiani ramadani hidayatullah abdullah rosadi sopian sofyan iskandar sitorus nasution harahap lubis siregar simanjuntak simatupang sitompul hutapea pardede panjaitan situmorang sinaga tambunan manurung sihombing simbolon hutagalung napitupulu silalahi pasaribu sembiring ginting tarigan purba saragih damanik hasibuan batubara daulay pohan rangkuti ritonga matondang gultom sianturi simamora marpaung aritonang hutabarat pakpahan sibarani sirait samosir sidabutar munthe sinambela nainggolan manullang siahaan simanungkalit rajagukguk lumbantobing butarbutar sinurat girsang perangin-angin peranginangin sumampouw pangemanan wenas lumentut rondonuwu mandagi tumbelaka tuhumury latuconsina pattinama wattimena pattiasina lewerissa".split(" "));
var SECOND_NAMES = new Set("sari rahayu lestari wati yanti ningsih ningrum astuti utami kusuma halim aminah kartika".split(" "));
var CHINESE_FAMILY_NAMES = new Set("lim liem tan tjan ong oei wong kwee gouw khoe tjoa thio tio liauw chen ng yap teo kho sie tjia lauw liong".split(" "));
var BALINESE_NAMES = new Set("made wayan nyoman ketut gede putu kadek komang nengah luh gusti dewa".split(" "));

// packages/core/dist/samaran/fields.js
var FIELDS = [
  // A column called "pasien" or "pelanggan" holds that person's name.
  ["NAME", "nama|name|full_?name|kepada|kpd|yth|attn|attention|pelapor|terlapor|korban|saksi|tersangka|terdakwa|pelaku|kepala_?keluarga|penanggung_?jawab|ahli_?waris|pemberi_?kuasa|penerima_?kuasa|requester|username|nama_?lengkap|first_?name|last_?name|middle_?name|given_?name|family_?name|surname|nama_?depan|nama_?tengah|nama_?belakang|nama_?panggilan|nickname|nama_?ibu_?kandung|mother_?s?_?maiden_?name|penerima|pengirim|recipient|pasien|patient|pelanggan|customer|nasabah|karyawan|employee|pegawai|siswa|mahasiswa|student|peserta|pemohon|debitur|pemilik|owner|pemesan|pembeli|buyer|konsumen|atas_?nama|a_n"],
  ["ADDRESS", "alamat|address|full_?address|street|street_?address|domisili|alamat_?domisili|alamat_?ktp|alamat_?rumah|alamat_?pengiriman|shipping_?address|home_?address|billing_?address"],
  ["NIK", "nik|no_?ktp|nomor_?ktp|ktp|nomor_?induk_?kependudukan|national_?id"],
  ["KK", "kk|no_?kk|nomor_?kk|kartu_?keluarga|no_?kartu_?keluarga|nomor_?kartu_?keluarga|family_?card(_?number)?"],
  ["NPWP", "npwp|no_?npwp|nomor_?npwp|tax_?id|tin"],
  ["PASSPORT", "paspor|passport|no_?paspor|nomor_?paspor|passport_?(no|number)"],
  ["SIM", "sim|no_?sim|nomor_?sim|driver_?s?_?licen[cs]e|driving_?licen[cs]e"],
  ["NIP", "nip|nip_?baru|nrp|nomor_?induk_?pegawai"],
  ["NISN", "nisn|no_?nisn|nomor_?nisn|nomor_?induk_?siswa_?nasional"],
  ["AKTA", "akta|no_?akta|nomor_?akta|(?:no_?|nomor_?)?akta_?(?:kelahiran|lahir|nikah|perkawinan|kawin|cerai|perceraian|kematian)|birth_?certificate(?:_?(?:no|number))?|marriage_?certificate(?:_?(?:no|number))?"],
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
  ["FINANCIAL", "gaji|salary|(?:net|gross|base|basic)_?salary|take_?home_?pay|thp|gaji_?(?:pokok|bersih|kotor)|penghasilan|pendapatan|income|saldo|balance|limit_?kredit|credit_?limit|utang|hutang|debt|pinjaman|loan|loan_?amount|cicilan|installment|tunggakan|arrears|skor_?kredit|credit_?score|slik|kolektibilitas|kekayaan|net_?worth|harta"],
  ["CRIMINAL_RECORD", "catatan_?kriminal|catatan_?kepolisian|catatan_?pidana|skck|riwayat_?pidana|riwayat_?kriminal|criminal_?record|criminal_?history|status_?hukum"],
  // Not "signature" or "face": in code those are crypto signatures and UI faces.
  ["BIOMETRIC", "sidik_?jari|fingerprint|foto_?ktp|foto_?wajah|foto_?selfie|selfie|selfie_?ktp|face_?image|face_?photo|face_?embedding|biometri|biometric|biometrik|iris|retina|dna|genetik|genetic|voiceprint|voice_?print|tanda_?tangan|ttd"]
];
var ENTITY = "customer|pelanggan|nasabah|pasien|patient|user|pengguna|member|anggota|karyawan|employee|pegawai|siswa|student|mahasiswa|penerima|pengirim|recipient|sender|ibu|ayah|wali|orang_?tua|pemohon|applicant|debitur|peserta|pemilik|owner|contact|kontak|pemesan|pembeli|buyer|konsumen";
var QUALIFIER = `${ENTITY}|lengkap|baru|lama|asli|utama|rumah|kantor|ktp|domisili|pengiriman|pribadi|aktif|pokok|bersih|kotor|bulanan|tahunan|total|1|2`;
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
var ROLE_KEY = /^(pasien|patient|pelanggan|customer|nasabah|karyawan|employee|pegawai|siswa|mahasiswa|student|peserta|pemohon|debitur|pemilik|owner|penerima|pengirim|recipient|pemesan|pembeli|buyer|konsumen)$/;
var NICKNAME = /\s+\([A-Z]?[a-z][A-Za-z .'-]*\)$/;
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
var CODE_FILE = /[\w-]\.(?:m?[jt]sx?|cjs|cts|py|json|ya?ml|sh|toml)\b/i;
var DIGIT_TYPES = /* @__PURE__ */ new Set([
  "NIK",
  "KK",
  "NPWP",
  "NIP",
  "SIM",
  "BPJS",
  "NISN",
  "PHONE",
  "BANK_ACCOUNT",
  "CARD"
]);
var USER_KEY = /^(?:user|username|login)$/;
var isKnownNamePart = (word) => {
  const bare = word.toLowerCase().replace(/\d+$/, "");
  return GIVEN_NAMES.has(bare) || AMBIGUOUS_GIVEN_NAMES.has(bare) || FAMILY_NAMES.has(bare) || SECOND_NAMES.has(bare);
};
function isPlausibleValue(type, value, key) {
  const v = type === "NAME" ? value.trim().replace(NICKNAME, "").replace(/%20|\+/g, " ") : value.trim();
  if (!v || EMPTY.test(v))
    return false;
  if (TYPE_WORDS.has(v.toLowerCase()))
    return false;
  if (/^\[[A-Z_]+_\d+\]$/.test(v))
    return false;
  if (type === "NAME" && USER_KEY.test(normalizeKey(key))) {
    return /^[A-Za-z][\w. -]{2,40}$/.test(v) && v.split(/[._ -]+/).some(isKnownNamePart);
  }
  if (/[{}<>`$[\]]|=>|^\w+\.\w+\(/.test(v))
    return false;
  if (/^(?:new|await|typeof|function|return|yield|async)\s|^[A-Za-z_$][\w$.]*\($/.test(v))
    return false;
  if (type === "AKTA" && v.replace(/\D/g, "").length < 4)
    return false;
  if (type === "ADDRESS" && !/\s/.test(v))
    return false;
  if (type === "ADDRESS" && CODE_FILE.test(v))
    return false;
  const initials = type === "NAME" && /^(?:[A-Z]\.[ \t]?){1,4}$/.test(v);
  if (type !== "ADDRESS" && (/[()]/.test(v) || !initials && /^[a-z_$][\w$]*\.[a-z_$][\w$.]*$/i.test(v)))
    return false;
  const digitCount = v.replace(/\D/g, "").length;
  if (DIGIT_TYPES.has(type) && digitCount < 6)
    return false;
  if ((type === "GEO" || type === "IP") && digitCount < 2)
    return false;
  if (type === "IP" && !/^(?:\d{1,3}\.){3}\d{1,3}/.test(v) && !v.includes(":"))
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
    } else if (ROLE_KEY.test(normalizeKey(key)) && words.length === 1 && !/^[A-Z]/.test(v) && /[-_.\d]|^(?:admin|root|system|bot|team|tim|null|user)$/.test(v)) {
      return false;
    }
  }
  return true;
}

// packages/core/dist/samaran/detectors.js
function before(text, index, window = 40) {
  const slice = text.slice(Math.max(0, index - window), index);
  const nl = slice.lastIndexOf("\n");
  return (nl >= 0 ? slice.slice(nl + 1) : slice).toLowerCase();
}
function lineAbove(text, index, length) {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const lineEnd = text.indexOf("\n", index + length);
  if (text.slice(lineStart, index).trim() || text.slice(index + length, lineEnd === -1 ? text.length : lineEnd).trim())
    return "";
  if (lineStart === 0)
    return "";
  return text.slice(text.lastIndexOf("\n", lineStart - 2) + 1, lineStart - 1).toLowerCase();
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
var NISN_KEYWORD = /\b(nisn|nomor induk siswa nasional)\b[^\d]*$/;
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
    else if (digits.length === 10 && NISN_KEYWORD.test(label))
      push("NISN", "high");
    else if ((digits.length === 13 || digits.length === 11) && BPJS_KEYWORD.test(ctx))
      push("BPJS", "high");
    else if (digits.length >= 8 && digits.length <= 18 && BANK_KEYWORD.test(ctx))
      push("BANK_ACCOUNT", "high");
    else if (digits.length >= 8 && digits.length <= 18 && BANK_KEYWORD.test(lineAbove(text, m.index, m[0].length))) {
      push("BANK_ACCOUNT", "medium");
    }
  }
  return out;
}
function detectNpwpFormatted(text) {
  const re = /(?<!\d)\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}(?!\d)/g;
  return [...text.matchAll(re)].map((m) => match("NPWP", m.index, m[0], "high"));
}
function detectAkta(text) {
  const out = [];
  const dukcapil = /(?<![\w-])\d{4}[-./ ]?(?:LT|LU|LD|KW|CR|KM)[-./ ]?\d{8}[-./ ]?\d{3,6}(?![\w-])/gi;
  for (const m of text.matchAll(dukcapil))
    out.push(match("AKTA", m.index, m[0], "high"));
  const worded = /\bakta\s+(?:kelahiran|lahir|nikah|perkawinan|kematian|cerai|perceraian)(?:nya)?\s+(?:no(?:mor)?\.?\s*:?\s*)?([A-Za-z0-9][\w./-]{3,30}[A-Za-z0-9])/gi;
  for (const m of text.matchAll(worded)) {
    if (m[1].replace(/\D/g, "").length < 4)
      continue;
    out.push(match("AKTA", m.index + m[0].length - m[1].length, m[1], "high"));
  }
  return out;
}
function detectPassports(text) {
  const re = /(?<![A-Za-z0-9])[A-Z]{1,2}\s?\d{6,8}(?![A-Za-z0-9])/g;
  return [...text.matchAll(re)].filter((m) => /\b(paspor|passport)\b/.test(before(text, m.index, 30))).map((m) => match("PASSPORT", m.index, m[0], "high"));
}
var PHONE_LABELS = /* @__PURE__ */ new Set([
  "hp",
  "no",
  "nomor",
  "nohp",
  "telp",
  "tlp",
  "tel",
  "telepon",
  "telpon",
  "phone",
  "ph",
  "handphone",
  "mobile",
  "wa",
  "whatsapp",
  "wa.me",
  "nowa",
  "sms",
  "call",
  "cs",
  "cp",
  "kontak",
  "contact"
]);
function gluedToCode(text, index) {
  const sep = text[index - 1];
  if (sep !== "-" && sep !== "/")
    return false;
  let i = index - 1;
  while (i > 0 && /[A-Za-z0-9.]/.test(text[i - 1]))
    i--;
  const token = text.slice(i, index - 1).toLowerCase();
  return /[a-z]/.test(token) && !PHONE_LABELS.has(token) && !token.endsWith("wa.me");
}
var PHONE_WORD = /\b(?:telp|telepon|telpon|tlp|tel|phone|fax|faks|hub|hubungi|call|kontak|contact|cp|rumah|kantor|no)\b[^\d]*$/;
function detectPhones(text) {
  const out = [];
  const mobile = /(?<![\d+\w])(?:\+62|0062|62|0)[ \t-]?8\d{1,2}(?:[ \t.-]?\d{3,4}){2,3}(?![\d\w])/g;
  for (const m of text.matchAll(mobile)) {
    if (parsePhone(m[0].replace(/^00/, "+")).valid && !gluedToCode(text, m.index))
      out.push(match("PHONE", m.index, m[0], "high"));
  }
  const landline = /\((?:\+62[ \t]?|0)\d{2,3}\)[ \t]?\d{3,4}[ \t-]?\d{3,4}(?!\d)|(?<![\d\w])\+62[ \t]?[2-79]\d{1,2}[ \t-]?\d{3,4}[ \t-]?\d{3,4}(?!\d)/g;
  for (const m of text.matchAll(landline))
    out.push(match("PHONE", m.index, m[0], "medium"));
  const bracketed = /(?<![\d\w])(?:\+?62[ \t]?\(8\d{1,2}\)|\(08\d{1,2}\))[ \t]?\d{3,4}[ \t.-]?\d{3,4}(?!\d)/g;
  for (const m of text.matchAll(bracketed))
    if (parsePhone(m[0]).valid)
      out.push(match("PHONE", m.index, m[0], "high"));
  const grouped = /(?<![\d\w+])(?:\+62[ \t.-]?|62[ \t.-]?|0[ \t.-]?)8(?:[ \t.-]?\d){8,12}(?![\d\w])/g;
  for (const m of text.matchAll(grouped)) {
    const groups = m[0].split(/[ \t.-]/);
    const named = PHONE_WORD.test(before(text, m.index, 30));
    if (!named && (groups.length < 4 || groups.slice(1).some((g) => g.length > 2)))
      continue;
    if (/^0[ \t.-]/.test(m[0]) && !named)
      continue;
    if (parsePhone(m[0]).valid && !gluedToCode(text, m.index))
      out.push(match("PHONE", m.index, m[0], "high"));
  }
  const areaCode = /(?<![\d\w+])0(?:2[1-9]|[3-79]\d)\d{0,2}[ \t.-]?\d{3,4}[ \t.-]?\d{3,4}(?![\d\w])/g;
  for (const m of text.matchAll(areaCode)) {
    if (!PHONE_WORD.test(before(text, m.index, 30)))
      continue;
    const info = parsePhone(m[0]);
    if (info.valid && info.type === "landline")
      out.push(match("PHONE", m.index, m[0], "medium"));
  }
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
  for (const m of text.matchAll(/(?<![\w.+-])[A-Za-z0-9._+-]+%40[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g)) {
    out.push(match("EMAIL", m.index, m[0], "high"));
  }
  return out;
}
function detectIps(text) {
  const out = [];
  const re = /(?<![\d.\w])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d\w]|\.[\d\w])/g;
  for (const m of text.matchAll(re)) {
    const ip = m[0];
    if (/^(0\.|127\.|255\.255\.255\.255)/.test(ip))
      continue;
    if (/^-\d+(?![\d.])/.test(text.slice(m.index + ip.length)) || /\b(?:no|nomor|sk|surat)\.?\s*$/.test(before(text, m.index, 12)))
      continue;
    if (/\b(versi|version|ver|v)\.?\s*$/.test(before(text, m.index, 12)))
      continue;
    if (text[m.index + ip.length] === "." && ip.split(".").every((part) => part.length === 1))
      continue;
    const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
    out.push(match("IP", m.index, ip, priv ? "medium" : "high"));
  }
  return out;
}
function detectCoordinates(text) {
  const out = [];
  const re = /(?<![\d.])(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})(?![\d.])|\blat(?:itude)?\s*[:=]?\s*(-?\d{1,2}\.\d{4,})\s*[,;]?\s*(?:lng|lon|long|longitude)\s*[:=]?\s*(-?\d{1,3}\.\d{4,})(?![\d.])/gi;
  for (const m of text.matchAll(re)) {
    const lat = Number(m[1] ?? m[3]);
    const lng = Number(m[2] ?? m[4]);
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
  const re = new RegExp(`\\b(?:lahir|lhr|kelahiran|born|ttl|dob|d\\.o\\.b\\.?|date\\s+of\\s+birth|birth\\s*date|birthday)(?![a-z])[^\\n\\d]{0,40}?(${DATE})`, "gi");
  return [...text.matchAll(re)].map((m) => match("BIRTH_DATE", m.index + m[0].length - m[1].length, m[1], "high"));
}
var CONDITIONS = "hiv|aids|odha|tbc|tb paru|tuberkulosis|hepatitis(?: [abc])?|kanker(?: \\w+)?|tumor(?: \\w+)?|diabetes(?: mel+itus)?(?: tipe [12])?|hipertensi|stroke|penyakit jantung|gagal ginjal|cuci darah|covid(?:-19)?|dbd|demam berdarah(?: dengue)?|malaria|kusta|lepra|skizofrenia|bipolar(?: tipe [12i]+)?|depresi(?: berat| sedang| ringan)?|gangguan jiwa|gangguan mental|odgj|autis(?:me)?|epilepsi|ims|sifilis|gonore|herpes|hamil(?: \\d{1,2} (?:bulan|minggu))?|keguguran|asma|lupus|leukemia|th?alas+emia(?: (?:alfa|beta|mayor|minor))?|hemofilia|alzheimer|demensia|gastroenteritis(?: akut)?|gastritis|maag|typhoid|pneumonia|bronkitis|sinusitis|apendisitis|usus buntu|batu ginjal|hipotiroid|hipertiroid|anemia|glaukoma|katarak|skoliosis|hernia|wasir|ambeien|tbc tulang|meningitis|parkinson|tifus|tipes|cacar|campak|polio|difteri|stunting|obesitas|kolesterol tinggi|asam urat|gangguan kecemasan|anxiety|ptsd|ocd|adhd|down syndrome|cerebral palsy|lumpuh|tunanetra|tunarungu|tunawicara|tunadaksa|kista|miom|endometriosis|pcos|osteoporosis|vertigo|psikosis|gerd|jantung koroner|sakit jantung|gagal jantung|serangan jantung|infertil|mandul|impoten|klamidia|kecanduan(?: \\w+)?|pecandu(?: \\w+)?|pengguna (?:narkoba|narkotika|sabu|ganja|heroin|putaw|ekstasi)|percobaan bunuh diri|self harm|patah tulang(?: \\w+)?|gegar otak|luka bakar|amputasi|serangan panik|gangguan makan|anoreksia|bulimia";
var SYMPTOMS = "(?:demam(?:\\s+tinggi)?|batuk(?:\\s+berdahak)?|pilek|flu|sesak(?:\\s+napas)?|mual|muntah|diare|mencret|pusing|sakit\\s+kepala|nyeri\\s+\\w+|lemas|meriang|gatal-gatal|ruam|pendarahan|kejang|sariawan|radang\\s+tenggorokan|sakit\\s+perut|sakit\\s+gigi)";
var MEDICATIONS = "insulin|metformin|glibenclamide|arv|antiretroviral|obat tbc|rifampisin|isoniazid|kemoterapi|kemo|antidepresan|antipsikotik|fluoxetine|sertraline|risperidone|haloperidol|lithium|metadon|methadone|warfarin|amlodipine|captopril|levothyroxine|tamoxifen|hormon|kb|pil kb";
function detectHealth(text) {
  const out = [];
  const strong = /\b(?:didiagnosis|didiagnosa|terdiagnosis|terdiagnosa|mengidap|terinfeksi|riwayat penyakit|divonis)\s+(?:menderita\s+|mengidap\s+|penyakit\s+)?(?!(?:yang|dan|atau|di|ke|dari|untuk|ini|itu|tersebut|adalah|dapat|bisa|tidak|belum|anda|kamu|pasien|seseorang)\b)([^\n\r,.;:()"]{2,60}?)(?=\s+(?:sejak|selama|dan sudah|dan sedang|tapi|namun|sehingga|jadi)\b|[\n\r,.;:()"]|$)/gi;
  const dx = /\b(?:Dx|DX|Diagnosis|Diagnosa|Diag)\s*:\s*([^\n\r,;()"]{2,60}?)(?=\s*(?:[\n\r,;()"]|\.(?:\s|$)|$))/g;
  for (const m of [...text.matchAll(strong), ...text.matchAll(dx)]) {
    out.push(match("HEALTH", m.index + m[0].length - m[1].length, m[1], "high"));
  }
  const gated = new RegExp(`\\b(?:(?:dokter|dok|dr)\\.?\\s+(?:bilang|bilangnya|menyatakan|mendiagnosis)(?:\\s+(?:ada|kena|positif))?|positif|menderita|terkena|kena|sakit|pasien|komplikasi|kambuh|kumat|penderita|pengidap|penyintas|mengalami|karena|krn|akibat|gara-gara|punya|riwayat|diagnosa|diagnosis|didiagnosa|pembawa\\s+sifat|carrier|saya|aku|gue|gw|gua|dia|beliau|ayah|bapak|ibu|mama|mamah|papa|papah|suami|istri|anak|anaknya|adik|adek|kakak|nenek|kakek|mertua|pacar|teman|temen)\\s+(?:(?:saya|aku|gue|dia|lagi|sedang|sdg|sudah|udah|sdh|sempat|pernah|baru|kena|terkena)\\s+){0,2}((?:penyakit\\s+)?(?:${CONDITIONS})(?:\\s*(?:,|dan|serta)\\s+(?:${CONDITIONS}))*)\\b`, "gi");
  for (const m of text.matchAll(gated)) {
    out.push(match("HEALTH", m.index + m[0].length - m[1].length, m[1], "medium"));
  }
  const result = /\b(?:tes|test|uji|pemeriksaan|skrining|screening|swab|rapid(?:\s+test)?)\s+((?:hiv|hepatitis(?:\s+[abc])?|hbsag|covid(?:-19)?|tbc|tb|sifilis|vdrl|narkoba|urine|kehamilan|dna|pcr|antigen)\s+(?:hasilnya\s+)?(?:reaktif|non-?reaktif|positif|negatif))\b/gi;
  for (const m of text.matchAll(result))
    out.push(match("HEALTH", m.index + m[0].length - m[1].length, m[1], "medium"));
  for (const m of text.matchAll(/\b(?:mutasi\s+)?(?:BRCA[12]|HLA-B\*?\d{2}:\d{2})(?:\s+(?:positif|negatif|mutasi|carrier))?/g)) {
    if (/positif|negatif|mutasi|carrier/i.test(m[0]) || /\b(?:hasil|tes|test|dinyatakan)\b[^\n]{0,20}$/i.test(before(text, m.index, 30))) {
      out.push(match("HEALTH", m.index, m[0], "medium"));
    }
  }
  for (const m of text.matchAll(/\b(?:tuna[ -]?(?:rungu|netra|wicara|daksa|grahita|laras)|odha|odgj)\b/gi)) {
    if (/\b(?:para|kaum|penyandang|bagi|untuk|buat|sekolah|slb|komunitas|organisasi|yayasan|layanan|hak|ramah)\s+$/i.test(before(text, m.index, 20)))
      continue;
    out.push(match("HEALTH", m.index, m[0], "medium"));
  }
  for (const m of text.matchAll(new RegExp(`\\((${CONDITIONS})\\)`, "gi"))) {
    out.push(match("HEALTH", m.index + 1, m[1], "medium"));
  }
  const treatment = new RegExp(`\\b(?:obat|suntik(?:an)?|minum|konsumsi|terapi|resep)\\s+(${MEDICATIONS})\\b|\\b(kemoterapi|radioterapi|hemodialisa|cuci darah)\\b`, "gi");
  for (const m of text.matchAll(treatment)) {
    const value = m[1] ?? m[2];
    out.push(match("HEALTH", m.index + m[0].length - value.length, value, "medium"));
  }
  for (const m of text.matchAll(/\balergi\s+(?:terhadap\s+)?([a-z][\w-]*(?:\s+dan\s+[a-z][\w-]*)?)/gi)) {
    if (/\b(?:anti|bebas|obat|tes|uji)\s+$/.test(before(text, m.index, 12)))
      continue;
    out.push(match("HEALTH", m.index + m[0].length - m[1].length, m[1], "medium"));
  }
  const symptom = /\b(?:keluhan|gejala|mengeluh(?:kan)?)\s+((?:demam|batuk|pilek|flu|sesak(?:\s+napas)?|mual|muntah|diare|pusing|sakit\s+kepala|nyeri\s+\w+|lemas|meriang|gatal|ruam|benjolan|pendarahan|kejang)(?:\s+(?:dan|,)\s+(?:demam|batuk|pilek|flu|mual|muntah|diare|pusing|lemas))*)/gi;
  for (const m of text.matchAll(symptom))
    out.push(match("HEALTH", m.index + m[0].length - m[1].length, m[1], "medium"));
  const having = new RegExp(`\\b(?:(?:sudah|udah|sdh|sejak|selama|umur|usia)\\s+\\d+\\s+(?:hari|minggu|bulan|tahun|th)|(?:saya|aku|gue|gw|dia|beliau|anak\\s+saya|anakku|anaknya|suami\\s+saya|istri\\s+saya)\\s+(?:lagi|sedang|sering|kena|terkena|mengalami))\\s+(${SYMPTOMS}(?:\\s*(?:dan|,|&)\\s*${SYMPTOMS})*)`, "gi");
  for (const m of text.matchAll(having))
    out.push(match("HEALTH", m.index + m[0].length - m[1].length, m[1], "medium"));
  const finding = new RegExp(`(?:[,;:]|\\bdan)\\s*((?:${CONDITIONS})|tekanan\\s+darah\\s+\\d{2,3}\\/\\d{2,3}|tensi\\s+\\d{2,3}\\/\\d{2,3})(?=\\s*(?:[,;.]|dan\\b|$))`, "gi");
  for (const m of text.matchAll(finding)) {
    if (!/\b(?:mcu|medical|check-?up|hasil\s+(?:lab|pemeriksaan)|pasien|dokter|dok|tekanan\s+darah|tensi|keluhan|riwayat|diagnos[ai]s?|klinik|puskesmas|rs|rsud)\b/i.test(text.slice(Math.max(0, m.index - 80), m.index)))
      continue;
    out.push(match("HEALTH", m.index + m[0].length - m[1].length, m[1], "medium"));
  }
  const afterAge = new RegExp(`(?:\\(\\d{1,2}[^)\\n]{0,8}\\)|\\b\\d{1,2}\\s*(?:th|thn|tahun))\\s*,\\s*((?:${CONDITIONS})(?:\\s*(?:,|dan)\\s*(?:${CONDITIONS}))*)\\b`, "gi");
  for (const m of text.matchAll(afterAge))
    out.push(match("HEALTH", m.index + m[0].length - m[1].length, m[1], "medium"));
  const hospital = /\b(?:dirawat|opname|rawat inap|diopname|dioperasi|isolasi)\s+(?:di\s+)?(?:(?:RSUD|RSU|RSIA|RSJ|RSAB|RS|Rumah Sakit|Puskesmas|Klinik)\b[^\n,.;:()]{0,40}?)(?=\s+(?:karena|krn|sejak|selama|dan|tapi|jadi|sampai)\b|[\n,.;:()]|$)/gi;
  for (const m of text.matchAll(hospital))
    out.push(match("HEALTH", m.index, m[0], "medium"));
  return out;
}
var PERSON_NEAR = /\b(?:saya|aku|gue|gw|gua|dia|beliau|kami|suami|istri|ayah|bapak|ibu|mama|papa|anak|adik|kakak|pernah|udah|sudah|lagi|sedang|jadi)\b/;
function detectFinancial(text) {
  const re = /\b(?:gaji|penghasilan|pendapatan|saldo|utang|hutang|pinjaman|cicilan|tunggakan|limit(?:\s+kartu)?(?:\s+kredit)?|tagihan\s+(?:kartu\s+kredit|cc|paylater|pinjol|kpr|cicilan)|(deposito|tabungan|simpanan|habis|rugi|kerugian|kalah|sisa\s+(?:pokok|pinjaman|utang|hutang|cicilan)|pokok\s+(?:pinjaman|utang|hutang)|outstanding|plafond?))(?:\s+(?:saya|aku|gue|gw|gua|dia|beliau|suami|istri|ayah|bapak|ibu|ortu|orang\s+tua|keluarga|bulanan|tahunan|pokok|tetap|per\s+bulan|sebulan|setahun|bersih|kotor|rekening|tabungan|deposito|terakhir|total|anda|kamu|kalian|pinjol|paylater|kpr|kta|online|leasing|kartu\s+kredit|per\s+hari\s+ini|hari\s+ini|saat\s+ini|sekarang|udah|sudah|sdh|baru|itu|ini|tsb|motor|mobil|rumah|hp|laptop|apartemen|bulan\s+ini|ovo|gopay|dana|shopeepay|linkaja|jenius|bca|bri|bni|mandiri|bsi|jago|seabank|di\s+\w+|ke\s+\w+))*\s*(?:sebesar|sekitar|kira-kira|cuma|hanya|adalah|ada|masih|tinggal|sisa|senilai|:|=)?\s*((?:Rp\.?\s?)?\d[\d.,]*(?:\s*(?:rb|ribu|k|jt|juta|m|miliar|milyar|t|triliun)\b)?)/gi;
  const out = [];
  for (const m of text.matchAll(re)) {
    const amount = m[2].replace(/[.,]+$/, "");
    if (!/rp|[a-z]$/i.test(amount) && amount.replace(/\D/g, "").length < 4)
      continue;
    if (m[1] && !/\b(?:punya|memiliki|milik|nasabah|pak|bu|bapak|ibu|saya|aku|gue|gw|dia|beliau|debitur|peminjam)\b/i.test(before(text, m.index, 40) + m[0]))
      continue;
    out.push(match("FINANCIAL", m.index + m[0].length - m[2].length, amount, "medium"));
  }
  const status = /\b(?:galbay|gagal\s+bayar|kredit\s+macet|kol(?:ektibilitas)?\s*[2-5]|masuk\s+(?:bi\s*checking|slik)|di-?blacklist\s+(?:bank|bi|ojk)|(?:dikejar|ditagih|didatangi)\s+(?:dc|debt\s+collector)|terlilit\s+(?:utang|hutang|pinjol))\b/gi;
  for (const m of text.matchAll(status)) {
    if (!/^galbay$/i.test(m[0]) && !PERSON_NEAR.test(before(text, m.index, 30)))
      continue;
    out.push(match("FINANCIAL", m.index, m[0], "medium"));
  }
  return out;
}
function detectMaritalStatus(text) {
  const out = [];
  const re = /\b(?:saya|aku|gue|gw|dia|beliau|ibu|bapak|ayah|mama|papa|kakak|adik)\s+(?:(?:sudah|udah|sdh|baru|belum|blm|masih|sekarang|kini|seorang|berstatus|statusnya)\s+)*(cerai(?:\s+(?:hidup|mati))?|bercerai|janda|duda|menikah|kawin|lajang|single|nikah\s+siri|nikah|pisah\s+ranjang)\b|\b(?:sekarang|kini|berstatus|seorang|itu|statusnya)\s+(janda|duda|lajang)\b|\b(janda|duda)(?=\s+(?:anak|beranak|dengan\s+\d|\d|cerai|ditinggal|tanpa\s+anak|muda|kembang)\b)|\bstatus(?:nya)?\s+(?:perkawinan\s+|pernikahan\s+)?(cerai\s+(?:hidup|mati)|janda|duda|kawin|menikah|sudah\s+menikah|belum\s+(?:kawin|menikah)|lajang|nikah\s+siri)\b|\b(pisah\s+ranjang)\b|\b(?:sudah|udah|sdh|telah)\s+(?:\d+\s+tahun\s+(menikah|nikah|berumah\s+tangga)|(bercerai|cerai(?:\s+(?:hidup|mati))?|menjanda|menduda))\b/gi;
  for (const m of text.matchAll(re)) {
    const value = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7];
    if (/^(?:menikah|kawin|nikah)$/i.test(value) && !/\b(?:sudah|udah|sdh|belum|blm|berstatus|status|statusnya|perkawinan|pernikahan|tahun)\s+$/i.test(m[0].slice(0, -value.length)))
      continue;
    out.push(match("MARITAL_STATUS", m.index + m[0].length - value.length, value, "medium"));
  }
  return out;
}
function detectReligion(text) {
  const re = /\b(?:beragama|agamanya|agama\s+(?:saya|aku|dia|beliau|kami|mereka))\s+(Islam|Kristen(?:\s+Protestan)?|Protestan|Katolik|Katholik|Hindu|Buddha|Budha|Konghucu|Khonghucu|Kong Hu Cu)\b/gi;
  const out = [...text.matchAll(re)].map((m) => match("RELIGION", m.index + m[0].length - m[1].length, m[1], "high"));
  const adjective = /\b(?:saya|aku|gue|gw|dia|beliau|kami|keluarga\s+(?:saya|kami)|(?:suami|istri|ayah|bapak|ibu|mama|papa|ortu|orang\s+tua|anak|adik|kakak|pacar|calon)(?:\s+(?:saya|aku|gue|dia)|nya|ku)?)\s+(?:(?:seorang|itu|adalah|sudah|udah|baru|jadi)\s+)?(muslim(?:ah)?|islam|nasrani|kristiani?|kristen(?:\s+protestan)?|protestan|katolik|katholik|hindu|buddhis|buddha|budha|konghucu|khonghucu|mualaf|muallaf|ateis|atheis|agnostik|non[- ]?muslim)\b/gi;
  for (const m of text.matchAll(adjective))
    out.push(match("RELIGION", m.index + m[0].length - m[1].length, m[1], "medium"));
  const conversion = /\b(?:pindah\s+agama|murtad|convert|mualaf)\b[^\n.]{0,30}?\b(?:jadi|menjadi|ke|sekarang|kini)\s+(Islam|Kristen(?:\s+Protestan)?|Protestan|Katolik|Katholik|Hindu|Buddha|Budha|Konghucu|Khonghucu)\b|\bmasuk\s+(Islam|Kristen|Katolik|Hindu|Buddha)\b/gi;
  for (const m of text.matchAll(conversion)) {
    const value = m[1] ?? m[2];
    out.push(match("RELIGION", m.index + m[0].length - value.length, value, "medium"));
  }
  return out;
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
  const loose = new RegExp(`(?<![A-Za-z0-9])(?:${PLATE_REGIONS})\\s?\\d{1,4}\\s?[A-Z]{1,3}(?![A-Za-z0-9])`, "gi");
  for (const m of text.matchAll(loose)) {
    if (/\b(plat|nopol|no\.?\s*pol|tnkb|kendaraan|motor|mobil)\b/.test(before(text, m.index, 20))) {
      out.push(match("PLATE", m.index, m[0], "medium"));
    }
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
  "nn",
  "mr",
  "mrs",
  "ms",
  "miss",
  "mister",
  "koh",
  "ko",
  "cik",
  "ci",
  "cici",
  "om",
  "tante",
  "kang",
  "teh",
  "bli",
  "cak",
  "mbok",
  "habib",
  "gus",
  "romo",
  "pastor",
  "pendeta",
  "pdt",
  "alm",
  "almh",
  "almarhum",
  "almarhumah",
  "kh",
  "dear"
]);
var NOT_NAME = new Set("yang dan atau dengan dgn di ke dari dr untuk utk pada dalam ini itu tsb tersebut saya sy aku aq kamu km anda dia beliau kami kita mereka gue gw gua lu nya ya iya yaa ok oke kak sih dong deh nih tuh kok lah kah pun juga aja saja sudah udah sdh belum blm mau ingin pengen pingin minta mohon tolong bisa bisakah boleh akan sedang lagi masih baru tadi kemarin besok nanti sekarang hari sekali sekalian semua para terima kasih makasih selamat pagi siang sore malam halo hai permisi maaf refund transfer tf pesanan pesan order barang paket produk nomor no nik hp wa alamat email rekening rek umur usia lahir tinggal asal sebagai adalah ialah tidak tak gak ga nggak bukan jadi kalau kalo karena krn tapi namun perusahaan kantor toko pt cv ud yayasan koperasi instansi bank kota negara pertiwi jari hamil menyusui rumah tiri mertua kandung terdaftar sendiri ada punya kirim dikirim cek dicek tanya nanya bertanya sama bersama tentang soal mengenai sini situ sana apa siapa gimana bagaimana kenapa mana kapan berapa harap segera langsung dulu lalu kemudian terus menyatakan bahwa yg sekalian islam kristen katolik hindu buddha konghucu jl jln jalan gg gang the and i am is a an of to for want my senin selasa rabu kamis jumat sabtu minggu januari februari maret april mei juni juli agustus september oktober november desember cuma hanya pernah sering selalu benar betul yakin setuju kecewa senang puas bingung orang customer pelanggan pembeli penjual member anggota warga mahasiswa siswa karyawan pegawai seller buyer user pengguna manajemen management direksi pimpinan tim team seluruh keluarga pribadi rt rw satpam ojol cs domain file folder tabel table kolom column variabel fungsi function class akun aplikasi app server database program manfaat pengendali prosesor pemerintah kementerian keuangan negeri daerah republik indonesia rakyat dewan lembaga badan dinas direktorat komisi mahkamah pengadilan kepolisian polri tni sekretariat umum nasional pusat setia prioritas vip tetap kontrak berprestasi terbaik terhormat yth tercinta terkasih kesayangan aktif harian magang honorer swasta asing lokal premium reguler perorangan individu lama kakak adik semuanya sir madam all everyone there world guys team folks friends bro sis gan min bos boss say sayang beb dek service support masukkan isi ketik pilih enter your sobat jakarta bandung surabaya medan semarang makassar palembang bogor depok tangerang bekasi yogyakarta jogja solo malang denpasar bali batam pekanbaru padang manado balikpapan samarinda pontianak banjarmasin ambon jayapura kupang mataram lampung aceh cirebon tasikmalaya sukabumi serang cilegon purwokerto kediri jember madiun magelang salatiga".split(" "));
var NAME_PARTICLES = /* @__PURE__ */ new Set(["bin", "binti", "van", "der", "de", "al", "el", "da", "dos"]);
var ORGANIZATION = /* @__PURE__ */ new Set(["pt", "cv", "ud", "toko", "yayasan", "koperasi", "perusahaan", "bank"]);
var NAME_TOKEN = /[ \t]*([A-Za-z][A-Za-z'’-]*\.?)/y;
function nameAt(text, start, confidence, capitalized = false) {
  const words = [];
  let lowercaseAmbiguous = false;
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
    if (capitalized && !/^[A-Z]/.test(word) && !NAME_PARTICLES.has(bare)) {
      if (words.length ? !isKnownName(bare) : !GIVEN_NAMES.has(bare) && !AMBIGUOUS_GIVEN_NAMES.has(bare))
        break;
      if (!words.length && AMBIGUOUS_GIVEN_NAMES.has(bare))
        lowercaseAmbiguous = true;
    }
    words.push({ start: wordStart, end: wordStart + word.length, bare });
    if (word.endsWith(".") && bare.length > 1)
      break;
  }
  while (words.length && NAME_PARTICLES.has(words[words.length - 1].bare))
    words.pop();
  if (!words.length || ORGANIZATION.has(words[0].bare))
    return void 0;
  if (lowercaseAmbiguous && words.length === 1)
    return void 0;
  const value = text.slice(words[0].start, words[words.length - 1].end).replace(/[.,]+$/, "");
  if (value.replace(/[^A-Za-z]/g, "").length < 2)
    return void 0;
  return match("NAME", words[0].start, value, confidence);
}
var NAME_INTRO = /\b(?:a\.\s?n\.?|a\/n|an\.|atas\s+nama|nama\s+(?:lengkap\s+)?(?:saya|aku|ku|gue|gw|sy)|namaku|namanya|nama\s+(?:lengkap\s+)?(?:anak|ibu|bapak|ayah|suami|istri|adik|kakak|teman|orang\s+tua)\s+(?:saya|aku|kami|gue)|nama\s+(?:akun|pengguna|pemilik|penerima|pengirim|pelanggan|nasabah|pasien|siswa|karyawan|pemesan)|bernama|dengan\s+nama|my\s+name\s+is|nami\s+(?:abdi|kulo|kula|simkuring|sim\s+kuring)|jeneng(?:ku|\s+(?:kula|kulo|aku|kulo))|asma\s+kula)(?![A-Za-z])[ \t]*(?:[:=][ \t]*)?/gi;
var NAME_CUE = /\b(?:saya|aku|gue|gw)[ \t]*,?[ \t]+|\b(?:halo|hai|hallo|selamat\s+(?:pagi|siang|sore|malam))[ \t]*,?[ \t]*(?:ini|dengan|dgn)[ \t]+|\b(?:penerima|pengirim|pemesan|pembeli)[ \t]+/gi;
var HONORIFIC = /(?<![\w-])(?:Bapak|Bpk\.?|Bp\.|Ananda|Ibu|Pak|Bu|Sdr\.?|Sdri\.?|Saudara|Saudari|Mas|Mbak|Kak|Bang|Tn\.|Ny\.|Nn\.)[ \t]+/gi;
var TITLE_CUE = /(?<![\w-])(?:Mr\.?|Mrs\.?|Ms\.?|Miss|Mister|Dr\.|Prof\.|Ir\.|Drs\.|Dra\.|H\.|Hj\.|KH\.|Pdt\.|Alm\.|Almh\.|[Aa]lmarhum(?:ah)?|[Kk]oh?|[Cc]ik|[Cc]ici|[Oo]m|[Tt]ante|[Kk]ang|[Bb]li|[Cc]ak|[Mm]bok|[Hh]abib|[Gg]us|[Uu]stadz(?:ah)?|[Rr]omo|[Pp]astor|[Pp]endeta)[ \t]+/g;
var ROLE_CUE = /\b(?:pelanggan|customer|konsumen|pembeli|pemesan|nasabah|pasien|patient|kurir|driver|sopir|supir|karyawan|karyawati|pegawai|staf|staff|siswa|siswi|murid|santri|mahasiswa|mahasiswi|tamu|pemilik|penyewa|penghuni|peminjam|debitur|pelapor|terlapor|korban|pelaku|tersangka|terdakwa|saksi|kepala\s+keluarga|penggugat|tergugat|pemohon|termohon|pewaris|klien|konseli|tertanggung|penumpang|berinisial|inisial|istrinya|suaminya|anaknya|adiknya|kakaknya|ayahnya|ibunya|wakilnya|atasannya|temannya|tetangga|pacar|calon|bayi(?:[ \t]+(?:laki-laki|perempuan))?|balita|cucu(?:nya)?|keponakan(?:nya)?|anggota|member|warga|jamaah|jemaat|u\/|utk\.?|untuk|kepada|kpd\.?)[ \t]+/gi;
var LOOSE_ROLE = /^(?:customer|patient|driver|staff|staf|tamu|calon|pacar|korban|saksi|pelaku|tetangga|utk|untuk|kepada|kpd|anggota|member|warga|jamaah|jemaat)\b/i;
var GREETING_CUE = /(?:^|(?<=[\s,.!]))(?:halo|hallo|hai|hi|hello|hey|dear|selamat\s+(?:pagi|siang|sore|malam)|assalamu'?alaikum)[ \t]*,?[ \t]+|^[ \t]*(?:pagi|siang|sore|malam)[ \t]*,?[ \t]+/gim;
function isKnownName(bare) {
  return GIVEN_NAMES.has(bare) || AMBIGUOUS_GIVEN_NAMES.has(bare) || FAMILY_NAMES.has(bare) || SECOND_NAMES.has(bare);
}
var JAVANESE_NAME = /^[a-z]{2,}(?:wati|yati|iyati|ningsih|ningrum|astuti|tini|rini|yanto|yono|wanto|harjo)$/;
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
  for (const m of text.matchAll(TITLE_CUE))
    add(nameAt(text, m.index + m[0].length, "medium", true));
  for (const m of text.matchAll(ROLE_CUE)) {
    const found = nameAt(text, m.index + m[0].length, "medium", true);
    if (!found || /^[A-Z]{2,5}$/.test(found.value) && !/inisial/i.test(m[0]))
      continue;
    if (LOOSE_ROLE.test(m[0]) && !found.value.split(/\s+/).some((w) => isKnownName(w.toLowerCase())))
      continue;
    add(found);
  }
  for (const m of text.matchAll(GREETING_CUE)) {
    const found = nameAt(text, m.index + m[0].length, "medium", true);
    if (found && /^[ \t]*(?:[,!:\r\n]|\.(?!\S)|$)/.test(text.slice(found.end)))
      add(found);
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
var CHAT_SENDER = /^‎?\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?[ \t]+\d{1,2}[.:]\d{2}(?:[.:]\d{2})?(?:[ \t ]?[AP]M)?\]?(?:[ \t]+-)?[ \t]+([^:\n]{1,60}?):[ \t]/dgm;
var CHAT_TITLE = /^(?:Chat WhatsApp dengan|WhatsApp Chat with|Chat dengan|Riwayat chat dengan)[ \t]+([^\n]{1,60}?)[ \t]*$/dgim;
var NOT_A_PERSON = /\b(?:toko|shop|store|official|olshop|admin|cs|customer service|support|tim|team|pt|cv|ud|bot|system|sistem|info|layanan|grosir)\b|^(?:error|warn|warning|info|debug|trace|fatal|notice)$/i;
function detectChatSenders(text) {
  const out = [];
  for (const re of [CHAT_SENDER, CHAT_TITLE]) {
    for (const m of text.matchAll(re)) {
      const sender = m[1].replace(/^~\s*/, "").trim();
      if (!new RegExp("\\p{L}", "u").test(sender) || /^[+\d\s()-]+$/.test(sender) || NOT_A_PERSON.test(sender))
        continue;
      const start = m.indices[1][0] + m[1].indexOf(sender);
      out.push(match("NAME", start, sender, "high"));
    }
  }
  return out;
}
var PLACE_WORDS = new Set("jl jln jalan gg gang lorong komp komplek kompleks perum perumahan cluster universitas univ institut sekolah fakultas akademi politeknik kampus sd sdn smp smpn sma sman smk smkn mi mts ma pondok ponpes pesantren masjid musholla mushola langgar gereja pura vihara klenteng rs rsu rsud rsia rsj sakit puskesmas klinik apotek toko warung pt cv ud yayasan koperasi bank stasiun terminal bandara pelabuhan gedung wisma hotel mall plaza pasar taman museum stadion lapangan gor gelora kampung desa kelurahan kecamatan kabupaten kota provinsi gunung pantai pulau sungai danau monumen tugu bendungan rusun apartemen tower blok aula balai lembaga dinas kantor perpustakaan piala liga festival bung way tanjung teluk ujung muara kuala bukit lubuk pematang sei lumban lobu huta dolok bandar urung nagori talun pamah perkebunan sosor aek banjar pintu raja siraja debata kel kec kab kp ds dsn paket promo program diskon menu edisi spesial special event lomba produk varian".split(" "));
var PLACE_SUFFIX = new Set("jaya makmur raya selatan utara barat timur tengah permai asri sejahtera sentosa abadi mulya baru lama damai harapan mekar gemilang kencana rejo mukti karya bakti jitu pahlawan".split(" "));
var CAPITALIZED_RUN = /(?<![\w@.'’-])[A-Z][A-Za-z'’-]*\.?(?:[ \t]+(?:[A-Z][A-Za-z'’-]*\.?|bin|binti|van|der|de|al|el))+/g;
function detectKnownNames(text) {
  const out = [];
  for (const m of text.matchAll(CAPITALIZED_RUN)) {
    const words = [...m[0].matchAll(/\S+/g)].map((w) => ({
      start: m.index + w.index,
      end: m.index + w.index + w[0].replace(/[.,]+$/, "").length,
      word: w[0],
      bare: w[0].replace(/\.$/, "").toLowerCase()
    }));
    const prev = /([A-Za-z]+)\.?[ \t]*$/.exec(text.slice(Math.max(0, m.index - 30), m.index))?.[1]?.toLowerCase();
    if (prev && PLACE_WORDS.has(prev))
      continue;
    const nameish = (k) => {
      const w = words[k];
      if (!w)
        return false;
      if (NAME_PARTICLES.has(w.bare))
        return k + 1 < words.length;
      return /^[A-Z]/.test(w.word) && !NOT_NAME.has(w.bare) && !TITLE_WORDS.has(w.bare) && !ORGANIZATION.has(w.bare) && !PLACE_WORDS.has(w.bare) && !PLACE_SUFFIX.has(w.bare) && !w.bare.endsWith("nya");
    };
    const extend = (from) => {
      let k = from;
      while (k < words.length && k - from < 5 && nameish(k)) {
        k++;
        if (words[k - 1].word.endsWith(".") && words[k - 1].bare.length > 1)
          break;
      }
      while (k > from && NAME_PARTICLES.has(words[k - 1].bare))
        k--;
      return k - from;
    };
    for (let i = 0; i < words.length - 1; i++) {
      const w = words[i];
      if (PLACE_WORDS.has(w.bare) || ORGANIZATION.has(w.bare))
        break;
      const next = words[i + 1].bare;
      let len = 0;
      if ((w.word === "I" || w.word === "Ni") && BALINESE_NAMES.has(next))
        len = 1 + extend(i + 1);
      else if (!nameish(i))
        continue;
      else if (CHINESE_FAMILY_NAMES.has(w.bare) && [1, 2].every((d) => nameish(i + d) && /^[A-Za-z]{2,5}$/.test(words[i + d].word)))
        len = 3;
      else if (GIVEN_NAMES.has(w.bare) && nameish(i + 1))
        len = extend(i);
      else if (AMBIGUOUS_GIVEN_NAMES.has(w.bare) && nameish(i + 1) && (GIVEN_NAMES.has(next) || FAMILY_NAMES.has(next) || SECOND_NAMES.has(next))) {
        len = extend(i);
      } else {
        for (let j = i + 1; j <= i + 3 && nameish(j); j++) {
          if (!FAMILY_NAMES.has(words[j].bare)) {
            if (!isKnownName(words[j].bare))
              break;
            continue;
          }
          const lone = j === i + 1 && !FAMILY_NAMES.has(w.bare);
          if (lone || GIVEN_NAMES.has(w.bare) || AMBIGUOUS_GIVEN_NAMES.has(w.bare))
            len = Math.max(j - i + 1, extend(i));
          break;
        }
      }
      if (len < 2)
        continue;
      const last = words[i + len - 1];
      out.push(match("NAME", w.start, text.slice(w.start, last.end), "medium"));
      i += len - 1;
    }
  }
  return out;
}
var SIGN_OFF = /^[ \t]*(?:salam(?:\s+hangat)?|hormat\s+(?:saya|kami)|terima\s*kasih|makasih|regards|best\s+regards|kind\s+regards|warm\s+regards|best|thanks|thank\s+you|cheers|sincerely|yours\s+sincerely|wassalam(?:u'?alaikum)?)[ \t]*[,.!]?[ \t]*(?:\r?\n[ \t]*)+/gim;
function detectSignatures(text) {
  const out = [];
  for (const m of text.matchAll(SIGN_OFF)) {
    const start = m.index + m[0].length;
    const lineEnd = text.indexOf("\n", start);
    const line = text.slice(start, lineEnd === -1 ? text.length : lineEnd).replace(/\r$/, "").trim();
    const found = nameAt(text, start, "medium", true);
    if (found && found.value.length >= line.replace(/^(?:\w+\.\s*)+/, "").replace(/,.*$/, "").length - 1)
      out.push(found);
  }
  for (const m of text.matchAll(/(?:^|(?<=[.!?)"”]))[ \t]*[-–—~][ \t]*(?=[A-Z])/gm)) {
    const found = nameAt(text, m.index + m[0].length, "medium", true);
    if (!found || !found.value.split(/\s+/).some((w) => isKnownName(w.toLowerCase())))
      continue;
    if (/^[ \t]*(?:,|\r?\n|$)/.test(text.slice(found.end)))
      out.push(found);
  }
  return out;
}
function detectDisplayNames(text) {
  const out = [];
  const re = /(?:^|(?<=[\s:,;(]))"?((?:[A-Z][A-Za-z'’.-]*[ \t]+){0,4}[A-Z][A-Za-z'’.-]*)"?[ \t]*<[^<>\s@]+@[^<>\s]+>/gm;
  for (const m of text.matchAll(re)) {
    const group = m.index + m[0].indexOf(m[1]);
    const groupEnd = group + m[1].length;
    for (const w of m[1].matchAll(/\S+/g)) {
      const found = nameAt(text, group + w.index, "high", true);
      if (found && found.end >= groupEnd - 1) {
        out.push(found);
        break;
      }
    }
  }
  return out;
}
var CODE_AT = new Set("param params arg argument returns return type typedef template example deprecated see link throws throw default since version author license preserve todo fixme internal private public protected override readonly module namespace callback property prop event fires listens description summary inheritdoc abstract async media import keyframes supports layer tailwind apply use forward include mixin extend charset container page font-face component injectable input output test before after inject directive pipe ngmodule effect select staticmethod classmethod dataclass pytest app router api client mock patch fixture ts-ignore ts-expect-error jsx jsximportsource vite babel types entity column table get post put delete controller service observable satisfies overload implements augments class constructor enum function member memberof method name this constant const copyright exports external file fileoverview global ignore instance interface kind lends mixes package requires static tutorial yields alias generator beta alpha experimental remarks typeparam defaultvalue label linkcode linkplain virtual sealed decorator args options props context state value data".split(" "));
var HANDLE_CUE = /\b(?:ig|instagram|insta|tiktok|twitter|threads|telegram|tele|dm|akun|account|follow|mention|tag|username|handle|fb|facebook|line|youtube|yt)\b/;
function detectHandles(text) {
  const out = [];
  for (const m of text.matchAll(/(?<![^\s(,:;"'[])@([A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)(?![\w@/(-]|\.\w)/g)) {
    const handle = m[1];
    if (CODE_AT.has(handle.toLowerCase()) || CODE_AT.has(handle.split(".")[0].toLowerCase()) || /^\d+$/.test(handle))
      continue;
    if (/\.(?:com|net|org|id|io|co|dev|app|me)$/i.test(handle))
      continue;
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    const lead = text.slice(lineStart, m.index);
    if (/^\s*(?:\*|\/\/|#)/.test(lead))
      continue;
    if (!lead.trim() && !text.slice(m.index + m[0].length).split("\n", 1)[0].trim())
      continue;
    const shaped = /[\d._]/.test(handle) && handle.length >= 5 && /^[a-z0-9_.]+$/.test(handle);
    if (!shaped && !HANDLE_CUE.test(before(text, m.index, 40)))
      continue;
    out.push(match("NAME", m.index + 1, handle, "medium"));
  }
  return out;
}
var STACKED_TYPES = /* @__PURE__ */ new Set([
  "NAME",
  "NIK",
  "KK",
  "NPWP",
  "NIP",
  "SIM",
  "BPJS",
  "PHONE",
  "BANK_ACCOUNT",
  "EMAIL",
  "BIRTH_DATE",
  "RELIGION",
  "GENDER",
  "MARITAL_STATUS"
]);
var RELIGION_WORD = /^(?:islam|kristen(?:\s+protestan)?|protestan|katolik|katholik|hindu|buddha|budha|konghucu|khonghucu|kepercayaan.*)$/i;
var MARITAL_WORD = /^(?:kawin|belum\s+kawin|cerai\s+hidup|cerai\s+mati|menikah|belum\s+menikah|lajang|janda|duda|single|married|divorced|widowed)$/i;
function detectStackedLabels(text) {
  const out = [];
  const lines = [];
  for (let pos = 0; pos <= text.length; ) {
    let end = text.indexOf("\n", pos);
    if (end === -1)
      end = text.length;
    lines.push({ start: pos, text: text.slice(pos, end).replace(/\r$/, "") });
    pos = end + 1;
  }
  for (let i = 0; i + 1 < lines.length; i++) {
    const label = lines[i].text.trim();
    if (!label || label.length > 30 || /[:=]/.test(label) || label.split(/\s+/).length > 3)
      continue;
    const type = fieldType(label);
    if (!type || !STACKED_TYPES.has(type))
      continue;
    const next = lines[i + 1];
    const value = next.text.trim();
    if (!value || value.length > 60 || fieldType(value) || !isPlausibleValue(type, value, label))
      continue;
    if (type === "NAME" && !value.split(/\s+/).every((w) => /^[A-Z]/.test(w) && !NOT_NAME.has(w.toLowerCase())))
      continue;
    if (type === "RELIGION" && !RELIGION_WORD.test(value))
      continue;
    if (type === "MARITAL_STATUS" && !MARITAL_WORD.test(value))
      continue;
    out.push(match(type, next.start + next.text.indexOf(value), value, "medium"));
  }
  return out;
}
function detectColonlessLabels(text) {
  const out = [];
  const re = /^[ \t]*(Jenis[ \t]+Kelamin|Kelamin|Agama|Status[ \t]+Perkawinan|Status[ \t]+Kawin|Perkawinan)[ \t]+(?![:=])([A-Za-z][A-Za-z -]{1,24}?)(?=[ \t]*(?:\r?$|[ \t]{2,}|[ \t]+(?:Gol|Golongan|RT|RW)\b))/gim;
  for (const m of text.matchAll(re)) {
    const type = fieldType(m[1]);
    const value = m[2];
    if (type === "GENDER" && !GENDER_WORD_RE.test(value))
      continue;
    if (type === "RELIGION" && !RELIGION_WORD.test(value))
      continue;
    if (type === "MARITAL_STATUS" && !MARITAL_WORD.test(value))
      continue;
    if (type)
      out.push(match(type, m.index + m[0].length - value.length, value, "medium"));
  }
  return out;
}
var GENDER_WORD_RE = /^(?:laki-?\s?laki|lelaki|perempuan|pria|wanita)$/i;
function detectPhoneOwners(text) {
  const out = [];
  const re = /(?:\+62|0062|62|0)[ \t-]?8[\d \t.-]{7,16}\d[ \t]*\([ \t]*((?:(?:Pak|Bu|Bapak|Ibu|Mas|Mbak|Kak|Bang)[ \t]+)?[A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){0,2})[ \t]*\)/g;
  for (const m of text.matchAll(re)) {
    const name = m[1];
    const words = name.split(/[ \t]+/).map((w) => w.toLowerCase());
    if (words.some((w) => NOT_NAME.has(w) && !TITLE_WORDS.has(w)))
      continue;
    out.push(match("NAME", m.index + m[0].lastIndexOf(name), name, "medium"));
  }
  return out;
}
function detectLogUsers(text) {
  const out = [];
  for (const m of text.matchAll(/(?<![\w.-])(?:user|usr|login|uname)=(["']?)([A-Za-z][\w.-]{2,40})\1(?=[\s,;&]|$)/g)) {
    const user = m[2];
    if (!user.split(/[._-]+/).some((w) => isKnownName(w.toLowerCase().replace(/\d+$/, ""))))
      continue;
    out.push(match("NAME", m.index + m[0].length - user.length - m[1].length, user, "medium"));
  }
  return out;
}
function detectTimedSenders(text) {
  const out = [];
  for (const m of text.matchAll(/^\[\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:[ \t]?[AP]M)?\][ \t]+([A-Za-z][\w. -]{1,38}?):[ \t]/dgm)) {
    const sender = m[1];
    if (NOT_A_PERSON.test(sender))
      continue;
    const shaped = /^[a-z][a-z0-9]*[._][a-z0-9._]+$/.test(sender);
    if (!shaped && !sender.split(/[ ._-]+/).some((w) => isKnownName(w.toLowerCase())))
      continue;
    out.push(match("NAME", m.indices[1][0], sender, "medium"));
  }
  return out;
}
var decodeEntities = (s) => s.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
function detectHtml(text) {
  if (!/<(?:input|td|th)\b/i.test(text))
    return [];
  const out = [];
  for (const m of text.matchAll(/<input\b[^>]*>/gi)) {
    const name = /\b(?:name|id)\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1];
    const value = /\bvalue\s*=\s*(["'])([^"']*)\1/i.exec(m[0]);
    const type = name ? fieldType(name) : void 0;
    if (!type || !value || !isPlausibleValue(type, value[2], name))
      continue;
    out.push(match(type, m.index + value.index + value[0].indexOf(value[2], 1), value[2], "high"));
  }
  let columns;
  let headers = [];
  for (const row of text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells2 = [...row[1].matchAll(/<(t[hd])\b[^>]*>([^<]*)<\/t[hd]>/gi)].map((c) => ({
      header: c[1].toLowerCase() === "th",
      text: decodeEntities(c[2]).trim(),
      start: row.index + row[0].indexOf(row[1]) + c.index + c[0].indexOf(">") + 1,
      raw: c[2]
    }));
    if (!cells2.length)
      continue;
    const types = cells2.map((c) => c.text.length <= 40 ? fieldType(c.text) : void 0);
    if (cells2.length === 2 && types[0] && !types[1]) {
      const [label, cell] = cells2;
      if (cell.text && isPlausibleValue(types[0], cell.text, label.text)) {
        out.push(match(types[0], cell.start + cell.raw.indexOf(cell.text.slice(0, 1)), cell.raw.trim(), "high"));
      }
      continue;
    }
    if (cells2.every((c) => c.header) || !columns && types.some(Boolean) && cells2.every((c) => !/\d{3}/.test(c.text))) {
      columns = types;
      headers = cells2.map((c) => c.text);
      continue;
    }
    if (!columns)
      continue;
    cells2.forEach((c, i) => {
      const type = columns[i];
      if (!type || !c.text || !isPlausibleValue(type, c.text, headers[i]))
        return;
      out.push(match(type, c.start + c.raw.indexOf(c.raw.trim()), c.raw.trim(), isGenericNameKey(headers[i]) ? "medium" : "high"));
    });
  }
  return out;
}
var HL7_FIELDS = {
  PID: { 5: "NAME", 6: "NAME", 7: "BIRTH_DATE", 8: "GENDER", 11: "ADDRESS", 13: "PHONE", 14: "PHONE", 19: "NIK" },
  NK1: { 2: "NAME", 4: "ADDRESS", 5: "PHONE", 6: "PHONE" },
  DG1: { 3: "HEALTH", 4: "HEALTH" },
  IN1: { 16: "NAME" }
};
function detectHl7(text) {
  const out = [];
  for (const m of text.matchAll(/^(PID|NK1|DG1|IN1)\|[^\r\n]*/gm)) {
    const fields2 = HL7_FIELDS[m[1]];
    let pos = m.index;
    m[0].split("|").forEach((value, i) => {
      const type = fields2[i];
      if (type && value.replace(/[\^~&\s]/g, "")) {
        out.push(match(type, pos, value.replace(/[\^~]+$/, ""), "high"));
      }
      pos += value.length + 1;
    });
  }
  return out;
}
var CRIME = "[a-z]+(?:\\s+(?:online|anak|uang|dana|berat|ringan|narkotika|pidana))?";
var CRIMINAL = new RegExp(`\\b(?:mantan|eks|bekas)\\s+(?:napi|narapidana|tahanan|tapol|terpidana|residivis)(?:\\s+kasus\\s+${CRIME})?|\\bresidivis(?:\\s+kasus\\s+${CRIME})?|\\b(?:napi|narapidana|terpidana|tersangka|terdakwa|terjerat|tersandung|terlibat)\\s+kasus\\s+${CRIME}|\\bpernah\\s+(?:dipenjara|dibui|dipidana|ditahan|dihukum(?:\\s+penjara)?|masuk\\s+(?:penjara|bui|lapas|rutan)|ditangkap(?:\\s+polisi)?)(?:\\s+(?:selama\\s+)?\\d+\\s+(?:tahun|bulan))?(?:\\s+(?:karena\\s+|atas\\s+)?kasus\\s+${CRIME})?|\\bdivonis\\s+\\d+\\s+(?:tahun|bulan)(?:\\s+penjara)?|\\bcatatan\\s+(?:(?:kriminal|kepolisian|pidana)\\s+)?kasus\\s+${CRIME}|\\b(?:masuk|dimasukkan\\s+ke|tercantum\\s+di)\\s+(?:dalam\\s+)?daftar\\s+(?:cekal|pencegahan|penangkalan|hitam\\s+imigrasi|pencarian\\s+orang|dpo|buronan)|\\b(?:dicekal|berstatus\\s+(?:dpo|buron(?:an)?)|masuk\\s+dpo|jadi\\s+(?:dpo|buron(?:an)?))\\b|\\b(?:keluar|bebas)\\s+(?:dari\\s+)?(?:lapas|lp|penjara|bui|rutan|tahanan)\\b|\\bkasusnya\\s+${CRIME}`, "gi");
function detectCriminal(text) {
  return [...text.matchAll(CRIMINAL)].map((m) => match("CRIMINAL_RECORD", m.index, m[0], "medium"));
}
function detectGluedIds(text) {
  const out = [];
  for (const m of text.matchAll(/(?<=[A-Za-z_])\d{16}(?![\dA-Za-z])/g)) {
    const prefix = /[A-Za-z_]+$/.exec(text.slice(Math.max(0, m.index - 20), m.index))[0];
    const head = text[m.index - prefix.length - 1];
    if (head !== void 0 && /\d/.test(head) || prefix.replace(/_/g, "").length < 2 && !prefix.includes("_"))
      continue;
    if (parseNik(m[0]).valid)
      out.push(match("NIK", m.index, m[0], "high"));
  }
  for (const m of text.matchAll(/(?<=[A-Za-z])(?:\+?62|0)8\d{8,11}(?!\d)/g)) {
    const label = /[A-Za-z.]+$/.exec(text.slice(Math.max(0, m.index - 12), m.index))[0].toLowerCase();
    if (PHONE_LABELS.has(label) && parsePhone(m[0]).valid)
      out.push(match("PHONE", m.index, m[0], "high"));
  }
  return out;
}
var DIGIT_WORD = "(?:nol|kosong|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan)";
function detectSpokenPhones(text) {
  const re = new RegExp(`\\b(?:nol|kosong)[\\s,.-]+delapan(?:[\\s,.-]+${DIGIT_WORD}){8,11}\\b`, "gi");
  return [...text.matchAll(re)].map((m) => match("PHONE", m.index, m[0], "medium"));
}
function detectLoneGivenNames(text) {
  const out = [];
  for (const m of text.matchAll(/(?<![\w@.'’-])[A-Z][a-z]{2,14}(?![\w'’-]|\.\w|[ \t]+[A-Z])/g)) {
    const bare = m[0].toLowerCase();
    if (!GIVEN_NAMES.has(bare) && !JAVANESE_NAME.test(bare))
      continue;
    const lead = text.slice(Math.max(0, m.index - 30), m.index);
    if (!/(?:(?<![A-Za-z])[a-z]+|,)[ \t]+$/.test(lead))
      continue;
    const prev = /([A-Za-z]+)[ \t]+$/.exec(lead)?.[1]?.toLowerCase();
    if (prev && (PLACE_WORDS.has(prev) || ORGANIZATION.has(prev) || /^(?:di|daerah|arah|wilayah|kawasan|menuju|sekitar)$/.test(prev)))
      continue;
    out.push(match("NAME", m.index, m[0], "medium"));
  }
  return out;
}
var NOT_AN_AGE = new Set("pasal ayat bab bagian lampiran gambar tabel grafik nomor no langkah tahap poin butir huruf angka versi kelas ruang lantai gate pintu loket jalur map set array object date number string buffer promise error symbol".split(" "));
var ROLE_AT_START = new RegExp(`^(?:${ROLE_CUE.source.replace(/^\\b/, "")})`, "i");
function detectNamesWithAge(text) {
  const out = [];
  const re = /(?<![\w@.'’-])([A-Z][a-z'’-]+(?:[ \t]+(?:[A-Z][a-z'’-]+|bin|binti)){0,3})[ \t]+\([ \t]*\d{1,2}[ \t]*(?:th|thn|tahun|thn\.|th\.)?[ \t]*\)/g;
  for (const m of text.matchAll(re)) {
    const role = ROLE_AT_START.exec(m[1])?.[0] ?? "";
    const name = m[1].slice(role.length);
    const words = name.split(/[ \t]+/).map((w) => w.toLowerCase());
    if (!name || words.some((w) => NOT_NAME.has(w) || NOT_AN_AGE.has(w) || TITLE_WORDS.has(w) || PLACE_WORDS.has(w)))
      continue;
    out.push(match("NAME", m.index + role.length, name, "medium"));
  }
  return out;
}
function detectAttendance(text) {
  const out = [];
  const re = /(?<![\w@.'’-])([A-Z][a-z'’-]+(?:[ \t]+[A-Z][a-z'’-]+){0,3})[ \t]+\((?:sakit|izin|ijin|alpa|alpha|absen|cuti|dinas(?:[ \t]+luar)?|terlambat|telat|hadir|wfh|wfo|istri|suami|ayah|ibu|bapak|anak|kakak|adik|ortu|orang[ \t]+tua|wali|saudara|keluarga|teman|wife|husband|mother|father)\)/g;
  for (const m of text.matchAll(re)) {
    if (m[1].split(/[ \t]+/).some((w) => NOT_NAME.has(w.toLowerCase()) || TITLE_WORDS.has(w.toLowerCase())))
      continue;
    out.push(match("NAME", m.index, m[1], "medium"));
  }
  return out;
}
function detectSentenceSubjects(text) {
  const out = [];
  const re = /(?:^|(?<=[.!?]\s)|(?<=\n))[ \t]*([A-Z][a-z]{2,14})(?=[ \t]+(?:masih|sudah|udah|belum|lagi|sedang|bilang|minta|punya|mau|tidak|nggak|gak|ga|pernah|sakit|kerja|tinggal|baru|katanya|pinjam|hutang|utang|janji|nanya|nelpon|telat|izin|cuti|dirawat|meninggal)\b)/gm;
  for (const m of text.matchAll(re)) {
    const bare = m[1].toLowerCase();
    if (!GIVEN_NAMES.has(bare) && !JAVANESE_NAME.test(bare))
      continue;
    out.push(match("NAME", m.index + m[0].length - m[1].length, m[1], "medium"));
  }
  return out;
}
function detectNamePairs(text) {
  const out = [];
  for (const m of text.matchAll(/(?<![\w@.'’-])([A-Z][a-z]{2,14})[ \t]*(?:&|dan)[ \t]*([A-Z][a-z]{2,14})(?![\w'’-]|[ \t]+[A-Z])/g)) {
    const [a, b] = [m[1], m[2]];
    const ok = (w) => !NOT_NAME.has(w.toLowerCase()) && !PLACE_WORDS.has(w.toLowerCase()) && !TITLE_WORDS.has(w.toLowerCase());
    if (!ok(a) || !ok(b))
      continue;
    if (GIVEN_NAMES.has(a.toLowerCase()))
      out.push(match("NAME", m.index + m[0].lastIndexOf(b), b, "medium"));
    if (GIVEN_NAMES.has(b.toLowerCase()))
      out.push(match("NAME", m.index, a, "medium"));
  }
  return out;
}
function detectBracketHandles(text) {
  const out = [];
  for (const m of text.matchAll(/\(([a-z][a-z0-9]*(?:[._][a-z0-9]+)+)\)/g)) {
    if (!m[1].split(/[._]/).some((w) => GIVEN_NAMES.has(w.replace(/\d+$/, "")) || FAMILY_NAMES.has(w.replace(/\d+$/, ""))))
      continue;
    out.push(match("NAME", m.index + 1, m[1], "medium"));
  }
  return out;
}
function detectCardCodes(text) {
  const re = /\b(?:cvv2?|cvc2?|cid|kode\s+keamanan)\b[ \t]*[:=]?[ \t]*(\d{3,4})(?!\d)/gi;
  return [...text.matchAll(re)].map((m) => match("CARD", m.index + m[0].length - m[1].length, m[1], "high"));
}
var DIGITS_AT = /\d+/y;
var THING_TABLE = /produk|product|barang|item|sku|kategori|categor|menu|toko|store|shop|merchant|brand|merek|layanan|service|paket|package|kota|city|provinsi|province|wilayah|region|kecamatan|kelurahan|desa|district|bank|kurir|courier|ekspedisi|tag|role|permission|setting|config|status|metode|method/i;
var COLUMN_QUOTES = /^[`"[]|[`"\]]$/g;
var COLUMN_NAME = /^(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|[\w$]+)/;
var NOT_A_COLUMN = /^(?:PRIMARY|KEY|UNIQUE|CONSTRAINT|INDEX|FOREIGN|CHECK|FULLTEXT|SPATIAL|EXCLUDE|LIKE|PERIOD)\b/i;
var CREATE_TABLE = /\bCREATE\s+(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\w.]+)\s*\(/gi;
var INSERT_COLUMNS = /\b(?:INSERT|REPLACE)\s+(?:IGNORE\s+)?INTO\s+([`"\w.]+)\s*\(([^)]{1,2000})\)\s*VALUES\s*/gi;
var INSERT_VALUES = /\b(?:INSERT|REPLACE)\s+(?:IGNORE\s+)?INTO\s+([`"\w.]+)\s+VALUES\s*/gi;
var COPY_FROM_STDIN = /^COPY\s+([`"\w.]+)\s*\(([^)]{1,2000})\)\s+FROM\s+stdin;\r?\n/gim;
function tableKey(name) {
  return name.replace(/[`"]/g, "").split(".").pop().toLowerCase();
}
function columnTypes(table, columns) {
  const thingTable = THING_TABLE.test(table);
  return columns.map((c) => thingTable && /^(?:nama|name|title|judul)$/i.test(c) ? void 0 : fieldType(c));
}
function createdTables(text) {
  const tables = /* @__PURE__ */ new Map();
  for (const m of text.matchAll(CREATE_TABLE)) {
    const columns = [];
    let depth = 1;
    let from = m.index + m[0].length;
    const limit = Math.min(text.length, from + 1e5);
    const take = (to) => {
      const item = text.slice(from, to).trim();
      const name = COLUMN_NAME.exec(item);
      if (name && !NOT_A_COLUMN.test(item))
        columns.push(name[0].replace(COLUMN_QUOTES, ""));
    };
    for (let i = from; i < limit && depth > 0; i++) {
      const ch = text[i];
      if (ch === "'") {
        let j = i + 1;
        while (j < limit && !(text[j] === "'" && text[j + 1] !== "'"))
          j += text[j] === "'" || text[j] === "\\" ? 2 : 1;
        i = j;
      } else if (ch === "(")
        depth++;
      else if (ch === ")") {
        if (--depth === 0)
          take(i);
      } else if (ch === "," && depth === 1) {
        take(i);
        from = i + 1;
      }
    }
    if (depth === 0)
      tables.set(tableKey(m[1]), columns);
  }
  return tables;
}
function sqlValues(text, i, types, columns, out) {
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
      DIGITS_AT.lastIndex = i;
      const num = DIGITS_AT.exec(text)[0];
      const type = types[col];
      if (type && isPlausibleValue(type, num, columns[col]))
        out.push(match(type, i, num, "high"));
      i += num.length;
      continue;
    }
    i++;
  }
}
function detectSqlInserts(text) {
  if (!/\b(?:INTO|COPY)\b/i.test(text))
    return [];
  const out = [];
  for (const m of text.matchAll(INSERT_COLUMNS)) {
    const columns = m[2].split(",").map((c) => c.trim().replace(COLUMN_QUOTES, ""));
    const types = columnTypes(m[1], columns);
    if (types.some(Boolean))
      sqlValues(text, m.index + m[0].length, types, columns, out);
  }
  let tables;
  for (const m of text.matchAll(INSERT_VALUES)) {
    tables ??= createdTables(text);
    const columns = tables.get(tableKey(m[1]));
    if (!columns)
      continue;
    const types = columnTypes(m[1], columns);
    if (types.some(Boolean))
      sqlValues(text, m.index + m[0].length, types, columns, out);
  }
  for (const m of text.matchAll(COPY_FROM_STDIN)) {
    const columns = m[2].split(",").map((c) => c.trim().replace(COLUMN_QUOTES, ""));
    const types = columnTypes(m[1], columns);
    if (!types.some(Boolean))
      continue;
    let pos = m.index + m[0].length;
    while (pos < text.length) {
      let end = text.indexOf("\n", pos);
      if (end === -1)
        end = text.length;
      const line = text.slice(pos, end > pos && text[end - 1] === "\r" ? end - 1 : end);
      if (line === "\\.")
        break;
      let at = pos;
      line.split("	").forEach((cell, idx) => {
        const type = types[idx];
        if (type && cell !== "\\N" && isPlausibleValue(type, cell, columns[idx]))
          out.push(match(type, at, cell, "high"));
        at += cell.length + 1;
      });
      pos = end + 1;
    }
  }
  return out;
}
var STREET = "Jl|Jln|Jalan|Gg|Gang|Komp|Kompl|Komplek|Kompleks|Perum|Perumahan|Cluster|Klaster|Apartemen|Apartment|Apt|Rusun|Rusunawa|Tower|Ruko|Wisma|Asrama|Dusun|Dsn|Dukuh|Kampung|Kp|Lingkungan|Ling";
var PIN = "[Nn][Oo]|[Nn]omor|[Bb]lok|[Kk]av|[Uu]nit|[Ll]t|[Ll]antai|[Kk]amar|[Kk]mr|NO|BLOK";
var RT_RW = "RT\\.?\\s*0*\\d{1,3}\\s*[/,]?\\s*RW\\.?\\s*0*\\d{1,3}";
function detectStreetAddresses(text) {
  const out = [];
  const street = new RegExp(`\\b(?:${STREET})\\.?\\s+[A-Za-z0-9][^\\n;]{1,80}?(?:\\b(?:${PIN})\\.?\\s*[A-Za-z]?\\d+[A-Za-z]?(?:\\/\\d+)?(?:,?\\s*(?:${PIN})\\.?\\s*[A-Za-z]?\\d+[A-Za-z]?(?:\\/\\d+)?)*(?:,?\\s*${RT_RW})?|\\b${RT_RW})`, "g");
  for (const m of text.matchAll(street))
    out.push(match("ADDRESS", m.index, m[0], "high"));
  const lower = /\b(?:perum|perumahan|komplek|kompleks|komp|cluster|klaster|apartemen|apt|rusun|asrama|jl|jln|gg|gang)\.?\s+[a-z0-9][^\n;]{1,60}?\b(?:no|nomor|blok|kav|unit)\.?\s*[a-z]?\d+[a-z]?(?:\/\d+)?(?:,?\s*(?:no|nomor|blok|kav|unit)\.?\s*[a-z]?\d+[a-z]?)*/g;
  for (const m of text.matchAll(lower))
    out.push(match("ADDRESS", m.index, m[0], "medium"));
  for (const m of text.matchAll(new RegExp(`\\b${RT_RW}\\b`, "gi")))
    out.push(match("ADDRESS", m.index, m[0], "medium"));
  const bare = /\b(?:[Jj]ln?|[Gg]g)\.?\s+[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,3}?\s+\d{1,4}[A-Za-z]?\b(?!\s*(?:jam|menit|detik|km|meter|m\b|kali|hari|minggu|bulan|tahun|orang|lantai|lajur|jalur|%|x\b))/g;
  for (const m of text.matchAll(bare))
    out.push(match("ADDRESS", m.index, m[0], "medium"));
  return out;
}
var NAME_STOP = /\s(?:dan|dengan|yang|nik|hp|no|nomor|umur|usia|alamat|email|tinggal|lahir|asal|dari|di|ke|untuk|sebagai|mau|ingin|minta|tolong|saya|aku|gue|gua|gw|mohon|terima|makasih|thanks|thank|thx|tks|trims|bisa|boleh|apakah|kapan|berapa|gimana|bagaimana|kenapa|mengapa|tanya|nanya|sudah|udah|sdh|belum|blm|akan|sedang)\b/i;
var NAME_STOP_CHAT = /\s(?:ya|yah|yaa|iya|kak|kakak|gan|sis|min|pak|bu|dong|deh|sih|kok|nih|aja|saja|juga|lho|loh|ok|oke|okay|lagi|baru|tadi|kemarin|kemaren|besok|nanti|sekarang)\b/;
var NAME_END = /[!?\u2190-\u2bff\ud800-\udfff\ufe0f]/;
var MULTI_PART = /* @__PURE__ */ new Set(["ADDRESS", "BIRTH_DATE", "HEALTH", "GEO"]);
function takeWords(s, n) {
  return s.split(/(\s+)/).slice(0, Math.max(0, 2 * n - 1)).join("");
}
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
      v = takeWords(head, cut);
    }
  }
  if (type === "HEALTH") {
    const end = v.search(/\.\s+[A-Z]/);
    if (end >= 0)
      v = v.slice(0, end);
  }
  if (MULTI_PART.has(type)) {
    for (const m of v.matchAll(/([A-Za-z]*)\.\s+/g)) {
      if (m[1].length < 4)
        continue;
      const lead = v.slice(m.index + m[0].length).split(/\s+/).slice(0, 3);
      if (lead.some((_, i) => fieldType(lead.slice(0, i + 1).join(" ")))) {
        v = v.slice(0, m.index + m[1].length);
        break;
      }
    }
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
    for (const re of [NAME_END, NAME_STOP, NAME_STOP_CHAT]) {
      const stop = v.search(re);
      if (stop >= 0)
        v = v.slice(0, stop);
    }
    const digit = v.replace(/%[0-9A-Fa-f]{2}/g, "%xx").search(/\d/);
    if (digit >= 0)
      v = v.slice(0, digit);
    v = takeWords(v, 5);
  }
  if (NUMBER_TYPES.has(type)) {
    const digits = /^[+(]?\d[\d \t.\-/()]*\d\)?/.exec(v.trim());
    if (digits)
      return digits[0].trim();
  }
  return v.replace(/[\s.,}\]]+$/, "").trim();
}
var NUMBER_TYPES = /* @__PURE__ */ new Set(["NIK", "KK", "NPWP", "NIP", "SIM", "BPJS", "NISN", "PHONE", "BANK_ACCOUNT", "CARD"]);
var isQuote = (c) => c === '"' || c === "'" || c === "`";
var isLabelChar = (c) => c !== void 0 && /[A-Za-z0-9_./-]/.test(c);
var isLetter = (c) => c !== void 0 && /[A-Za-z]/.test(c);
var isJsSpace = (c) => c !== void 0 && /\s/.test(c);
function labelBefore(text, lineStart, end) {
  while (end > lineStart && isJsSpace(text[end - 1]))
    end--;
  let pos = end;
  let start = -1;
  for (let words = 0; words < 5; words++) {
    let p = pos;
    if (p > lineStart && isQuote(text[p - 1]))
      p--;
    const runEnd = p;
    while (p > lineStart && isLabelChar(text[p - 1]))
      p--;
    let first = p;
    while (first < runEnd && !isLetter(text[first]))
      first++;
    if (first >= runEnd)
      break;
    start = first === p && p > lineStart && isQuote(text[p - 1]) ? p - 1 : first;
    if (first !== p)
      break;
    let q = start;
    while (q > lineStart && (text[q - 1] === " " || text[q - 1] === "	"))
      q--;
    if (q === start)
      break;
    pos = q;
  }
  return start < 0 ? void 0 : text.slice(start, end);
}
function valueExtent(text, start, end) {
  const endsValue = (i) => text[i] === ":" && !(text[i + 1] === "/" && text[i + 2] === "/");
  const colonsCut = !endsValue(start);
  for (let i = start; i < end; i++) {
    const c = text[i];
    if (c === ";" || c === "|" || c === "&")
      return i;
    if (colonsCut && endsValue(i))
      return Math.min(end, i + 3);
  }
  return end;
}
function closingQuote(text, start, end) {
  for (let i = start; i < end; i++) {
    if (text[i] !== '"' || text[i - 1] === "\\")
      continue;
    let j = i + 1;
    while (j < end && (text[j] === " " || text[j] === "	"))
      j++;
    if (j >= end || text[j] === "," || text[j] === "}" || text[j] === "]")
      return i;
  }
  return end;
}
function detectLabeledFields(text) {
  const out = [];
  let lineStart = 0;
  let lineEnd = text.indexOf("\n");
  if (lineEnd === -1)
    lineEnd = text.length;
  for (const m of text.matchAll(/[ \t]*(?::(?![:\/])|=>|=(?![=>]))[ \t]*/g)) {
    if (m[0].includes("=>") && !isQuote(text[m.index - 1]))
      continue;
    while (m.index > lineEnd) {
      lineStart = lineEnd + 1;
      lineEnd = text.indexOf("\n", lineStart);
      if (lineEnd === -1)
        lineEnd = text.length;
    }
    const label = labelBefore(text, lineStart, m.index);
    if (!label)
      continue;
    const words = label.trim().split(/[ \t]+/);
    let type;
    let key = "";
    for (let i = 0; i < words.length && !type; i++) {
      key = words.slice(i).join(" ");
      type = fieldType(key);
    }
    if (!type)
      continue;
    const valueStart = m.index + m[0].length;
    const rawEnd = lineEnd > valueStart && text[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd;
    let value;
    let start = valueStart;
    const quote = text[valueStart];
    if (valueStart < rawEnd && isQuote(quote)) {
      let close = valueStart + 1;
      while (close < rawEnd && (text[close] !== quote || text[close - 1] === "\\"))
        close++;
      if (close >= rawEnd)
        continue;
      value = text.slice(valueStart + 1, close);
      if (/^\s/.test(value))
        continue;
      start += 1;
    } else {
      const end = closingQuote(text, valueStart, rawEnd);
      const raw = text.slice(valueStart, valueExtent(text, valueStart, end));
      value = cutValue(type, raw);
      if (value)
        start += raw.indexOf(value);
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
var NUMBERED_LINE = /^ *(\d{1,7})(?:\t|\u2192)/;
var NUMBERED_LINES = /^ *\d{1,7}(?:\t|\u2192)/gm;
function blankLineNumbers(text) {
  const first = NUMBERED_LINE.exec(text);
  const breakAt = text.indexOf("\n");
  const second = breakAt >= 0 ? NUMBERED_LINE.exec(text.slice(breakAt + 1)) : null;
  if (!first || !second || Number(second[1]) !== Number(first[1]) + 1)
    return text;
  return text.replace(NUMBERED_LINES, (prefix) => " ".repeat(prefix.length));
}
var CSV_HEADER_LINES = 20;
function detectCsvColumns(text) {
  text = blankLineNumbers(text);
  const table = csvTableAt(text, 0, true);
  if (table)
    return table;
  let lineStart = 0;
  for (let n = 1; n < CSV_HEADER_LINES; n++) {
    const lineBreak = text.indexOf("\n", lineStart);
    if (lineBreak === -1)
      break;
    lineStart = lineBreak + 1;
    const later = csvTableAt(text, lineStart, false);
    if (later)
      return later;
  }
  return [];
}
var CSV_HEADER_PREFIX = /^[^,;|\t:]{1,60}:[ \t]+/;
function csvTableAt(text, at, toEnd, header) {
  const firstBreak = text.indexOf("\n", at);
  if (firstBreak === -1)
    return void 0;
  if (header === void 0) {
    const line = text.slice(at, firstBreak).replace(/\r$/, "");
    const prefix = CSV_HEADER_PREFIX.exec(line);
    return prefix && csvTableAt(text, at, false, line.slice(prefix[0].length)) || csvTableAt(text, at, toEnd, line);
  }
  const delimiter = [",", ";", "	", "|"].find((d) => header.includes(d));
  if (!delimiter || !toEnd && delimiter === "	")
    return void 0;
  const headerFields = csvFields(header, delimiter).map((f) => header.slice(f.start, f.end).trim());
  const secondLine = text.slice(firstBreak + 1).split("\n", 1)[0].replace(/\r$/, "");
  if (headerFields.length < 2 || headerFields.some((h) => h.length > 40 || /[.!?]$/.test(h)) || csvFields(secondLine, delimiter).length !== headerFields.length || // In the middle of a text, a header is labels only: not a data row such as "n01687978<TAB>agama".
  !toEnd && headerFields.some((h) => !/[A-Za-z]/.test(h) || /\d{3}/.test(h))) {
    return void 0;
  }
  const columns = headerFields.map((h) => fieldType(h));
  if (!columns.some(Boolean))
    return void 0;
  const second = csvFields(secondLine, delimiter);
  if (columns.some((t, i) => t && fieldType(secondLine.slice(second[i].start, second[i].end).trim())))
    return void 0;
  const out = [];
  let offset = firstBreak + 1;
  for (const rawLine of text.slice(offset).split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const fields2 = csvFields(line, delimiter);
    if (!toEnd && fields2.length !== headerFields.length)
      break;
    fields2.forEach((f, idx) => {
      const type = columns[idx];
      const cell = line.slice(f.start, f.end);
      const value = cell.trim();
      if (!type || !isPlausibleValue(type, value, headerFields[idx]))
        return;
      if (!toEnd && NUMBER_TYPES.has(type) && !/^[+\d\s().\/-]+$/.test(value))
        return;
      const start = offset + f.start + cell.indexOf(value);
      out.push(match(type, start, value, isGenericNameKey(headerFields[idx]) ? "medium" : "high"));
    });
    offset += rawLine.length + 1;
  }
  return out;
}
function detectTabTables(text) {
  if (!text.includes("	"))
    return [];
  text = blankLineNumbers(text);
  const out = [];
  let header;
  let columns = [];
  let pos = 0;
  while (pos <= text.length) {
    let end = text.indexOf("\n", pos);
    if (end === -1)
      end = text.length;
    const line = text.slice(pos, end > pos && text[end - 1] === "\r" ? end - 1 : end);
    const cells2 = [];
    if (line.includes("	")) {
      let at = 0;
      for (const part of line.split("	")) {
        const value = part.trim();
        cells2.push({ start: pos + at + (value ? part.indexOf(value) : 0), value });
        at += part.length + 1;
      }
    }
    const filled = cells2.filter((c) => c.value);
    if (header && filled.length >= 2 && cells2.length <= header.length) {
      cells2.forEach((c, i) => {
        const type = columns[i];
        if (!type || !c.value || !isPlausibleValue(type, c.value, header[i]))
          return;
        out.push(match(type, c.start, c.value, isGenericNameKey(header[i]) ? "medium" : "high"));
      });
    } else {
      header = void 0;
      const types = cells2.map((c) => c.value ? fieldType(c.value) : void 0);
      const [label, value] = filled;
      if (filled.length === 2 && /^[A-Z]/.test(label.value) && fieldType(label.value) && !fieldType(value.value)) {
        const type = fieldType(label.value);
        if (!/^[:=]/.test(value.value) && isPlausibleValue(type, value.value, label.value)) {
          out.push(match(type, value.start, value.value, isGenericNameKey(label.value) ? "medium" : "high"));
        }
      } else if (filled.length >= 2 && filled.every((c) => c.value.length <= 40 && /[A-Za-z]/.test(c.value) && !/[.!?]$|\d{3}/.test(c.value)) && // Data files have tabs too ("n01687978<TAB>agama"): a document table's header is capitalized, or names two fields.
      (types.filter(Boolean).length >= 2 || types.some(Boolean) && filled.every((c) => /^[A-Z]/.test(c.value)))) {
        header = cells2.map((c) => c.value);
        columns = types;
      }
    }
    pos = end + 1;
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
  detectMaritalStatus,
  detectPlates,
  detectNames,
  detectChatSenders,
  detectKnownNames,
  detectSignatures,
  detectDisplayNames,
  detectHandles,
  detectStackedLabels,
  detectColonlessLabels,
  detectPhoneOwners,
  detectTimedSenders,
  detectLogUsers,
  detectHtml,
  detectHl7,
  detectAkta,
  detectCriminal,
  detectGluedIds,
  detectCardCodes,
  detectSpokenPhones,
  detectLoneGivenNames,
  detectNamesWithAge,
  detectNamePairs,
  detectAttendance,
  detectSentenceSubjects,
  detectBracketHandles,
  detectSqlInserts,
  detectStreetAddresses,
  detectLabeledFields,
  detectCsvColumns,
  detectTabTables
];
var JSON_STRING = /"((?:[^"\\]|\\[\s\S])*)"/g;
var UNESCAPED = { n: "\n", r: "\r", t: "	", b: "\b", f: "\f" };
var JSON_BODY = /^[ \t\r\n]*[{[]/;
function worthUnescaping(body) {
  if (!body.includes('\\"'))
    return false;
  return JSON_BODY.test(body) || body.includes("\\n") && /[,;|]/.test(body);
}
function detectEscapedStrings(text) {
  if (!text.includes("\\"))
    return [];
  const out = [];
  let joined = "";
  let joinedAt = [];
  let joinedPart = [];
  let part = 0;
  const flush = () => {
    if (!joined)
      return;
    joinedAt.push(joinedAt.at(-1));
    joinedPart.push(-1);
    for (const f of [...DETECTORS.flatMap((d) => d(joined)), ...detectEscapedStrings(joined)]) {
      if (joinedPart[f.start] !== joinedPart[f.end - 1])
        continue;
      const start = joinedAt[f.start];
      const end = joinedAt[f.end];
      out.push({ ...f, start, end, value: text.slice(start, end) });
    }
    joined = "";
    joinedAt = [];
    joinedPart = [];
  };
  for (const m of text.matchAll(JSON_STRING)) {
    const body = m[1];
    if (!worthUnescaping(body))
      continue;
    const json = JSON_BODY.test(body);
    if (!json)
      flush();
    if (joined) {
      joined += "\n\n";
      joinedAt.push(joinedAt.at(-1), joinedAt.at(-1));
      joinedPart.push(-1, -1);
    }
    const base = m.index + 1;
    part++;
    for (let i = 0; i < body.length; ) {
      joinedAt.push(base + i);
      joinedPart.push(part);
      if (body[i] !== "\\") {
        joined += body[i++];
      } else if (body[i + 1] === "u" && /^[0-9a-fA-F]{4}$/.test(body.slice(i + 2, i + 6))) {
        joined += String.fromCharCode(parseInt(body.slice(i + 2, i + 6), 16));
        i += 6;
      } else {
        const e = body[i + 1] ?? "";
        joined += UNESCAPED[e] ?? e;
        i += 2;
      }
    }
    joinedAt.push(base + body.length);
    joinedPart.push(part);
    joined += " ";
    if (!json)
      flush();
  }
  flush();
  return out;
}
var ESCAPED_BREAK = /\\+[nrt]/g;
var BREAK_FOR = { n: "\n", r: "\r", t: "	" };
function escapesAsBreaks(text) {
  if (!text.includes("\\"))
    return text;
  return text.replace(ESCAPED_BREAK, (e) => " ".repeat(e.length - 1) + BREAK_FOR[e[e.length - 1]]);
}
function detectPii(text, options = {}) {
  for (const t of [...options.types ?? [], ...options.exclude ?? []]) {
    if (!PII_TYPES.includes(t))
      throw new RangeError(`Unknown PII type "${t}". Valid types: ${PII_TYPES.join(", ")}`);
  }
  const types = new Set(options.types ?? PII_TYPES);
  for (const t of options.exclude ?? [])
    types.delete(t);
  const minRank = options.minConfidence === "high" ? 2 : 1;
  const rank = (m) => m.confidence === "high" ? 2 : 1;
  if (options.custom?.length)
    checkCustomRules(options.custom);
  const view = escapesAsBreaks(text);
  const found = [...DETECTORS.flatMap((d) => d(view)), ...detectEscapedStrings(text)];
  if (options.custom?.length)
    found.push(...detectCustom(view, options.custom));
  const candidates = found.filter((m) => m.end > m.start && types.has(m.type) && rank(m) >= minRank);
  const own = (m) => m.type === "CUSTOM" ? 1 : 0;
  candidates.sort((a, b) => rank(b) - rank(a) || b.end - b.start - (a.end - a.start) || own(b) - own(a) || a.start - b.start);
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
  accepted.sort((a, b) => a.start - b.start);
  return accepted.flatMap((m) => {
    let end = m.end;
    for (; ; ) {
      if (end > m.start && view[end - 1] !== text[end - 1])
        end--;
      else if (end > m.start && text[end - 1] === "\\")
        end--;
      else if (end - 1 > m.start && text[end - 1] === '"' && text[end - 2] === "\\")
        end -= 2;
      else
        break;
    }
    if (end === m.end)
      return [m];
    return end > m.start ? [{ ...m, end, value: text.slice(m.start, end) }] : [];
  });
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
    case "NISN":
    case "AKTA":
      return `${stars(digits.length - 3)}${digits.slice(-3)}`;
    case "PASSPORT":
      return `${[...value][0] ?? ""}${stars(5)}${value.slice(-2)}`;
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
      return `${[...user][0] ?? ""}${stars(3)}@${domain}`;
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
      return value.split(/\s+/).map((w) => `${[...w][0] ?? ""}${stars(3)}`).join(" ");
    case "ADDRESS":
      return `${value.split(/\s+/)[0]} ${stars(3)}`;
    case "CUSTOM":
      return `${stars(value.length - 2)}${value.length > 6 ? value.slice(-2) : ""}`;
  }
}

// packages/mcp/src/files.ts
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";

// packages/mcp/src/xlsx.ts
import { inflateRawSync } from "node:zlib";
var MAX_ENTRY_BYTES = 256 * 1024 * 1024;
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
  const corrupt = () => new Error("Corrupt ZIP central directory.");
  const u16 = (at) => {
    if (at < 0 || at + 2 > buf.length) throw corrupt();
    return buf.readUInt16LE(at);
  };
  const u32 = (at) => {
    if (at < 0 || at + 4 > buf.length) throw corrupt();
    return buf.readUInt32LE(at);
  };
  const entries = u16(eocd + 10);
  let p = u32(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (u32(p) !== 33639248) throw corrupt();
    const method = u16(p + 10);
    const compressed = u32(p + 20);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    const local = u32(p + 42);
    const name = buf.toString("utf8", p + 46, Math.min(buf.length, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const dataStart = local + 30 + u16(local + 26) + u16(local + 28);
    const data = buf.subarray(dataStart, dataStart + compressed);
    if (method === 0) files.set(name, data);
    else if (method === 8) {
      try {
        files.set(name, inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }));
      } catch (e) {
        throw new Error(e instanceof RangeError ? "A file in the ZIP is too large to decompress." : "Corrupt ZIP data.");
      }
    }
  }
  return files;
}
function decodeXml(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, (all2, name, dec, hex) => {
    if (dec || hex) {
      const cp = dec ? Number(dec) : parseInt(hex, 16);
      return cp <= 1114111 ? String.fromCodePoint(cp) : all2;
    }
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
      const cells2 = [];
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
        const idx = ref ? columnIndex(ref) : cells2.length;
        while (cells2.length < idx) cells2.push("");
        cells2[idx] = value;
      }
      rows.push(cells2);
    }
    const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
    const csv = rows.map((r) => [...r, ...Array(width - r.length).fill("")].map(csvCell).join(",")).join("\n");
    sheets.push({ name, csv });
  }
  return sheets;
}

// packages/mcp/src/docx.ts
var PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;
var ORDER = ["document", "header", "footer", "footnotes", "endnotes", "comments"];
var TOKEN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>|<\/w:p>/g;
function paragraphs(xml) {
  let out = "";
  for (const m of xml.matchAll(TOKEN)) {
    if (m[1] !== void 0) out += decodeXml(m[1]);
    else if (m[2] === "tab") out += "	";
    else out += "\n";
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
function tableCsv(xml) {
  const rows = [...xml.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map(
    (r) => [...r[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((c) => paragraphs(c[1]).replace(/\s*\n\s*/g, " "))
  );
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows.map((r) => [...r, ...Array(width - r.length).fill("")].map(csvCell).join(",")).join("\n");
}
function readDocx(buf) {
  const files = unzip(buf);
  if (!files.has("word/document.xml")) throw new Error("Not a Word document (word/document.xml is missing).");
  const names = [...files.keys()].filter((n) => PARTS.test(n));
  const rank = (n) => ORDER.findIndex((o) => n.startsWith(`word/${o}`));
  names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "en", { numeric: true }));
  const tables = [];
  const texts = names.map(
    (n) => paragraphs(
      files.get(n).toString("utf8").replace(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g, (tbl) => {
        const name = `Tabel ${tables.length + 1}`;
        tables.push({ name, csv: tableCsv(tbl) });
        return `<w:p><w:r><w:t>[${name}]</w:t></w:r></w:p>`;
      })
    )
  );
  return [{ name: "Dokumen", csv: texts.filter(Boolean).join("\n\n") }, ...tables];
}

// packages/mcp/src/pdf.ts
import { constants, inflateRawSync as inflateRawSync2, inflateSync } from "node:zlib";
var Name = class {
  v;
  constructor(v) {
    this.v = v;
  }
};
var Str = class {
  v;
  constructor(v) {
    this.v = v;
  }
};
var Ref = class {
  num;
  gen;
  constructor(num, gen) {
    this.num = num;
    this.gen = gen;
  }
};
var Op = class {
  v;
  constructor(v) {
    this.v = v;
  }
};
var Stream = class {
  dict;
  raw;
  /** The file ends inside this stream: a cut-off download or a partial copy. */
  truncated;
  constructor(dict, raw, truncated = false) {
    this.dict = dict;
    this.raw = raw;
    this.truncated = truncated;
  }
};
var isSpace = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
var isDelim = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
var NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
var MAX_DEPTH = 64;
var Lexer = class {
  pos = 0;
  s;
  constructor(s) {
    this.s = s;
  }
  skip() {
    const s = this.s;
    while (this.pos < s.length) {
      const c = s.charCodeAt(this.pos);
      if (c === 37) {
        while (this.pos < s.length && s[this.pos] !== "\n" && s[this.pos] !== "\r") this.pos++;
      } else if (isSpace(c)) this.pos++;
      else break;
    }
  }
  regular() {
    const start = this.pos;
    while (this.pos < this.s.length) {
      const c = this.s.charCodeAt(this.pos);
      if (isSpace(c) || isDelim(c)) break;
      this.pos++;
    }
    return this.s.slice(start, this.pos);
  }
  /** The next value or operator, or undefined at the end. */
  value(depth = 0) {
    if (depth > MAX_DEPTH) throw new Error("PDF nesting too deep.");
    this.skip();
    const s = this.s;
    if (this.pos >= s.length) return void 0;
    const c = s[this.pos];
    if (c === "/") {
      this.pos++;
      return new Name(this.regular().replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
    }
    if (c === "(") return this.literal();
    if (c === "<") {
      if (s[this.pos + 1] === "<") {
        this.pos += 2;
        const dict = /* @__PURE__ */ new Map();
        for (; ; ) {
          this.skip();
          if (this.pos >= s.length) break;
          if (s[this.pos] === ">" && s[this.pos + 1] === ">") {
            this.pos += 2;
            break;
          }
          const key = this.value(depth + 1);
          if (key === void 0) break;
          if (!(key instanceof Name)) continue;
          const val = this.value(depth + 1);
          if (val === void 0) break;
          dict.set(key.v, val);
        }
        return dict;
      }
      const close = s.indexOf(">", this.pos);
      const hex = s.slice(this.pos + 1, close < 0 ? s.length : close).replace(/[^0-9A-Fa-f]/g, "");
      this.pos = close < 0 ? s.length : close + 1;
      let bytes = "";
      for (let i = 0; i < hex.length; i += 2) bytes += String.fromCharCode(parseInt(hex.slice(i, i + 2).padEnd(2, "0"), 16));
      return new Str(bytes);
    }
    if (c === "[") {
      this.pos++;
      const arr = [];
      for (; ; ) {
        this.skip();
        if (this.pos >= s.length) break;
        if (s[this.pos] === "]") {
          this.pos++;
          break;
        }
        const v = this.value(depth + 1);
        if (v === void 0) break;
        arr.push(v);
      }
      return arr;
    }
    const token = this.regular();
    if (!token) {
      this.pos++;
      return new Op(c);
    }
    if (NUMBER.test(token)) {
      const n = Number(token);
      if (/^\d+$/.test(token)) {
        const save = this.pos;
        this.skip();
        const gen = this.regular();
        if (/^\d+$/.test(gen)) {
          this.skip();
          if (s[this.pos] === "R" && (this.pos + 1 >= s.length || isSpace(s.charCodeAt(this.pos + 1)) || isDelim(s.charCodeAt(this.pos + 1)))) {
            this.pos++;
            return new Ref(n, Number(gen));
          }
        }
        this.pos = save;
      }
      return n;
    }
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    return new Op(token);
  }
  literal() {
    const s = this.s;
    let depth = 1;
    let out = "";
    this.pos++;
    while (this.pos < s.length) {
      const c = s[this.pos++];
      if (c === "\\") {
        const n = s[this.pos++];
        if (n === void 0) break;
        if (n >= "0" && n <= "7") {
          let oct = n;
          while (oct.length < 3 && s[this.pos] >= "0" && s[this.pos] <= "7") oct += s[this.pos++];
          out += String.fromCharCode(parseInt(oct, 8) & 255);
        } else if (n === "\r") {
          if (s[this.pos] === "\n") this.pos++;
        } else if (n !== "\n") {
          out += { n: "\n", r: "\r", t: "	", b: "\b", f: "\f" }[n] ?? n;
        }
      } else if (c === "(") {
        depth++;
        out += c;
      } else if (c === ")") {
        if (--depth === 0) break;
        out += c;
      } else out += c;
    }
    return new Str(out);
  }
};
var MAX_STREAM_BYTES = 64 * 1024 * 1024;
function ascii85(data) {
  const out = [];
  let group = [];
  const body = data.replace(/^\s*<~/, "");
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "~") break;
    if (ch === "z" && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 33 || code > 117) continue;
    group.push(code - 33);
    if (group.length === 5) {
      const n = group.reduce((acc, d) => acc * 85 + d, 0);
      out.push(n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255);
      group = [];
    }
  }
  if (group.length > 1) {
    const size = group.length;
    while (group.length < 5) group.push(84);
    const n = group.reduce((acc, d) => acc * 85 + d, 0);
    out.push(...[n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255].slice(0, size - 1));
  }
  return Buffer.from(out);
}
function inflate(data) {
  const options = { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: MAX_STREAM_BYTES };
  const tooLarge = (e) => e instanceof RangeError ? new Error("A PDF stream is too large to decompress.") : e;
  try {
    return inflateSync(data, options);
  } catch (e) {
    if (e instanceof RangeError) throw tooLarge(e);
    try {
      return inflateRawSync2(data, options);
    } catch (raw) {
      throw raw instanceof RangeError ? tooLarge(raw) : e;
    }
  }
}
var Pdf = class {
  objects = /* @__PURE__ */ new Map();
  decoded = /* @__PURE__ */ new Map();
  fonts = /* @__PURE__ */ new Map();
  truncated = /* @__PURE__ */ new Set();
  trailers = [];
  constructor(buf) {
    const s = buf.toString("latin1");
    const objRe = /(\d+)\s+(\d+)\s+obj\b/g;
    for (let m = objRe.exec(s); m; m = objRe.exec(s)) {
      const lx = new Lexer(s);
      lx.pos = objRe.lastIndex;
      let value;
      try {
        value = lx.value();
      } catch {
        continue;
      }
      if (value === void 0) break;
      lx.skip();
      if (lx.pos >= s.length && value instanceof Map) this.truncated.add(value);
      if (value instanceof Map && s.startsWith("stream", lx.pos)) {
        let start = lx.pos + 6;
        if (s[start] === "\r") start++;
        if (s[start] === "\n") start++;
        const length = value.get("Length");
        let end = -1;
        if (typeof length === "number" && Number.isInteger(length) && length >= 0 && start + length <= s.length) {
          const after = s.slice(start + length, start + length + 32);
          if (/^\s*endstream/.test(after)) end = start + length;
        }
        let truncated = false;
        if (end < 0) {
          end = s.indexOf("endstream", start);
          if (end < 0) {
            end = s.length;
            truncated = true;
          }
          if (s[end - 1] === "\n") end--;
          if (s[end - 1] === "\r") end--;
        }
        value = new Stream(value, buf.subarray(start, Math.max(start, end)), truncated);
        objRe.lastIndex = Math.max(end, start);
      } else {
        objRe.lastIndex = Math.max(objRe.lastIndex, lx.pos);
      }
      if (value instanceof Stream && this.nameOf(value.dict.get("Type")) === "XRef") this.trailers.push(value.dict);
      this.objects.set(Number(m[1]), { value, at: m.index });
    }
    for (const m of s.matchAll(/trailer\s*<</g)) {
      const lx = new Lexer(s);
      lx.pos = m.index + 7;
      const t = lx.value();
      if (t instanceof Map) this.trailers.push(t);
    }
    if (this.trailers.some((t) => t.has("Encrypt"))) throw new Error("The PDF is encrypted (password-protected).");
    this.expandObjectStreams();
  }
  expandObjectStreams() {
    for (const [, { value, at }] of [...this.objects]) {
      if (!(value instanceof Stream) || this.nameOf(value.dict.get("Type")) !== "ObjStm") continue;
      let data;
      try {
        data = this.data(value);
      } catch {
        continue;
      }
      const n = this.num(value.dict.get("N"));
      const first = this.num(value.dict.get("First"));
      const lx = new Lexer(data);
      const header = [];
      for (let i = 0; i < 2 * n; i++) {
        const v = lx.value();
        if (typeof v !== "number") break;
        header.push(v);
      }
      for (let i = 0; i + 1 < header.length; i += 2) {
        const num = header[i];
        const pos = first + header[i + 1];
        if (!Number.isInteger(num) || !Number.isInteger(pos) || pos < 0) continue;
        const existing = this.objects.get(num);
        if (existing && existing.at > at) continue;
        const ox = new Lexer(data);
        ox.pos = pos;
        try {
          const v = ox.value();
          if (v !== void 0) this.objects.set(num, { value: v, at });
        } catch {
        }
      }
    }
  }
  resolve(v) {
    for (let i = 0; i < 32 && v instanceof Ref; i++) v = this.objects.get(v.num)?.value;
    return v instanceof Ref ? void 0 : v;
  }
  dict(v) {
    const r = this.resolve(v);
    if (r instanceof Stream) return r.dict;
    return r instanceof Map ? r : void 0;
  }
  nameOf(v) {
    const r = this.resolve(v);
    return r instanceof Name ? r.v : void 0;
  }
  num(v, fallback = 0) {
    const r = this.resolve(v);
    return typeof r === "number" ? r : fallback;
  }
  /** A stream's decoded bytes, as a latin1 string. */
  data(stream) {
    const cached = this.decoded.get(stream);
    if (cached !== void 0) return cached;
    const filters = this.resolve(stream.dict.get("Filter"));
    const list = (Array.isArray(filters) ? filters : filters === void 0 ? [] : [filters]).map((f) => this.nameOf(f));
    let buf = stream.raw;
    for (const f of list) {
      if (f === "FlateDecode" || f === "Fl") buf = inflate(buf);
      else if (f === "ASCII85Decode" || f === "A85") buf = ascii85(buf.toString("latin1"));
      else if (f === "ASCIIHexDecode" || f === "AHx") buf = Buffer.from(buf.toString("latin1").replace(/>[\s\S]*$/, "").replace(/[^0-9A-Fa-f]/g, ""), "hex");
      else throw new Error(`Unsupported PDF filter ${f}.`);
    }
    const out = buf.toString("latin1");
    this.decoded.set(stream, out);
    return out;
  }
  /** Pages in reading order, each with the resources it inherits. */
  pages() {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const walk = (node, inherited, depth) => {
      if (!node || seen.has(node) || depth > 64 || out.length >= 1e4) return;
      seen.add(node);
      const resources = this.dict(node.get("Resources")) ?? inherited;
      const kids = this.resolve(node.get("Kids"));
      if (Array.isArray(kids)) for (const k of kids) walk(this.dict(k), resources, depth + 1);
      else out.push({ page: node, resources });
    };
    for (const t of [...this.trailers].reverse()) {
      const catalog = this.dict(t.get("Root"));
      if (catalog) {
        walk(this.dict(catalog.get("Pages")), void 0, 0);
        if (out.length) return out;
      }
    }
    for (const [, { value }] of [...this.objects].sort((a, b) => a[0] - b[0])) {
      const d = value instanceof Map ? value : void 0;
      if (d && this.nameOf(d.get("Type")) === "Page") out.push({ page: d, resources: this.dict(d.get("Resources")) });
    }
    return out;
  }
  font(ref) {
    const dict = this.dict(ref);
    if (!dict) return void 0;
    let font = this.fonts.get(dict);
    if (!font) {
      font = new Font(this, dict);
      this.fonts.set(dict, font);
    }
    return font;
  }
};
var decodeTable = (label) => {
  try {
    const dec = new TextDecoder(label);
    return Array.from({ length: 256 }, (_, i) => dec.decode(new Uint8Array([i])));
  } catch {
    return Array.from({ length: 256 }, (_, i) => String.fromCharCode(i));
  }
};
var WIN_ANSI = decodeTable("windows-1252");
var MAC_ROMAN = decodeTable("macintosh");
var STANDARD = WIN_ANSI.map((c, i) => i === 39 ? "\u2019" : i === 96 ? "\u2018" : c);
var GLYPHS = {
  space: " ",
  exclam: "!",
  quotedbl: '"',
  numbersign: "#",
  dollar: "$",
  percent: "%",
  ampersand: "&",
  quotesingle: "'",
  parenleft: "(",
  parenright: ")",
  asterisk: "*",
  plus: "+",
  comma: ",",
  hyphen: "-",
  period: ".",
  slash: "/",
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  colon: ":",
  semicolon: ";",
  less: "<",
  equal: "=",
  greater: ">",
  question: "?",
  at: "@",
  bracketleft: "[",
  backslash: "\\",
  bracketright: "]",
  asciicircum: "^",
  underscore: "_",
  grave: "`",
  braceleft: "{",
  bar: "|",
  braceright: "}",
  asciitilde: "~",
  bullet: "\u2022",
  endash: "\u2013",
  emdash: "\u2014",
  quoteleft: "\u2018",
  quoteright: "\u2019",
  quotedblleft: "\u201C",
  quotedblright: "\u201D",
  quotesinglbase: "\u201A",
  quotedblbase: "\u201E",
  ellipsis: "\u2026",
  Euro: "\u20AC",
  minus: "\u2212",
  nbspace: "\xA0",
  fi: "fi",
  fl: "fl",
  ff: "ff",
  ffi: "ffi",
  ffl: "ffl",
  f_i: "fi",
  f_l: "fl",
  f_f: "ff",
  degree: "\xB0",
  copyright: "\xA9",
  registered: "\xAE",
  trademark: "\u2122",
  section: "\xA7",
  paragraph: "\xB6",
  periodcentered: "\xB7",
  multiply: "\xD7",
  divide: "\xF7",
  plusminus: "\xB1"
};
var ACCENTED = /^([A-Za-z])(acute|grave|circumflex|dieresis|tilde|ring|cedilla|caron)$/;
var COMBINING = {
  acute: "\u0301",
  grave: "\u0300",
  circumflex: "\u0302",
  dieresis: "\u0308",
  tilde: "\u0303",
  ring: "\u030A",
  cedilla: "\u0327",
  caron: "\u030C"
};
function glyphToUnicode(name) {
  if (Object.hasOwn(GLYPHS, name)) return GLYPHS[name];
  if (/^[A-Za-z]$/.test(name)) return name;
  let m = /^uni([0-9A-Fa-f]{4})+$/.exec(name);
  if (m) return String.fromCharCode(...name.slice(3).match(/.{4}/g).map((h) => parseInt(h, 16)));
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) {
    const cp = parseInt(m[1], 16);
    return cp <= 1114111 ? String.fromCodePoint(cp) : void 0;
  }
  m = ACCENTED.exec(name);
  if (m) return (m[1] + COMBINING[m[2]]).normalize("NFC");
  const dot = name.indexOf(".");
  if (dot > 0) return glyphToUnicode(name.slice(0, dot));
  return void 0;
}
function utf16be(bytes) {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode(bytes.charCodeAt(i) << 8 | bytes.charCodeAt(i + 1));
  return out;
}
function bytesToInt(bytes) {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) n = n * 256 + bytes.charCodeAt(i);
  return n;
}
function intToBytes(n, length) {
  let out = "";
  for (let i = 0; i < length; i++) {
    out = String.fromCharCode(n % 256) + out;
    n = Math.floor(n / 256);
  }
  return out;
}
function parseCMap(text) {
  const map = /* @__PURE__ */ new Map();
  const ranges = [];
  const lx = new Lexer(text);
  const operands = [];
  for (let v = lx.value(); v !== void 0; v = lx.value()) {
    if (!(v instanceof Op)) {
      operands.push(v);
      continue;
    }
    if (v.v === "endcodespacerange") {
      for (let i = 0; i + 1 < operands.length; i += 2) {
        const [lo, hi] = [operands[i], operands[i + 1]];
        if (lo instanceof Str && hi instanceof Str && lo.v.length === hi.v.length) ranges.push([lo.v, hi.v]);
      }
    } else if (v.v === "endbfchar") {
      for (let i = 0; i + 1 < operands.length; i += 2) {
        const [src, dst] = [operands[i], operands[i + 1]];
        if (src instanceof Str && dst instanceof Str) map.set(src.v, utf16be(dst.v));
        else if (src instanceof Str && dst instanceof Name) map.set(src.v, glyphToUnicode(dst.v) ?? "");
      }
    } else if (v.v === "endbfrange") {
      for (let i = 0; i + 2 < operands.length; i += 3) {
        const [lo, hi, dst] = [operands[i], operands[i + 1], operands[i + 2]];
        if (!(lo instanceof Str && hi instanceof Str)) continue;
        const from = bytesToInt(lo.v);
        const to = Math.min(bytesToInt(hi.v), from + 65535);
        for (let code = from; code <= to; code++) {
          const key = intToBytes(code, lo.v.length);
          if (Array.isArray(dst)) {
            const d = dst[code - from];
            if (d instanceof Str) map.set(key, utf16be(d.v));
          } else if (dst instanceof Str && dst.v.length >= 2) {
            const base = utf16be(dst.v);
            map.set(key, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + code - from));
          }
        }
      }
    }
    if (v.v.startsWith("end") || v.v.startsWith("begin")) operands.length = 0;
  }
  return { map, ranges };
}
var Font = class {
  toUnicode;
  ranges = [];
  composite;
  encoding;
  widths = /* @__PURE__ */ new Map();
  defaultWidth;
  constructor(pdf, dict) {
    this.composite = pdf.nameOf(dict.get("Subtype")) === "Type0";
    const tu = pdf.resolve(dict.get("ToUnicode"));
    if (tu instanceof Stream) {
      try {
        this.toUnicode = parseCMap(pdf.data(tu)).map;
      } catch {
      }
    }
    let encoding = WIN_ANSI;
    const enc = pdf.resolve(dict.get("Encoding"));
    if (this.composite && enc instanceof Stream) {
      try {
        this.ranges = parseCMap(pdf.data(enc)).ranges;
      } catch {
      }
    }
    const named = (n) => n === "MacRomanEncoding" ? MAC_ROMAN : n === "StandardEncoding" ? STANDARD : WIN_ANSI;
    if (enc instanceof Name) encoding = named(enc.v);
    else if (enc instanceof Map) {
      encoding = [...named(pdf.nameOf(enc.get("BaseEncoding")))];
      const diffs = pdf.resolve(enc.get("Differences"));
      if (Array.isArray(diffs)) {
        let code = 0;
        for (const d of diffs) {
          if (typeof d === "number") code = d;
          else if (d instanceof Name) {
            if (code >= 0 && code < 256) encoding[code] = glyphToUnicode(d.v) ?? "";
            code++;
          }
        }
      }
    }
    this.encoding = encoding;
    if (this.composite) {
      const descendants = pdf.resolve(dict.get("DescendantFonts"));
      const cid = pdf.dict(Array.isArray(descendants) ? descendants[0] : void 0);
      this.defaultWidth = pdf.num(cid?.get("DW"), 1e3);
      const w = pdf.resolve(cid?.get("W"));
      if (Array.isArray(w)) {
        for (let i = 0; i < w.length; ) {
          const first = pdf.num(w[i]);
          const next = pdf.resolve(w[i + 1]);
          if (Array.isArray(next)) {
            next.forEach((width, j) => this.widths.set(first + j, pdf.num(width)));
            i += 2;
          } else {
            const last = pdf.num(next);
            const width = pdf.num(w[i + 2]);
            for (let c = first; c <= last && c - first < 65536; c++) this.widths.set(c, width);
            i += 3;
          }
        }
      }
    } else {
      const first = pdf.num(dict.get("FirstChar"));
      const widths = pdf.resolve(dict.get("Widths"));
      if (Array.isArray(widths)) widths.forEach((w, i) => this.widths.set(first + i, pdf.num(w)));
      const descriptor = pdf.dict(dict.get("FontDescriptor"));
      const base = pdf.nameOf(dict.get("BaseFont")) ?? "";
      this.defaultWidth = pdf.num(descriptor?.get("MissingWidth"), 0) || (/Courier/.test(base) ? 600 : 500);
    }
  }
  /** Splits a string into character codes. */
  codes(bytes) {
    const out = [];
    if (!this.composite) {
      for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
      return out;
    }
    for (let i = 0; i < bytes.length; ) {
      let len = 0;
      for (let n = 1; n <= 4 && !len; n++) {
        const code = bytes.slice(i, i + n);
        if (code.length === n && this.ranges.some(([lo, hi]) => lo.length === n && code >= lo && code <= hi)) len = n;
      }
      if (!len) len = this.composite ? 2 : 1;
      out.push(bytes.slice(i, i + len));
      i += len;
    }
    return out;
  }
  text(code) {
    const mapped = this.toUnicode?.get(code) ?? (code.length === 1 ? this.toUnicode?.get(`\0${code}`) : void 0);
    if (mapped !== void 0) return mapped;
    if (code.length === 1) return this.encoding[code.charCodeAt(0)] ?? "";
    return "";
  }
  width(code) {
    return this.widths.get(bytesToInt(code)) ?? this.defaultWidth;
  }
};
var IDENTITY = [1, 0, 0, 1, 0, 0];
var mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5]
];
var TextWriter = class {
  out = "";
  /** Text was shown in a font the file does not have (it was cut off or damaged). */
  missingFont = false;
  last;
  /** Text drawn from (x0, y0) to (x1, y1) in device space, at an effective font size. */
  add(text, x0, y0, x1, y1, size) {
    if (!text) return;
    const last = this.last;
    if (last && this.out) {
      const tolerance = Math.max(size, last.size) * 0.5;
      const end = this.out.charCodeAt(this.out.length - 1);
      if (Math.abs(y0 - last.y) > tolerance) {
        if (end !== 10) this.out += "\n";
      } else {
        const gap = x0 - last.x;
        if ((gap > size * 0.15 || gap < -size) && end !== 32 && end !== 9 && end !== 10 && text[0] !== " ") {
          this.out += gap > size * 0.8 ? "	" : " ";
        }
      }
    }
    this.out += text;
    this.last = { x: x1, y: y1, size };
  }
  breakLine() {
    if (this.out && !this.out.endsWith("\n")) this.out += "\n";
    this.last = void 0;
  }
  /** A line of its own, such as a form field. */
  line(text) {
    if (!text) return;
    this.breakLine();
    this.out += `${text}
`;
  }
};
function textString(bytes) {
  if (bytes.startsWith("\xFE\xFF")) return utf16be(bytes.slice(2));
  if (bytes.startsWith("\xEF\xBB\xBF")) return Buffer.from(bytes.slice(3), "latin1").toString("utf8");
  return bytes;
}
function fieldLine(pdf, widget) {
  const names = [];
  let value;
  let node = widget;
  for (let depth = 0; node && depth < 32; depth++) {
    const t = pdf.resolve(node.get("T"));
    if (t instanceof Str) names.unshift(textString(t.v));
    if (value === void 0 && node.has("V")) value = pdf.resolve(node.get("V"));
    node = pdf.dict(node.get("Parent"));
  }
  const one = (v) => v instanceof Str ? textString(v.v) : v instanceof Name && v.v !== "Off" ? v.v : "";
  const text = (Array.isArray(value) ? value.map((v) => one(pdf.resolve(v))).filter(Boolean).join(", ") : one(value)).replace(/\s*[\r\n]+\s*/g, ", ").trim();
  return text ? `${names.join(".") || "field"}: ${text}` : void 0;
}
function annotations(pdf, page, writer) {
  const annots = pdf.resolve(page.get("Annots"));
  if (!Array.isArray(annots)) return;
  for (const ref of annots.slice(0, 5e3)) {
    const a = pdf.dict(ref);
    const subtype = a && pdf.nameOf(a.get("Subtype"));
    if (!a || subtype === "Popup" || subtype === "Link") continue;
    if (subtype === "Widget") {
      const field = fieldLine(pdf, a);
      if (field) writer.line(field);
      continue;
    }
    let appearance = pdf.resolve(pdf.dict(a.get("AP"))?.get("N"));
    if (appearance instanceof Map) appearance = pdf.resolve(appearance.get(pdf.nameOf(a.get("AS")) ?? ""));
    if (appearance instanceof Stream) {
      const rect = pdf.resolve(a.get("Rect"));
      const bbox = pdf.resolve(appearance.dict.get("BBox"));
      const at = (arr, i) => Array.isArray(arr) ? pdf.num(arr[i]) : 0;
      const ctm = [1, 0, 0, 1, Math.min(at(rect, 0), at(rect, 2)) - at(bbox, 0), Math.min(at(rect, 1), at(rect, 3)) - at(bbox, 1)];
      writer.breakLine();
      try {
        runContent(pdf, pdf.data(appearance), pdf.dict(appearance.dict.get("Resources")), ctm, writer, 1);
      } catch {
      }
      writer.breakLine();
      continue;
    }
    const contents = pdf.resolve(a.get("Contents"));
    if (contents instanceof Str) writer.line(textString(contents.v).replace(/\s*[\r\n]+\s*/g, " ").trim());
  }
}
function runContent(pdf, content, resources, ctm, writer, depth) {
  const lx = new Lexer(content);
  const operands = [];
  const stack = [];
  let tm = IDENTITY;
  let lm = IDENTITY;
  let font;
  let size = 0;
  let charSpacing = 0;
  let wordSpacing = 0;
  let scale = 1;
  let leading = 0;
  let rise = 0;
  const fontsDict = pdf.dict(resources?.get("Font"));
  const xobjects = pdf.dict(resources?.get("XObject"));
  const moveLine = (tx, ty) => {
    lm = mul([1, 0, 0, 1, tx, ty], lm);
    tm = lm;
  };
  const show = (bytes) => {
    if (!font) {
      if (bytes) writer.missingFont = true;
      return;
    }
    const start = mul([1, 0, 0, 1, 0, rise], mul(tm, ctm));
    let text = "";
    for (const code of font.codes(bytes)) {
      text += font.text(code);
      const advance = (font.width(code) / 1e3 * size + charSpacing + (code === " " ? wordSpacing : 0)) * scale;
      tm = mul([1, 0, 0, 1, advance, 0], tm);
    }
    const end = mul(tm, ctm);
    const effective = Math.abs(size) * Math.sqrt(start[2] * start[2] + start[3] * start[3]) || 1;
    writer.add(text, start[4], start[5], end[4], end[5], effective);
  };
  const kern = (n) => {
    tm = mul([1, 0, 0, 1, -n / 1e3 * size * scale, 0], tm);
  };
  for (let v = lx.value(); v !== void 0; v = lx.value()) {
    if (!(v instanceof Op)) {
      if (operands.length < 64) operands.push(v);
      continue;
    }
    const n = (i) => typeof operands[i] === "number" ? operands[i] : 0;
    switch (v.v) {
      case "q":
        if (stack.length < 64) stack.push(ctm);
        break;
      case "Q":
        ctm = stack.pop() ?? ctm;
        break;
      case "cm":
        ctm = mul([n(0), n(1), n(2), n(3), n(4), n(5)], ctm);
        break;
      case "BT":
        tm = lm = IDENTITY;
        break;
      case "Tf":
        font = operands[0] instanceof Name ? pdf.font(fontsDict?.get(operands[0].v)) : void 0;
        size = n(1);
        break;
      case "Tc":
        charSpacing = n(0);
        break;
      case "Tw":
        wordSpacing = n(0);
        break;
      case "Tz":
        scale = n(0) / 100;
        break;
      case "TL":
        leading = n(0);
        break;
      case "Ts":
        rise = n(0);
        break;
      case "Td":
        moveLine(n(0), n(1));
        break;
      case "TD":
        leading = -n(1);
        moveLine(n(0), n(1));
        break;
      case "Tm":
        lm = tm = [n(0), n(1), n(2), n(3), n(4), n(5)];
        break;
      case "T*":
        moveLine(0, -leading);
        break;
      case "Tj":
        if (operands[0] instanceof Str) show(operands[0].v);
        break;
      case "'":
        moveLine(0, -leading);
        if (operands[0] instanceof Str) show(operands[0].v);
        break;
      case '"':
        wordSpacing = n(0);
        charSpacing = n(1);
        moveLine(0, -leading);
        if (operands[2] instanceof Str) show(operands[2].v);
        break;
      case "TJ":
        if (Array.isArray(operands[0])) {
          for (const item of operands[0]) {
            if (item instanceof Str) show(item.v);
            else if (typeof item === "number") kern(item);
          }
        }
        break;
      case "Do": {
        const xobject = operands[0] instanceof Name ? pdf.resolve(xobjects?.get(operands[0].v)) : void 0;
        if (xobject instanceof Stream && pdf.nameOf(xobject.dict.get("Subtype")) === "Form" && depth < 8) {
          const matrix = pdf.resolve(xobject.dict.get("Matrix"));
          const m = Array.isArray(matrix) && matrix.length === 6 ? matrix.map((x) => pdf.num(x)) : IDENTITY;
          let data;
          try {
            data = pdf.data(xobject);
          } catch {
            data = void 0;
          }
          if (data !== void 0) runContent(pdf, data, pdf.dict(xobject.dict.get("Resources")) ?? resources, mul(m, ctm), writer, depth + 1);
        }
        break;
      }
      case "ID": {
        const end = /\sEI(?=[\s]|$)/g;
        end.lastIndex = lx.pos;
        const m = end.exec(content);
        lx.pos = m ? m.index + m[0].length : content.length;
        break;
      }
    }
    operands.length = 0;
  }
}
function extractPages(buf) {
  if (buf.subarray(0, 1024).indexOf("%PDF-") < 0) throw new Error("Not a PDF file.");
  const pdf = new Pdf(buf);
  const pages = pdf.pages();
  if (!pages.length) throw new Error("No pages found.");
  return pages.map(({ page, resources }) => {
    let damaged = pdf.truncated.has(page);
    const contents = pdf.resolve(page.get("Contents"));
    const list = Array.isArray(contents) ? contents.map((c) => pdf.resolve(c)) : page.has("Contents") ? [contents] : [];
    const parts = [];
    for (const s of list) {
      if (!(s instanceof Stream) || s.truncated) damaged = true;
      if (!(s instanceof Stream)) continue;
      try {
        parts.push(pdf.data(s));
      } catch {
        damaged = true;
      }
    }
    const writer = new TextWriter();
    try {
      runContent(pdf, parts.join("\n"), resources, IDENTITY, writer, 0);
    } catch {
      damaged = true;
    }
    annotations(pdf, page, writer);
    if (writer.missingFont) damaged = true;
    const text = writer.out.split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n").trim();
    return { text, damaged, blank: !damaged && !parts.some((p) => /\S/.test(p)) };
  });
}
function readPdf(buf) {
  const pages = [];
  const scanned = [];
  const damaged = [];
  const all2 = extractPages(buf);
  all2.forEach(({ text, damaged: broken, blank }, i) => {
    if (text.replace(/\s/g, "")) pages.push({ name: `Halaman ${i + 1}`, csv: text });
    else if (broken) damaged.push(i + 1);
    else if (!blank) scanned.push(i + 1);
  });
  return { pages, scanned, damaged, total: all2.length };
}

// packages/mcp/src/files.ts
var MAX_FILE_BYTES = 100 * 1024 * 1024;
var GUARD_SAMPLE_BYTES = 5 * 1024 * 1024;
var GUARD_MAX_ZIP_BYTES = 20 * 1024 * 1024;
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
function loadConfig(root) {
  const file = path.join(root, ".samaran.json");
  if (!existsSync(file)) return { custom: [], allow: [] };
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`.samaran.json is not valid JSON: ${e.message}`);
  }
  const fail = (why) => {
    throw new Error(`.samaran.json: ${why}`);
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail('expected an object with "custom" and "allow"');
  const { custom: custom2 = [], allow = [], ...rest } = raw;
  const unknownKeys = Object.keys(rest).filter((k) => !k.startsWith("$"));
  if (unknownKeys.length) fail(`unknown key ${unknownKeys.map((k) => `"${k}"`).join(", ")} (expected "custom" and "allow")`);
  if (!Array.isArray(custom2)) fail('"custom" must be a list of rules');
  if (!Array.isArray(allow) || !allow.every((a) => typeof a === "string")) fail('"allow" must be a list of strings');
  const rules = custom2.map((r, i) => {
    if (!r || typeof r !== "object") fail(`custom[${i}] must be an object`);
    const { label, pattern, fields: fields2, ...extra } = r;
    if (Object.keys(extra).length) fail(`custom[${i}]: unknown key ${Object.keys(extra).map((k) => `"${k}"`).join(", ")}`);
    if (typeof label !== "string") fail(`custom[${i}] needs a "label"`);
    if (pattern !== void 0 && typeof pattern !== "string") fail(`custom[${i}].pattern must be a string`);
    if (fields2 !== void 0 && (!Array.isArray(fields2) || !fields2.every((f) => typeof f === "string" && f.trim()))) {
      fail(`custom[${i}].fields must be a list of field names`);
    }
    return {
      label,
      ...pattern !== void 0 ? { pattern } : {},
      ...fields2 !== void 0 ? { fields: fields2 } : {}
    };
  });
  try {
    checkCustomRules(rules);
  } catch (e) {
    fail(e.message);
  }
  return { custom: rules, allow };
}
function detectConfigured(text, options, config2) {
  const found = detectPii(text, { ...options, custom: config2.custom });
  return config2.allow.length ? found.filter((m) => !config2.allow.includes(m.value)) : found;
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
var unsupported = (reason, dataBearing = true) => ({ kind: "skipped", status: "unsupported", reason, dataBearing });
var failed = (reason) => ({ kind: "skipped", status: "failed", reason, dataBearing: true });
function readHead(file, bytes) {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    const text = buf.subarray(0, n).toString("utf8");
    const lastBreak = text.lastIndexOf("\n");
    return lastBreak > 0 ? text.slice(0, lastBreak) : text;
  } finally {
    closeSync(fd);
  }
}
var mb = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`;
function pageList(pages) {
  const out = [];
  for (let i = 0; i < pages.length; ) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    out.push(j > i ? `${pages[i]}-${pages[j]}` : `${pages[i]}`);
    i = j + 1;
  }
  return out.join(", ");
}
var UNSUPPORTED_DATA = {
  ".xls": "Excel 97-2003 (.xls) is not supported; save it as .xlsx or .csv",
  ".doc": "Word 97-2003 (.doc) is not supported; save it as .docx",
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
var PARSED_WHOLE = /* @__PURE__ */ new Set([".xlsx", ".xlsm", ".docx", ".pdf"]);
function parseWhole(ext, buf) {
  if (ext === ".xlsx" || ext === ".xlsm") {
    try {
      return { kind: "sheets", sheets: readXlsx(buf) };
    } catch (e) {
      return failed(`unreadable spreadsheet: ${e.message}`);
    }
  }
  if (ext === ".docx") {
    try {
      return { kind: "sheets", sheets: readDocx(buf), unit: "part" };
    } catch (e) {
      return failed(`unreadable Word document: ${e.message}`);
    }
  }
  try {
    const { pages, scanned, damaged, total } = readPdf(buf);
    if (!pages.length && (scanned.length || damaged.length)) {
      return damaged.length ? failed("damaged PDF: no readable text") : unsupported("PDF without a text layer (scanned); needs OCR");
    }
    const notes = [];
    if (scanned.length) {
      const one = scanned.length === 1;
      notes.push(`${one ? "page" : "pages"} ${pageList(scanned)} of ${total} ${one ? "has" : "have"} no text layer (scanned) and need${one ? "s" : ""} OCR`);
    }
    if (damaged.length) {
      const one = damaged.length === 1;
      notes.push(`${one ? "page" : "pages"} ${pageList(damaged)} of ${total} ${one ? "is" : "are"} damaged and could not be read`);
    }
    return { kind: "sheets", sheets: pages, unit: "page", unscanned: notes.join("; ") || void 0 };
  } catch (e) {
    const message = e.message;
    return failed(/encrypted/.test(message) ? "encrypted PDF (password-protected)" : `unreadable PDF: ${message.replace(/\.$/, "")}`);
  }
}
function loadDocument(file, options = {}) {
  const ext = path.extname(file).toLowerCase();
  const st = statSync(file);
  if (st.size > MAX_FILE_BYTES) return unsupported(`larger than ${mb(MAX_FILE_BYTES)}`);
  if (PARSED_WHOLE.has(ext)) {
    if (options.maxZipBytes !== void 0 && st.size > options.maxZipBytes) {
      return unsupported(`larger than ${mb(options.maxZipBytes)}`);
    }
    return parseWhole(ext, readFileSync(file));
  }
  const why = UNSUPPORTED_DATA[ext];
  if (why) return unsupported(why);
  if (!isTextFile(file)) return unsupported("binary file", false);
  if (options.sampleBytes !== void 0 && st.size > options.sampleBytes) {
    return { kind: "text", text: readHead(file, options.sampleBytes), sampled: true };
  }
  return { kind: "text", text: readFileSync(file, "utf8") };
}

// packages/mcp/src/shell-reads.ts
import { existsSync as existsSync2, readdirSync as readdirSync2, statSync as statSync2 } from "node:fs";
import path2 from "node:path";
var SHELL_DATA_FILE = /\.(csv|tsv|json|jsonl|ndjson|log|txt|sql|xml|ya?ml|dump|bak|out|pdf)(\.\d+)?$/i;
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
  "findstr",
  "pdftotext"
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
  const escape2 = powershell ? "`" : "\\";
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
    } else if (c === escape2 && i + 1 < command.length && command[i + 1] !== "\n") {
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
      if (seg.program === "pdftotext" && !seg.args.includes("-")) {
        flow = [];
        continue;
      }
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
    for (const r of flow) out.push(r);
  }
  return out;
}
var INLINE_CODE = {
  python: ["-c"],
  python3: ["-c"],
  py: ["-c"],
  node: ["-e", "--eval", "-p", "--print"],
  bun: ["-e", "--eval", "-p", "--print"],
  deno: ["eval"],
  ruby: ["-e"],
  perl: ["-e", "-E"],
  php: ["-r"],
  rscript: ["-e"],
  pwsh: ["-c", "-command"],
  powershell: ["-c", "-command"]
};
var NAMED_FILE = /[\w.~:\\/-]+\.(?:csv|tsv|json|jsonl|ndjson|log|txt|sql|xml|ya?ml|dump|bak|out)(?:\.\d+)?(?![\w.])/gi;
var DOTNET_READ = /\[(?:system\.)?io\.file\]::\s*read/i;
var HEREDOC = /(?:^|\n)[ \t]*(\S+)[^\n]*?<<-?[ \t]*(['"]?)(\w+)\2[^\n]*\n([\s\S]*?)\n[ \t]*\3[ \t]*(?=\r?\n|$)/g;
var HERE_STRING = /@(['"])\r?\n([\s\S]*?)\r?\n\1@[ \t]*\|[ \t]*(\S+)/g;
function namedFiles(code, cwd, powershell) {
  return [...code.matchAll(NAMED_FILE)].flatMap((m) => expand(m[0].replace(/^[(]+/, ""), cwd, powershell));
}
function inlineCodeReads(command, cwd, powershell = false) {
  const files = /* @__PURE__ */ new Set();
  for (const m of command.matchAll(HEREDOC)) {
    if (programName(m[1]) in INLINE_CODE) for (const f of namedFiles(m[4], cwd, powershell)) files.add(f);
  }
  for (const m of command.matchAll(HERE_STRING)) {
    if (programName(m[3]) in INLINE_CODE) for (const f of namedFiles(m[2], cwd, powershell)) files.add(f);
  }
  for (const pipeline of parse(stripHeredocs(command), powershell)) {
    for (const words of pipeline) {
      const seg = toSegment(words);
      if (!seg || seg.writesToFile) continue;
      const flags = INLINE_CODE[seg.program];
      const at = flags ? seg.args.findIndex((a) => flags.includes(a.toLowerCase())) : -1;
      const joined = words.map((w) => w.text).join(" ");
      const code = at >= 0 ? seg.args.slice(at + 1).join(" ") : powershell && DOTNET_READ.test(joined) ? joined : void 0;
      if (code !== void 0) for (const f of namedFiles(code, cwd, powershell)) files.add(f);
    }
  }
  return [...files].map((file) => ({ file, select: all }));
}

// packages/mcp/src/guard.ts
var STRICT = [
  "NIK",
  "KK",
  "NPWP",
  "PASSPORT",
  "SIM",
  "NIP",
  "NISN",
  "AKTA",
  "BANK_ACCOUNT",
  "BPJS",
  "CARD",
  "HEALTH",
  "CRIMINAL_RECORD",
  "BIOMETRIC",
  // A team's own rules in .samaran.json: they wrote them because those values must not leave.
  "CUSTOM"
];
var BULK_THRESHOLD = 3;
var BYPASS = /#izinkan-pii\b/i;
var DATA_FILE = /\.(csv|tsv|json|jsonl|ndjson|log|txt|sql|xml|ya?ml|dump|bak|out|xlsx|xlsm|docx|pdf)(\.\d+)?$/i;
var GREP_MAX_FILES = 300;
var IMAGE_FILE = /\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/i;
var PERSONAL_PATH = /(?:^|[^a-z])(?:e?ktp|kk|kartu[ _-]?keluarga|npwp|sim|paspor|passport|selfie|swafoto|identitas|identity|id[ _-]?card|akta|ijazah|slip[ _-]?gaji|rekening|tabungan|bpjs|kyc|verifikasi|verification|pelanggan|customers?|nasabah|pasien|patients?|karyawan|employees?|pegawai|pemohon|applicants?|debitur|peserta|siswa|students?)(?:[^a-z]|$)/i;
var UPLOAD_PATH = /(?:^|[\\/])(?:media|uploads?|storage|attachments?|lampiran|berkas|dokumen|documents?|scans?|private|var)(?:[\\/]|$)/i;
var ASSET_PATH = /(?:^|[\\/])(?:assets?|icons?|images?|img|static|fonts?|docs?|screenshots?|\.github|design|branding|logos?)(?:[\\/]|$)/i;
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
  const name = (m) => m.label ?? m.type;
  const counts = /* @__PURE__ */ new Map();
  for (const m of matches) counts.set(name(m), (counts.get(name(m)) ?? 0) + 1);
  return [...counts.entries()].map(([label, n]) => {
    const first = matches.find((m) => name(m) === label);
    const sample = examples ? ` (${partialMask(first.type, first.value)})` : "";
    return `${label}\xD7${n}${sample}`;
  }).join(", ");
}
function fileTexts(file) {
  try {
    const doc = loadDocument(file, { sampleBytes: GUARD_SAMPLE_BYTES, maxZipBytes: GUARD_MAX_ZIP_BYTES });
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
  return verdictOf(texts.flatMap((t) => detectConfigured(t, { minConfidence: "high" }, config)));
}
function verdictOf(found) {
  const strict = found.some((m) => STRICT.includes(m.type));
  return strict || found.length >= BULK_THRESHOLD ? found : void 0;
}
function shownPii(full, shown, file) {
  const all2 = detectConfigured(full, { minConfidence: "high" }, config);
  let inFile;
  if (shown.length >= full.length) {
    inFile = all2;
  } else if (shown.length <= 1e5) {
    inFile = all2.filter((m) => shown.includes(m.value));
  } else {
    const fields2 = new Set(shown.split(/[\t\n\r,;|]+/).map((f) => f.trim().replace(/^"|"$/g, "")));
    inFile = all2.filter((m) => fields2.has(m.value));
  }
  const direct = detectConfigured(withHeader(full, shown, file), { minConfidence: "high" }, config);
  return inFile.length >= direct.length ? inFile : direct;
}
var PROCESS_HINT = "To process the data, run a script that reads the file and writes its results to a file (or prints only counts), or use `write_file_unmasked`.";
var strictMode = () => process.env.SAMARAN_GUARD === "strict";
var config = { custom: [], allow: [] };
var block = (message) => ({ action: "block", message });
function ask(shownAs, what) {
  return {
    action: "ask",
    message: [
      `\u{1F6E1}\uFE0F  Samaran: ${shownAs} ${what}, jadi isinya tidak bisa diperiksa dan akan dikirim ke model AI apa adanya.`,
      "Izinkan hanya jika berkas ini tidak berisi data pribadi asli (KTP, selfie, formulir pelanggan).",
      "Berkas contoh bisa dimasukkan ke .samaranignore supaya tidak ditanyakan lagi."
    ].join(" ")
  };
}
function personalImage(file, root) {
  const rel = path3.relative(root, file);
  const where = rel.startsWith("..") || path3.isAbsolute(rel) ? file : rel;
  return PERSONAL_PATH.test(where) || UPLOAD_PATH.test(path3.dirname(where)) && !ASSET_PATH.test(path3.dirname(where));
}
function readTool(file, shownAs, root, ignored) {
  if (ignored(file)) return void 0;
  if (IMAGE_FILE.test(file)) {
    return personalImage(file, root) && existsSync3(file) ? ask(shownAs, "mungkin foto KTP atau dokumen pribadi") : void 0;
  }
  if (!DATA_FILE.test(file)) return void 0;
  let doc;
  try {
    doc = loadDocument(file, { sampleBytes: GUARD_SAMPLE_BYTES, maxZipBytes: GUARD_MAX_ZIP_BYTES });
  } catch {
    return void 0;
  }
  if (doc.kind === "skipped") {
    return doc.dataBearing ? ask(shownAs, `tidak bisa dibaca Samaran (${doc.reason})`) : void 0;
  }
  const found = verdict(doc.kind === "text" ? [doc.text] : doc.sheets.map((s) => s.csv));
  if (found) {
    return block(
      [
        `Samaran blocked reading ${shownAs}: it contains personal data (${summarize(found, false)}).`,
        "Use the `read_file_masked` tool from the lokal MCP server instead: same content, with personal data replaced by stable placeholders.",
        "Write results that need the real values with `write_file_unmasked`.",
        "If the user confirms the file only holds fake data, they can add it to .samaranignore."
      ].join(" ")
    );
  }
  if (doc.kind === "sheets" && doc.unscanned) return ask(shownAs, `hanya terbaca sebagian (${doc.unscanned})`);
  return void 0;
}
function shellTool(command, cwd, powershell, ignored) {
  const reads = [...dataReadsInCommand(command, cwd, powershell), ...strictMode() ? inlineCodeReads(command, cwd, powershell) : []].filter((r) => !ignored(r.file));
  const matches = [];
  const files = /* @__PURE__ */ new Set();
  for (const r of reads) {
    for (const full of fileTexts(r.file) ?? []) {
      const shown = r.select(full);
      if (!shown.trim()) continue;
      const here = shownPii(full, shown, r.file);
      for (const m of here) matches.push(m);
      if (verdictOf(here)) files.add(r.file);
    }
  }
  const found = verdictOf(matches);
  if (!found) return void 0;
  const names = [...files.size ? files : new Set(reads.map((r) => r.file))].map((f) => path3.relative(cwd, f) || f);
  return block([
    `Samaran blocked this command: it would print personal data from ${names.join(", ")} into the conversation (${summarize(found, false)}).`,
    "To look at the data, use the `read_file_masked` tool from the lokal MCP server (personal data replaced by stable placeholders).",
    PROCESS_HINT,
    "If the user confirms the file only holds fake data, they can add it to .samaranignore."
  ].join(" "));
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
      for (const m of here) matches.push(m);
      if (verdictOf(here)) files.push(file);
    }
  }
  const found = verdictOf(matches);
  if (!found) return void 0;
  const names = (files.length ? files : candidates).slice(0, 5).map((f) => path3.relative(cwd, f) || f);
  return block([
    `Samaran blocked this search: the matching lines in ${names.join(", ")} contain personal data (${summarize(found, false)}).`,
    'Search with output_mode "files_with_matches" or "count", or read the file with `read_file_masked` from the lokal MCP server.',
    "Add a glob or type that leaves data files out if you meant to search code."
  ].join(" "));
}
function evaluate(input, projectRoot) {
  if (process.env.SAMARAN_GUARD === "off") return void 0;
  const root = projectRoot ?? process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  config = loadConfig(root);
  if (input.hook_event_name === "UserPromptSubmit" && input.prompt) {
    if (BYPASS.test(input.prompt)) return void 0;
    const found = detectConfigured(input.prompt, { types: STRICT, minConfidence: "high" }, config);
    if (!found.length) return void 0;
    return block([
      `\u{1F6E1}\uFE0F  Samaran menahan prompt ini: ada data pribadi ${summarize(found)}.`,
      "Prompt akan terkirim ke server model AI. Ganti dengan data contoh atau samarkan dulu,",
      "atau kirim ulang dengan menambahkan #izinkan-pii jika memang disengaja."
    ].join("\n"));
  }
  if (input.hook_event_name !== "PreToolUse" || !input.tool_input) return void 0;
  const cwd = input.cwd ?? root;
  const ignored = loadIgnore(root);
  const tool = input.tool_input;
  switch (input.tool_name) {
    case "Read":
      if (!tool.file_path) return void 0;
      {
        const file = path3.resolve(root, tool.file_path);
        const rel = path3.relative(root, file);
        const shownAs = rel && !rel.startsWith("..") && !path3.isAbsolute(rel) ? rel.split(path3.sep).join("/") : tool.file_path;
        return readTool(file, shownAs, root, ignored);
      }
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
var CURSOR_EVENTS = /* @__PURE__ */ new Set(["beforeSubmitPrompt", "beforeReadFile", "beforeShellExecution"]);
var GEMINI_EVENTS = /* @__PURE__ */ new Set(["BeforeAgent", "BeforeTool"]);
var shellToolName = () => process.platform === "win32" ? "PowerShell" : "Bash";
function translate(raw) {
  const event = raw.hook_event_name ?? "";
  if (CURSOR_EVENTS.has(event)) {
    const root = raw.workspace_roots?.[0];
    if (event === "beforeSubmitPrompt") return { agent: "cursor", input: { hook_event_name: "UserPromptSubmit", prompt: raw.prompt }, root };
    if (event === "beforeReadFile") {
      return { agent: "cursor", input: { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: raw.file_path }, cwd: root }, root };
    }
    return {
      agent: "cursor",
      input: { hook_event_name: "PreToolUse", tool_name: shellToolName(), tool_input: { command: raw.command }, cwd: raw.cwd ?? root },
      root
    };
  }
  if (GEMINI_EVENTS.has(event)) {
    if (event === "BeforeAgent") return { agent: "gemini", input: { hook_event_name: "UserPromptSubmit", prompt: raw.prompt, cwd: raw.cwd } };
    const tool = raw.tool_input ?? {};
    if (raw.tool_name === "read_file") {
      const file = tool.file_path ?? tool.absolute_path ?? tool.path;
      return { agent: "gemini", input: { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: file }, cwd: raw.cwd } };
    }
    if (raw.tool_name === "run_shell_command") {
      return { agent: "gemini", input: { hook_event_name: "PreToolUse", tool_name: shellToolName(), tool_input: { command: tool.command }, cwd: raw.cwd } };
    }
    return { agent: "gemini", input: { hook_event_name: "PreToolUse", tool_name: raw.tool_name, cwd: raw.cwd } };
  }
  return { agent: "claude", input: raw };
}
function respond(agent, event, verdict2) {
  if (agent === "cursor") {
    if (event === "beforeSubmitPrompt") {
      return { stdout: JSON.stringify(verdict2 ? { continue: false, user_message: verdict2.message } : { continue: true }), exitCode: 0 };
    }
    if (!verdict2) return { stdout: JSON.stringify({ permission: "allow" }), exitCode: 0 };
    if (event === "beforeReadFile") {
      const message = verdict2.action === "ask" ? `${verdict2.message} (Cursor tidak bisa bertanya dulu, jadi berkas ini ditahan.)` : verdict2.message;
      return { stdout: JSON.stringify({ permission: "deny", user_message: message }), exitCode: 0 };
    }
    return {
      stdout: JSON.stringify(
        verdict2.action === "ask" ? { permission: "ask", user_message: verdict2.message } : { permission: "deny", user_message: verdict2.message, agent_message: verdict2.message }
      ),
      exitCode: 0
    };
  }
  if (!verdict2) return { exitCode: 0 };
  if (verdict2.action === "ask" && agent === "claude") {
    const hookSpecificOutput = { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: verdict2.message };
    return { stdout: JSON.stringify({ hookSpecificOutput }), exitCode: 0 };
  }
  return { stderr: verdict2.message, exitCode: 2 };
}
async function runGuard() {
  let agent = "claude";
  let event = "";
  try {
    let raw = "";
    for await (const chunk of process.stdin) raw += chunk;
    const parsed = JSON.parse(raw);
    const translated = translate(parsed);
    agent = translated.agent;
    event = parsed.hook_event_name ?? "";
    const out = respond(agent, event, evaluate(translated.input, translated.root));
    if (out.stdout) process.stdout.write(`${out.stdout}
`);
    if (out.stderr) process.stderr.write(`${out.stderr}
`);
    process.exitCode = out.exitCode;
  } catch (e) {
    process.stderr.write(`samaran-guard: ${e.message}
`);
    const failed2 = strictMode() ? block(`Samaran guard failed (${e.message}), and SAMARAN_GUARD=strict blocks what it cannot check.`) : void 0;
    const out = respond(agent, event, failed2);
    if (out.stdout) process.stdout.write(`${out.stdout}
`);
    if (out.stderr) process.stderr.write(`${out.stderr}
`);
    process.exitCode = out.exitCode;
  }
}
if (process.argv[1] && /samaran-guard\.m?js$/.test(process.argv[1])) {
  await runGuard();
}
export {
  evaluate,
  respond,
  runGuard,
  strictMode,
  translate
};

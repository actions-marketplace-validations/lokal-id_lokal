"""Field names that announce personal data: CSV headers, JSON/YAML keys, and labels in text
("Agama: Islam", "Tgl. Lahir: 15-08-1995", "customer_phone", "NAMA_IBU_KANDUNG").
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Optional

from .. import _js
from ._names import AMBIGUOUS_GIVEN_NAMES, FAMILY_NAMES, GIVEN_NAMES, SECOND_NAMES
from .types import PiiType

_FIELDS: list[tuple[PiiType, str]] = [
    # A column called "pasien" or "pelanggan" holds that person's name.
    ('NAME', 'nama|name|full_?name|kepada|kpd|yth|attn|attention|pelapor|terlapor|korban|saksi|tersangka|terdakwa|pelaku|kepala_?keluarga|penanggung_?jawab|ahli_?waris|pemberi_?kuasa|penerima_?kuasa|requester|username|nama_?lengkap|first_?name|last_?name|middle_?name|given_?name|family_?name|surname|nama_?depan|nama_?tengah|nama_?belakang|nama_?panggilan|nickname|nama_?ibu_?kandung|mother_?s?_?maiden_?name|penerima|pengirim|recipient|pasien|patient|pelanggan|customer|nasabah|karyawan|employee|pegawai|siswa|mahasiswa|student|peserta|pemohon|debitur|pemilik|owner|pemesan|pembeli|buyer|konsumen|atas_?nama|a_n'),  # noqa: E501
    ('ADDRESS', 'alamat|address|full_?address|street|street_?address|domisili|alamat_?domisili|alamat_?ktp|alamat_?rumah|alamat_?pengiriman|shipping_?address|home_?address|billing_?address|alamat_?kirim|alamat_?tujuan|alamat_?penerima|alamat_?pengirim|alamat_?lengkap|alamat_?tinggal|tempat_?tinggal|kirim_?ke|dikirim_?ke|tujuan_?kirim|tujuan_?pengiriman|ship_?to|shipping_?to|deliver_?to|delivery_?address|delivery_?to|mailing_?address|residential_?address|residence|address_?line_?[12]'),  # noqa: E501
    ('NIK', 'nik|no_?ktp|nomor_?ktp|ktp|nomor_?induk_?kependudukan|national_?id'),
    ('KK', 'kk|no_?kk|nomor_?kk|kartu_?keluarga|no_?kartu_?keluarga|nomor_?kartu_?keluarga|family_?card(_?number)?'),
    ('NPWP', 'npwp|no_?npwp|nomor_?npwp|tax_?id|tin'),
    ('PASSPORT', 'paspor|passport|no_?paspor|nomor_?paspor|passport_?(no|number)'),
    ('SIM', 'sim|no_?sim|nomor_?sim|driver_?s?_?licen[cs]e|driving_?licen[cs]e'),
    ('NIP', 'nip|nip_?baru|nrp|nomor_?induk_?pegawai'),
    ('NISN', 'nisn|no_?nisn|nomor_?nisn|nomor_?induk_?siswa_?nasional'),
    ('AKTA', 'akta|no_?akta|nomor_?akta|(?:no_?|nomor_?)?akta_?(?:kelahiran|lahir|nikah|perkawinan|kawin|cerai|perceraian|kematian)|birth_?certificate(?:_?(?:no|number))?|marriage_?certificate(?:_?(?:no|number))?'),  # noqa: E501
    ('BPJS', 'bpjs|no_?bpjs|nomor_?bpjs|bpjs_?kesehatan|bpjs_?ketenagakerjaan|kis|no_?kis|jkn|kpj|(?:no_?|nomor_?)?(?:kartu_?)?(?:jkn|kis|jkn_?kis)|(?:no_?|nomor_?)kartu_?(?:bpjs|jkn|kis)'),  # noqa: E501
    ('PHONE', 'hp|no_?hp|nomor_?hp|nohp|telp|tlp|telepon|telpon|no_?telp|no_?telepon|nomor_?telepon|phone|phone_?number|mobile|mobile_?phone|handphone|whatsapp|wa|no_?wa|nomor_?wa|msisdn'),  # noqa: E501
    ('EMAIL', 'email|e_?mail|surel|alamat_?email|email_?address'),
    ('BANK_ACCOUNT', 'rekening|no_?rek|no_?rekening|nomor_?rekening|norek|rek|account_?number|bank_?account|account_?no|va|virtual_?account|no_?va'),  # noqa: E501
    ('CARD', 'card_?number|no_?kartu|nomor_?kartu|kartu_?kredit|credit_?card|cc_?number|pan'),
    ('IP', 'ip|ip_?address|ip_?addr|client_?ip|remote_?ip|remote_?addr|x_?forwarded_?for'),
    ('GEO', 'lat|lng|lon|latitude|longitude|koordinat|coordinates|coords|geo|geolocation|latlng|lat_?long'),
    ('BIRTH_DATE', 'tanggal_?lahir|tgl_?lahir|tgl_?lhr|tanggal_?kelahiran|tempat_?lahir|ttl|tempat_?tanggal_?lahir|tempat_?tgl_?lahir|tempat_?tgl_?lhr|date_?of_?birth|dob|birth_?date|birthdate|birthday|birth_?place|place_?of_?birth'),  # noqa: E501
    ('GENDER', 'jenis_?kelamin|jns_?kelamin|kelamin|gender|sex|jk|l_?p'),
    # "Agama/Kepercayaan", as Dukcapil forms print it.
    ('RELIGION', 'agama|religion|kepercayaan|agama_(?:dan_|atau_)?kepercayaan|kepercayaan_(?:dan_|atau_)?agama'),
    ('MARITAL_STATUS', 'status_?perkawinan|status_?kawin|status_?pernikahan|status_?nikah|perkawinan|marital_?status|status_?marital'),  # noqa: E501
    ('NATIONALITY', 'kewarganegaraan|warga_?negara|wn|nationality|citizenship'),
    ('HEALTH', 'diagnosa|diagnosis|diagnose|penyakit|riwayat_?penyakit|riwayat_?medis|rekam_?medis|kondisi_?medis|kondisi_?kesehatan|keluhan|gejala|alergi|allergy|allergies|golongan_?darah|gol_?darah|blood_?type|hasil_?lab|lab_?result|obat|medication|medications|resep|prescription|icd|icd_?10|medical_?history|medical_?record|disabilitas|disability|kehamilan|pregnancy|status_?vaksin|vaccination_?status|tindakan_?medis'),  # noqa: E501
    ('FINANCIAL', 'gaji|salary|(?:net|gross|base|basic)_?salary|take_?home_?pay|thp|gaji_?(?:pokok|bersih|kotor)|penghasilan|pendapatan|income|saldo|balance|limit_?kredit|credit_?limit|utang|hutang|debt|pinjaman|loan|loan_?amount|cicilan|installment|tunggakan|arrears|skor_?kredit|credit_?score|slik|kolektibilitas|kekayaan|net_?worth|harta'),  # noqa: E501
    ('CRIMINAL_RECORD', 'catatan_?kriminal|catatan_?kepolisian|catatan_?pidana|skck|riwayat_?pidana|riwayat_?kriminal|criminal_?record|criminal_?history|status_?hukum'),  # noqa: E501
    # Not "signature" or "face": in code those are crypto signatures and UI faces.
    ('BIOMETRIC', 'sidik_?jari|fingerprint|foto_?ktp|foto_?wajah|foto_?selfie|selfie|selfie_?ktp|face_?image|face_?photo|face_?embedding|biometri|biometric|biometrik|iris|retina|dna|genetik|genetic|voiceprint|voice_?print|tanda_?tangan|ttd'),  # noqa: E501
]

# "nama_pelanggan", "customer_phone", "alamat_pengiriman": the field, optionally qualified by whose it is.
_ENTITY = (
    'customer|pelanggan|nasabah|pasien|patient|user|pengguna|member|anggota|karyawan|employee|pegawai|siswa|student|'
    'mahasiswa|penerima|pengirim|recipient|sender|ibu|ayah|wali|orang_?tua|pemohon|applicant|debitur|peserta|pemilik|'
    'owner|contact|kontak|pemesan|pembeli|buyer|konsumen'
)
_QUALIFIER = f'{_ENTITY}|lengkap|baru|lama|asli|utama|rumah|kantor|ktp|domisili|pengiriman|pribadi|aktif|pokok|bersih|kotor|bulanan|tahunan|total|1|2'

# One alternation, tried in list order like the TypeScript loop: the first field type that matches the whole key wins.
_KEY_TYPES: list[PiiType] = [t for t, _ in _FIELDS]
_KEY_RE = _js.compile(
    '|'.join(f'(?P<k{i}>(?:(?:{_ENTITY})_)?(?:{alts})(?:_(?:{_QUALIFIER}))?)' for i, (_, alts) in enumerate(_FIELDS))
)

_NON_ALNUM = re.compile(r'[^a-z0-9]+')
_EDGE_UNDERSCORES = re.compile(r'^_+|_+\Z')


def normalize_key(key: str) -> str:
    return _EDGE_UNDERSCORES.sub('', _NON_ALNUM.sub('_', key.lower()))


@lru_cache(maxsize=8192)
def field_type(key: str) -> Optional[PiiType]:
    """The kind of personal data a field name announces, if any."""
    k = normalize_key(key)
    if not k or len(k) > 40:
        return None
    m = _KEY_RE.fullmatch(k)
    if not m:
        return None
    for i, t in enumerate(_KEY_TYPES):
        if m.group(f'k{i}') is not None:
            return t
    return None


_GENERIC_NAME_KEY = re.compile(r'name|nickname')


def is_generic_name_key(key: str) -> bool:
    """``name`` and ``title``-like keys are everywhere in code; only a full name counts for them."""
    return _GENERIC_NAME_KEY.fullmatch(normalize_key(key)) is not None


_NAME_PART_KEY = re.compile(r'(?:(?:customer|billing|shipping|user|contact)_)?(?:first|last|middle|given|family)_?name|surname')


def _is_name_part_key(key: str) -> bool:
    """One part of a person's name, as payment gateways and CRMs split it (``"first_name":"Siti"``)."""
    return _NAME_PART_KEY.fullmatch(normalize_key(key)) is not None


# Form labels rather than a person: `first_name: "First Name"`, `last_name: "Nama Belakang"`.
_NAME_LABEL_WORDS = _js.compile(r'(?:first|last|middle|given|family|sur|name|nama|depan|belakang|tengah|lengkap|full)', re.I)

_GENDER_WORD = _js.compile(r'(?:laki-?\s?laki|lelaki|perempuan|pria|wanita|male|female|man|woman|cowok|cewek)'
                           .replace(r'\s', _js.WS), re.I)
_GENDER_LETTER = re.compile(r'[LPMF]')
_DATE_KEY = re.compile(r'tanggal|tgl|date|dob|birthday|birthdate|ttl')
_DATE_LIKE = _js.compile(
    r'\d{1,4}[-/. ]\d{1,2}[-/. ]\d{1,4}|\d{1,2}' + _js.WS + r'+[A-Za-z]{3,9}\.?' + _js.WS + r'+\d{4}|\b(?:19|20)\d{2}\b'
)

_ROLE_KEY = re.compile(
    r'pasien|patient|pelanggan|customer|nasabah|karyawan|employee|pegawai|siswa|mahasiswa|student|peserta|pemohon|'
    r'debitur|pemilik|owner|penerima|pengirim|recipient|pemesan|pembeli|buyer|konsumen'
)

_EMPTY = _js.compile(r'(?:-+|null|none|nil|n/?a|undefined|tidak ada|kosong|\?)', re.I)
_TYPE_WORDS = {
    'string', 'number', 'boolean', 'bool', 'int', 'integer', 'bigint', 'varchar', 'char', 'text', 'date', 'datetime',
    'timestamp', 'float', 'double', 'decimal', 'any', 'object', 'array', 'null', 'undefined', 'true', 'false',
    'required', 'optional', 'nullable', 'unique', 'str', 'list', 'dict', 'enum', 'json', 'uuid', 'unknown', 'void',
}

_CODE_FILE = _js.compile(r'[\w-]\.(?:m?[jt]sx?|cjs|cts|py|json|ya?ml|sh|toml)\b', re.I)

_DIGIT_TYPES: frozenset[PiiType] = frozenset((
    'NIK', 'KK', 'NPWP', 'NIP', 'SIM', 'BPJS', 'NISN', 'PHONE', 'BANK_ACCOUNT', 'CARD',
))

# `user=dimas.anggara` in a log is a person; `user=root` or `user: postgres` is an account.
_USER_KEY = _js.rx(r'^(?:user|username|login)$')
_USER_VALUE = _js.rx(r'^[A-Za-z][\w. -]{2,40}$')
_USER_PARTS = _js.rx(r'[._ -]+')
_TRAILING_DIGITS = _js.rx(r'\d+$')


def is_known_name_part(word: str) -> bool:
    bare = _TRAILING_DIGITS.sub('', word.lower())
    return bare in GIVEN_NAMES or bare in AMBIGUOUS_GIVEN_NAMES or bare in FAMILY_NAMES or bare in SECOND_NAMES

_PLACEHOLDER = re.compile(r'\[[A-Z_]+_[0-9]+\]')
_CODE_LIKE = _js.compile(r'[{}<>`$\[\]]|=>|^\w+\.\w+\(')
_PARENS = re.compile(r'[()]')
_NICKNAME = _js.rx(r"\s+\([A-Z]?[a-z][A-Za-z .'-]*\)$")  # "(Ami)", not an acronym like "(GSS)"
_DOTTED_IDENT = _js.compile(r'[a-z_$][\w$]*\.[a-z_$][\w$.]*', re.I)
_EXPRESSION = _js.rx(r'^(?:new|await|typeof|function|return|yield|async)\s|^[A-Za-z_$][\w$.]*\($')
_INITIALS = _js.rx(r'^(?:[A-Z]\.[ 	]?){1,4}$')
_URL_SPACE = re.compile(r'%20|\+')
_ACCOUNT_LIKE = _js.rx(r'[-_.\d]|^(?:admin|root|system|bot|team|tim|null|user)$')
_HAS_LETTER = re.compile(r'[A-Za-z]')
_NAME_BAD_CHARS = re.compile(r'[0-9_(){}\[\]<>=]')
_UNDERSCORED_NAME = re.compile(r'[A-Za-z]+(?:_[A-Za-z]+){1,3}')
_CODE_KEYWORD = _js.compile(r'^(?:new|this|await|null|undefined|true|false|typeof|function|return|self|None)\b')
_PASCAL = re.compile(r'^[A-Z][a-z]+[A-Z]')
_STARTS_UPPER = re.compile(r'^[A-Z]')
_FIVE_DIGITS = re.compile(r'[0-9]{5}')


_IPV4_START = re.compile(r'(?:[0-9]{1,3}\.){3}[0-9]{1,3}')


def is_plausible_value(pii_type: PiiType, value: str, key: str) -> bool:
    """Values that are code, schema, or placeholders rather than someone's data."""
    # "Siti Aminah (Ami)": a nickname in brackets is part of the name, not a function call. "Siti%20Rahayu" and
    # "Siti+Rahayu" in a URL are the same name.
    v = _URL_SPACE.sub(' ', _NICKNAME.sub('', _js.trim(value))) if pii_type == 'NAME' else _js.trim(value)
    if not v or _EMPTY.fullmatch(v):
        return False
    if v.lower() in _TYPE_WORDS:
        return False
    if _PLACEHOLDER.fullmatch(v):
        return False  # already masked
    if pii_type == 'NAME' and _USER_KEY.search(normalize_key(key)):
        return bool(_USER_VALUE.search(v)) and any(is_known_name_part(w) for w in _USER_PARTS.split(v))
    # Code, not data: `req.body.nama`, `z.string()`, `${user.phone}`, `=> …`.
    if _CODE_LIKE.search(v):
        return False
    # `street = new RegExp(`, `alamat = buildAddress(`: an expression.
    if _EXPRESSION.search(v):
        return False
    if pii_type == 'AKTA' and sum(1 for ch in v if '0' <= ch <= '9') < 4:
        return False
    if pii_type == 'ADDRESS' and not _js.has_ws(v):
        return False  # a real address has more than one word
    # `"eval:alamat": "node evals/alamat-bench.mjs"` in a package.json is a command.
    if pii_type == 'ADDRESS' and _CODE_FILE.search(v):
        return False
    # `user.name` is code; initials ("A.S.", "M. R.") are a person.
    initials = pii_type == 'NAME' and _INITIALS.search(v) is not None
    if pii_type != 'ADDRESS' and (_PARENS.search(v) or (not initials and _DOTTED_IDENT.fullmatch(v))):
        return False
    digit_count = sum(1 for ch in v if '0' <= ch <= '9')
    if pii_type in _DIGIT_TYPES and digit_count < 6:
        return False
    # "No. Kartu" on a BPJS card is not a payment card: card numbers never start with 0.
    if pii_type == 'CARD' and next((ch for ch in v if '0' <= ch <= '9'), '') == '0':
        return False
    if pii_type in ('GEO', 'IP') and digit_count < 2:
        return False
    # `"ip-address": "^10.2.0"` in a lockfile is a package version; an address is a dotted quad or IPv6.
    if pii_type == 'IP' and not _IPV4_START.match(v) and ':' not in v:
        return False
    if pii_type == 'EMAIL' and '@' not in v:
        return False
    # `gender: "m"` in an i18n file is grammatical gender; a person's is one of these.
    if pii_type == 'GENDER' and not (_GENDER_LETTER.fullmatch(v) or _GENDER_WORD.fullmatch(v)):
        return False
    if pii_type == 'BIRTH_DATE' and _DATE_KEY.search(normalize_key(key)):
        # `ttl: 60000` is a time-to-live. A birth date looks like a date (or an Excel date serial).
        serial_ok = normalize_key(key) != 'ttl' and _FIVE_DIGITS.fullmatch(v) is not None and 7000 <= int(v) <= 55000
        if not _DATE_LIKE.search(v) and not serial_ok:
            return False
    if pii_type == 'NAME':
        # "Budi_Santoso": OpenAI's `name` field allows no spaces, so a person is written with underscores. A name the
        # lists know in it makes it a person; `build_and_test` is not one.
        if _UNDERSCORED_NAME.fullmatch(v):
            return any(is_known_name_part(w) for w in v.split('_'))
        if not _HAS_LETTER.search(v) or _NAME_BAD_CHARS.search(v):
            return False
        # `fullName = new codegen.Name(…)`: an expression, not a name.
        if _CODE_KEYWORD.search(v):
            return False
        if _PASCAL.search(v):
            return False  # PascalCase identifier
        words = _js.split_ws(v)
        if _is_name_part_key(key):
            if (
                len(words) > 4 or not all(_STARTS_UPPER.search(w) for w in words)
                or all(_NAME_LABEL_WORDS.fullmatch(w) for w in words)
            ):
                return False
        elif is_generic_name_key(key):
            # `name: Build and test` in a CI file is not a person.
            if len(words) < 2 or len(words) > 5 or not all(_STARTS_UPPER.search(w) for w in words):
                return False
        elif (
            _ROLE_KEY.fullmatch(normalize_key(key)) and len(words) == 1 and not _STARTS_UPPER.search(v)
            and _ACCOUNT_LIKE.search(v)
        ):
            # `"owner": "lokal-id"` is an account; "Siti", "siti aminah", or "sukirman" under `penerima` is a person.
            return False
    return True

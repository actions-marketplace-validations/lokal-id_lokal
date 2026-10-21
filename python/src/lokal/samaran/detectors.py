"""Indonesian personal data detectors. A line-by-line port of packages/core/src/samaran/detectors.ts.

The patterns are the TypeScript sources verbatim, compiled with `rx()` so they keep JavaScript semantics.
Keep both files in step: tests/vectors checks that both give the same matches.
"""

from __future__ import annotations

import datetime as _dt
import re
from collections.abc import Callable, Iterable
from typing import Optional

from .. import _js
from .._js import rx
from ..nik import parse_nik
from ..phone import parse_phone
from .fields import field_type, is_generic_name_key, is_plausible_value
from .types import PII_TYPES, Confidence, PiiMatch, PiiType

# The detectors run on a UTF-16 view of the text, where a character outside the BMP (an emoji) is two surrogate
# code points, exactly what a JavaScript regex without the `u` flag sees. Lengths, windows and quantifiers such as
# `{1,60}` then count the same as in TypeScript; detect_pii maps the offsets back to Python characters.


def _to_utf16_view(text: str) -> str:
    out: list[str] = []
    for ch in text:
        cp = ord(ch)
        if cp > 0xFFFF:
            cp -= 0x10000
            out.append(chr(0xD800 + (cp >> 10)))
            out.append(chr(0xDC00 + (cp & 0x3FF)))
        else:
            out.append(ch)
    return ''.join(out)


def _from_utf16_view(view: str) -> str:
    return view.encode('utf-16-le', 'surrogatepass').decode('utf-16-le', 'surrogatepass')


def _before(text: str, index: int, window: int = 40) -> str:
    """Text in the `window` characters before `index`, on the same line, lowercased."""
    chunk = text[max(0, index - window) : index]
    nl = chunk.rfind('\n')
    return (chunk[nl + 1 :] if nl >= 0 else chunk).lower()


def _last_units(s: str, n: int) -> str:
    """``s.slice(-n)``."""
    return s[-n:] if n else ''


def _match(pii_type: PiiType, start: int, value: str, confidence: Confidence) -> PiiMatch:
    return PiiMatch(pii_type, start, start + len(value), value, confidence)


def _digits(s: str) -> str:
    return ''.join(ch for ch in s if '0' <= ch <= '9')


def _luhn(digits: str) -> bool:
    total = 0
    double = False
    for ch in reversed(digits):
        d = ord(ch) - 48
        if double:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        double = not double
    return total % 10 == 0


def _is_real_date(y: int, m: int, d: int) -> bool:
    try:
        _dt.date(y, m, d)
    except ValueError:
        return False
    return True


def _is_nip(d: str) -> bool:
    """NIP ASN: birth date (8) + TMT CPNS year-month (6) + gender 1/2 (1) + serial (3)."""
    if len(d) != 18:
        return False
    y = int(d[0:4])
    tmt = int(d[8:12])
    tmt_month = int(d[12:14])
    return (
        1940 <= y <= 2010 and _is_real_date(y, int(d[4:6]), int(d[6:8]))
        and 1970 <= tmt <= 2040 and tmt - y >= 17 and 1 <= tmt_month <= 12 and d[14] in '12'
    )


# Card numbers published by Visa, Mastercard, Amex, Stripe, and payment gateways for testing.
_TEST_CARDS = {
    '4111111111111111', '4242424242424242', '4000056655665556', '4012888888881881', '4007000000027',
    '4222222222222', '5555555555554444', '5105105105105100', '5200828282828210', '2223003122003222',
    '378282246310005', '371449635398431', '378734493671000', '6011111111111117', '6011000990139424',
    '3530111333300000', '3566002020360505', '4811111111111114', '5211111111111117', '4911111111111113',
}

_KK_KEYWORD = rx(r'\b(kk|kartu keluarga)\b[^\d]*$')
_SIM_KEYWORD = rx(r'\b(sim|surat izin mengemudi|driving licen[cs]e)\b[^\d]*$')
_NIK_KEYWORD = rx(r'\b(nik|ktp|nomor induk kependudukan)\b')
_NPWP_KEYWORD = rx(r'\bnpwp\b')
_BPJS_KEYWORD = rx(r'\b(bpjs|jkn|kis|kartu indonesia sehat|kpj|jamsostek)\b')
_BANK_KEYWORD = rx(
    r'\b(no\.?\s*rek(ening)?|norek|rekening|rek|account|acc|a\/c|virtual account|va|transfer|tf|bca|bri|bni|mandiri|bsi|cimb|niaga|permata|danamon|btn|jago|seabank|blu|ocbc|panin|maybank|mega|muamalat)\b'  # noqa: E501
)
_DIGIT_RUN = rx(r'(?<![\d\w.])\d(?:[ -]?\d){7,18}(?![\d\w])')
_MOBILE_START = re.compile(r'(08|628)')


def _detect_digit_runs(text: str) -> list[PiiMatch]:
    """Runs of 8–19 digits, optionally separated by single spaces or dashes ("1234 5678 9012").

    Classified by length, structure, checksum, and nearby keywords.
    """
    out: list[PiiMatch] = []
    for m in _DIGIT_RUN.finditer(text):
        value = m.group(0)
        digits = _digits(value)
        ctx = _before(text, m.start())
        label = _last_units(ctx, 25)  # the words right before the number

        def push(t: PiiType, c: Confidence, start: int = m.start(), value: str = value) -> None:
            out.append(_match(t, start, value, c))

        # Mobile numbers (also used as e-wallet accounts) are left to the phone detector.
        if _MOBILE_START.match(digits) and parse_phone(digits).valid:
            continue
        n = len(digits)
        if n == 16 and _KK_KEYWORD.search(label):
            push('KK', 'high')
        elif 12 <= n <= 16 and _SIM_KEYWORD.search(label):
            push('SIM', 'high')
        elif n == 16 and parse_nik(digits).valid:
            push('NIK', 'high')
        elif _is_nip(digits):
            push('NIP', 'high')
        elif 13 <= n <= 19 and digits[0] in '3456' and _luhn(digits):
            if digits not in _TEST_CARDS:
                push('CARD', 'high')
        elif n in (15, 16) and _NPWP_KEYWORD.search(ctx):
            push('NPWP', 'high')
        elif n == 16 and _NIK_KEYWORD.search(ctx):
            push('NIK', 'medium')
        elif n in (13, 11) and _BPJS_KEYWORD.search(ctx):
            push('BPJS', 'high')
        elif 8 <= n <= 18 and _BANK_KEYWORD.search(ctx):
            push('BANK_ACCOUNT', 'high')
    return out


_NPWP_FORMATTED = rx(r'(?<!\d)\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}(?!\d)')


def _detect_npwp_formatted(text: str) -> list[PiiMatch]:
    return [_match('NPWP', m.start(), m.group(0), 'high') for m in _NPWP_FORMATTED.finditer(text)]


_PASSPORT = rx(r'(?<![A-Za-z0-9])[A-Z]{1,2}\s?\d{6,8}(?![A-Za-z0-9])')
_PASSPORT_KEYWORD = rx(r'\b(paspor|passport)\b')


def _detect_passports(text: str) -> list[PiiMatch]:
    return [
        _match('PASSPORT', m.start(), m.group(0), 'high')
        for m in _PASSPORT.finditer(text)
        if _PASSPORT_KEYWORD.search(_before(text, m.start(), 30))
    ]


# Separators never include a line break, and every group after the operator prefix has at least three digits.
# Otherwise a number at the end of a line swallows the digits that start the next one ("…6789\n14/10/26"),
# fails validation, and is left unmasked.
_MOBILE = rx(r'(?<![\d+\w])(?:\+62|62|0)[ \t-]?8\d{1,2}(?:[ \t.-]?\d{3,4}){2,3}(?![\d\w])')
_LANDLINE = rx(
    r'\((?:\+62[ \t]?|0)\d{2,3}\)[ \t]?\d{3,4}[ \t-]?\d{3,4}(?!\d)|(?<![\d\w])\+62[ \t]?[2-79]\d{1,2}[ \t-]?\d{3,4}[ \t-]?\d{3,4}(?!\d)'  # noqa: E501
)


# Words that may sit right before a number with "-" or "/" and still mean "this is a phone".
_PHONE_LABELS = {
    'hp', 'no', 'nomor', 'nohp', 'telp', 'tlp', 'tel', 'telepon', 'telpon', 'phone', 'ph', 'handphone', 'mobile', 'wa',
    'whatsapp', 'wa.me', 'nowa', 'sms', 'call', 'cs', 'cp', 'kontak', 'contact',
}
_CODE_CHARS = frozenset('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.')


def _glued_to_code(text: str, index: int) -> bool:
    """"INV-081234567890", "ORD/0812…": a number glued to a code is an ID, not a phone. "hp-0812…" and "wa.me/62…" are."""
    if index == 0 or text[index - 1] not in '-/':
        return False
    i = index - 1
    while i > 0 and text[i - 1] in _CODE_CHARS:
        i -= 1
    token = text[i : index - 1].lower()
    return any('a' <= c <= 'z' for c in token) and token not in _PHONE_LABELS and not token.endswith('wa.me')


def _detect_phones(text: str) -> list[PiiMatch]:
    out = [
        _match('PHONE', m.start(), m.group(0), 'high')
        for m in _MOBILE.finditer(text)
        if parse_phone(m.group(0)).valid and not _glued_to_code(text, m.start())
    ]
    out += [_match('PHONE', m.start(), m.group(0), 'medium') for m in _LANDLINE.finditer(text)]
    return out


# Domains reserved for documentation and testing (RFC 2606, RFC 6761) never belong to a person.
_RESERVED_EMAIL_DOMAIN = rx(r'@(?:[\w-]+\.)*(?:example\.(?:com|net|org)|[\w-]+\.(?:example|test|invalid|localhost))$', 'i')
_EMAIL = rx(r'(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])')
# Written out to dodge scrapers: "siti.rahayu88 [at] gmail [dot] com", "budi(at)yahoo.co.id".
_AT = r'\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\})\s*'
_DOT = r'(?:\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\})\s*|\.)'
_SPELLED_EMAIL = rx(rf'(?<![\w.+-])[A-Za-z0-9._%+-]+{_AT}[A-Za-z0-9-]+(?:{_DOT}[A-Za-z0-9-]+)*{_DOT}[A-Za-z]{{2,}}(?![\w-])', 'gi')


def _detect_emails(text: str) -> list[PiiMatch]:
    out = [
        _match('EMAIL', m.start(), m.group(0), 'high')
        for m in _EMAIL.finditer(text)
        if not _RESERVED_EMAIL_DOMAIN.search(m.group(0))
    ]
    out += [_match('EMAIL', m.start(), m.group(0), 'high') for m in _SPELLED_EMAIL.finditer(text)]
    return out


_IP = rx(r'(?<![\d.\w])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.\w])')
_IP_SKIP = rx(r'^(0\.|127\.|255\.255\.255\.255)')
_IP_VERSION = rx(r'\b(versi|version|ver|v)\.?\s*$')
_IP_PRIVATE = rx(r'^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)')


def _detect_ips(text: str) -> list[PiiMatch]:
    out: list[PiiMatch] = []
    for m in _IP.finditer(text):
        ip = m.group(0)
        if _IP_SKIP.search(ip):
            continue
        if _IP_VERSION.search(_before(text, m.start(), 12)):
            continue
        out.append(_match('IP', m.start(), ip, 'medium' if _IP_PRIVATE.search(ip) else 'high'))
    return out


_COORDS = rx(r'(?<![\d.])(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})(?![\d.])')


def _detect_coordinates(text: str) -> list[PiiMatch]:
    out: list[PiiMatch] = []
    for m in _COORDS.finditer(text):
        lat = float(m.group(1))
        lng = float(m.group(2))
        if abs(lat) > 90 or abs(lng) > 180:
            continue
        indonesia = -11.5 <= lat <= 6.5 and 94 <= lng <= 141.5
        out.append(_match('GEO', m.start(), m.group(0), 'high' if indonesia else 'medium'))
    return out


_MONTHS = (
    'Januari|Februari|Pebruari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Nopember|Desember|'
    'January|February|March|May|June|July|August|October|December|Jan|Feb|Mar|Apr|Jun|Jul|Agu|Agt|Ags|Aug|Sep|Sept|'
    'Okt|Oct|Nov|Des|Dec'
)
_DATE = rf'\d{{1,2}}[-/. ]\d{{1,2}}[-/. ]\d{{2,4}}|\d{{1,2}}\s+(?:{_MONTHS})\.?\s+\d{{4}}|\d{{4}}-\d{{2}}-\d{{2}}'
_BIRTH = rx(rf'\b(?:lahir|kelahiran|born)\b[^\n\d]{{0,40}}?({_DATE})', 'gi')


def _group_tail(m: re.Match[str], group: int = 1) -> tuple[int, str]:
    """Start and text of a group that ends the match, computed as TypeScript does (m.index + m[0].length - len)."""
    value = m.group(group)
    return m.start() + len(m.group(0)) - len(value), value


def _detect_birth_dates(text: str) -> list[PiiMatch]:
    return [_match('BIRTH_DATE', *_group_tail(m), 'high') for m in _BIRTH.finditer(text)]


_CONDITIONS = (
    r'hiv|aids|odha|tbc|tb paru|tuberkulosis|hepatitis(?: [abc])?|kanker(?: \w+)?|tumor(?: \w+)?|diabetes(?: melitus)?|'
    r'hipertensi|stroke|penyakit jantung|gagal ginjal|cuci darah|covid(?:-19)?|dbd|demam berdarah|malaria|kusta|lepra|'
    r'skizofrenia|bipolar|depresi(?: berat)?|gangguan jiwa|gangguan mental|odgj|autis(?:me)?|epilepsi|ims|sifilis|'
    r'gonore|herpes|hamil|keguguran'
)
# Medicines that name the condition they treat.
_MEDICATIONS = (
    'insulin|metformin|glibenclamide|arv|antiretroviral|obat tbc|rifampisin|isoniazid|kemoterapi|kemo|antidepresan|'
    'antipsikotik|fluoxetine|sertraline|risperidone|haloperidol|lithium|metadon|methadone|warfarin|amlodipine|captopril|'
    'levothyroxine|tamoxifen|hormon|kb|pil kb'
)
# Strong medical verbs: whatever follows is the condition.
_HEALTH_STRONG = rx(
    r'\b(?:didiagnosis|didiagnosa|terdiagnosis|terdiagnosa|mengidap|terinfeksi|riwayat penyakit|divonis)\s+(?:menderita\s+|mengidap\s+|penyakit\s+)?([^\n,.;:()]{2,60}?)(?=\s+(?:sejak|selama|dan sudah|dan sedang|tapi|namun|sehingga|jadi)\b|[\n,.;:()]|$)',  # noqa: E501
    'gi',
)
# Everyday words ("positif", "karena", "saya") only count before a known condition: "saya diabetes".
_HEALTH_GATED = rx(
    rf'\b(?:positif|menderita|terkena|kena|sakit|pasien|penderita|pengidap|penyintas|mengalami|karena|krn|akibat|gara-gara|punya|saya|aku|gue|gw|gua|dia|beliau)\s+((?:penyakit\s+)?(?:{_CONDITIONS}))\b',  # noqa: E501
    'gi',
)
# A known condition on its own in brackets: "obat buat ibu saya (diabetes)".
_HEALTH_BRACKETED = rx(rf'\(({_CONDITIONS})\)', 'gi')
# Treatment that reveals the condition: "obat insulin", "suntik insulin", "terapi ARV", "kemoterapi".
_HEALTH_TREATMENT = rx(
    rf'\b(?:obat|suntik(?:an)?|minum|konsumsi|terapi|resep)\s+({_MEDICATIONS})\b|\b(kemoterapi|radioterapi|hemodialisa|cuci darah)\b',  # noqa: E501
    'gi',
)
# Being in hospital is health data too: "dirawat di RSUD Cibinong", "opname di RS Hermina".
_HEALTH_HOSPITAL = rx(
    r'\b(?:dirawat|opname|rawat inap|diopname|dioperasi|isolasi)\s+(?:di\s+)?(?:(?:RSUD|RSU|RSIA|RSJ|RSAB|RS|Rumah Sakit|Puskesmas|Klinik)\b[^\n,.;:()]{0,40}?)(?=\s+(?:karena|krn|sejak|selama|dan|tapi|jadi|sampai)\b|[\n,.;:()]|$)',  # noqa: E501
    'gi',
)


def _detect_health(text: str) -> list[PiiMatch]:
    out = [_match('HEALTH', *_group_tail(m), 'high') for m in _HEALTH_STRONG.finditer(text)]
    out += [_match('HEALTH', *_group_tail(m), 'medium') for m in _HEALTH_GATED.finditer(text)]
    out += [_match('HEALTH', m.start() + 1, m.group(1), 'medium') for m in _HEALTH_BRACKETED.finditer(text)]
    for m in _HEALTH_TREATMENT.finditer(text):
        value = m.group(1) if m.group(1) is not None else m.group(2)
        out.append(_match('HEALTH', m.start() + len(m.group(0)) - len(value), value, 'medium'))
    out += [_match('HEALTH', m.start(), m.group(0), 'medium') for m in _HEALTH_HOSPITAL.finditer(text)]
    return out


_FINANCIAL = rx(
    r'\b(?:gaji|penghasilan|pendapatan|saldo|utang|hutang|pinjaman|cicilan|tunggakan|limit(?:\s+kartu)?(?:\s+kredit)?)(?:\s+(?:saya|aku|gue|gw|gua|dia|beliau|bulanan|tahunan|per\s+bulan|sebulan|setahun|bersih|kotor|rekening|terakhir|total|di\s+\w+))*\s*(?:sebesar|sekitar|kira-kira|cuma|hanya|adalah|ada|masih|tinggal|sisa|senilai|:|=)?\s*((?:Rp\.?\s?)?\d[\d.,]*(?:\s*(?:rb|ribu|k|jt|juta|m|miliar|milyar|t|triliun)\b)?)',  # noqa: E501
    'gi',
)
_TRAILING_PUNCT = rx(r'[.,]+$')
_AMOUNT_HAS_UNIT = rx(r'rp|[a-z]$', 'i')


def _detect_financial(text: str) -> list[PiiMatch]:
    out: list[PiiMatch] = []
    for m in _FINANCIAL.finditer(text):
        raw = m.group(1)
        amount = _TRAILING_PUNCT.sub('', raw)
        if not _AMOUNT_HAS_UNIT.search(amount) and len(_digits(amount)) < 4:
            continue
        out.append(_match('FINANCIAL', m.start() + len(m.group(0)) - len(raw), amount, 'medium'))
    return out


_RELIGION = rx(
    r'\b(?:beragama|agamanya|agama\s+(?:saya|aku|dia|beliau|kami|mereka))\s+(Islam|Kristen(?:\s+Protestan)?|Protestan|Katolik|Katholik|Hindu|Buddha|Budha|Konghucu|Khonghucu|Kong Hu Cu)\b',  # noqa: E501
    'gi',
)


def _detect_religion(text: str) -> list[PiiMatch]:
    return [_match('RELIGION', *_group_tail(m), 'high') for m in _RELIGION.finditer(text)]


# Indonesian plate region codes (kode wilayah TNKB).
_PLATE_REGIONS = (
    'AA|AB|AD|AE|AG|BA|BB|BD|BE|BG|BH|BK|BL|BM|BN|BP|DA|DB|DC|DD|DE|DG|DH|DK|DL|DM|DN|DP|DR|DT|EA|EB|ED|KB|KH|KT|KU|'
    'PA|PB|A|B|D|E|F|G|H|K|L|M|N|P|R|S|T|W|Z'
)
_PLATE = rx(rf'(?<![A-Za-z0-9])(?:{_PLATE_REGIONS})\s?\d{{1,4}}\s?[A-Z]{{1,3}}(?![A-Za-z0-9])')
_PLATE_SPACED = rx(r'\s\d+\s')
_PLATE_KEYWORD = rx(r'\b(plat|nopol|no\.?\s*pol|tnkb|kendaraan|motor|mobil)\b')


def _detect_plates(text: str) -> list[PiiMatch]:
    out: list[PiiMatch] = []
    for m in _PLATE.finditer(text):
        spaced = _PLATE_SPACED.search(m.group(0)) is not None
        keyword = _PLATE_KEYWORD.search(_before(text, m.start())) is not None
        if not spaced and not keyword:
            continue
        out.append(_match('PLATE', m.start(), m.group(0), 'high' if keyword else 'medium'))
    return out


# Titles between the honorific and the name are skipped: "Bapak Presiden Joko Widodo" → "Joko Widodo".
_TITLE_WORDS = {
    'bapak', 'ibu', 'pak', 'bu', 'mas', 'mbak', 'kak', 'bang', 'presiden', 'wakil', 'menteri', 'direktur',
    'dokter', 'dr', 'drs', 'dra', 'prof', 'ir', 'h', 'hj', 'guru', 'lurah', 'camat', 'bupati', 'walikota', 'wali',
    'gubernur', 'kepala', 'dosen', 'ketua', 'manajer', 'admin', 'kurir', 'driver', 'ustadz', 'ustadzah', 'sdr',
    'sdri', 'saudara', 'saudari', 'tn', 'ny', 'nn',
}
# Words that end (or rule out) a name in chat: "nama saya budi mau refund", "Ibu Kota", "atas nama perusahaan".
_NOT_NAME = set((
    'yang dan atau dengan dgn di ke dari dr untuk utk pada dalam ini itu tsb tersebut saya sy aku aq kamu km anda dia '
    'beliau kami kita mereka gue gw gua lu nya ya iya yaa ok oke kak sih dong deh nih tuh kok lah kah pun juga aja saja '
    'sudah udah sdh belum blm mau ingin pengen pingin minta mohon tolong bisa bisakah boleh akan sedang lagi masih baru '
    'tadi kemarin besok nanti sekarang hari sekali sekalian semua para terima kasih makasih selamat pagi siang sore malam '
    'halo hai permisi maaf refund transfer tf pesanan pesan order barang paket produk nomor no nik hp wa alamat email '
    'rekening rek umur usia lahir tinggal asal sebagai adalah ialah tidak tak gak ga nggak bukan jadi kalau kalo karena '
    'krn tapi namun perusahaan kantor toko pt cv ud yayasan koperasi instansi bank kota negara pertiwi jari hamil '
    'menyusui rumah tiri mertua kandung terdaftar sendiri ada punya kirim dikirim cek dicek tanya nanya bertanya sama '
    'bersama tentang soal mengenai sini situ sana apa siapa gimana bagaimana kenapa mana kapan berapa harap segera '
    'langsung dulu lalu kemudian terus menyatakan bahwa yg sekalian islam kristen katolik hindu buddha konghucu '
    'jl jln jalan gg gang the and i am is a an of to for want my senin selasa rabu kamis jumat sabtu minggu januari '
    'februari maret april mei juni juli agustus september oktober november desember '
    # Common words people capitalize in chat ("saya Cuma mau tanya"), roles, groups, and things that get named.
    'cuma hanya pernah sering selalu benar betul yakin setuju kecewa senang puas bingung orang customer pelanggan '
    'pembeli penjual member anggota warga mahasiswa siswa karyawan pegawai seller buyer user pengguna manajemen '
    'management direksi pimpinan tim team seluruh keluarga pribadi rt rw satpam ojol cs domain file folder tabel '
    'table kolom column variabel fungsi function class akun aplikasi app server database program manfaat '
    # Institutions: "atas nama Pengendali Data", "atas nama Menteri Keuangan".
    'pengendali prosesor pemerintah kementerian keuangan negeri daerah republik indonesia rakyat dewan lembaga '
    'badan dinas direktorat komisi mahkamah pengadilan kepolisian polri tni sekretariat umum nasional pusat'
).split(' '))
# Particles inside a name: "Nur Aisyah binti Ahmad", "Van der Berg".
_NAME_PARTICLES = {'bin', 'binti', 'van', 'der', 'de', 'al', 'el', 'da', 'dos'}
_ORGANIZATION = {'pt', 'cv', 'ud', 'toko', 'yayasan', 'koperasi', 'perusahaan', 'bank'}
_NAME_TOKEN = rx("[ \\t]*([A-Za-z][A-Za-z'\u2019-]*\\.?)", 'y')
_UPPER_START = re.compile(r'[A-Z]')
_ASCII_LETTER = re.compile(r'[A-Za-z]')
_TRAILING_DOT_COMMA = rx(r'[.,]+$')


def _name_at(text: str, start: int, confidence: Confidence, capitalized: bool = False) -> Optional[PiiMatch]:
    """Up to five words starting at `start`, stopping at a word that is not part of a name.

    Leading titles are skipped. `capitalized` requires each word to start with a capital (for weak triggers).
    """
    words: list[tuple[int, int, str]] = []
    pos = start
    while len(words) < 5:
        m = _NAME_TOKEN.match(text, pos)
        if not m:
            break
        word = m.group(1)
        bare = (word[:-1] if word.endswith('.') else word).lower()
        word_start = m.start() + len(m.group(0)) - len(word)
        pos = m.end()
        if not words and (bare in _TITLE_WORDS or bare in ('adalah', 'ialah')):
            continue
        if bare in _NOT_NAME or bare.endswith('nya') or (not words and bare in _NAME_PARTICLES):
            break
        if words and bare in _TITLE_WORDS:
            return None  # "barangnya buat mbak yuni": not one name
        if capitalized and not _UPPER_START.match(word) and bare not in _NAME_PARTICLES:
            break
        words.append((word_start, word_start + len(word), bare))
        if word.endswith('.') and len(bare) > 1:
            break  # "… Budi." ends the sentence; "M. Rizky" goes on
    while words and words[-1][2] in _NAME_PARTICLES:
        words.pop()
    if not words or words[0][2] in _ORGANIZATION:
        return None
    value = _TRAILING_DOT_COMMA.sub('', text[words[0][0] : words[-1][1]])
    if len(_ASCII_LETTER.findall(value)) < 2:
        return None
    return _match('NAME', words[0][0], value, confidence)


# Phrases that introduce a name, in any case: "atas nama budi santoso", "nama saya Rina", "bernama Rizky".
_NAME_INTRO = rx(
    r'\b(?:a\.\s?n\.?|a\/n|atas\s+nama|nama\s+(?:lengkap\s+)?(?:saya|aku|ku|gue|gw|sy)|namaku|namanya|nama\s+(?:lengkap\s+)?(?:anak|ibu|bapak|ayah|suami|istri|adik|kakak|teman|orang\s+tua)\s+(?:saya|aku|kami|gue)|bernama|dengan\s+nama|my\s+name\s+is)(?![A-Za-z])[ \t]*(?:[:=][ \t]*)?',  # noqa: E501
    'gi',
)
# Weaker cues, so the name itself must be capitalized: "saya Rina Wulandari", "halo, dengan Agus", "Penerima Budi".
_NAME_CUE = rx(
    r'\b(?:saya|aku|gue|gw)[ \t]*,?[ \t]+|\b(?:halo|hai|hallo|selamat\s+(?:pagi|siang|sore|malam))[ \t]*,?[ \t]*(?:ini|dengan|dgn)[ \t]+|\b(?:penerima|pengirim|pemesan|pembeli)[ \t]+',  # noqa: E501
    'gi',
)
_HONORIFIC = rx(r'(?<![\w-])(?:Bapak|Ibu|Pak|Bu|Sdr\.?|Sdri\.?|Saudara|Saudari|Mas|Mbak|Kak|Bang|Tn\.|Ny\.|Nn\.)[ \t]+', 'gi')
_LOWERCASE_OK = rx(r'^(?:bapak|ibu|mbak)\b')
_REPORTED_SPEECH = rx(
    r'\b(?:tadi|kemarin|kemaren|katanya|kata)[ \t]+([A-Za-z]{3,15})[ \t]+(bilang|ngomong|nanya|nanyain|minta|cerita|nelpon|telpon|ngechat|nge-?wa|kasih\s+tau|ngasih\s+tau)\b',  # noqa: E501
    'gi',
)
_LEADING_WORD = rx(r'^\S+[ \t]+')
# Speakers that are relatives, roles, or software rather than a named person.
_NOT_A_SPEAKER = set(['mama', 'mamah', 'papa', 'papah', 'ayah', 'bunda', 'emak', 'abah', 'suami', 'istri', 'anak', 'adik', 'adek', 'kakak', 'abang', 'teman', 'temen', 'sahabat', 'tetangga', 'bos', 'atasan', 'boss', 'orangnya', 'mereka', 'kalian', 'sistem', 'system', 'aplikasi', 'website', 'web', 'bot', 'google', 'kurir', 'driver', 'ojol', 'sopir', 'penjual', 'pembeli', 'seller', 'admin', 'cs', 'operator', 'petugas', 'dokter', 'perawat', 'bidan', 'guru', 'dosen', 'polisi', 'pacar', 'doi', 'beliau'])
_GREETING_SELF = rx(
    r'\b(?:halo|hai|hallo|hi|permisi|assalamualaikum|selamat\s+(?:pagi|siang|sore|malam))[ \t]*,?[ \t]*(?:(?:kak|kakak|min|admin|gan|sis|mas|mbak|pak|bu|bang)[ \t]*,?[ \t]+)?(?:ini|sama|dengan|dgn)[ \t]+',  # noqa: E501
    'gi',
)
_SELF_INTRO_END = rx(r'^\s*(?:[,.!\n]|$)')


def _detect_names(text: str) -> list[PiiMatch]:
    """Names introduced without a colon: "a.n. Budi Santoso", "nama saya budi", "Bapak Budi", "bu sari"."""
    out: list[PiiMatch] = []

    def add(found: Optional[PiiMatch]) -> None:
        if found:
            out.append(found)

    for m in _NAME_INTRO.finditer(text):
        add(_name_at(text, m.end(), 'high'))
    for m in _NAME_CUE.finditer(text):
        add(_name_at(text, m.end(), 'medium', True))
    for m in _HONORIFIC.finditer(text):
        # "Ibu Sari Dewi di Depok" stops at "di". After "bapak/ibu/mbak" a lowercase name is common in chat
        # ("bapak ahmad"); the short ones ("kak", "pak", "bu") too often just address the reader.
        lowercase_ok = _LOWERCASE_OK.search(m.group(0)) is not None
        add(_name_at(text, m.end(), 'medium', not lowercase_ok))
    # "tadi budi bilang …": reported speech names whoever spoke, unless that is a role or a thing.
    for m in _REPORTED_SPEECH.finditer(text):
        word = m.group(1)
        bare = word.lower()
        if bare in _NOT_NAME or bare in _TITLE_WORDS or bare in _NOT_A_SPEAKER:
            continue
        lead = _LEADING_WORD.match(m.group(0))
        assert lead is not None
        out.append(_match('NAME', m.start() + len(lead.group(0)), word, 'medium'))
    # "halo kak ini rina, …": a one-word lowercase self-introduction, only when a comma or line end closes it.
    for m in _GREETING_SELF.finditer(text):
        found = _name_at(text, m.end(), 'medium')
        if found and not _js.has_ws(found.value) and _SELF_INTRO_END.search(text[found.end :]):
            add(found)
    return out


# Chat export lines: Android "12/10/26 09.14 - Dewi Lestari: …", iOS "[12/10/26 09.14.33] Dewi Lestari: …",
# and the export title "Chat WhatsApp dengan Dewi Lestari". The sender is whoever saved that contact name.
_CHAT_SENDER = rx(
    '^\u200e?\\[?\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4},?[ \\t]+\\d{1,2}[.:]\\d{2}(?:[.:]\\d{2})?(?:[ \\t\u202f]?[AP]M)?\\]?(?:[ \\t]+-)?[ \\t]+([^:\\n]{1,60}?):[ \\t]',  # noqa: E501
    'dgm',
)
_CHAT_TITLE = rx(
    r'^(?:Chat WhatsApp dengan|WhatsApp Chat with|Chat dengan|Riwayat chat dengan)[ \t]+([^\n]{1,60}?)[ \t]*$', 'dgim'
)
# Senders that are a business or a system role, not a customer.
_NOT_A_PERSON = rx(
    r'\b(?:toko|shop|store|official|olshop|admin|cs|customer service|support|tim|team|pt|cv|ud|bot|system|sistem|info|layanan|grosir)\b|^(?:error|warn|warning|info|debug|trace|fatal|notice)$',  # noqa: E501
    'i',
)
_TILDE = rx(r'^~\s*')
_PHONE_ONLY = rx(r'^[+\d\s()-]+$')


def _detect_chat_senders(text: str) -> list[PiiMatch]:
    out: list[PiiMatch] = []
    for pattern in (_CHAT_SENDER, _CHAT_TITLE):
        for m in pattern.finditer(text):
            group = m.group(1)
            sender = _js.trim(_TILDE.sub('', group, count=1))
            # Unsaved contacts show as a number; the phone detector already covers those.
            if not any(ch.isalpha() for ch in _from_utf16_view(sender)) or _PHONE_ONLY.search(sender) or _NOT_A_PERSON.search(sender):
                continue
            out.append(_match('NAME', m.start(1) + group.find(sender), sender, 'high'))
    return out


_THING_TABLE = rx(
    r'produk|product|barang|item|sku|kategori|categor|menu|toko|store|shop|merchant|brand|merek|layanan|service|paket|package|kota|city|provinsi|province|wilayah|region|kecamatan|kelurahan|desa|district|bank|kurir|courier|ekspedisi|tag|role|permission|setting|config|status|metode|method',  # noqa: E501
    'i',
)
_COLUMN_QUOTES = rx(r'^[`"[]|[`"\]]$', 'g')
_COLUMN_NAME = rx(r'^(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|[\w$]+)')
_NOT_A_COLUMN = rx(r'^(?:PRIMARY|KEY|UNIQUE|CONSTRAINT|INDEX|FOREIGN|CHECK|FULLTEXT|SPATIAL|EXCLUDE|LIKE|PERIOD)\b', 'i')
_CREATE_TABLE = rx(
    r'\bCREATE\s+(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\w.]+)\s*\(',
    'gi',
)
_INSERT_COLUMNS = rx(r'\b(?:INSERT|REPLACE)\s+(?:IGNORE\s+)?INTO\s+([`"\w.]+)\s*\(([^)]{1,2000})\)\s*VALUES\s*', 'gi')
_INSERT_VALUES = rx(r'\b(?:INSERT|REPLACE)\s+(?:IGNORE\s+)?INTO\s+([`"\w.]+)\s+VALUES\s*', 'gi')
_COPY_FROM_STDIN = rx(r'^COPY\s+([`"\w.]+)\s*\(([^)]{1,2000})\)\s+FROM\s+stdin;\r?\n', 'gim')
_SQL_DUMP = rx(r'\b(?:INTO|COPY)\b', 'i')
_TABLE_QUOTES = re.compile(r'[`"]')
_GENERIC_COLUMN = rx(r'^(?:nama|name|title|judul)$', 'i')
_SQL_SPACE_OR_COMMA = _js.WS_SET | {','}
_SQL_BEFORE_NUMBER = _js.WS_SET | {'(', ','}
_LEADING_DIGITS = re.compile(r'[0-9]+')


def _table_key(name: str) -> str:
    """``public.pelanggan``, ``"pelanggan"``, and ```pelanggan``` name the same table."""
    return _TABLE_QUOTES.sub('', name).split('.')[-1].lower()


def _column_types(table: str, columns: list[str]) -> list[Optional[PiiType]]:
    # `produk.nama` is a product; only a person's table makes a bare "nama" column a name.
    thing_table = _THING_TABLE.search(table) is not None
    return [None if thing_table and _GENERIC_COLUMN.search(c) else field_type(c) for c in columns]


def _add_column(columns: list[str], definition: str) -> None:
    item = _js.trim(definition)
    name = _COLUMN_NAME.search(item)
    if name and not _NOT_A_COLUMN.search(item):
        columns.append(_COLUMN_QUOTES.sub('', name.group(0)))


def _created_tables(text: str) -> dict[str, list[str]]:
    """The columns of every ``CREATE TABLE``, so rows without column names (mysqldump) can be read by column."""
    tables: dict[str, list[str]] = {}
    for m in _CREATE_TABLE.finditer(text):
        columns: list[str] = []
        depth = 1
        start = m.end()
        limit = min(len(text), start + 100_000)
        i = start
        while i < limit and depth > 0:
            ch = text[i]
            if ch == "'":
                # A default or comment: `DEFAULT 'a,b'`, `COMMENT 'nama (lengkap)'`.
                j = i + 1
                while j < limit and not (text[j] == "'" and (j + 1 >= len(text) or text[j + 1] != "'")):
                    j += 2 if text[j] == "'" or text[j] == '\\' else 1
                i = j
            elif ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
                if depth == 0:
                    _add_column(columns, text[start:i])
            elif ch == ',' and depth == 1:
                _add_column(columns, text[start:i])
                start = i + 1
            i += 1
        if depth == 0:
            tables[_table_key(m.group(1))] = columns
    return tables


def _detect_sql_inserts(text: str) -> list[PiiMatch]:
    """SQL dumps, with values matched to their columns.

    ``INSERT INTO pelanggan (nama, nik, …) VALUES ('Hendra', '1371…'), (…);``, rows without column names under a
    ``CREATE TABLE`` (mysqldump, ``pg_dump --inserts``), and ``COPY … FROM stdin`` blocks (pg_dump's default).
    """
    if not _SQL_DUMP.search(text):
        return []
    out: list[PiiMatch] = []
    for m in _INSERT_COLUMNS.finditer(text):
        columns = [_COLUMN_QUOTES.sub('', _js.trim(c)) for c in m.group(2).split(',')]
        types = _column_types(m.group(1), columns)
        if any(types):
            out.extend(_sql_values(text, m.end(), types, columns))
    tables: Optional[dict[str, list[str]]] = None
    for m in _INSERT_VALUES.finditer(text):
        if tables is None:
            tables = _created_tables(text)
        created = tables.get(_table_key(m.group(1)))
        if created is None:
            continue
        types = _column_types(m.group(1), created)
        if any(types):
            out.extend(_sql_values(text, m.end(), types, created))
    for m in _COPY_FROM_STDIN.finditer(text):
        columns = [_COLUMN_QUOTES.sub('', _js.trim(c)) for c in m.group(2).split(',')]
        types = _column_types(m.group(1), columns)
        if not any(types):
            continue
        pos = m.end()
        while pos < len(text):
            end = text.find('\n', pos)
            if end == -1:
                end = len(text)
            line = text[pos : end - 1 if end > pos and text[end - 1] == '\r' else end]
            if line == '\\.':
                break
            at = pos
            for idx, cell in enumerate(line.split('\t')):
                t = types[idx] if idx < len(types) else None
                # \N is NULL.
                if t and cell != '\\N' and is_plausible_value(t, cell, columns[idx]):
                    out.append(_match(t, at, cell, 'high'))
                at += len(cell) + 1
            pos = end + 1
    return out


def _sql_values(text: str, i: int, types: list[Optional[PiiType]], columns: list[str]) -> list[PiiMatch]:
    """Walks the VALUES tuples starting at `i`, matching each value to its column."""
    out: list[PiiMatch] = []

    def type_at(col: int) -> Optional[PiiType]:
        return types[col] if col < len(types) else None

    def column_at(col: int) -> str:
        return columns[col] if col < len(columns) else ''

    col = 0
    depth = 0
    # Walk the tuples character by character so quoted commas and parentheses stay inside their value.
    while i < len(text):
        ch = text[i]
        if ch in ("'", '"'):
            j = i + 1
            while j < len(text) and not (text[j] == ch and (j + 1 >= len(text) or text[j + 1] != ch)):
                j += 2 if text[j] == ch or text[j] == '\\' else 1
            t = type_at(col) if depth == 1 else None
            value = text[i + 1 : j]
            if t and is_plausible_value(t, value, column_at(col)):
                out.append(_match(t, i + 1, value, 'high'))
            i = j + 1
            continue
        if ch == '(':
            depth += 1
            if depth == 1:
                col = 0
        elif ch == ')':
            depth -= 1
        elif ch == ',' and depth == 1:
            col += 1
        elif ch == ';' and depth == 0 or depth == 0 and ch not in _SQL_SPACE_OR_COMMA:
            break
        elif depth == 1 and '0' <= ch <= '9' and text[i - 1] in _SQL_BEFORE_NUMBER:
            # An unquoted number in a personal column: `nik` stored as BIGINT.
            num_match = _LEADING_DIGITS.match(text, i)
            assert num_match is not None
            num = num_match.group(0)
            t = type_at(col)
            if t and is_plausible_value(t, num, column_at(col)):
                out.append(_match(t, i, num, 'high'))
            i += len(num)
            continue
        i += 1
    return out


# A street only counts as personal data when it is pinned to a house: No., Blok, Kav., or RT/RW.
_STREET = rx(
    r'\b(?:Jl|Jln|Jalan|Gg|Gang|Komp|Kompleks|Perum|Perumahan)\.?\s+[A-Za-z0-9][^\n;]{1,80}?(?:\b(?:No|Nomor|Blok|Kav)\.?\s*[A-Za-z]?\d+[A-Za-z]?(?:\/\d+)?(?:,?\s*RT\.?\s*\d{1,3}\s*\/\s*RW\.?\s*\d{1,3})?|\bRT\.?\s*\d{1,3}\s*\/\s*RW\.?\s*\d{1,3})',  # noqa: E501
    'g',
)
_RTRW = rx(r'\bRT\.?\s*0*\d{1,3}\s*\/\s*RW\.?\s*0*\d{1,3}\b', 'gi')


def _detect_street_addresses(text: str) -> list[PiiMatch]:
    out = [_match('ADDRESS', m.start(), m.group(0), 'high') for m in _STREET.finditer(text)]
    out += [_match('ADDRESS', m.start(), m.group(0), 'medium') for m in _RTRW.finditer(text)]
    return out


_NAME_STOP = rx(
    r'\s(?:dan|dengan|yang|nik|hp|no|nomor|umur|usia|alamat|email|tinggal|lahir|asal|dari|di|ke|untuk|sebagai|mau|'
    r'ingin|minta|tolong|saya|aku|gue|gua|gw|mohon|terima|makasih|thanks|thank|thx|tks|trims|bisa|boleh|apakah|kapan|'
    r'berapa|gimana|bagaimana|kenapa|mengapa|tanya|nanya|sudah|udah|sdh|belum|blm|akan|sedang)\b',
    'i',
)
# Chat words after a name: "Nama: Budi Santoso ya kak". Lowercase only, so "Lee Dong Hae" keeps its "Dong".
_NAME_STOP_CHAT = rx(
    r'\s(?:ya|yah|yaa|iya|kak|kakak|gan|sis|min|pak|bu|dong|deh|sih|kok|nih|aja|saja|juga|lho|loh|ok|oke|okay|lagi|'
    r'baru|tadi|kemarin|kemaren|besok|nanti|sekarang)\b'
)
# A name ends at an emoji, a pictograph, or ! and ?. Detectors see UTF-16, so an emoji is a surrogate pair here.
_NAME_END = rx(r'[!?\u2190-\u2bff\ud800-\udfff\ufe0f]')
_MULTI_PART: frozenset[PiiType] = frozenset(('ADDRESS', 'BIRTH_DATE', 'HEALTH', 'GEO'))
_SENTENCE_END = rx(r'\.\s+[A-Z]')
_VALUE_END = rx(r'[;|&]')
_NEXT_PAIR = rx(r'\s+[A-Za-z_][\w.-]*=(?!=)')
_WS_ONE = rx(r'\s')
_NEXT_COLON = rx(r':(?!\/\/)')
_FIRST_DIGIT = re.compile(r'[0-9]')
_TRAILING_VALUE_NOISE = rx(r'[\s.,}\]]+$')


_WS_SPLIT_KEEP = rx(r'(\s+)')


def _take_words(s: str, n: int) -> str:
    """The first `n` words of `s` exactly as written.

    Rejoining ``split(/\\s+/)`` with single spaces would shorten "Siti   Aminah", and the mask would then stop
    short and leave the end of the name visible.
    """
    return ''.join(_WS_SPLIT_KEEP.split(s)[: max(0, 2 * n - 1)])


def _js_search(pattern: re.Pattern[str], s: str) -> int:
    m = pattern.search(s)
    return m.start() if m else -1


def _cut_value(pii_type: PiiType, raw: str) -> str:
    """Cuts an unquoted value where the next field begins."""
    v = raw
    semi = _js_search(_VALUE_END, v)
    if semi >= 0:
        v = v[:semi]
    # logfmt: "nik=3201… hp=0812… err=…" — the next key=value pair starts a new field.
    pair = _js_search(_NEXT_PAIR, v)
    if pair >= 0:
        v = v[:pair]
    # These never contain spaces: "user_email=budi@x.com tadi" ends at the space.
    if pii_type in ('EMAIL', 'IP'):
        v = _WS_ONE.split(v, maxsplit=1)[0]
    # Another "Label:" later on the line ends this value.
    next_colon = _js_search(_NEXT_COLON, v)
    if next_colon > 0:
        head = v[:next_colon]
        comma = head.rfind(',')
        if comma >= 0:
            v = head[:comma]
        else:
            words = _js.split_ws(head)
            cut = len(words) - 1
            for i in range(1, len(words)):
                if field_type(' '.join(words[i:])):
                    cut = i
                    break
            v = _take_words(head, cut)
    if pii_type == 'HEALTH':
        # "diagnosa: Diabetes tipe 2. Plat B 1234 XYZ": a condition ends with its sentence.
        end = _js_search(_SENTENCE_END, v)
        if end >= 0:
            v = v[:end]
    if pii_type in _MULTI_PART:
        # "Alamat: Jl. Mawar No. 5, Depok, HP 0812…": keep commas until a segment opens with a field name.
        parts = v.split(',')
        keep = 1
        while keep < len(parts):
            lead = _js.split_ws(_js.trim(parts[keep]))[:3]
            if any(field_type(' '.join(lead[: i + 1])) for i in range(len(lead))):
                break
            keep += 1
        v = ','.join(parts[:keep])
    else:
        v = v.split(',')[0]
    if pii_type == 'NAME':
        for pattern in (_NAME_END, _NAME_STOP, _NAME_STOP_CHAT):
            stop = _js_search(pattern, v)
            if stop >= 0:
                v = v[:stop]
        digit = _js_search(_FIRST_DIGIT, v)
        if digit >= 0:
            v = v[:digit]
        v = _take_words(v, 5)
    return _js.trim(_TRAILING_VALUE_NOISE.sub('', v))


# What `_label_before` computes, as a regex over the line (kept for the equivalence tests).
_LABEL = rx(r"""((?:["'`]?[A-Za-z][A-Za-z0-9_./-]*["'`]?[ \t]+){0,4}["'`]?[A-Za-z][A-Za-z0-9_./-]*["'`]?)$""")
_SEPARATOR = rx(r'[ \t]*(?::(?![:\/])|=(?![=>]))[ \t]*', 'g')
_LABEL_WORDS = re.compile(r'[ \t]+')
_QUOTES = frozenset('"\'`')
_LABEL_CHARS = frozenset('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_./-')
_LETTERS = frozenset('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz')
_VALUE_BREAK = re.compile(r'[;|&:]')


def _label_before(text: str, line_start: int, end: int) -> Optional[str]:
    """The label ending at `end`, as ``_LABEL.search(text[line_start:end] trimmed)`` finds it.

    Scans right to left over at most five words instead of the whole line. On a 2 MB single-line JSON file the
    regex made this detector quadratic, long enough for the guard hook to time out (and fail open).
    """
    ws = _js.WS_SET
    while end > line_start and text[end - 1] in ws:
        end -= 1
    pos = end
    start = -1
    for _ in range(5):
        # One word: an optional quote, a letter, label characters, an optional quote.
        p = pos
        if p > line_start and text[p - 1] in _QUOTES:
            p -= 1
        run_end = p
        while p > line_start and text[p - 1] in _LABEL_CHARS:
            p -= 1
        first = p
        while first < run_end and text[first] not in _LETTERS:
            first += 1
        if first >= run_end:
            break
        start = p - 1 if first == p and p > line_start and text[p - 1] in _QUOTES else first
        # The label continues leftwards only over a whole word followed by spaces or tabs.
        if first != p:
            break
        q = start
        while q > line_start and text[q - 1] in ' \t':
            q -= 1
        if q == start:
            break
        pos = q
    return None if start < 0 else text[start:end]


def _value_extent(text: str, start: int, end: int) -> int:
    """How much of the line after a label `_cut_value` can look at.

    Up to the first ``;``, ``|`` or ``&``, or just past the first colon that ends the value (not one in "://", and
    not one right at the start, which _cut_value ignores). Cutting there gives the same result and stays linear.
    """

    def ends_value(i: int) -> bool:
        return text.startswith(':', i) and not text.startswith('//', i + 1)

    colons_cut = not ends_value(start)
    for m in _VALUE_BREAK.finditer(text, start, end):
        i = m.start()
        if text[i] != ':':
            return i
        if colons_cut and ends_value(i):
            return min(end, i + 3)
    return end


def _detect_labeled_fields(text: str) -> list[PiiMatch]:
    """"Label: value" in prose, forms, logs, JSON, YAML and .env.

    "Agama: Islam", "NAMA : BUDI SANTOSO", "tgl. lahir: 15-08-1995", "nama: budi", "customer_email" = "…".
    """
    out: list[PiiMatch] = []
    line_start = 0
    line_end = text.find('\n')
    if line_end == -1:
        line_end = len(text)
    for m in _SEPARATOR.finditer(text):
        while m.start() > line_end:
            line_start = line_end + 1
            line_end = text.find('\n', line_start)
            if line_end == -1:
                line_end = len(text)
        label = _label_before(text, line_start, m.start())
        if not label:
            continue
        words = _LABEL_WORDS.split(_js.trim(label))
        pii_type: Optional[PiiType] = None
        key = ''
        for i in range(len(words)):
            key = ' '.join(words[i:])
            pii_type = field_type(key)
            if pii_type:
                break
        if not pii_type:
            continue

        value_start = m.end()
        raw_end = line_end - 1 if line_end > value_start and text[line_end - 1] == '\r' else line_end
        start = value_start
        quote = text[value_start] if value_start < raw_end else ''
        if quote in _QUOTES:
            close = text.find(quote, value_start + 1, raw_end)
            if close == -1:
                continue
            value = text[value_start + 1 : close]
            start += 1
        else:
            raw = text[value_start : _value_extent(text, value_start, raw_end)]
            value = _cut_value(pii_type, raw)
            # _cut_value trims; "nama: Budi" starts after the no-break space, not at it.
            if value:
                start += raw.find(value)
        if not is_plausible_value(pii_type, value, key):
            continue
        # `name: "Default Greeting"` is everywhere in code; only Indonesian/role labels are high-confidence.
        out.append(_match(pii_type, start, value, 'medium' if is_generic_name_key(key) else 'high'))
    return out


def _csv_fields(line: str, delimiter: str) -> list[tuple[int, int]]:
    """Splits one CSV line into fields with their offsets, honoring double quotes."""
    fields: list[tuple[int, int]] = []
    n = len(line)
    i = 0
    while i <= n:
        if i < n and line[i] == '"':
            j = i + 1
            while j < n and not (line[j] == '"' and (j + 1 >= n or line[j + 1] != '"')):
                j += 2 if line[j] == '"' else 1
            fields.append((i + 1, j))
            i = line.find(delimiter, j)
        else:
            nxt = line.find(delimiter, i)
            fields.append((i, n if nxt == -1 else nxt))
            i = nxt
        if i == -1:
            break
        i += len(delimiter)
    return fields


def _strip_cr(s: str) -> str:
    return s[:-1] if s.endswith('\r') else s


_HEADER_SENTENCE_END = re.compile(r'[.!?]\Z')


_NUMBERED_LINE = rx(r'^ *(\d{1,7})(?:\t|\u2192)')
_NUMBERED_LINES = rx(r'^ *\d{1,7}(?:\t|\u2192)', 'gm')


def _blank_line_numbers(text: str) -> str:
    """A file shown with line numbers, as an agent's Read tool or `cat -n` prints it, with the numbers blanked out.

    The header row is then a header again. Same length, so offsets stay put.
    """
    first = _NUMBERED_LINE.search(text)
    break_at = text.find('\n')
    second = _NUMBERED_LINE.search(text[break_at + 1 :]) if break_at >= 0 else None
    if not first or not second or int(second.group(1)) != int(first.group(1)) + 1:
        return text
    return _NUMBERED_LINES.sub(lambda m: ' ' * len(m.group(0)), text)


def _detect_csv_columns(text: str) -> list[PiiMatch]:
    """Every cell under a header that says what it holds: nama, nik, agama, diagnosa, gaji, …"""
    text = _blank_line_numbers(text)
    first_break = text.find('\n')
    if first_break == -1:
        return []
    header = _strip_cr(text[:first_break])
    delimiter = next((d for d in (',', ';', '\t', '|') if d in header), None)
    if not delimiter:
        return []
    header_fields = [_js.trim(header[s:e]) for s, e in _csv_fields(header, delimiter)]
    # A header is short labels, and the next row has as many fields — not a sentence with commas.
    second_line = _strip_cr(text[first_break + 1 :].split('\n', 1)[0])
    if (
        len(header_fields) < 2
        or any(len(h) > 40 or _HEADER_SENTENCE_END.search(h) for h in header_fields)
        or len(_csv_fields(second_line, delimiter)) != len(header_fields)
    ):
        return []
    columns = [field_type(h) for h in header_fields]
    if not any(columns):
        return []
    # "Nama<TAB>Budi Santoso" then "NIK<TAB>3201…" is a list of labels and values, not a table with a header.
    second = _csv_fields(second_line, delimiter)
    if any(t and field_type(_js.trim(second_line[second[i][0] : second[i][1]])) for i, t in enumerate(columns)):
        return []

    out: list[PiiMatch] = []
    offset = first_break + 1
    for raw_line in text[offset:].split('\n'):
        line = _strip_cr(raw_line)
        for idx, (s, e) in enumerate(_csv_fields(line, delimiter)):
            t = columns[idx] if idx < len(columns) else None
            cell = line[s:e]
            value = _js.trim(cell)
            if not t or not is_plausible_value(t, value, header_fields[idx]):
                continue
            start = offset + s + cell.find(value)
            # A plain "name" column can hold product names as easily as people.
            out.append(_match(t, start, value, 'medium' if is_generic_name_key(header_fields[idx]) else 'high'))
        offset += len(raw_line) + 1
    return out


_HAS_LETTER = re.compile(r'[A-Za-z]')
_NOT_A_HEADER_CELL = rx(r'[.!?]$|\d{3}')
_KV_SEPARATOR_VALUE = re.compile(r'[:=]')


def _starts_upper(s: str) -> bool:
    return 'A' <= s[:1] <= 'Z'


def _detect_tab_tables(text: str) -> list[PiiMatch]:
    """Tab-separated tables anywhere in the text: cells copied from Excel or Word, and tables in PDF text.

    In PDF text a wide gap between cells becomes a tab. "Nama Pelanggan<TAB>Budi Santoso" is a label and its value.
    A row of short cells with at least one field name, followed by rows with as many cells or fewer, is a table with
    typed columns.
    """
    if '\t' not in text:
        return []
    text = _blank_line_numbers(text)
    out: list[PiiMatch] = []
    header: Optional[list[str]] = None
    columns: list[Optional[PiiType]] = []
    pos = 0
    while pos <= len(text):
        end = text.find('\n', pos)
        if end == -1:
            end = len(text)
        line = text[pos : end - 1 if end > pos and text[end - 1] == '\r' else end]
        cells: list[tuple[int, str]] = []
        if '\t' in line:
            at = 0
            for part in line.split('\t'):
                value = _js.trim(part)
                cells.append((pos + at + (part.find(value) if value else 0), value))
                at += len(part) + 1
        filled = [c for c in cells if c[1]]
        if header is not None and len(filled) >= 2 and len(cells) <= len(header):
            for i, (start, value) in enumerate(cells):
                t = columns[i]
                if not t or not value or not is_plausible_value(t, value, header[i]):
                    continue
                out.append(_match(t, start, value, 'medium' if is_generic_name_key(header[i]) else 'high'))
        else:
            header = None
            types = [field_type(value) if value else None for _, value in cells]
            if (
                len(filled) == 2 and _starts_upper(filled[0][1]) and field_type(filled[0][1])
                and not field_type(filled[1][1])
            ):
                # "Nama Pelanggan<TAB>Budi Santoso". "Nama<TAB>: Budi" is a labeled field, found by _detect_labeled_fields.
                (_, label), (value_start, value) = filled
                t = field_type(label)
                if t and not _KV_SEPARATOR_VALUE.match(value) and is_plausible_value(t, value, label):
                    out.append(_match(t, value_start, value, 'medium' if is_generic_name_key(label) else 'high'))
            elif (
                len(filled) >= 2
                and all(
                    len(v) <= 40 and _HAS_LETTER.search(v) and not _NOT_A_HEADER_CELL.search(v) for _, v in filled
                )
                # Data files have tabs too ("n01687978<TAB>agama"): a document table's header is capitalized, or
                # names two fields.
                and (
                    sum(1 for t in types if t) >= 2
                    or (any(types) and all(_starts_upper(v) for _, v in filled))
                )
            ):
                header = [value for _, value in cells]
                columns = types
        pos = end + 1
    return out


_DETECTORS: tuple[Callable[[str], list[PiiMatch]], ...] = (
    _detect_digit_runs,
    _detect_npwp_formatted,
    _detect_passports,
    _detect_phones,
    _detect_emails,
    _detect_ips,
    _detect_coordinates,
    _detect_birth_dates,
    _detect_health,
    _detect_financial,
    _detect_religion,
    _detect_plates,
    _detect_names,
    _detect_chat_senders,
    _detect_sql_inserts,
    _detect_street_addresses,
    _detect_labeled_fields,
    _detect_csv_columns,
    _detect_tab_tables,
)


def check_types(types: Iterable[str]) -> tuple[PiiType, ...]:
    """The given type names, or ValueError for one that is not in PII_TYPES (a typo would silently mask less)."""
    if isinstance(types, str):
        raise TypeError('types and exclude take a list of type names, e.g. ["FINANCIAL"], not a string')
    out = tuple(types)
    for t in out:
        if t not in PII_TYPES:
            raise ValueError(f'Unknown PII type "{t}". Valid types: {", ".join(PII_TYPES)}')
    return out  # type: ignore[return-value]


def detect_pii(
    text: str,
    *,
    types: Optional[Iterable[PiiType]] = None,
    exclude: Optional[Iterable[PiiType]] = None,
    min_confidence: Optional[Confidence] = None,
) -> list[PiiMatch]:
    """All personal data in the text, non-overlapping, in reading order.

    ``types`` limits the result to some kinds. ``exclude`` drops kinds an app needs to read, e.g.
    ``exclude=['FINANCIAL']`` when income and installments are a dealer's credit-simulation data, or
    ``exclude=['NAME']`` when names are not sensitive in that flow. ``min_confidence="high"`` keeps only validated or
    keyword-anchored matches (default "medium"). An unknown type name raises ``ValueError``.
    """
    wanted = set(check_types(types) if types is not None else PII_TYPES)
    wanted -= set(check_types(exclude or ()))
    min_rank = 2 if min_confidence == 'high' else 1

    def rank(m: PiiMatch) -> int:
        return 2 if m.confidence == 'high' else 1

    astral = _ASTRAL.search(text) is not None
    view = _to_utf16_view(text) if astral else text

    candidates = [
        m for detector in _DETECTORS for m in detector(view)
        if m.end > m.start and m.type in wanted and rank(m) >= min_rank
    ]
    # Prefer confident, then longer matches; drop anything overlapping an accepted match.
    candidates.sort(key=lambda m: (-rank(m), -(m.end - m.start), m.start))
    taken = bytearray(len(view) + 1)
    accepted: list[PiiMatch] = []
    for c in candidates:
        if any(taken[c.start : c.end]):
            continue
        taken[c.start : c.end] = b'\x01' * (c.end - c.start)
        accepted.append(c)
    accepted.sort(key=lambda m: m.start)
    if not astral:
        return accepted

    # Map UTF-16 offsets back to Python characters, never splitting an emoji.
    unit_to_char = [0] * (len(view) + 1)
    unit = 0
    for i, ch in enumerate(text):
        unit_to_char[unit] = i
        if ord(ch) > 0xFFFF:
            unit_to_char[unit + 1] = i
            unit += 2
        else:
            unit += 1
    unit_to_char[len(view)] = len(text)

    def char_end(u: int) -> int:
        inside_pair = u < len(view) and 0xDC00 <= ord(view[u]) <= 0xDFFF
        return unit_to_char[u] + 1 if inside_pair else unit_to_char[u]

    out: list[PiiMatch] = []
    for m in accepted:
        start, end = unit_to_char[m.start], char_end(m.end)
        out.append(PiiMatch(m.type, start, end, text[start:end], m.confidence))
    return out


_ASTRAL = re.compile('[\U00010000-\U0010ffff]')

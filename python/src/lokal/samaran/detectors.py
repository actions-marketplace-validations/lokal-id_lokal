"""Indonesian personal data detectors. A line-by-line port of packages/core/src/samaran/detectors.ts.

The patterns are the TypeScript sources verbatim, compiled with `rx()` so they keep JavaScript semantics.
Keep both files in step: tests/vectors checks that both give the same matches.
"""

from __future__ import annotations

import datetime as _dt
import re
from collections.abc import Callable, Iterable
from typing import NamedTuple, Optional

from .. import _js
from .._js import rx
from ..nik import parse_nik
from ..phone import parse_phone
from ._names import (
    AMBIGUOUS_GIVEN_NAMES,
    BALINESE_NAMES,
    CHINESE_FAMILY_NAMES,
    FAMILY_NAMES,
    GIVEN_NAMES,
    SECOND_NAMES,
)
from .custom import RuleLike, detect_custom, to_rules
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


def _is_call_center(value: str) -> bool:
    """A company's call center, not a person: six digits starting with 500 after the area code ("(021) 500-888")."""
    local = _digits(_CALL_CENTER_PREFIX.sub('', value, count=1))
    return len(local) == 6 and local.startswith('500')


_CALL_CENTER_PREFIX = rx(r'^\s*(?:\(\s*)?(?:\+62|0)\s?\d{2,3}\)?[\s.-]?')


def _previous_line(text: str, index: int) -> str:
    """The line above the one `index` is on, lowercased; empty on the first line."""
    line_start = text.rfind('\n', 0, max(0, index)) + 1 if index > 0 else 0
    if line_start == 0:
        return ''
    above_start = text.rfind('\n', 0, max(0, line_start - 1)) + 1 if line_start >= 2 else 0
    return text[above_start : line_start - 1].lower()


def _line_above(text: str, index: int, length: int) -> str:
    """The line above a value that stands alone on its own line, lowercased; empty when the value shares its line."""
    # Alone on its line: walk out from the value to the line's ends, and stop at the first other character, so a long
    # line costs no more than a short one.
    line_start = index
    while line_start > 0 and text[line_start - 1] != '\n':
        if text[line_start - 1] not in _js.WS_SET:
            return ''
        line_start -= 1
    i = index + length
    while i < len(text) and text[i] != '\n':
        if text[i] not in _js.WS_SET:
            return ''
        i += 1
    if line_start == 0:
        return ''
    above_start = text.rfind('\n', 0, max(0, line_start - 1)) + 1 if line_start >= 2 else 0
    return text[above_start : line_start - 1].lower()


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

# After a word or a key's underscore: "No. KK", "no_kk", "family_card".
_KK_KEYWORD = rx(r'(?:\b|_)(kk|kartu[ _]?keluarga|family[ _]?card)\b[^\d]*$')
# A card's title on the line above, with only "No." in front of the number: "KARTU KELUARGA\nNo. 3201…".
_NUMBER_ONLY_LABEL = rx(r'^\W*(?:no|nomor|no\.\s*kartu|nomor\s+kartu)?\W*$')
_KARTU_KELUARGA = rx(r'\bkartu keluarga\b')
# A date and time ("2026-12-03 04:15"), not a number.
_DATE_RUN = rx(r'^(?:19|20)\d{2}-\d{2}-\d{2}(?: \d{2})?$|^\d{2}-\d{2}-(?:19|20)\d{2}(?: \d{2})?$')
_SIM_KEYWORD = rx(r'\b(sim|surat izin mengemudi|driving licen[cs]e)\b[^\d]*$')
_NIK_KEYWORD = rx(r'\b(nik|ktp|nomor induk kependudukan)\b')
_NPWP_KEYWORD = rx(r'\bnpwp\b')
_NISN_KEYWORD = rx(r'\b(nisn|nomor induk siswa nasional)\b[^\d]*$')
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
        if _DATE_RUN.search(value):
            continue
        title = _previous_line(text, m.start()) if _NUMBER_ONLY_LABEL.search(label) else ''
        n = len(digits)
        if n == 16 and (_KK_KEYWORD.search(label) or _KARTU_KELUARGA.search(title)):
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
        elif n == 10 and _NISN_KEYWORD.search(label):
            push('NISN', 'high')
        elif n in (13, 11) and (_BPJS_KEYWORD.search(ctx) or _BPJS_KEYWORD.search(title)):
            push('BPJS', 'high')
        elif 8 <= n <= 18 and _BANK_KEYWORD.search(ctx):
            push('BANK_ACCOUNT', 'high')
        elif 8 <= n <= 18 and _BANK_KEYWORD.search(_line_above(text, m.start(), len(value))):
            # A transfer receipt stacks the bank and the account: "Bank BNI\n0123456789".
            push('BANK_ACCOUNT', 'medium')
    return out


_NPWP_FORMATTED = rx(r'(?<!\d)\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}(?!\d)')


def _detect_npwp_formatted(text: str) -> list[PiiMatch]:
    return [_match('NPWP', m.start(), m.group(0), 'high') for m in _NPWP_FORMATTED.finditer(text)]


_AKTA_DUKCAPIL = rx(r'(?<![\w-])\d{4}[-./ ]?(?:LT|LU|LD|KW|CR|KM)[-./ ]?\d{8}[-./ ]?\d{3,6}(?![\w-])', 'gi')
_AKTA_WORDED = rx(
    r'\bakta\s+(?:kelahiran|lahir|nikah|perkawinan|kematian|cerai|perceraian)(?:nya)?\s+(?:no(?:mor)?\.?\s*:?\s*)?([A-Za-z0-9][\w./-]{3,30}[A-Za-z0-9])',  # noqa: E501
    'gi',
)


def _detect_akta(text: str) -> list[PiiMatch]:
    """Civil registry deeds (akta kelahiran, perkawinan, kematian).

    Dukcapil numbers them "3201-LT-12052018-0042": region, kind, date, serial. Older deeds have a free-form number
    after the words "akta kelahiran".
    """
    out = [_match('AKTA', m.start(), m.group(0), 'high') for m in _AKTA_DUKCAPIL.finditer(text)]
    for m in _AKTA_WORDED.finditer(text):
        if len(_digits(m.group(1))) < 4:
            continue
        start, value = _group_tail(m)
        out.append(_match('AKTA', start, value, 'high'))
    return out


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
# "0062 812 …" dials out of another country the way "+62" does.
_MOBILE = rx(r'(?<![\d+\w])(?:\+62|0062|62|0)[ \t-]?8\d{1,2}(?:[ \t.-]?\d{3,4}){2,3}(?![\d\w])')
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


_PHONE_WORD = rx(
    r'\b(?:telp|telepon|telpon|tlp|tel|phone|fax|faks|hub|hubungi|call|kontak|contact|cp|rumah|kantor|no)\b[^\d]*$'
)
# "+62 (812) 3456-7890", "(0812) 3456 7890".
_BRACKETED_MOBILE = rx(r'(?<![\d\w])(?:\+?62[ \t]?\(8\d{1,2}\)|\(08\d{1,2}\))[ \t]?\d{3,4}[ \t.-]?\d{3,4}(?!\d)')
# "08 12 34 56 78 90": any grouping, as long as all the digits make one valid mobile number.
_GROUPED_MOBILE = rx(r'(?<![\d\w+])(?:\+62[ \t.-]?|62[ \t.-]?|0[ \t.-]?)8(?:[ \t.-]?\d){8,12}(?![\d\w])')
_GROUP_SEP = re.compile(r'[ \t.-]')
_SPACED_ZERO = rx(r'^0[ \t.-]')
# "rumah 0251 8321234", "telp 021-7654321": an area code without brackets, only next to a phone word.
_AREA_CODE = rx(r'(?<![\d\w+])0(?:2[1-9]|[3-79]\d)\d{0,2}[ \t.-]?\d{3,4}[ \t.-]?\d{3,4}(?![\d\w])')


def _detect_phones(text: str) -> list[PiiMatch]:
    out = [
        _match('PHONE', m.start(), m.group(0), 'high')
        for m in _MOBILE.finditer(text)
        if parse_phone('+' + m.group(0)[2:] if m.group(0).startswith('00') else m.group(0)).valid
        and not _glued_to_code(text, m.start())
    ]
    out += [
        _match('PHONE', m.start(), m.group(0), 'medium') for m in _LANDLINE.finditer(text)
        if not _is_call_center(m.group(0))
    ]
    out += [
        _match('PHONE', m.start(), m.group(0), 'high') for m in _BRACKETED_MOBILE.finditer(text)
        if parse_phone(m.group(0)).valid
    ]
    for m in _GROUPED_MOBILE.finditer(text):
        # Only what the pattern above cannot read: groups of one or two digits after the prefix. Otherwise
        # "0812-3456-7890\n2 …" would take the next line's "2".
        groups = _GROUP_SEP.split(m.group(0))
        # Next to a phone word any grouping goes: 'invalid phone "0812-77-1234-99"'.
        named = bool(_PHONE_WORD.search(_before(text, m.start(), 30)))
        if not named and (len(groups) < 4 or any(len(g) > 2 for g in groups[1:])):
            continue
        # "0 8 1 2 3 …", one digit at a time, only next to a phone word: otherwise it is any list of digits.
        if _SPACED_ZERO.search(m.group(0)) and not named:
            continue
        if parse_phone(m.group(0)).valid and not _glued_to_code(text, m.start()):
            out.append(_match('PHONE', m.start(), m.group(0), 'high'))
    for m in _AREA_CODE.finditer(text):
        if not _PHONE_WORD.search(_before(text, m.start(), 30)):
            continue
        info = parse_phone(m.group(0))
        if info.valid and info.type == 'landline' and not _is_call_center(m.group(0)):
            out.append(_match('PHONE', m.start(), m.group(0), 'medium'))
    return out


# Domains reserved for documentation and testing (RFC 2606, RFC 6761) never belong to a person.
_RESERVED_EMAIL_DOMAIN = rx(r'@(?:[\w-]+\.)*(?:example\.(?:com|net|org)|[\w-]+\.(?:example|test|invalid|localhost))$', 'i')
_EMAIL = rx(r'(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])')
# Written out to dodge scrapers: "siti.rahayu88 [at] gmail [dot] com", "budi(at)yahoo.co.id".
_AT = r'\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\})\s*'
_DOT = r'(?:\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\})\s*|\.)'
_SPELLED_EMAIL = rx(rf'(?<![\w.+-])[A-Za-z0-9._%+-]+{_AT}[A-Za-z0-9-]+(?:{_DOT}[A-Za-z0-9-]+)*{_DOT}[A-Za-z]{{2,}}(?![\w-])', 'gi')

_URL_EMAIL = rx(r'(?<![\w.+-])[A-Za-z0-9._+-]+%40[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])')


def _detect_emails(text: str) -> list[PiiMatch]:
    out = [
        _match('EMAIL', m.start(), m.group(0), 'high')
        for m in _EMAIL.finditer(text)
        if not _RESERVED_EMAIL_DOMAIN.search(m.group(0))
    ]
    out += [_match('EMAIL', m.start(), m.group(0), 'high') for m in _SPELLED_EMAIL.finditer(text)]
    # URL-encoded: "email=siti%40gmail.com".
    out += [_match('EMAIL', m.start(), m.group(0), 'high') for m in _URL_EMAIL.finditer(text)]
    return out


_IP = rx(r'(?<![\d.\w])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d\w]|\.[\d\w])')
_IP_SKIP = rx(r'^(0\.|127\.|255\.255\.255\.255)')
_IP_VERSION = rx(r'\b(versi|version|ver|v)\.?\s*$')
_IP_PRIVATE = rx(r'^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)')
_IP_DOC_NUMBER_AFTER = rx(r'^-\d+(?![\d.])')
_IP_DOC_NUMBER_BEFORE = rx(r'\b(?:no|nomor|sk|surat)\.?\s*$')


def _detect_ips(text: str) -> list[PiiMatch]:
    out: list[PiiMatch] = []
    for m in _IP.finditer(text):
        ip = m.group(0)
        if _IP_SKIP.search(ip):
            continue
        if _IP_VERSION.search(_before(text, m.start(), 12)):
            continue
        # "SK No. 100.3.3.1-6117": a document number. "192.168.2.1-192.168.2.10" is a range of addresses.
        if _IP_DOC_NUMBER_AFTER.search(text[m.start() + len(ip) :]) or _IP_DOC_NUMBER_BEFORE.search(_before(text, m.start(), 12)):
            continue
        # "step 5.2.1.1." in a spec is a section; an address ending a sentence has larger parts ("dari IP 36.72.215.104.").
        if text[m.start() + len(ip) : m.start() + len(ip) + 1] == '.' and all(len(part) == 1 for part in ip.split('.')):
            continue
        out.append(_match('IP', m.start(), ip, 'medium' if _IP_PRIVATE.search(ip) else 'high'))
    return out


# "-6.914744, 107.609810", and with the axes named: "lat -7.250445, lng 112.768845".
_COORDS = rx(
    r'(?<![\d.])(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})(?![\d.])|\blat(?:itude)?\s*[:=]?\s*(-?\d{1,2}\.\d{4,})\s*[,;]?\s*(?:lng|lon|long|longitude)\s*[:=]?\s*(-?\d{1,3}\.\d{4,})(?![\d.])',  # noqa: E501
    'gi',
)


def _detect_coordinates(text: str) -> list[PiiMatch]:
    out: list[PiiMatch] = []
    for m in _COORDS.finditer(text):
        lat = float(m.group(1) if m.group(1) is not None else m.group(3))
        lng = float(m.group(2) if m.group(2) is not None else m.group(4))
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
_BIRTH = rx(
    rf'\b(?:lahir|lhr|kelahiran|born|ttl|dob|d\.o\.b\.?|date\s+of\s+birth|birth\s*date|birthday)(?![a-z])[^\n\d]{{0,40}}?({_DATE})',
    'gi',
)


def _group_tail(m: re.Match[str], group: int = 1) -> tuple[int, str]:
    """Start and text of a group that ends the match, computed as TypeScript does (m.index + m[0].length - len)."""
    value = m.group(group)
    return m.start() + len(m.group(0)) - len(value), value


def _detect_birth_dates(text: str) -> list[PiiMatch]:
    return [_match('BIRTH_DATE', *_group_tail(m), 'high') for m in _BIRTH.finditer(text)]


_CONDITIONS = (
    r'hiv|aids|odha|tbc|tb paru|tuberkulosis|hepatitis(?: [abc])?|kanker(?: \w+)?|tumor(?: \w+)?|diabetes(?: mel+itus)?(?: tipe [12])?|'
    r'hipertensi|stroke|penyakit jantung|gagal ginjal|cuci darah|covid(?:-19)?|dbd|demam berdarah(?: dengue)?|malaria|kusta|lepra|'
    r'skizofrenia|bipolar(?: tipe [12i]+)?|depresi(?: berat| sedang| ringan)?|gangguan jiwa|gangguan mental|odgj|autis(?:me)?|epilepsi|'
    r'ims|sifilis|gonore|herpes|hamil(?: \d{1,2} (?:bulan|minggu))?|keguguran|asma|lupus|leukemia|'
    r'th?alas+emia(?: (?:alfa|beta|mayor|minor))?|hemofilia|alzheimer|demensia|'
    r'gastroenteritis(?: akut)?|gastritis|maag|typhoid|pneumonia|bronkitis|sinusitis|apendisitis|usus buntu|batu ginjal|'
    r'hipotiroid|hipertiroid|anemia|glaukoma|katarak|skoliosis|hernia|wasir|ambeien|tbc tulang|meningitis|'
    r'parkinson|tifus|tipes|cacar|campak|polio|difteri|stunting|obesitas|kolesterol tinggi|asam urat|gangguan kecemasan|'
    r'anxiety|ptsd|ocd|adhd|down syndrome|cerebral palsy|lumpuh|tunanetra|tunarungu|tunawicara|tunadaksa|kista|miom|'
    r'endometriosis|pcos|osteoporosis|vertigo|psikosis|gerd|jantung koroner|sakit jantung|gagal jantung|serangan jantung|'
    r'infertil|mandul|impoten|klamidia|kecanduan(?: \w+)?|pecandu(?: \w+)?|pengguna (?:narkoba|narkotika|sabu|ganja|heroin|putaw|ekstasi)|'
    r'percobaan bunuh diri|self harm|patah tulang(?: \w+)?|gegar otak|luka bakar|amputasi|serangan panik|gangguan makan|anoreksia|bulimia'
)
_SYMPTOMS = (
    r'(?:demam(?:\s+tinggi)?|batuk(?:\s+berdahak)?|pilek|flu|sesak(?:\s+napas)?|mual|muntah|diare|mencret|pusing|sakit\s+kepala|'
    r'nyeri\s+\w+|lemas|meriang|gatal-gatal|ruam|pendarahan|kejang|sariawan|radang\s+tenggorokan|sakit\s+perut|sakit\s+gigi)'
)
# Medicines that name the condition they treat.
_MEDICATIONS = (
    'insulin|metformin|glibenclamide|arv|antiretroviral|obat tbc|rifampisin|isoniazid|kemoterapi|kemo|antidepresan|'
    'antipsikotik|fluoxetine|sertraline|risperidone|haloperidol|lithium|metadon|methadone|warfarin|amlodipine|captopril|'
    'levothyroxine|tamoxifen|hormon|kb|pil kb'
)
# Strong medical verbs: whatever follows is the condition.
_HEALTH_STRONG = rx(
    r'\b(?:didiagnosis|didiagnosa|terdiagnosis|terdiagnosa|mengidap|terinfeksi|riwayat penyakit|divonis)\s+(?:menderita\s+|mengidap\s+|penyakit\s+)?(?!(?:yang|dan|atau|di|ke|dari|untuk|ini|itu|tersebut|adalah|dapat|bisa|tidak|belum|anda|kamu|pasien|seseorang)\b)([^\n\r,.;:()"]{2,60}?)(?=\s+(?:sejak|selama|dan sudah|dan sedang|tapi|namun|sehingga|jadi)\b|[\n\r,.;:()"]|$)',  # noqa: E501
    'gi',
)
# "Dx: TB paru" in a medical note; capitalized, so "dx" in code is not one.
_HEALTH_DX = rx(r'\b(?:Dx|DX|Diagnosis|Diagnosa|Diag)\s*:\s*([^\n\r,;()"]{2,60}?)(?=\s*(?:[\n\r,;()"]|\.(?:\s|$)|$))', 'g')
# Everyday words ("positif", "karena", "saya") only count before a known condition: "saya diabetes",
# "riwayat hipertensi dan diabetes melitus".
_HEALTH_GATED = rx(
    r'\b(?:(?:dokter|dok|dr)\.?\s+(?:bilang|bilangnya|menyatakan|mendiagnosis)(?:\s+(?:ada|kena|positif))?|perawatan|pengobatan|terapi|dirawat\s+karena|kontrol|has|have|had|with|suffers\s+from|suffering\s+from|diagnosed\s+with|history\s+of|positif|menderita|terkena|kena|sakit|pasien|komplikasi|kambuh|kumat|penderita|pengidap|penyintas|mengalami|karena|krn|akibat|gara-gara|punya|riwayat|diagnosa|diagnosis|didiagnosa|pembawa\s+sifat|carrier|saya|aku|gue|gw|gua|dia|beliau|ayah|bapak|ibu|mama|mamah|papa|papah|suami|istri|anak|anaknya|adik|adek|kakak|nenek|kakek|mertua|pacar|teman|temen)'  # noqa: E501
    r'\s+(?:(?:saya|aku|gue|dia|lagi|sedang|sdg|sudah|udah|sdh|sempat|pernah|baru|rutin|kena|terkena)\s+){0,2}'
    rf'((?:penyakit\s+)?(?:{_CONDITIONS})(?:\s*(?:,|dan|serta)\s+(?:{_CONDITIONS}))*)\b',
    'gi',
)
# A test result: "hasil tes HIV reaktif", "rapid test covid positif", "tes narkoba negatif".
_HEALTH_RESULT = rx(
    r'\b(?:tes|test|uji|pemeriksaan|skrining|screening|swab|rapid(?:\s+test)?)\s+((?:hiv|hepatitis(?:\s+[abc])?|hbsag|covid(?:-19)?|tbc|tb|sifilis|vdrl|narkoba|urine|kehamilan|dna|pcr|antigen)\s+(?:hasilnya\s+)?(?:reaktif|non-?reaktif|positif|negatif))\b',  # noqa: E501
    'gi',
)
# A genetic test result: "BRCA1 positif", "mutasi BRCA2", "carrier thalassemia" (above).
_GENETIC = rx(r'\b(?:mutasi\s+)?(?:BRCA[12]|HLA-B\*?\d{2}:\d{2})(?:\s+(?:positif|negatif|mutasi|carrier))?', 'g')
_GENETIC_RESULT = rx(r'positif|negatif|mutasi|carrier', 'i')
_GENETIC_TEST = rx(r'\b(?:hasil|tes|test|dinyatakan)\b[^\n]{0,20}$', 'i')
# A disability said of someone stands on its own: "Peserta Lina Marlina, tunarungu, …". Not "sekolah bagi tunarungu".
_DISABILITY = rx(r'\b(?:tuna[ -]?(?:rungu|netra|wicara|daksa|grahita|laras)|odha|odgj)\b', 'gi')
_FOR_A_GROUP = rx(
    r'\b(?:para|kaum|penyandang|bagi|untuk|buat|sekolah|slb|komunitas|organisasi|yayasan|layanan|hak|ramah)\s+$', 'i'
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

_ALLERGY = rx(r'\balergi\s+(?:terhadap\s+)?([a-z][\w-]*(?:\s+dan\s+[a-z][\w-]*)?)', 'gi')
_NOT_AN_ALLERGY = rx(r'\b(?:anti|bebas|obat|tes|uji)\s+$')
# Symptoms after the word for a complaint: "keluhan demam", "gejala sesak napas". Not "keluhan pelanggan".
_SYMPTOM = rx(
    r'\b(?:keluhan|gejala|mengeluh(?:kan)?)\s+((?:demam|batuk|pilek|flu|sesak(?:\s+napas)?|mual|muntah|diare|pusing|sakit\s+kepala|nyeri\s+\w+|lemas|meriang|gatal|ruam|benjolan|pendarahan|kejang)(?:\s+(?:dan|,)\s+(?:demam|batuk|pilek|flu|mual|muntah|diare|pusing|lemas))*)',  # noqa: E501
    'gi',
)
# Symptoms someone has had for a while: "sudah 3 hari demam dan batuk", "anak saya lagi diare".
_HAVING_SYMPTOMS = rx(
    r'\b(?:(?:sudah|udah|sdh|sejak|selama|umur|usia)\s+\d+\s+(?:hari|minggu|bulan|tahun|th)|(?:saya|aku|gue|gw|dia|beliau|anak\s+saya|anakku|anaknya|suami\s+saya|istri\s+saya)\s+(?:lagi|sedang|sering|kena|terkena|mengalami))'  # noqa: E501
    rf'\s+({_SYMPTOMS}(?:\s*(?:dan|,|&)\s*{_SYMPTOMS})*)',
    'gi',
)
# Findings listed in a medical note: "Hasil MCU: …, tekanan darah 150/95, kolesterol tinggi". The list needs a
# medical word before it; "kolesterol tinggi" in an article about food has none.
_FINDING = rx(
    rf'(?:[,;:]|\bdan)\s*((?:{_CONDITIONS})|tekanan\s+darah\s+\d{{2,3}}\/\d{{2,3}}|tensi\s+\d{{2,3}}\/\d{{2,3}})(?=\s*(?:[,;.]|dan\b|$))',
    'gi',
)
_MEDICAL_CONTEXT = rx(
    r'\b(?:mcu|medical|check-?up|hasil\s+(?:lab|pemeriksaan)|pasien|dokter|dok|tekanan\s+darah|tensi|keluhan|riwayat|diagnos[ai]s?|klinik|puskesmas|rs|rsud)\b',  # noqa: E501
    'i',
)
# A condition right after someone's age: "Alif (8 th), autis", "Bu Narti, 54 tahun, stroke".
_AFTER_AGE = rx(
    rf'(?:\(\d{{1,2}}[^)\n]{{0,8}}\)|\b\d{{1,2}}\s*(?:th|thn|tahun))\s*,\s*((?:{_CONDITIONS})(?:\s*(?:,|dan)\s*(?:{_CONDITIONS}))*)\b',
    'gi',
)


def _detect_health(text: str) -> list[PiiMatch]:
    out = [_match('HEALTH', *_group_tail(m), 'high') for m in _HEALTH_STRONG.finditer(text)]
    out += [_match('HEALTH', *_group_tail(m), 'high') for m in _HEALTH_DX.finditer(text)]
    out += [_match('HEALTH', *_group_tail(m), 'medium') for m in _HEALTH_GATED.finditer(text)]
    out += [_match('HEALTH', *_group_tail(m), 'medium') for m in _HEALTH_RESULT.finditer(text)]
    for m in _GENETIC.finditer(text):
        if _GENETIC_RESULT.search(m.group(0)) or _GENETIC_TEST.search(_before(text, m.start(), 30)):
            out.append(_match('HEALTH', m.start(), m.group(0), 'medium'))
    for m in _DISABILITY.finditer(text):
        if _FOR_A_GROUP.search(_before(text, m.start(), 20)):
            continue
        out.append(_match('HEALTH', m.start(), m.group(0), 'medium'))
    out += [_match('HEALTH', m.start() + 1, m.group(1), 'medium') for m in _HEALTH_BRACKETED.finditer(text)]
    for m in _HEALTH_TREATMENT.finditer(text):
        value = m.group(1) if m.group(1) is not None else m.group(2)
        out.append(_match('HEALTH', m.start() + len(m.group(0)) - len(value), value, 'medium'))
    # An allergy is health data whatever it is to: "alergi penisilin". Not "bebas alergi" or "obat alergi".
    for m in _ALLERGY.finditer(text):
        if _NOT_AN_ALLERGY.search(_before(text, m.start(), 12)):
            continue
        out.append(_match('HEALTH', *_group_tail(m), 'medium'))
    out += [_match('HEALTH', *_group_tail(m), 'medium') for m in _SYMPTOM.finditer(text)]
    out += [_match('HEALTH', *_group_tail(m), 'medium') for m in _HAVING_SYMPTOMS.finditer(text)]
    for m in _FINDING.finditer(text):
        if not _MEDICAL_CONTEXT.search(text[max(0, m.start() - 80) : m.start()]):
            continue
        out.append(_match('HEALTH', *_group_tail(m), 'medium'))
    out += [_match('HEALTH', *_group_tail(m), 'medium') for m in _AFTER_AGE.finditer(text)]
    out += [_match('HEALTH', m.start(), m.group(0), 'medium') for m in _HEALTH_HOSPITAL.finditer(text)]
    return out


_FINANCIAL = rx(
    r'\b(?:gaji|penghasilan|pendapatan|saldo|utang|hutang|pinjaman|cicilan|tunggakan|limit(?:\s+kartu)?(?:\s+kredit)?|tagihan\s+(?:kartu\s+kredit|cc|paylater|pinjol|kpr|cicilan)|(deposito|tabungan|simpanan|habis|rugi|kerugian|kalah|sisa\s+(?:pokok|pinjaman|utang|hutang|cicilan)|pokok\s+(?:pinjaman|utang|hutang)|outstanding|plafond?))'  # noqa: E501
    r'(?:\s+(?:saya|aku|gue|gw|gua|dia|beliau|suami|istri|ayah|bapak|ibu|ortu|orang\s+tua|keluarga|bulanan|tahunan|pokok|tetap|per\s+bulan|sebulan|setahun|bersih|kotor|rekening|tabungan|deposito|terakhir|total|anda|kamu|kalian|pinjol|paylater|kpr|kta|online|leasing|kartu\s+kredit|per\s+hari\s+ini|hari\s+ini|saat\s+ini|sekarang|udah|sudah|sdh|baru|itu|ini|tsb|motor|mobil|rumah|hp|laptop|apartemen|bulan\s+ini|ovo|gopay|dana|shopeepay|linkaja|jenius|bca|bri|bni|mandiri|bsi|jago|seabank|di\s+\w+|ke\s+\w+))*'  # noqa: E501
    r'\s*(?:sebesar|sekitar|kira-kira|cuma|hanya|adalah|ada|masih|tinggal|sisa|senilai|:|=)?\s*((?:Rp\.?\s?)?\d[\d.,]*(?:\s*(?:rb|ribu|k|jt|juta|m|miliar|milyar|t|triliun)\b)?)',  # noqa: E501
    'gi',
)
_TRAILING_PUNCT = rx(r'[.,]+$')
_AMOUNT_HAS_UNIT = rx(r'rp|[a-z]$', 'i')
# "Deposito 100 juta, bunga 5%" in a bank's ad is a product; it is personal data when someone holds it.
_HOLDER = rx(r'\b(?:punya|memiliki|milik|nasabah|pak|bu|bapak|ibu|saya|aku|gue|gw|dia|beliau|debitur|peminjam)\b', 'i')

_PERSON_NEAR = rx(
    r'\b(?:saya|aku|gue|gw|gua|dia|beliau|kami|suami|istri|ayah|bapak|ibu|mama|papa|anak|adik|kakak|pernah|udah|sudah|lagi|sedang|jadi)\b'  # noqa: E501
)
_FINANCIAL_STATUS = rx(
    r'\b(?:galbay|gagal\s+bayar|kredit\s+macet|kol(?:ektibilitas)?\s*[2-5]|masuk\s+(?:bi\s*checking|slik)|di-?blacklist\s+(?:bank|bi|ojk)|(?:dikejar|ditagih|didatangi)\s+(?:dc|debt\s+collector)|terlilit\s+(?:utang|hutang|pinjol))\b',  # noqa: E501
    'gi',
)
_GALBAY = rx(r'^galbay$', 'i')


def _detect_financial(text: str) -> list[PiiMatch]:
    out: list[PiiMatch] = []
    for m in _FINANCIAL.finditer(text):
        raw = m.group(2)
        amount = _TRAILING_PUNCT.sub('', raw)
        if not _AMOUNT_HAS_UNIT.search(amount) and len(_digits(amount)) < 4:
            continue
        if m.group(1) is not None and not _HOLDER.search(_before(text, m.start(), 40) + m.group(0)):
            continue
        out.append(_match('FINANCIAL', m.start() + len(m.group(0)) - len(raw), amount, 'medium'))
    # Statuses that say it without an amount: "udah galbay 3 bulan", "saya masuk BI checking".
    for m in _FINANCIAL_STATUS.finditer(text):
        # "risiko gagal bayar obligasi" is about markets; it is personal data when it is someone's status.
        if not _GALBAY.search(m.group(0)) and not _PERSON_NEAR.search(_before(text, m.start(), 30)):
            continue
        out.append(_match('FINANCIAL', m.start(), m.group(0), 'medium'))
    return out


# Marital status said of a person: "saya sudah cerai", "sekarang janda dengan 2 anak".
# "Pemohon an. Wulandari, status cerai hidup" names the status in a sentence; a form label ("Status: …") is a field.
# "sudah 3 tahun menikah", "Bu Wati sudah bercerai": a status that needs no subject in front.
_MARITAL = rx(
    r'\b(?:saya|aku|gue|gw|dia|beliau|ibu|bapak|ayah|mama|papa|kakak|adik)\s+(?:(?:sudah|udah|sdh|baru|belum|blm|masih|sekarang|kini|seorang|berstatus|statusnya)\s+)*(cerai(?:\s+(?:hidup|mati))?|bercerai|janda|duda|menikah|kawin|lajang|single|nikah\s+siri|nikah|pisah\s+ranjang)\b'  # noqa: E501
    r'|\b(?:sekarang|kini|berstatus|seorang|itu|statusnya)\s+(janda|duda|lajang)\b'
    r'|\b(janda|duda)(?=\s+(?:anak|beranak|dengan\s+\d|\d|cerai|ditinggal|tanpa\s+anak|muda|kembang)\b)'
    r'|\bstatus(?:nya)?\s+(?:perkawinan\s+|pernikahan\s+)?(cerai\s+(?:hidup|mati)|janda|duda|kawin|menikah|sudah\s+menikah|belum\s+(?:kawin|menikah)|lajang|nikah\s+siri)\b'  # noqa: E501
    r'|\b(pisah\s+ranjang)\b'
    r'|\b(?:sudah|udah|sdh|telah)\s+(?:\d+\s+tahun\s+(menikah|nikah|berumah\s+tangga)|(bercerai|cerai(?:\s+(?:hidup|mati))?|menjanda|menduda))\b',  # noqa: E501
    'gi',
)
_WEDDING = rx(r'^(?:menikah|kawin|nikah)$', 'i')
_ALREADY = rx(r'\b(?:sudah|udah|sdh|belum|blm|berstatus|status|statusnya|perkawinan|pernikahan|tahun)\s+$', 'i')


def _detect_marital_status(text: str) -> list[PiiMatch]:
    out: list[PiiMatch] = []
    for m in _MARITAL.finditer(text):
        value = next(g for g in m.groups() if g is not None)
        # "saya menikah tahun depan" is a plan; "saya sudah menikah" or "berstatus janda" is a status.
        if _WEDDING.search(value) and not _ALREADY.search(m.group(0)[: len(m.group(0)) - len(value)]):
            continue
        out.append(_match('MARITAL_STATUS', m.start() + len(m.group(0)) - len(value), value, 'medium'))
    return out


_RELIGION = rx(
    r'\b(?:beragama|agamanya|agama\s+(?:saya|aku|dia|beliau|kami|mereka))\s+(Islam|Kristen(?:\s+Protestan)?|Protestan|Katolik|Katholik|Hindu|Buddha|Budha|Konghucu|Khonghucu|Kong Hu Cu)\b',  # noqa: E501
    'gi',
)


# An adjective of a person: "saya muslim", "suami saya kristen protestan". Not "umat Muslim" or "Gereja Kristen".
_RELIGION_ADJECTIVE = rx(
    r'\b(?:saya|aku|gue|gw|dia|ia|beliau|ybs|kami|keluarga\s+(?:saya|kami)|(?:suami|istri|ayah|bapak|ibu|mama|papa|ortu|orang\s+tua|anak|adik|kakak|pacar|calon)(?:\s+(?:saya|aku|gue|dia)|nya|ku)?)\s+(?:(?:seorang|itu|adalah|sudah|udah|baru|jadi)\s+)?(muslim(?:ah)?|islam|nasrani|kristiani?|kristen(?:\s+protestan)?|protestan|katolik|katholik|hindu|buddhis|buddha|budha|konghucu|khonghucu|mualaf|muallaf|ateis|atheis|agnostik|non[- ]?muslim)\b',  # noqa: E501
    'gi',
)
# A conversion: "baru pindah agama, sekarang Kristen", "masuk Islam tahun lalu".
_CONVERSION = rx(
    r'\b(?:pindah\s+agama|murtad|convert|mualaf)\b[^\n.]{0,30}?\b(?:jadi|menjadi|ke|sekarang|kini)\s+(Islam|Kristen(?:\s+Protestan)?|Protestan|Katolik|Katholik|Hindu|Buddha|Budha|Konghucu|Khonghucu)\b|\bmasuk\s+(Islam|Kristen|Katolik|Hindu|Buddha)\b',  # noqa: E501
    'gi',
)


# "(agama Hindu)", "religion Islam" said of someone. Not religious education, institutions, or holidays:
# "pendidikan agama Islam", "Pengadilan Agama", "hari raya agama Hindu".
_RELIGION_BARE = rx(
    r'\b(?:agama|religion)(?:\s*[:–-]\s*|\s+)(Islam|Kristen(?:\s+Protestan)?|Protestan|Katolik|Katholik|Catholic|Christian|Muslim|Hindu|Buddha|Budha|Buddhist|Konghucu|Khonghucu)\b',  # noqa: E501
    'gi',
)
_RELIGION_INSTITUTION = rx(
    r'\b(?:pendidikan|pelajaran|mata\s+pelajaran|guru|umat|hari(?:\s+raya)?|tokoh|kementerian|pengadilan|universitas|institut|sekolah|ajaran|nilai|organisasi|lembaga|majelis|studi|fakultas|ilmu|perayaan|kitab|rumah\s+ibadah|penyuluh|pemuka)\s+$',  # noqa: E501
    'i',
)


def _detect_religion(text: str) -> list[PiiMatch]:
    out = [_match('RELIGION', *_group_tail(m), 'high') for m in _RELIGION.finditer(text)]
    for m in _RELIGION_BARE.finditer(text):
        if _RELIGION_INSTITUTION.search(_before(text, m.start(), 30)):
            continue
        out.append(_match('RELIGION', *_group_tail(m), 'medium'))
    out += [_match('RELIGION', *_group_tail(m), 'medium') for m in _RELIGION_ADJECTIVE.finditer(text)]
    for m in _CONVERSION.finditer(text):
        value = m.group(1) if m.group(1) is not None else m.group(2)
        out.append(_match('RELIGION', m.start() + len(m.group(0)) - len(value), value, 'medium'))
    return out


# Indonesian plate region codes (kode wilayah TNKB).
_PLATE_REGIONS = (
    'AA|AB|AD|AE|AG|BA|BB|BD|BE|BG|BH|BK|BL|BM|BN|BP|DA|DB|DC|DD|DE|DG|DH|DK|DL|DM|DN|DP|DR|DT|EA|EB|ED|KB|KH|KT|KU|'
    'PA|PB|A|B|D|E|F|G|H|K|L|M|N|P|R|S|T|W|Z'
)
_PLATE = rx(rf'(?<![A-Za-z0-9])(?:{_PLATE_REGIONS})\s?\d{{1,4}}\s?[A-Z]{{1,3}}(?![A-Za-z0-9])')
_PLATE_SPACED = rx(r'\s\d+\s')
_PLATE_KEYWORD = rx(r'\b(plat|nopol|no\.?\s*pol|tnkb|kendaraan|motor|mobil)\b')
# "motor b3456xyz": any case, but only right after a vehicle word.
_PLATE_LOOSE = rx(rf'(?<![A-Za-z0-9])(?:{_PLATE_REGIONS})\s?\d{{1,4}}\s?[A-Z]{{1,3}}(?![A-Za-z0-9])', 'gi')


def _detect_plates(text: str) -> list[PiiMatch]:
    out: list[PiiMatch] = []
    for m in _PLATE.finditer(text):
        spaced = _PLATE_SPACED.search(m.group(0)) is not None
        keyword = _PLATE_KEYWORD.search(_before(text, m.start())) is not None
        if not spaced and not keyword:
            continue
        out.append(_match('PLATE', m.start(), m.group(0), 'high' if keyword else 'medium'))
    for m in _PLATE_LOOSE.finditer(text):
        if _PLATE_KEYWORD.search(_before(text, m.start(), 20)):
            out.append(_match('PLATE', m.start(), m.group(0), 'medium'))
    return out


# Titles between the honorific and the name are skipped: "Bapak Presiden Joko Widodo" → "Joko Widodo".
_TITLE_WORDS = {
    'bapak', 'ibu', 'pak', 'bu', 'mas', 'mbak', 'kak', 'bang', 'presiden', 'wakil', 'menteri', 'direktur',
    'dokter', 'dr', 'drs', 'dra', 'prof', 'ir', 'h', 'hj', 'guru', 'lurah', 'camat', 'bupati', 'walikota', 'wali',
    'gubernur', 'kepala', 'dosen', 'ketua', 'manajer', 'admin', 'kurir', 'driver', 'ustadz', 'ustadzah', 'sdr',
    'sdri', 'saudara', 'saudari', 'tn', 'ny', 'nn', 'mr', 'mrs', 'ms', 'miss', 'mister', 'koh', 'ko', 'cik', 'ci', 'cici',
    'om', 'tante', 'kang', 'teh', 'bli', 'cak', 'mbok', 'habib', 'gus', 'romo', 'pastor', 'pendeta', 'pdt', 'alm', 'almh',
    'almarhum', 'almarhumah', 'kh', 'dear',
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
    # SQL keywords: "INSERT INTO pelanggan VALUES (…)".
    'values select insert into update delete where set null default primary key references '
    # Institutions: "atas nama Pengendali Data", "atas nama Menteri Keuangan".
    'pengendali prosesor pemerintah kementerian keuangan negeri daerah republik indonesia rakyat dewan lembaga '
    'badan dinas direktorat komisi mahkamah pengadilan kepolisian polri tni sekretariat umum nasional pusat '
    # What follows a role or a greeting when it is not a name: "Pelanggan Setia", "Karyawan Tetap", "Halo Semua".
    'setia prioritas vip tetap kontrak berprestasi terbaik terhormat yth tercinta terkasih kesayangan aktif harian '
    'magang honorer swasta asing lokal premium reguler perorangan individu lama kakak adik semuanya sir madam all '
    'everyone there world guys team folks friends bro sis gan min bos boss say sayang beb dek service support '
    'masukkan isi ketik pilih enter your sobat '
    # Cities, which a greeting or a list can put where a name would be: "Halo Bandung".
    'jakarta bandung surabaya medan semarang makassar palembang bogor depok tangerang bekasi yogyakarta jogja solo '
    'malang denpasar bali batam pekanbaru padang manado balikpapan samarinda pontianak banjarmasin ambon jayapura '
    'kupang mataram lampung aceh cirebon tasikmalaya sukabumi serang cilegon purwokerto kediri jember madiun '
    'magelang salatiga'
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
    lowercase_ambiguous = False  # "saya budi" alone is a name only if a second name follows
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
            # A cue plus a common name is enough without capitals: "aku andi yg td chat", "saya siti rahayu".
            if (not _is_known_name(bare)) if words else (bare not in GIVEN_NAMES and bare not in AMBIGUOUS_GIVEN_NAMES):
                break
            if not words and bare in AMBIGUOUS_GIVEN_NAMES:
                lowercase_ambiguous = True
        elif words and _UPPER_START.match(text[words[0][0]]) and not _UPPER_START.match(word):
            # "a.n. Ilham Simatupang kontrol rutin …": a capitalized name ends at a lowercase word that is no name.
            if bare not in _NAME_PARTICLES and not _is_known_name(bare):
                break
        words.append((word_start, word_start + len(word), bare))
        if word.endswith('.') and len(bare) > 1:
            break  # "… Budi." ends the sentence; "M. Rizky" goes on
    while words and words[-1][2] in _NAME_PARTICLES:
        words.pop()
    if not words or words[0][2] in _ORGANIZATION:
        return None
    if lowercase_ambiguous and len(words) == 1:
        return None
    value = _TRAILING_DOT_COMMA.sub('', text[words[0][0] : words[-1][1]])
    if len(_ASCII_LETTER.findall(value)) < 2:
        return None
    return _match('NAME', words[0][0], value, confidence)


# Phrases that introduce a name, in any case: "atas nama budi santoso", "nama saya Rina", "bernama Rizky".
_NAME_INTRO = rx(
    r'\b(?:a\.\s?n\.?|a\/n|an\.|atas\s+nama|nama\s+(?:lengkap\s+)?(?:saya|aku|ku|gue|gw|sy)|namaku|namanya|nama\s+(?:lengkap\s+)?(?:anak|ibu|bapak|ayah|suami|istri|adik|kakak|teman|orang\s+tua)\s+(?:saya|aku|kami|gue)|nama\s+(?:akun|pengguna|pemilik|penerima|pengirim|pelanggan|nasabah|pasien|siswa|karyawan|pemesan)|bernama|dengan\s+nama|my\s+name\s+is|nami\s+(?:abdi|kulo|kula|simkuring|sim\s+kuring)|jeneng(?:ku|\s+(?:kula|kulo|aku|kulo))|asma\s+kula)(?![A-Za-z])[ \t]*(?:[:=][ \t]*)?',  # noqa: E501
    'gi',
)
# Weaker cues, so the name itself must be capitalized: "saya Rina Wulandari", "halo, dengan Agus", "Penerima Budi".
_NAME_CUE = rx(
    r'\b(?:saya|aku|gue|gw)[ \t]*,?[ \t]+|\b(?:halo|hai|hallo|selamat\s+(?:pagi|siang|sore|malam))[ \t]*,?[ \t]*(?:ini|dengan|dgn)[ \t]+|\b(?:penerima|pengirim|pemesan|pembeli)[ \t]+',  # noqa: E501
    'gi',
)
_HONORIFIC = rx(
    r'(?<![\w-])(?:Bapak|Bpk\.?|Bp\.|Ananda|Ibu|Pak|Bu|Sdr\.?|Sdri\.?|Saudara|Saudari|Mas|Mbak|Kak|Bang|Tn\.|Ny\.|Nn\.)[ \t]+',  # noqa: E501
    'gi',
)
_LOWERCASE_OK = rx(r'^(?:bapak|ibu|mbak)\b')
# Titles and forms of address in their usual case only: "CI Pipeline" and "Uni Eropa" are not people.
_TITLE_CUE = rx(
    r'(?<![\w-])(?:Mr\.?|Mrs\.?|Ms\.?|Miss|Mister|Dr\.|Prof\.|Ir\.|Drs\.|Dra\.|H\.|Hj\.|KH\.|Pdt\.|Alm\.|Almh\.|[Aa]lmarhum(?:ah)?|[Kk]oh?|[Cc]ik|[Cc]ici|[Oo]m|[Tt]ante|[Kk]ang|[Bb]li|[Cc]ak|[Mm]bok|[Hh]abib|[Gg]us|[Uu]stadz(?:ah)?|[Rr]omo|[Pp]astor|[Pp]endeta)[ \t]+',  # noqa: E501
    'g',
)
# Roles that a name follows in support tickets, reports, and logs: "Pelanggan Budi Santoso", "Kurir Supardi".
_ROLE_CUE_SOURCE = r'\b(?:pelanggan|customer|konsumen|pembeli|pemesan|nasabah|pasien|patient|kurir|driver|sopir|supir|karyawan|karyawati|pegawai|staf|staff|siswa|siswi|murid|santri|mahasiswa|mahasiswi|tamu|pemilik|penyewa|penghuni|peminjam|debitur|pelapor|terlapor|korban|pelaku|tersangka|terdakwa|saksi|kepala\s+keluarga|penggugat|tergugat|pemohon|termohon|pewaris|klien|konseli|tertanggung|penumpang|berinisial|inisial|istrinya|suaminya|anaknya|adiknya|kakaknya|ayahnya|ibunya|wakilnya|atasannya|temannya|tetangga|pacar|calon|bayi(?:[ \t]+(?:laki-laki|perempuan))?|balita|cucu(?:nya)?|keponakan(?:nya)?|anggota|member|warga|jamaah|jemaat|u\/|utk\.?|untuk|kepada|kpd\.?)[ \t]+'  # noqa: E501
_ROLE_CUE = rx(_ROLE_CUE_SOURCE, 'gi')
_ROLE_AT_START = rx('^(?:' + _ROLE_CUE_SOURCE[len(r'\b') :] + ')', 'i')
_LOOSE_ROLE = rx(
    r'^(?:customer|patient|driver|staff|staf|tamu|calon|pacar|korban|saksi|pelaku|tetangga|utk|untuk|kepada|kpd|anggota|member|warga|jamaah|jemaat)\b',  # noqa: E501
    'i',
)
_ACRONYM = rx(r'^[A-Z]{2,5}$')
_INITIALS_CUE = rx(r'inisial', 'i')
# Greetings that open a message to someone: "Halo Budi,", "Dear Mr. Hendra Gunawan,".
# "Pagi, Budi!" opens a line; "Sinar Pagi, Bogor" in the middle of one is a village.
_GREETING_CUE = rx(
    r"(?:^|(?<=[\s,.!]))(?:halo|hallo|hai|hi|hello|hey|dear|selamat\s+(?:pagi|siang|sore|malam)|assalamu'?alaikum)[ \t]*,?[ \t]+|^[ \t]*(?:pagi|siang|sore|malam)[ \t]*,?[ \t]+",  # noqa: E501
    'gim',
)
_GREETING_END = rx(r'^[ \t]*(?:[,!:\r\n]|\.(?!\S)|$)')


def _is_known_name(bare: str) -> bool:
    return bare in GIVEN_NAMES or bare in AMBIGUOUS_GIVEN_NAMES or bare in FAMILY_NAMES or bare in SECOND_NAMES


# Javanese names the list cannot hold one by one end the same way: Hartini, Sumiyati, Rosmawati, Suryanto, Hadiyono.
_JAVANESE_NAME = rx(r'^[a-z]{2,}(?:wati|yati|iyati|ningsih|ningrum|astuti|tini|rini|yanto|yono|wanto|harjo)$')
_PLACE_PREPOSITION = rx(r'^(?:di|daerah|arah|wilayah|kawasan|menuju|sekitar)$')
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
        found = _name_at(text, m.end(), 'medium', True)
        # In capitals a capital is no sign of a name: "AKU TITIP BARANG" is a verb, "SAYA RINA" a name the lists know.
        if found and not re.search('[a-z]', found.value) and not _is_known_name(found.value.split()[0].lower()):
            continue
        add(found)
    for m in _HONORIFIC.finditer(text):
        # "Ibu Sari Dewi di Depok" stops at "di". After "bapak/ibu/mbak" a lowercase name is common in chat
        # ("bapak ahmad"); the short ones ("kak", "pak", "bu") too often just address the reader.
        lowercase_ok = _LOWERCASE_OK.search(m.group(0)) is not None
        add(_name_at(text, m.end(), 'medium', not lowercase_ok))
    for m in _TITLE_CUE.finditer(text):
        add(_name_at(text, m.end(), 'medium', True))
    for m in _ROLE_CUE.finditer(text):
        found = _name_at(text, m.end(), 'medium', True)
        # "Kurir JNE" is a company; "berinisial RK" is the only place two capitals are a person.
        if not found or (_ACRONYM.search(found.value) and not _INITIALS_CUE.search(m.group(0))):
            continue
        # "untuk Google Chrome", "Driver Printer Canon", "Tamu Undangan": after a preposition or a word that is also
        # English or generic, at least one word must be a known name.
        if _LOOSE_ROLE.search(m.group(0)) and not any(_is_known_name(w.lower()) for w in _js.split_ws(found.value)):
            continue
        add(found)
    for m in _GREETING_CUE.finditer(text):
        found = _name_at(text, m.end(), 'medium', True)
        # A greeting names someone only when the name closes it: "Halo Budi," but not "Halo Kak, Saya mau" or
        # "Hello, Node.js User!".
        if found and _GREETING_END.search(text[found.end :]):
            add(found)
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


# A word right before a capitalized run that makes it a place or an organization: "Jl. Ahmad Yani", "RS Siti
# Khadijah", "Universitas Ahmad Dahlan", "Toko Budi Jaya".
_PLACE_WORDS = frozenset((
    'jl jln jalan gg gang lorong komp komplek kompleks perum perumahan cluster universitas univ institut sekolah '
    'fakultas akademi politeknik kampus sd sdn smp smpn sma sman smk smkn mi mts ma pondok ponpes pesantren masjid '
    'musholla mushola langgar gereja pura vihara klenteng rs rsu rsud rsia rsj sakit puskesmas klinik apotek toko '
    'warung pt cv ud yayasan koperasi bank stasiun terminal bandara pelabuhan gedung wisma hotel mall plaza pasar '
    'taman museum stadion lapangan gor gelora kampung desa kelurahan kecamatan kabupaten kota provinsi gunung '
    'pantai pulau sungai danau monumen tugu bendungan rusun apartemen tower blok aula balai lembaga dinas kantor '
    'perpustakaan piala liga festival bung way tanjung teluk ujung muara kuala bukit lubuk pematang sei '
    # Batak and Karo villages are often a clan name after one of these: "Lumban Siregar", "Pintu Pohan".
    'lumban lobu huta dolok bandar urung nagori talun pamah perkebunan sosor aek banjar pintu raja siraja debata '
    'kel kec kab kp ds dsn '
    # Products and events are named like people too: "Paket Hemat Ramadhan", "Promo Spesial Kartini".
    'paket promo program diskon menu edisi spesial special event lomba produk varian'
).split(' '))
# Words that end a run of names in a place name: "Indra Jaya", "Laras Selatan", "Sido Makmur".
_PLACE_SUFFIX = frozenset((
    'jaya makmur raya selatan utara barat timur tengah permai asri sejahtera sentosa abadi mulya baru lama damai '
    'harapan mekar gemilang kencana rejo mukti karya bakti jitu pahlawan'
).split(' '))
_CAPITALIZED_RUN = rx(
    "(?<![\\w@.'\u2019-])[A-Z][A-Za-z'\u2019-]*\\.?(?:[ \\t]+(?:[A-Z][A-Za-z'\u2019-]*\\.?|bin|binti|van|der|de|al|el))+", 'g'
)
_NON_WS = rx(r'\S+', 'g')
_PREV_WORD = rx(r'([A-Za-z]+)\.?[ \t]*$')
_SHORT_WORD = rx(r'^[A-Za-z]{2,5}$')


# A word of a capitalized run: (start, end, word as written, bare lowercase word).
_Word = tuple[int, int, str, str]


def _nameish(words: list[_Word], k: int) -> bool:
    if k >= len(words):
        return False
    word, bare = words[k][2], words[k][3]
    if bare in _NAME_PARTICLES:
        return k + 1 < len(words)  # "bin Abdullah", never a trailing "bin"
    return (
        _UPPER_START.match(word) is not None and bare not in _NOT_NAME and bare not in _TITLE_WORDS
        and bare not in _ORGANIZATION and bare not in _PLACE_WORDS and bare not in _PLACE_SUFFIX
        and not bare.endswith('nya')
    )


def _extend_name(words: list[_Word], start: int) -> int:
    k = start
    while k < len(words) and k - start < 5 and _nameish(words, k):
        k += 1
        # "… Togar Simanjuntak. Tamu: …" ends with the sentence; "M. Rizky" goes on.
        if words[k - 1][2].endswith('.') and len(words[k - 1][3]) > 1:
            break
    while k > start and words[k - 1][3] in _NAME_PARTICLES:
        k -= 1
    return k - start


def _detect_known_names(text: str) -> list[PiiMatch]:
    """Names with no cue around them, recognized by their parts.

    A common given name before another name ("Hendra Gunawan", "SITI RAHAYU" in a bank statement), a family or clan
    name ("Togar Simanjuntak"), a Balinese name ("I Made Wirawan"), or a Chinese-Indonesian one ("Lim Swie Hong").
    """
    out: list[PiiMatch] = []
    for m in _CAPITALIZED_RUN.finditer(text):
        words: list[_Word] = [
            (m.start() + w.start(), m.start() + w.start() + len(_TRAILING_DOT_COMMA.sub('', w.group(0))), w.group(0),
             (w.group(0)[:-1] if w.group(0).endswith('.') else w.group(0)).lower())
            for w in _NON_WS.finditer(m.group(0))
        ]
        prev = _PREV_WORD.search(text[max(0, m.start() - 30) : m.start()])
        if prev and prev.group(1).lower() in _PLACE_WORDS:
            continue

        i = 0
        while i < len(words) - 1:
            w_start, _, word, bare = words[i]
            if bare in _PLACE_WORDS or bare in _ORGANIZATION:
                break  # the rest names the place
            nxt = words[i + 1][3]
            length = 0
            # "I" is also English, so it is checked before the other rules rule it out.
            if word in ('I', 'Ni') and nxt in BALINESE_NAMES:
                length = 1 + _extend_name(words, i + 1)
            elif not _nameish(words, i):
                i += 1
                continue
            elif bare in CHINESE_FAMILY_NAMES and all(
                _nameish(words, i + d) and _SHORT_WORD.search(words[i + d][2]) for d in (1, 2)
            ):
                length = 3
            # "Hendra Gunawan"; "Dewi Lestari", "Wahyu Hidayat", but not two words that are both also common nouns
            # ("Permata Intan").
            elif (bare in GIVEN_NAMES and _nameish(words, i + 1)) or (
                bare in AMBIGUOUS_GIVEN_NAMES and _nameish(words, i + 1)
                and (
                    nxt in GIVEN_NAMES or nxt in FAMILY_NAMES or nxt in SECOND_NAMES
                    # A Chinese-Indonesian family name at the end: "Dewi Lim", "Ayu Tan".
                    or (nxt in CHINESE_FAMILY_NAMES and not _nameish(words, i + 2))
                )
            ):
                length = _extend_name(words, i)
            else:
                # A family name after one unknown word ("Togar Simanjuntak") or after known names only. "BI-FAST CR
                # SITI RAHAYU" starts at SITI, not at BI-FAST. Two clan names in a row ("Simamora Hasibuan") name a
                # village.
                j = i + 1
                while j <= i + 3 and _nameish(words, j):
                    if words[j][3] not in FAMILY_NAMES:
                        if not _is_known_name(words[j][3]):
                            break
                        j += 1
                        continue
                    lone = j == i + 1 and bare not in FAMILY_NAMES
                    if lone or bare in GIVEN_NAMES or bare in AMBIGUOUS_GIVEN_NAMES:
                        length = max(j - i + 1, _extend_name(words, i))
                    break
            if length < 2:
                i += 1
                continue
            last_end = words[i + length - 1][1]
            out.append(_match('NAME', w_start, text[w_start:last_end], 'medium'))
            i += length
    return out


# Closings that put the sender's name on the same or the next line: "Salam,\nRina Kartika Sari".
_SIGN_OFF = rx(
    r"^[ \t]*(?:salam(?:\s+hangat)?|hormat\s+(?:saya|kami)|terima\s*kasih|makasih|regards|best\s+regards|kind\s+regards|warm\s+regards|best|thanks|thank\s+you|cheers|sincerely|yours\s+sincerely|wassalam(?:u'?alaikum)?)[ \t]*[,.!]?[ \t]*(?:\r?\n[ \t]*)+",  # noqa: E501
    'gim',
)
_LEADING_TITLES = rx(r'^(?:\w+\.\s*)+')
_FROM_COMMA = rx(r',.*$')
_TRAILING_CR = rx(r'\r$')
_DASH_SIGN = rx("(?:^|(?<=[.!?)\"\u201d]))[ \\t]*[-\u2013\u2014~][ \\t]*(?=[A-Z])", 'gm')
_DASH_SIGN_END = rx(r'^[ \t]*(?:,|\r?\n|$)')


def _detect_signatures(text: str) -> list[PiiMatch]:
    out: list[PiiMatch] = []
    for m in _SIGN_OFF.finditer(text):
        start = m.end()
        line_end = text.find('\n', start)
        line = _js.trim(_TRAILING_CR.sub('', text[start : len(text) if line_end == -1 else line_end]))
        found = _name_at(text, start, 'medium', True)
        # The whole line is the name (titles and degrees aside): "Agus Salim Nasution", "Dr. Rina, M.Sc.".
        if found and len(found.value) >= len(_FROM_COMMA.sub('', _LEADING_TITLES.sub('', line, count=1), count=1)) - 1:
            out.append(found)
    # A review or a quote signed with a dash: "… sudah ramah. - Rizal, Makassar". A dash also starts list items, so the
    # name must be a known one and close the line or be followed by a comma.
    for m in _DASH_SIGN.finditer(text):
        found = _name_at(text, m.end(), 'medium', True)
        if not found or not any(_is_known_name(w.lower()) for w in _js.split_ws(found.value)):
            continue
        if _DASH_SIGN_END.search(text[found.end :]):
            out.append(found)
    return out


_DISPLAY_NAME = rx(
    "(?:^|(?<=[\\s:,;(]))\"?((?:[A-Z][A-Za-z'\u2019.-]*[ \\t]+){0,4}[A-Z][A-Za-z'\u2019.-]*)\"?[ \\t]*<[^<>\\s@]+@[^<>\\s]+>",
    'gm',
)


def _detect_display_names(text: str) -> list[PiiMatch]:
    """The display name in front of an e-mail address: "From: Budi Santoso <budi.s@gmail.com>"."""
    out: list[PiiMatch] = []
    for m in _DISPLAY_NAME.finditer(text):
        group = m.start() + m.group(0).find(m.group(1))
        group_end = group + len(m.group(1))
        # The name is what reaches the "<": "MIT License. Einar Otto Stangvik <…>" is Einar Otto Stangvik.
        for w in _NON_WS.finditer(m.group(1)):
            found = _name_at(text, group + w.start(), 'high', True)
            if found and found.end >= group_end - 1:
                out.append(found)
                break
    return out


# Words after "@" that are code: JSDoc tags, CSS at-rules, decorators, and annotations.
_CODE_AT = frozenset((
    'param params arg argument returns return type typedef template example deprecated see link throws throw '
    'default since version author license preserve todo fixme internal private public protected override readonly '
    'module namespace callback property prop event fires listens description summary inheritdoc abstract async '
    'media import keyframes supports layer tailwind apply use forward include mixin extend charset container page '
    'font-face component injectable input output test before after inject directive pipe ngmodule effect select '
    'staticmethod classmethod dataclass pytest app router api client mock patch fixture ts-ignore ts-expect-error '
    'jsx jsximportsource vite babel types entity column table get post put delete controller service observable '
    'satisfies overload implements augments class constructor enum function member memberof method name this '
    'constant const copyright exports external file fileoverview global ignore instance interface kind lends mixes '
    'package requires static tutorial yields alias generator beta alpha experimental remarks typeparam defaultvalue '
    'label linkcode linkplain virtual sealed decorator args options props context state value data'
).split(' '))
_HANDLE_CUE = rx(
    r'\b(?:ig|instagram|insta|tiktok|twitter|threads|telegram|tele|dm|akun|account|follow|mention|tag|username|handle|fb|facebook|line|youtube|yt)\b'  # noqa: E501
)
# After a space or punctuation, never inside a word or an address ("b***@gmail.com").
_HANDLE = rx("(?<![^\\s(,:;\"'[])@([A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)(?![\\w@/(-]|\\.\\w)", 'g')
_ALL_DIGITS = rx(r'^\d+$')
_DOMAIN = rx(r'\.(?:com|net|org|id|io|co|dev|app|me)$', 'i')
_COMMENT_LEAD = rx(r'^\s*(?:\*|\/\/|#)')
_HANDLE_SHAPE = rx(r'[\d._]')
_HANDLE_CHARS = rx(r'^[a-z0-9_.]+$')


def _detect_handles(text: str) -> list[PiiMatch]:
    """Social media handles in chat and tickets: "cek DM dari @siti.rahayu88". Not "@param", "@media", "@types/node"."""
    out: list[PiiMatch] = []
    for m in _HANDLE.finditer(text):
        handle = m.group(1)
        if handle.lower() in _CODE_AT or handle.split('.')[0].lower() in _CODE_AT or _ALL_DIGITS.search(handle):
            continue
        if _DOMAIN.search(handle):
            continue  # a domain
        line_start = text.rfind('\n', 0, m.start()) + 1
        lead = text[line_start : m.start()]
        # A decorator stands alone at the start of a line ("@pytest.fixture"); doc comments are code ("* @param").
        if _COMMENT_LEAD.search(lead):
            continue
        if not _js.trim(lead) and not _js.trim(text[m.end() :].split('\n', 1)[0]):
            continue
        shaped = _HANDLE_SHAPE.search(handle) is not None and len(handle) >= 5 and _HANDLE_CHARS.search(handle) is not None
        if not shaped and not _HANDLE_CUE.search(_before(text, m.start(), 40)):
            continue
        out.append(_match('NAME', m.start() + 1, handle, 'medium'))
    return out


# A label on its own line and the value on the next, as receipts, bank transfer screens, and KTP scans without colons
# lay them out: "Penerima\nDEWI LESTARI", "Agama\nISLAM".
_STACKED_TYPES: frozenset[PiiType] = frozenset((
    'NAME', 'NIK', 'KK', 'NPWP', 'NIP', 'SIM', 'BPJS', 'PHONE', 'BANK_ACCOUNT', 'EMAIL', 'BIRTH_DATE', 'RELIGION',
    'GENDER', 'MARITAL_STATUS',
))
_RELIGION_WORD = rx(
    r'^(?:islam|kristen(?:\s+protestan)?|protestan|katolik|katholik|hindu|buddha|budha|konghucu|khonghucu|kepercayaan.*)$', 'i'
)
_MARITAL_WORD = rx(
    r'^(?:kawin|belum\s+kawin|cerai\s+hidup|cerai\s+mati|menikah|belum\s+menikah|lajang|janda|duda|single|married|divorced|widowed)$',  # noqa: E501
    'i',
)
_LABEL_SEPARATOR_CHAR = re.compile(r'[:=]')


def _detect_stacked_labels(text: str) -> list[PiiMatch]:
    out: list[PiiMatch] = []
    # Lines split on "\n" only, so a CRLF file keeps the value on the very next line.
    lines: list[tuple[int, str]] = []
    pos = 0
    while pos <= len(text):
        end = text.find('\n', pos)
        if end == -1:
            end = len(text)
        lines.append((pos, _TRAILING_CR.sub('', text[pos:end])))
        pos = end + 1
    for i in range(len(lines) - 1):
        label = _js.trim(lines[i][1])
        if not label or len(label) > 30 or _LABEL_SEPARATOR_CHAR.search(label) or len(_js.split_ws(label)) > 3:
            continue
        pii_type = field_type(label)
        if not pii_type or pii_type not in _STACKED_TYPES:
            continue
        next_start, next_text = lines[i + 1]
        value = _js.trim(next_text)
        if not value or len(value) > 60 or field_type(value) or not is_plausible_value(pii_type, value, label):
            continue
        if pii_type == 'NAME' and not all(
            _UPPER_START.match(w) and w.lower() not in _NOT_NAME for w in _js.split_ws(value)
        ):
            continue
        if pii_type == 'RELIGION' and not _RELIGION_WORD.search(value):
            continue
        if pii_type == 'MARITAL_STATUS' and not _MARITAL_WORD.search(value):
            continue
        out.append(_match(pii_type, next_start + next_text.find(value), value, 'medium'))
    return out


_COLONLESS_LABEL = rx(
    r'^[ \t]*(Jenis[ \t]+Kelamin|Kelamin|Agama|Status[ \t]+Perkawinan|Status[ \t]+Kawin|Perkawinan)[ \t]+(?![:=])([A-Za-z][A-Za-z -]{1,24}?)(?=[ \t]*(?:\r?$|[ \t]{2,}|[ \t]+(?:Gol|Golongan|RT|RW)\b))',  # noqa: E501
    'gim',
)
_GENDER_WORD = rx(r'^(?:laki-?\s?laki|lelaki|perempuan|pria|wanita)$', 'i')


def _detect_colonless_labels(text: str) -> list[PiiMatch]:
    """KTP scans that lost their colons keep label and value on one line: "Jenis Kelamin LAKI-LAKI", "Agama KRISTEN".

    The values come from a closed list, so nothing else on such a line is taken.
    """
    out: list[PiiMatch] = []
    for m in _COLONLESS_LABEL.finditer(text):
        pii_type = field_type(m.group(1))
        value = m.group(2)
        if pii_type == 'GENDER' and not _GENDER_WORD.search(value):
            continue
        if pii_type == 'RELIGION' and not _RELIGION_WORD.search(value):
            continue
        if pii_type == 'MARITAL_STATUS' and not _MARITAL_WORD.search(value):
            continue
        if pii_type:
            out.append(_match(pii_type, *_group_tail(m, 2), 'medium'))
    return out


_PHONE_OWNER = rx(
    r'(?:\+62|0062|62|0)[ \t-]?8[\d \t.-]{7,16}\d[ \t]*\([ \t]*((?:(?:Pak|Bu|Bapak|Ibu|Mas|Mbak|Kak|Bang)[ \t]+)?[A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){0,2})[ \t]*\)',  # noqa: E501
    'g',
)
_SPACES = rx(r'[ \t]+')


def _detect_phone_owners(text: str) -> list[PiiMatch]:
    """A name in brackets right after a phone number: "WA: 0812 3456 7890 (Andi)", "0813-1111-2222 (Bu Sari)"."""
    out: list[PiiMatch] = []
    for m in _PHONE_OWNER.finditer(text):
        name = m.group(1)
        words = [w.lower() for w in _SPACES.split(name)]
        if any(w in _NOT_NAME and w not in _TITLE_WORDS for w in words):
            continue  # "(Kantor)", "(Rumah)", "(WA)"
        out.append(_match('NAME', m.start() + m.group(0).rfind(name), name, 'medium'))
    return out


_LOG_USER = rx(r'(?<![\w.-])(?:user|usr|login|uname)=(["\']?)([A-Za-z][\w.-]{2,40})\1(?=[\s,;&]|$)', 'g')
_USER_PARTS = rx(r'[._-]+')
_TRAILING_DIGITS = rx(r'\d+$')


def _detect_log_users(text: str) -> list[PiiMatch]:
    """`user=dimas.anggara` in a logfmt line names a person; `user=root` or `user=postgres` is an account."""
    out: list[PiiMatch] = []
    for m in _LOG_USER.finditer(text):
        user = m.group(2)
        if not any(_is_known_name(_TRAILING_DIGITS.sub('', w.lower())) for w in _USER_PARTS.split(user)):
            continue
        out.append(_match('NAME', m.start() + len(m.group(0)) - len(user) - len(m.group(1)), user, 'medium'))
    return out


_TIMED_SENDER = rx(r'^\[\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:[ \t]?[AP]M)?\][ \t]+([A-Za-z][\w. -]{1,38}?):[ \t]', 'dgm')
_HANDLE_SHAPED = rx(r'^[a-z][a-z0-9]*[._][a-z0-9._]+$')
_SENDER_PARTS = rx(r'[ ._-]+')


def _detect_timed_senders(text: str) -> list[PiiMatch]:
    """Chat-app copies with only a time: Slack "[10:21] rizky_pratama: …", Discord, IRC logs."""
    out: list[PiiMatch] = []
    for m in _TIMED_SENDER.finditer(text):
        sender = m.group(1)
        if _NOT_A_PERSON.search(sender):
            continue
        # A log level or a service ("[10:21] Server: ready") is not a person: a handle shape or a known name is.
        shaped = bool(_HANDLE_SHAPED.search(sender))
        if not shaped and not any(_is_known_name(w.lower()) for w in _SENDER_PARTS.split(sender)):
            continue
        out.append(_match('NAME', m.start(1), sender, 'medium'))
    return out


def _decode_entities(s: str) -> str:
    return s.replace('&amp;', '&').replace('&nbsp;', ' ').replace('&#39;', "'").replace('&apos;', "'").replace('&quot;', '"')


_HTML_HINT = rx(r'<(?:input|td|th)\b', 'i')
_INPUT_TAG = rx(r'<input\b[^>]*>', 'gi')
_INPUT_NAME = rx("\\b(?:name|id)\\s*=\\s*[\"']([^\"']+)[\"']", 'i')
_INPUT_VALUE = rx("\\bvalue\\s*=\\s*([\"'])([^\"']*)\\1", 'i')
_TABLE_ROW = rx(r'<tr\b[^>]*>([\s\S]*?)<\/tr>', 'gi')
_TABLE_CELL = rx(r'<(t[hd])\b[^>]*>([^<]*)<\/t[hd]>', 'gi')
_THREE_DIGITS = re.compile(r'[0-9]{3}')


class _Cell(NamedTuple):
    header: bool
    text: str
    start: int
    raw: str


def _detect_html(text: str) -> list[PiiMatch]:
    """Form fields and tables in HTML: `<input name="nama" value="…">`, `<th>Nama</th>` over `<td>Budi Santoso</td>`."""
    if not _HTML_HINT.search(text):
        return []
    out: list[PiiMatch] = []
    for m in _INPUT_TAG.finditer(text):
        tag = m.group(0)
        name_m = _INPUT_NAME.search(tag)
        value = _INPUT_VALUE.search(tag)
        name = name_m.group(1) if name_m else None
        pii_type = field_type(name) if name else None
        if not pii_type or not value or not is_plausible_value(pii_type, value.group(2), name or ''):
            continue
        out.append(_match(pii_type, m.start() + value.start() + value.group(0).find(value.group(2), 1), value.group(2), 'high'))
    columns: Optional[list[Optional[PiiType]]] = None
    headers: list[str] = []
    for row in _TABLE_ROW.finditer(text):
        inner_start = row.start() + row.group(0).find(row.group(1))
        cells = [
            _Cell(
                c.group(1).lower() == 'th',
                _js.trim(_decode_entities(c.group(2))),
                inner_start + c.start() + c.group(0).find('>') + 1,
                c.group(2),
            )
            for c in _TABLE_CELL.finditer(row.group(1))
        ]
        if not cells:
            continue
        types = [field_type(c.text) if len(c.text) <= 40 else None for c in cells]
        # "<th>Nama</th><td>Budi Santoso</td>": a label cell and its value.
        if len(cells) == 2 and types[0] and not types[1]:
            label, cell = cells
            if cell.text and is_plausible_value(types[0], cell.text, label.text):
                out.append(_match(types[0], cell.start + cell.raw.find(cell.text[:1]), _js.trim(cell.raw), 'high'))
            continue
        if all(c.header for c in cells) or (
            columns is None and any(types) and all(not _THREE_DIGITS.search(c.text) for c in cells)
        ):
            columns = types
            headers = [c.text for c in cells]
            continue
        if columns is None:
            continue
        for i, c in enumerate(cells):
            pii_type = columns[i] if i < len(columns) else None
            if not pii_type or not c.text or not is_plausible_value(pii_type, c.text, headers[i]):
                continue
            raw = c.raw
            out.append(_match(
                pii_type, c.start + raw.find(_js.trim(raw)), _js.trim(raw),
                'medium' if is_generic_name_key(headers[i]) else 'high',
            ))
    return out


# UU PDP Article 4: criminal records. Phrases that say it of a person, not news about crime in general.
# HL7 v2 segments from hospital systems: field number → what it holds.
_HL7_FIELDS: dict[str, dict[int, PiiType]] = {
    'PID': {5: 'NAME', 6: 'NAME', 7: 'BIRTH_DATE', 8: 'GENDER', 11: 'ADDRESS', 13: 'PHONE', 14: 'PHONE', 19: 'NIK'},
    'NK1': {2: 'NAME', 4: 'ADDRESS', 5: 'PHONE', 6: 'PHONE'},
    'DG1': {3: 'HEALTH', 4: 'HEALTH'},
    'IN1': {16: 'NAME'},
}
_HL7_SEGMENT = rx(r'^(PID|NK1|DG1|IN1)\|[^\r\n]*', 'gm')
_HL7_SEPARATORS = rx(r'[\^~&\s]', 'g')
_HL7_TRAILING = rx(r'[\^~]+$')


def _detect_hl7(text: str) -> list[PiiMatch]:
    """"PID|1||RM-00123||SUSANTO^BUDI||19800412|M": every field a segment defines as personal, whatever its content."""
    out: list[PiiMatch] = []
    for m in _HL7_SEGMENT.finditer(text):
        fields = _HL7_FIELDS[m.group(1)]
        pos = m.start()
        for i, value in enumerate(m.group(0).split('|')):
            pii_type = fields.get(i)
            if pii_type and _HL7_SEPARATORS.sub('', value):
                out.append(_match(pii_type, pos, _HL7_TRAILING.sub('', value), 'high'))
            pos += len(value) + 1
    return out


_CRIME = r'[a-z]+(?:\s+(?:online|anak|uang|dana|berat|ringan|narkotika|pidana))?'
_CRIMINAL = rx(
    rf'\b(?:mantan|eks|bekas)\s+(?:napi|narapidana|tahanan|tapol|terpidana|residivis)(?:\s+kasus\s+{_CRIME})?'
    rf'|\bresidivis(?:\s+kasus\s+{_CRIME})?'
    rf'|\b(?:napi|narapidana|terpidana|tersangka|terdakwa|terjerat|tersandung|terlibat)\s+kasus\s+{_CRIME}'
    r'|\bpernah\s+(?:dipenjara|dibui|dipidana|ditahan|dihukum(?:\s+penjara)?|masuk\s+(?:penjara|bui|lapas|rutan)|ditangkap(?:\s+polisi)?)(?:\s+(?:selama\s+)?\d+\s+(?:tahun|bulan))?'  # noqa: E501
    rf'(?:\s+(?:karena\s+|atas\s+)?kasus\s+{_CRIME})?'
    r'|\bdivonis\s+\d+\s+(?:tahun|bulan)(?:\s+penjara)?'
    # "SKCK: ada catatan kasus penggelapan", "catatan kepolisian kasus KDRT".
    rf'|\bcatatan\s+(?:(?:kriminal|kepolisian|pidana)\s+)?kasus\s+{_CRIME}'
    # Penjelasan Pasal 4 ayat (2) huruf d: "pencantuman dalam daftar pencegahan atau penangkalan".
    r'|\b(?:masuk|dimasukkan\s+ke|tercantum\s+di)\s+(?:dalam\s+)?daftar\s+(?:cekal|pencegahan|penangkalan|hitam\s+imigrasi|pencarian\s+orang|dpo|buronan)'  # noqa: E501
    r'|\b(?:dicekal|berstatus\s+(?:dpo|buron(?:an)?)|masuk\s+dpo|jadi\s+(?:dpo|buron(?:an)?))\b'
    # "baru keluar lapas", "bebas dari penjara tahun lalu", "kasusnya penipuan".
    rf'|\b(?:keluar|bebas)\s+(?:dari\s+)?(?:lapas|lp|penjara|bui|rutan|tahanan)\b|\bkasusnya\s+{_CRIME}',
    'gi',
)


def _detect_criminal(text: str) -> list[PiiMatch]:
    return [_match('CRIMINAL_RECORD', m.start(), m.group(0), 'medium') for m in _CRIMINAL.finditer(text)]


_GLUED_NIK = rx(r'(?<=[A-Za-z_])\d{16}(?![\dA-Za-z])', 'g')
_LETTER_PREFIX = rx(r'[A-Za-z_]+$')
_GLUED_PHONE = rx(r'(?<=[A-Za-z])(?:\+?62|0)8\d{8,11}(?!\d)', 'g')
_PHONE_LABEL_PREFIX = rx(r'[A-Za-z.]+$')


def _detect_glued_ids(text: str) -> list[PiiMatch]:
    """Identifiers glued to letters, which the digit-run and phone detectors leave alone.

    "KTP_3201…0001.jpg", "NIK3201…", "wa081234567890". A NIK must validate; a phone must follow a phone label.
    """
    out: list[PiiMatch] = []
    for m in _GLUED_NIK.finditer(text):
        prefix_m = _LETTER_PREFIX.search(text[max(0, m.start() - 20) : m.start()])
        assert prefix_m is not None
        prefix = prefix_m.group(0)
        head_at = m.start() - len(prefix) - 1
        head = text[head_at] if head_at >= 0 else None
        # "a3f…" in a hash has digits before the letters; a lone letter is too little to go on.
        if (head is not None and '0' <= head <= '9') or (len(prefix.replace('_', '')) < 2 and '_' not in prefix):
            continue
        if parse_nik(m.group(0)).valid:
            out.append(_match('NIK', m.start(), m.group(0), 'high'))
    for m in _GLUED_PHONE.finditer(text):
        label_m = _PHONE_LABEL_PREFIX.search(text[max(0, m.start() - 12) : m.start()])
        assert label_m is not None
        if label_m.group(0).lower() in _PHONE_LABELS and parse_phone(m.group(0)).valid:
            out.append(_match('PHONE', m.start(), m.group(0), 'high'))
    return out


# A NIK or KK that OCR read from a card, with letters for the digits they look like: "NIK : 33O521 6805000l43".
_OCR_ID = rx(
    r'\b(nik|no\.?\s*ktp|ktp|no\.?\s*kk|kk|nomor\s+induk\s+kependudukan)\b[ \t]*[:.=]?[ \t]*'
    r'([0-9oil|](?:[ ]?[0-9oil|]){15})(?![0-9a-z|])',
    'gi',
)
_OCR_LETTER = rx('[oil|]', 'i')


def _detect_ocr_ids(text: str) -> list[PiiMatch]:
    out: list[PiiMatch] = []
    for m in _OCR_ID.finditer(text):
        raw = m.group(2)
        # Digits only are the digit-run detector's.
        if not _OCR_LETTER.search(raw):
            continue
        digits = _OCR_LETTER.sub(lambda c: '0' if c.group(0).lower() == 'o' else '1', raw.replace(' ', ''))
        kk = 'kk' in m.group(1).lower()
        confidence: Confidence = 'high' if not kk and parse_nik(digits).valid else 'medium'
        out.append(_match('KK' if kk else 'NIK', m.start(2), raw, confidence))
    return out


# A record that puts the birth date right after the name: "Sinta Wibowo, 12-03-1960, Jl. Cempaka …".
_RECORD_BIRTH = rx(
    r"^[ \t]*([A-Z][A-Za-z'’-]+(?:[ \t]+[A-Z][A-Za-z'’-]+){1,3})[ \t]*[,;|\t][ \t]*"
    r'(\d{1,2})([-/.])(\d{1,2})\3((?:19|20)\d{2})[ \t]*[,;|\t]',
    'gm',
)


def _detect_record_birth_dates(text: str) -> list[PiiMatch]:
    out: list[PiiMatch] = []
    this_year = _dt.datetime.now(_dt.timezone.utc).year
    for m in _RECORD_BIRTH.finditer(text):
        # "Jakarta Selatan, 12-03-2026, …" dates a letter.
        words = re.split(r'[ \t]+', m.group(1).lower())
        if any(w in _PLACE_WORDS or w in _PLACE_SUFFIX or w in _ORGANIZATION for w in words):
            continue
        year = int(m.group(5))
        if year > this_year or not _is_real_date(year, int(m.group(4)), int(m.group(2))):
            continue
        value = f'{m.group(2)}{m.group(3)}{m.group(4)}{m.group(3)}{m.group(5)}'
        out.append(_match('BIRTH_DATE', m.start(2), value, 'medium'))
    return out


_DIGIT_WORD = '(?:nol|kosong|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan)'
_SPOKEN_PHONE = rx(rf'\b(?:nol|kosong)[\s,.-]+delapan(?:[\s,.-]+{_DIGIT_WORD}){{8,11}}\b', 'gi')


def _detect_spoken_phones(text: str) -> list[PiiMatch]:
    """A phone number read out in a voice-bot or call transcript: "nol delapan satu dua tiga …"."""
    return [_match('PHONE', m.start(), m.group(0), 'medium') for m in _SPOKEN_PHONE.finditer(text)]


_LONE_WORD = rx("(?<![\\w@.'\u2019-])[A-Z][a-z]{2,14}(?![\\w'\u2019-]|\\.\\w|[ \\t]+[A-Z])", 'g')
_MID_SENTENCE = rx(r'(?:(?<![A-Za-z])[a-z]+|,)[ \t]+$')
_PREV_LOWER_WORD = rx(r'([A-Za-z]+)[ \t]+$')


def _detect_lone_given_names(text: str) -> list[PiiMatch]:
    """A single common given name in running text, not at the start of a sentence.

    "kepala keluarga Bambang", "tadi dikirim Joko". A sentence may start with any capitalized word, so there it needs
    a cue.
    """
    out: list[PiiMatch] = []
    for m in _LONE_WORD.finditer(text):
        bare = m.group(0).lower()
        if bare not in GIVEN_NAMES and not _JAVANESE_NAME.search(bare):
            continue
        lead = text[max(0, m.start() - 30) : m.start()]
        # Not at a sentence or line start, and not after a capitalized word ("Toko Batik Sekar").
        if not _MID_SENTENCE.search(lead):
            continue
        prev = _PREV_LOWER_WORD.search(lead)
        # "tinggal di Wina", "arah Malik": after a word of place, a lone name is a village.
        if prev and (
            prev.group(1).lower() in _PLACE_WORDS
            or prev.group(1).lower() in _ORGANIZATION
            or _PLACE_PREPOSITION.search(prev.group(1).lower())
        ):
            continue
        out.append(_match('NAME', m.start(), m.group(0), 'medium'))
    return out


# Headings and references that a bracketed number follows: "Pasal 5 (2)", "Tabel (3)".
_NOT_AN_AGE = frozenset((
    'pasal ayat bab bagian lampiran gambar tabel grafik nomor no langkah tahap poin butir huruf angka versi kelas ruang '
    'lantai gate pintu loket jalur map set array object date number string buffer promise error symbol'
).split(' '))
_NAME_WITH_AGE = rx(
    r"(?<![\w@.'’-])([A-Z][a-z'’-]+(?:[ \t]+(?:[A-Z][a-z'’-]+|bin|binti)){0,3})[ \t]+\([ \t]*\d{1,2}[ \t]*(?:th|thn|tahun|thn\.|th\.)?[ \t]*\)",  # noqa: E501
    'g',
)


def _detect_names_with_age(text: str) -> list[PiiMatch]:
    """A name followed by an age in brackets, as news and case notes write it: "Kevin (19)", "Narti (54 th)"."""
    out: list[PiiMatch] = []
    for m in _NAME_WITH_AGE.finditer(text):
        # "Pelaku Kevin (19)": the role in front is not part of the name.
        role_match = _ROLE_AT_START.match(m.group(1))
        role = role_match.group(0) if role_match else ''
        name = m.group(1)[len(role) :]
        words = [w.lower() for w in _SPACES.split(name)]
        if not name or any(
            w in _NOT_NAME or w in _NOT_AN_AGE or w in _TITLE_WORDS or w in _PLACE_WORDS for w in words
        ):
            continue
        out.append(_match('NAME', m.start() + len(role), name, 'medium'))
    return out


# Also a relation in emergency contacts: "Wulan (istri) 0812…".
_ATTENDANCE = rx(
    r"(?<![\w@.'’-])([A-Z][a-z'’-]+(?:[ \t]+[A-Z][a-z'’-]+){0,3})[ \t]+\((?:sakit|izin|ijin|alpa|alpha|absen|cuti|dinas(?:[ \t]+luar)?|terlambat|telat|hadir|wfh|wfo|istri|suami|ayah|ibu|bapak|anak|kakak|adik|ortu|orang[ \t]+tua|wali|saudara|keluarga|teman|wife|husband|mother|father)\)",  # noqa: E501
    'g',
)


def _detect_attendance(text: str) -> list[PiiMatch]:
    """Attendance lists: "Tidak hadir: Wahyu (sakit), Dinda (izin)". A word with an attendance status is a person."""
    out: list[PiiMatch] = []
    for m in _ATTENDANCE.finditer(text):
        if any(w.lower() in _NOT_NAME or w.lower() in _TITLE_WORDS for w in _SPACES.split(m.group(1))):
            continue
        out.append(_match('NAME', m.start(), m.group(1), 'medium'))
    return out


_SENTENCE_SUBJECT = rx(
    r'(?:^|(?<=[.!?]\s)|(?<=\n))[ \t]*([A-Z][a-z]{2,14})(?=[ \t]+(?:masih|sudah|udah|belum|lagi|sedang|bilang|minta|punya|mau|tidak|nggak|gak|ga|pernah|sakit|kerja|tinggal|baru|katanya|pinjam|hutang|utang|janji|nanya|nelpon|telat|izin|cuti|dirawat|meninggal)\b)',  # noqa: E501
    'gm',
)


def _detect_sentence_subjects(text: str) -> list[PiiMatch]:
    """A common given name opening a sentence and doing something: "Dodi masih punya utang", "Agus bilang besok"."""
    out: list[PiiMatch] = []
    for m in _SENTENCE_SUBJECT.finditer(text):
        bare = m.group(1).lower()
        if bare not in GIVEN_NAMES and not _JAVANESE_NAME.search(bare):
            continue
        out.append(_match('NAME', *_group_tail(m), 'medium'))
    return out


_NAME_PAIR = rx(r"(?<![\w@.'’-])([A-Z][a-z]{2,14})[ \t]*(?:&|dan)[ \t]*([A-Z][a-z]{2,14})(?![\w'’-]|[ \t]+[A-Z])", 'g')


def _pair_word_ok(w: str) -> bool:
    bare = w.lower()
    return bare not in _NOT_NAME and bare not in _PLACE_WORDS and bare not in _TITLE_WORDS


def _detect_name_pairs(text: str) -> list[PiiMatch]:
    """Two names joined by "&" or "dan" where one is a known given name: "Dimas & Anggun", "Rina dan Kelvin".

    The other is a name too, even if the list does not know it.
    """
    out: list[PiiMatch] = []
    for m in _NAME_PAIR.finditer(text):
        a, b = m.group(1), m.group(2)
        if not _pair_word_ok(a) or not _pair_word_ok(b):
            continue
        if a.lower() in GIVEN_NAMES:
            out.append(_match('NAME', m.start() + m.group(0).rfind(b), b, 'medium'))
        if b.lower() in GIVEN_NAMES:
            out.append(_match('NAME', m.start(), a, 'medium'))
    return out


_BRACKET_HANDLE = rx(r'\(([a-z][a-z0-9]*(?:[._][a-z0-9]+)+)\)', 'g')
_HANDLE_PARTS = rx(r'[._]')


def _detect_bracket_handles(text: str) -> list[PiiMatch]:
    """A handle in brackets after a name: "User Andreas Wijaya (andreas.w)". It must contain a known name."""
    out: list[PiiMatch] = []
    for m in _BRACKET_HANDLE.finditer(text):
        parts = [_TRAILING_DIGITS.sub('', w) for w in _HANDLE_PARTS.split(m.group(1))]
        if not any(w in GIVEN_NAMES or w in FAMILY_NAMES for w in parts):
            continue
        out.append(_match('NAME', m.start() + 1, m.group(1), 'medium'))
    return out


_CARD_CODE = rx(r'\b(?:cvv2?|cvc2?|cid|kode\s+keamanan)\b[ \t]*[:=]?[ \t]*(\d{3,4})(?!\d)', 'gi')


def _detect_card_codes(text: str) -> list[PiiMatch]:
    """The security code on the back of a card: "cvv 123"."""
    return [_match('CARD', *_group_tail(m), 'high') for m in _CARD_CODE.finditer(text)]


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


_STREET_WORDS = (
    'Jl|Jln|Jalan|Gg|Gang|Komp|Kompl|Komplek|Kompleks|Perum|Perumahan|Cluster|Klaster|Apartemen|Apartment|Apt|Rusun|'
    'Rusunawa|Tower|Ruko|Wisma|Asrama|Dusun|Dsn|Dukuh|Kampung|Kp|Lingkungan|Ling|'
    # A KTP or NPWP card prints the address in capitals.
    'JL|JLN|JALAN|GG|GANG|KOMP|KOMPLEK|KOMPLEKS|PERUM|PERUMAHAN|DUSUN|DSN|KAMPUNG|KP'
)
# What pins a street to one house: No., Blok, Kav., or an apartment's floor and unit. Chat writes "blok b no 9".
_PIN = '[Nn][Oo]|[Nn]omor|[Bb]lok|[Kk]av|[Uu]nit|[Ll]t|[Ll]antai|[Kk]amar|[Kk]mr|NO|BLOK'
_RT_RW = r'RT\.?\s*0*\d{1,3}\s*[/,]?\s*RW\.?\s*0*\d{1,3}'
# A street only counts as personal data when it is pinned to a house: No., Blok, Kav., a unit, or RT/RW.
_STREET = rx(
    rf'\b(?:{_STREET_WORDS})\.?\s+[A-Za-z0-9][^\n;]{{1,80}}?(?:\b(?:{_PIN})\.?\s*[A-Za-z]?\d+[A-Za-z]?(?:\/\d+)?(?:,?\s*(?:{_PIN})\.?\s*[A-Za-z]?\d+[A-Za-z]?(?:\/\d+)?)*(?:,?\s*{_RT_RW})?|\b{_RT_RW})',  # noqa: E501
    'g',
)
_RTRW = rx(rf'\b{_RT_RW}\b', 'gi')
# Chat writes the estate in lowercase: "perum griya asri blok c3 no 12". Not "jalan", which is also a verb.
_LOWER_STREET = rx(
    r'\b(?:perum|perumahan|komplek|kompleks|komp|cluster|klaster|apartemen|apt|rusun|asrama|jl|jln|gg|gang)\.?\s+[a-z0-9][^\n;]{1,60}?\b(?:no|nomor|blok|kav|unit)\.?\s*[a-z]?\d+[a-z]?(?:\/\d+)?(?:,?\s*(?:no|nomor|blok|kav|unit)\.?\s*[a-z]?\d+[a-z]?)*',  # noqa: E501
    'g',
)
# "jl mawar 5 cibinong": chat skips "No.". Only after "jl" or "gg", and not "jl. raya macet 2 jam".
_BARE_STREET = rx(
    r"\b(?:[Jj]ln?|[Gg]g)\.?\s+[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,3}?\s+\d{1,4}[A-Za-z]?\b(?!\s*(?:jam|menit|detik|km|meter|m\b|kali|hari|minggu|bulan|tahun|orang|lantai|lajur|jalur|%|x\b))",  # noqa: E501
    'g',
)


def _detect_street_addresses(text: str) -> list[PiiMatch]:
    out = [_match('ADDRESS', m.start(), m.group(0), 'high') for m in _STREET.finditer(text)]
    out += [_match('ADDRESS', m.start(), m.group(0), 'medium') for m in _LOWER_STREET.finditer(text)]
    out += [_match('ADDRESS', m.start(), m.group(0), 'medium') for m in _RTRW.finditer(text)]
    out += [_match('ADDRESS', m.start(), m.group(0), 'medium') for m in _BARE_STREET.finditer(text)]
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
_SENTENCE_BREAK = rx(r'([A-Za-z]*)\.\s+', 'g')
_VALUE_END = rx(r'[;|&]')
_NEXT_PAIR = rx(r'\s+[A-Za-z_][\w.-]*=(?!=)')
_WS_ONE = rx(r'\s')
_NEXT_COLON = rx(r':(?!\/\/)')
_FIRST_DIGIT = re.compile(r'[0-9]')
_URL_ESCAPE = re.compile(r'%[0-9A-Fa-f]{2}')
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
        # "Alamat: Jl. Melati 12, Bandung. Rekening BCA 123…": a sentence that opens with a field name is the next
        # field. Not after "Jl." or "Kec.", whose next word is part of the address.
        for m in _SENTENCE_BREAK.finditer(v):
            if len(m.group(1)) < 4:
                continue
            lead = _js.split_ws(v[m.end():])[:3]
            if any(field_type(' '.join(lead[: i + 1])) for i in range(len(lead))):
                v = v[: m.start() + len(m.group(1))]
                break
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
        # A digit ends a name, but not the "20" in "Siti%20Rahayu" (same length, so the index still fits).
        digit = _js_search(_FIRST_DIGIT, _URL_ESCAPE.sub('%xx', v))
        if digit >= 0:
            v = v[:digit]
        v = _take_words(v, 5)
    # "NPWP: 01.234.567.8-901.000 a.n. CV Maju Jaya": a number ends where its digits do.
    if pii_type in _NUMBER_TYPES:
        digits = _NUMBER_RUN.search(_js.trim(v))
        if digits:
            return _js.trim(digits.group(0))
    return _js.trim(_TRAILING_VALUE_NOISE.sub('', v))


_NUMBER_TYPES: frozenset[PiiType] = frozenset((
    'NIK', 'KK', 'NPWP', 'NIP', 'SIM', 'BPJS', 'NISN', 'PHONE', 'BANK_ACCOUNT', 'CARD',
))
_NUMBER_RUN = rx(r'^[+(]?\d[\d \t.\-/()]*\d\)?')


# What `_label_before` computes, as a regex over the line (kept for the equivalence tests).
_LABEL = rx(r"""((?:["'`]?[A-Za-z][A-Za-z0-9_./-]*["'`]?[ \t]+){0,4}["'`]?[A-Za-z][A-Za-z0-9_./-]*["'`]?)$""")
_SEPARATOR = rx(r'[ \t]*(?::(?![:\/])|=>|=(?![=>]))[ \t]*', 'g')
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


_MAX_VALUE = 1000


def _closing_quote(text: str, start: int, end: int) -> int:
    """Where a value inside a JSON string ends: at an unescaped double quote that closes the string.

    That is one followed by a comma, a bracket, or the end of the line. {"note":"Agama: Islam"} ends before its quote;
    'kata dia "ok" lalu' does not.
    """
    i = text.find('"', start, end)
    while i != -1:
        if i == 0 or text[i - 1] != '\\':
            j = i + 1
            while j < end and text[j] in ' \t':
                j += 1
            if j >= end or text[j] in ',}]':
                return i
        i = text.find('"', i + 1, end)
    return end


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
        # PHP, Ruby and Perl hashes: "'name' => 'Ahmad Fauzan'". Only after a quoted key; "phone => format(phone)" is a
        # JavaScript arrow function.
        if '=>' in m.group(0) and (m.start() == 0 or text[m.start() - 1] not in _QUOTES):
            continue
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
        # The longest value read after a label: scanning the rest of a huge one-line file for each of its labels made
        # detection quadratic.
        raw_end = min(line_end - 1 if line_end > value_start and text[line_end - 1] == '\r' else line_end, value_start + _MAX_VALUE)
        start = value_start
        quote = text[value_start] if value_start < raw_end else ''
        if quote in _QUOTES:
            close = text.find(quote, value_start + 1, raw_end)
            # "Budi \"Bob\" Santoso" in JSON: an escaped quote does not close the value.
            while close != -1 and text[close - 1] == '\\':
                close = text.find(quote, close + 1, raw_end)
            if close == -1:
                continue
            value = text[value_start + 1 : close]
            # 'labels like "Nama:" and "a.n."': the quote closes a quoted label; it does not open a value.
            if value[:1] in _js.WS_SET:
                continue
            start += 1
        else:
            # {"note":"Agama: Islam"}: the value ends where the string does, not with its closing quote.
            end = _closing_quote(text, value_start, raw_end)
            raw = text[value_start : _value_extent(text, value_start, end)]
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


#: How many lines into a text a table's header is looked for when the text does not start with one.
_CSV_HEADER_LINES = 20
_THREE_DIGITS = re.compile(r'\d{3}', re.ASCII)
_NUMBER_CELL = re.compile(r'[+\d\s().\/-]+\Z', re.ASCII)


def _detect_csv_columns(text: str) -> list[PiiMatch]:
    """Every cell under a header that says what it holds: nama, nik, agama, diagnosa, gaji, …"""
    text = _blank_line_numbers(text)
    table = _csv_table_at(text, 0, to_end=True)
    if table is not None:
        return table
    # A chat message or a prompt often has a sentence before the table: "Tolong cek data ini:" and then the CSV.
    line_start = 0
    for _ in range(1, _CSV_HEADER_LINES):
        line_break = text.find('\n', line_start)
        if line_break == -1:
            break
        line_start = line_break + 1
        later = _csv_table_at(text, line_start, to_end=False)
        if later is not None:
            return later
    return []


_CSV_HEADER_PREFIX = re.compile(r'[^,;|\t:]{1,60}:[ \t]+')


def _csv_table_at(text: str, at: int, *, to_end: bool, header: Optional[str] = None) -> Optional[list[PiiMatch]]:
    """The cells of a table whose header row starts at ``at``, or None when there is no header there.

    A table at the start of a text runs to its end (a CSV file); one after a sentence ends at the first line that is
    not one of its rows, such as a blank line or "makasih".
    """
    first_break = text.find('\n', at)
    if first_break == -1:
        return None
    if header is None:
        line = _strip_cr(text[at:first_break])
        # A log line or a sentence that ends in the header: "checkout csv: nama,nik,hp". A field name has no ": ".
        prefix = _CSV_HEADER_PREFIX.match(line)
        if prefix:
            table = _csv_table_at(text, at, to_end=False, header=line[prefix.end() :])
            if table:
                return table
        return _csv_table_at(text, at, to_end=to_end, header=line)
    delimiter = next((d for d in (',', ';', '\t', '|') if d in header), None)
    # Tab tables in the middle of a text are _detect_tab_tables' job, with rules of their own.
    if not delimiter or (not to_end and delimiter == '\t'):
        return None
    header_fields = [_js.trim(header[s:e]) for s, e in _csv_fields(header, delimiter)]
    # A header is short labels, and the next row has as many fields — not a sentence with commas.
    second_line = _strip_cr(text[first_break + 1 :].split('\n', 1)[0])
    if (
        len(header_fields) < 2
        or any(len(h) > 40 or _HEADER_SENTENCE_END.search(h) for h in header_fields)
        or len(_csv_fields(second_line, delimiter)) != len(header_fields)
        # In the middle of a text, a header is labels only: not a data row such as "n01687978<TAB>agama".
        or (not to_end and any(not _HAS_LETTER.search(h) or _THREE_DIGITS.search(h) for h in header_fields))
    ):
        return None
    columns = [field_type(h) for h in header_fields]
    if not any(columns):
        return None
    # "Nama<TAB>Budi Santoso" then "NIK<TAB>3201…" is a list of labels and values, not a table with a header.
    second = _csv_fields(second_line, delimiter)
    if any(t and field_type(_js.trim(second_line[second[i][0] : second[i][1]])) for i, t in enumerate(columns)):
        return None

    out: list[PiiMatch] = []
    offset = first_break + 1
    for raw_line in text[offset:].split('\n'):
        line = _strip_cr(raw_line)
        fields = _csv_fields(line, delimiter)
        if not to_end and len(fields) != len(header_fields):
            break
        for idx, (s, e) in enumerate(fields):
            t = columns[idx] if idx < len(columns) else None
            cell = line[s:e]
            value = _js.trim(cell)
            if not t or not is_plausible_value(t, value, header_fields[idx]):
                continue
            # After a sentence the text may go on in the same line: a number column then holds the number and nothing else.
            if not to_end and t in _NUMBER_TYPES and not _NUMBER_CELL.match(value):
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


_JSON_STRING = re.compile(r'"((?:[^"\\]|\\[\s\S])*)"')
_UNESCAPED = {'n': '\n', 'r': '\r', 't': '\t', 'b': '\b', 'f': '\f'}
_HEX4 = re.compile(r'[0-9a-fA-F]{4}\Z')


def _worth_unescaping(body: str) -> bool:
    """Only what the escapes hide: JSON (its field names are escaped) and a quoted CSV.

    Line breaks alone are read through _escapes_as_breaks already, and unescaping every log message would make
    detection many times slower.
    """
    if '\\"' not in body:
        return False
    return _JSON_BODY.match(body) is not None or ('\\n' in body and _CSV_DELIMITER.search(body) is not None)


_CSV_DELIMITER = re.compile(r'[,;|]')
_JSON_BODY = re.compile(r'[ \t\r\n]*[{\[]')


def _detect_escaped_strings(text: str) -> list[PiiMatch]:
    """A JSON string with escapes in it, read unescaped.

    JSON inside JSON, as a log writes a request body and a tool call its arguments ('{\\"nama\\":\\"Budi\\"}'), or a
    CSV export in a field. The detectors, this one included, read the unescaped text; the matches are mapped back onto
    the escaped text.
    """
    if '\\' not in text:
        return []
    out: list[PiiMatch] = []
    # JSON strings go into one text, a blank line apart, for one pass of the detectors: a log with a JSON body on every
    # line would otherwise run them once per line. A CSV is read on its own, since a table runs to the end of its text.
    joined: list[str] = []
    joined_at: list[int] = []
    joined_part: list[int] = []

    def flush() -> None:
        if not joined:
            return
        joined_at.append(joined_at[-1])
        joined_part.append(-1)
        unescaped = ''.join(joined)
        for f in [*(f for detector in _DETECTORS for f in detector(unescaped)), *_detect_escaped_strings(unescaped)]:
            # Never across two strings: the text between them is JSON, not data.
            if joined_part[f.start] != joined_part[f.end - 1]:
                continue
            start, end = joined_at[f.start], joined_at[f.end]
            out.append(PiiMatch(f.type, start, end, text[start:end], f.confidence, f.label))
        joined.clear()
        joined_at.clear()
        joined_part.clear()

    part = 0
    for m in _JSON_STRING.finditer(text):
        body = m.group(1)
        if not _worth_unescaping(body):
            continue
        is_json = _JSON_BODY.match(body) is not None
        if not is_json:
            flush()
        if joined:
            # The blank line maps to the end of the string before it.
            joined.append('\n\n')
            joined_at.extend((joined_at[-1], joined_at[-1]))
            joined_part.extend((-1, -1))
        base = m.start() + 1
        part += 1
        i = 0
        while i < len(body):
            joined_at.append(base + i)
            joined_part.append(part)
            if body[i] != '\\':
                joined.append(body[i])
                i += 1
            elif body[i + 1 : i + 2] == 'u' and _HEX4.match(body[i + 2 : i + 6]):
                joined.append(chr(int(body[i + 2 : i + 6], 16)))
                i += 6
            else:
                e = body[i + 1 : i + 2]
                joined.append(_UNESCAPED.get(e, e))
                i += 2
        # Where the string ends, for a match that runs to its last character.
        joined_at.append(base + len(body))
        joined_part.append(part)
        joined.append(' ')
        if not is_json:
            flush()
    flush()
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
    _detect_marital_status,
    _detect_plates,
    _detect_names,
    _detect_chat_senders,
    _detect_known_names,
    _detect_signatures,
    _detect_display_names,
    _detect_handles,
    _detect_stacked_labels,
    _detect_colonless_labels,
    _detect_phone_owners,
    _detect_timed_senders,
    _detect_log_users,
    _detect_html,
    _detect_hl7,
    _detect_akta,
    _detect_criminal,
    _detect_glued_ids,
    _detect_ocr_ids,
    _detect_record_birth_dates,
    _detect_card_codes,
    _detect_spoken_phones,
    _detect_lone_given_names,
    _detect_names_with_age,
    _detect_name_pairs,
    _detect_attendance,
    _detect_sentence_subjects,
    _detect_bracket_handles,
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


def _in_units(matches: list[PiiMatch], text: str) -> list[PiiMatch]:
    """Matches with Python offsets moved to UTF-16 ones, which detect_pii works in."""
    before = [0] * (len(text) + 1)
    for i, ch in enumerate(text):
        before[i + 1] = before[i] + (1 if ord(ch) > 0xFFFF else 0)
    return [
        PiiMatch(m.type, m.start + before[m.start], m.end + before[m.end], m.value, m.confidence, m.label)
        for m in matches
    ]


def detect_pii(
    text: str,
    *,
    types: Optional[Iterable[PiiType]] = None,
    exclude: Optional[Iterable[PiiType]] = None,
    min_confidence: Optional[Confidence] = None,
    custom: Iterable[RuleLike] = (),
    ner: Optional[Callable[[str], Iterable[PiiMatch]]] = None,
) -> list[PiiMatch]:
    """All personal data in the text, non-overlapping, in reading order.

    ``types`` limits the result to some kinds. ``exclude`` drops kinds an app needs to read, e.g.
    ``exclude=['FINANCIAL']`` when income and installments are a dealer's credit-simulation data, or
    ``exclude=['NAME']`` when names are not sensitive in that flow. ``min_confidence="high"`` keeps only validated or
    keyword-anchored matches (default "medium"). An unknown type name raises ``ValueError``. ``custom`` takes a team's
    own rules (``CustomRule`` or dicts): ID formats and field names Samaran does not know, found as CUSTOM with the
    rule's label. ``ner`` adds an optional detector's matches, such as ``lokal.samaran.ner.NerNames()``, with
    offsets into ``text``; Samaran's own matches win where they overlap and are as long.
    """
    rules = to_rules(custom)
    wanted = set(check_types(types) if types is not None else PII_TYPES)
    wanted -= set(check_types(exclude or ()))
    min_rank = 2 if min_confidence == 'high' else 1

    def rank(m: PiiMatch) -> int:
        return 2 if m.confidence == 'high' else 1

    astral = _ASTRAL.search(text) is not None
    units = _to_utf16_view(text) if astral else text
    view = _escapes_as_breaks(units)

    found = [m for detector in _DETECTORS for m in detector(view)] + _detect_escaped_strings(units)
    if rules:
        found.extend(detect_custom(view, rules))
    if ner is not None:
        found.extend(_in_units(list(ner(text)), text) if astral else ner(text))
    candidates = [m for m in found if m.end > m.start and m.type in wanted and rank(m) >= min_rank]
    # Prefer confident, then longer matches, then a team's own rule; drop anything overlapping an accepted match.
    candidates.sort(key=lambda m: (-rank(m), -(m.end - m.start), -(m.type == 'CUSTOM'), m.start))
    taken = bytearray(len(view) + 1)
    accepted: list[PiiMatch] = []
    for c in candidates:
        if any(taken[c.start : c.end]):
            continue
        taken[c.start : c.end] = b'\x01' * (c.end - c.start)
        accepted.append(c)
    accepted.sort(key=lambda m: m.start)
    # A match stops before an escape it ran into: a line break read from "\\n", or a quote written '\\"' in JSON that
    # went through twice. Its value is the text as it is.
    trimmed: list[PiiMatch] = []
    for m in accepted:
        end = m.end
        while True:
            if end > m.start and (view[end - 1] != units[end - 1] or units[end - 1] == '\\'):
                end -= 1
            elif end - 1 > m.start and units[end - 1] == '"' and units[end - 2] == '\\':
                end -= 2
            else:
                break
        if end == m.end:
            trimmed.append(m)
        elif end > m.start:
            trimmed.append(PiiMatch(m.type, m.start, end, units[m.start : end], m.confidence, m.label))
    accepted = trimmed
    if not astral:
        return accepted

    # Map UTF-16 offsets back to Python characters, never splitting an emoji.
    view = units
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
        out.append(PiiMatch(m.type, start, end, text[start:end], m.confidence, m.label))
    return out


_ASTRAL = re.compile('[\U00010000-\U0010ffff]')
_ESCAPED_BREAK = re.compile(r'\\+[nrt]')
_BREAK_FOR = {'n': '\n', 'r': '\r', 't': '\t'}


def _escapes_as_breaks(text: str) -> str:
    """Escaped line breaks ("\\n", or "\\\\n" after two rounds of JSON) as spaces and a real break, same length."""
    if '\\' not in text:
        return text
    return _ESCAPED_BREAK.sub(lambda e: ' ' * (len(e.group(0)) - 1) + _BREAK_FOR[e.group(0)[-1]], text)

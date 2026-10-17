"""QRIS (Quick Response Code Indonesian Standard) payloads: the text inside a QRIS code.

A payload is EMVCo merchant-presented TLV: two digits of tag, two digits of length, then the value, ending with a
CRC-16/CCITT-FALSE checksum in tag 63. Tags 26 to 51 hold merchant accounts; tag 51 with "ID.CO.QRIS.WWW" carries the
national merchant ID (NMID) and the merchant criteria. A static code (tag 01 = "11") lets the payer type the amount; a
dynamic one ("12") carries it in tag 54.

Port of packages/core/src/qris.ts, with the same results.
"""

from __future__ import annotations

import binascii
import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Literal, Optional, Union

from . import _js
from ._result import Result
from .nik import Issue

QrisType = Literal['static', 'dynamic']


@dataclass(slots=True)
class QrisField(Result):
    tag: str
    value: str
    #: Sub-fields of a template: merchant accounts (26 to 51), additional data (62), language (64), 80 to 99.
    children: Optional[list[QrisField]] = None


@dataclass(slots=True)
class QrisMerchantAccount(Result):
    tag: str
    #: Globally unique identifier: a reverse domain such as "ID.CO.QRIS.WWW" or "COM.GO-JEK.WWW".
    gui: Optional[str] = None
    #: Merchant PAN (sub-tag 01), the account number at the acquirer.
    pan: Optional[str] = None
    #: Merchant ID at the acquirer (02); in tag 51 this is the NMID.
    merchant_id: Optional[str] = None
    #: Merchant criteria (03): UMI, UKE, UME, UBE, ...
    criteria: Optional[str] = None


@dataclass(slots=True)
class QrisTip(Result):
    #: ``prompt``: the payer types a tip. ``fixed``: a fee in Rupiah. ``percent``: a percentage of the amount.
    kind: Literal['prompt', 'fixed', 'percent']
    value: Optional[str] = None


@dataclass(slots=True)
class QrisAdditionalData(Result):
    bill_number: Optional[str] = None
    mobile_number: Optional[str] = None
    store_label: Optional[str] = None
    loyalty_number: Optional[str] = None
    reference_label: Optional[str] = None
    customer_label: Optional[str] = None
    terminal_label: Optional[str] = None
    purpose: Optional[str] = None


@dataclass(slots=True)
class QrisInfo(Result):
    input: str
    valid: bool = False
    errors: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)
    #: ``static`` (tag 01 = 11): the payer types the amount. ``dynamic`` (12): the amount is in the code.
    type: Optional[QrisType] = None
    merchant_name: Optional[str] = None
    merchant_city: Optional[str] = None
    postal_code: Optional[str] = None
    #: National Merchant ID from tag 51, such as "ID1020021181745".
    nmid: Optional[str] = None
    criteria: Optional[str] = None
    #: "Usaha Mikro", "Usaha Kecil", ... for the criteria codes whose meaning is settled.
    criteria_label: Optional[str] = None
    #: Merchant category code (ISO 18245), such as "5812" for restaurants.
    mcc: Optional[str] = None
    #: ISO 4217 numeric: "360" is Rupiah.
    currency: Optional[str] = None
    country: Optional[str] = None
    #: As written in the code, in Rupiah: "25000".
    amount: Optional[str] = None
    tip: Optional[QrisTip] = None
    accounts: list[QrisMerchantAccount] = field(default_factory=list)
    additional: Optional[QrisAdditionalData] = None
    crc: Optional[str] = None
    fields: list[QrisField] = field(default_factory=list)


_QRIS_GUI = 'ID.CO.QRIS.WWW'
_CRITERIA = {'UMI': 'Usaha Mikro', 'UKE': 'Usaha Kecil', 'UME': 'Usaha Menengah', 'UBE': 'Usaha Besar'}
_ADDITIONAL = {
    '01': 'bill_number', '02': 'mobile_number', '03': 'store_label', '04': 'loyalty_number', '05': 'reference_label',
    '06': 'customer_label', '07': 'terminal_label', '08': 'purpose',
}
_AMOUNT = re.compile(r'(?=.{1,13}\Z)[0-9]+(?:\.[0-9]{1,2})?\Z', re.S)
_TWO_DIGITS = re.compile(r'[0-9][0-9]')
_NMID = re.compile(r'ID[0-9]{13}')
_FOUR_DIGITS = re.compile(r'[0-9]{4}')
_FIVE_DIGITS = re.compile(r'[0-9]{5}')


def _is_template(tag: int) -> bool:
    return 26 <= tag <= 51 or tag in (62, 64) or tag >= 80


def qris_crc(data: str) -> str:
    """CRC-16/CCITT-FALSE (polynomial 0x1021, initial 0xFFFF) over the UTF-8 bytes, as four uppercase hex digits."""
    return f'{binascii.crc_hqx(data.encode("utf-8"), 0xFFFF):04X}'


def _tlv(s: str) -> Union[list[QrisField], int]:
    """Splits TLV text into fields, or returns the position where it stops making sense."""
    out: list[QrisField] = []
    pos = 0
    while pos < len(s):
        tag = s[pos : pos + 2]
        length = s[pos + 2 : pos + 4]
        if not _TWO_DIGITS.fullmatch(tag) or not _TWO_DIGITS.fullmatch(length) or pos + 4 + int(length) > len(s):
            return pos
        out.append(QrisField(tag, s[pos + 4 : pos + 4 + int(length)]))
        pos += 4 + int(length)
    return out


def _field(tag: str, value: str) -> str:
    return f'{tag}{len(value):02d}{value}'


def parse_qris(payload: str) -> QrisInfo:
    """Reads a QRIS payload: who gets paid, how much, and whether the code is intact."""
    info = QrisInfo(payload)
    s = _js.trim(str(payload))
    fields = _tlv(s)
    if isinstance(fields, int):
        info.errors.append(Issue(
            'format',
            f'Payload QRIS tidak terbaca di posisi {fields}: setiap bagian harus dua digit tag, dua digit panjang, '
            'lalu isinya.',
        ))
        return info
    for f in fields:
        if _is_template(int(f.tag)):
            children = _tlv(f.value)
            if isinstance(children, int):
                info.errors.append(Issue('format', f'Isi tag {f.tag} bukan TLV yang valid.'))
            else:
                f.children = children
    info.fields = fields
    seen: set[str] = set()
    for f in fields:
        if f.tag in seen:
            info.errors.append(Issue('duplicate', f'Tag {f.tag} muncul lebih dari sekali.'))
        seen.add(f.tag)

    def get(tag: str) -> Optional[QrisField]:
        return next((f for f in fields if f.tag == tag), None)

    def sub(f: Optional[QrisField], tag: str) -> Optional[str]:
        if f is None or f.children is None:
            return None
        return next((c.value for c in f.children if c.tag == tag), None)

    if not fields or fields[0].tag != '00' or fields[0].value != '01':
        info.errors.append(Issue('payload_format', 'Payload QRIS harus diawali 000201 (Payload Format Indicator).'))

    last = fields[-1] if fields else None
    if last is None or last.tag != '63' or len(last.value) != 4:
        info.errors.append(Issue('crc_missing', 'CRC (tag 63, 4 karakter) harus ada di akhir payload.'))
    else:
        info.crc = last.value
        expected = qris_crc(s[:-4])
        if last.value.upper() != expected:
            info.errors.append(Issue(
                'crc',
                f'CRC tidak cocok: tertulis {last.value}, seharusnya {expected}. Kode ini rusak, terpotong, atau sudah '
                'diubah.',
            ))

    poi = get('01')
    if poi is not None:
        if poi.value == '11':
            info.type = 'static'
        elif poi.value == '12':
            info.type = 'dynamic'
        else:
            info.warnings.append(Issue(
                'point_of_initiation', f'Tag 01 bernilai {poi.value}, seharusnya 11 (statis) atau 12 (dinamis).'
            ))

    for f in fields:
        if not 26 <= int(f.tag) <= 51 or f.children is None:
            continue
        info.accounts.append(QrisMerchantAccount(f.tag, sub(f, '00'), sub(f, '01'), sub(f, '02'), sub(f, '03')))
    if not info.accounts:
        info.errors.append(Issue('merchant_account', 'Tidak ada informasi akun merchant (tag 26 sampai 51).'))
    national = next((a for a in info.accounts if a.gui is not None and a.gui.upper() == _QRIS_GUI), None)
    if national is not None:
        if national.merchant_id is not None:
            info.nmid = national.merchant_id
            if not _NMID.fullmatch(national.merchant_id):
                info.warnings.append(Issue(
                    'nmid', f'NMID {national.merchant_id} tidak berformat seperti biasanya: ID diikuti 13 digit.'
                ))
    elif info.accounts:
        info.warnings.append(Issue(
            'not_qris', f'Tidak ada akun dengan {_QRIS_GUI}: ini kode QR pembayaran EMVCo, tapi mungkin bukan QRIS.'
        ))
    criteria = national.criteria if national is not None and national.criteria is not None else next(
        (a.criteria for a in info.accounts if a.criteria), None
    )
    if criteria is not None:
        info.criteria = criteria
        info.criteria_label = _CRITERIA.get(criteria)

    mcc = get('52')
    if mcc is not None:
        info.mcc = mcc.value
    if mcc is None or not _FOUR_DIGITS.fullmatch(mcc.value):
        info.errors.append(Issue('mcc', 'Kode kategori merchant (tag 52) wajib ada, 4 digit.'))

    currency = get('53')
    if currency is not None:
        info.currency = currency.value
    if currency is None or currency.value != '360':
        info.errors.append(Issue('currency', 'Mata uang (tag 53) harus 360, yaitu Rupiah.'))

    amount = get('54')
    if amount is not None:
        info.amount = amount.value
        if not _AMOUNT.match(amount.value):
            info.errors.append(Issue(
                'amount', 'Nominal (tag 54) hanya boleh angka dengan paling banyak 2 desimal, maksimal 13 karakter.'
            ))
    elif info.type == 'dynamic':
        info.warnings.append(Issue('dynamic_without_amount', 'QRIS dinamis biasanya berisi nominal (tag 54).'))

    tip = get('55')
    if tip is not None:
        if tip.value == '01':
            info.tip = QrisTip('prompt')
        elif tip.value in ('02', '03'):
            value = get('56' if tip.value == '02' else '57')
            if value is None:
                need = 'biaya tetap di tag 56' if tip.value == '02' else 'persentase di tag 57'
                info.errors.append(Issue('tip', f'Tag 55 bernilai {tip.value} butuh {need}.'))
            else:
                info.tip = QrisTip('fixed' if tip.value == '02' else 'percent', value.value)
        else:
            info.errors.append(Issue('tip', f'Tag 55 bernilai {tip.value}, seharusnya 01, 02, atau 03.'))

    country = get('58')
    if country is not None:
        info.country = country.value
    if country is None or country.value != 'ID':
        info.errors.append(Issue('country', 'Kode negara (tag 58) harus ID.'))

    name = get('59')
    if name is not None:
        info.merchant_name = name.value
    if name is None or not name.value or len(name.value) > 25:
        info.errors.append(Issue('merchant_name', 'Nama merchant (tag 59) wajib ada, paling banyak 25 karakter.'))

    city = get('60')
    if city is not None:
        info.merchant_city = city.value
    if city is None or not city.value or len(city.value) > 15:
        info.errors.append(Issue('merchant_city', 'Kota merchant (tag 60) wajib ada, paling banyak 15 karakter.'))

    postal = get('61')
    if postal is not None:
        info.postal_code = postal.value
        if not _FIVE_DIGITS.fullmatch(postal.value):
            info.warnings.append(Issue('postal_code', f'Kode pos {postal.value} bukan 5 digit.'))

    additional = get('62')
    if additional is not None and additional.children is not None:
        data = QrisAdditionalData()
        found = False
        for c in additional.children:
            key = _ADDITIONAL.get(c.tag)
            if key:
                setattr(data, key, c.value)
                found = True
        if found:
            info.additional = data

    info.valid = not info.errors
    return info


Amount = Union[int, float, Decimal, str]


def _amount_text(value: Amount, what: str) -> str:
    # A number with more than 2 decimals is refused rather than rounded: money should not change on the way in.
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal, str)):
        raise TypeError(f'{what} must be a number or a string, not {type(value).__name__}')
    if isinstance(value, str):
        text = _js.trim(value)
    elif isinstance(value, Decimal):
        text = format(value, 'f')
    elif isinstance(value, int) or value.is_integer():
        text = _js.number_to_string(value)
    else:
        fixed = f'{value:.2f}'
        text = fixed if float(fixed) == value else _js.number_to_string(value)
    shown = _js.number_to_string(value) if isinstance(value, (int, float)) else str(value)
    if not _AMOUNT.match(text) or Decimal(text) <= 0:
        raise ValueError(
            f'{what} harus lebih dari 0, angka dengan paling banyak 2 desimal, maksimal 13 karakter: {shown}'
        )
    return text


def set_qris_amount(
    payload: str,
    amount: Amount,
    *,
    tip_fixed: Optional[Amount] = None,
    tip_percent: Optional[Amount] = None,
) -> str:
    """Turns a QRIS code into a dynamic one for an amount, with an optional fixed or percentage fee on top.

    Tag 01 becomes 12, the amount goes into tag 54, and the CRC is recomputed. Every other field stays as it was, so
    the payment still goes to the same merchant account. Raises ValueError for an invalid code or amount.
    """
    if tip_fixed is not None and tip_percent is not None:
        raise ValueError('Pilih salah satu: tip_fixed atau tip_percent.')
    info = parse_qris(payload)
    if not info.valid:
        raise ValueError(f'QRIS tidak valid: {info.errors[0].message}')
    value = _amount_text(amount, 'Nominal')
    tip_fields: list[tuple[str, str]] = []
    if tip_fixed is not None:
        tip_fields = [('55', '02'), ('56', _amount_text(tip_fixed, 'Biaya tetap'))]
    elif tip_percent is not None:
        percent = _amount_text(tip_percent, 'Persentase')
        if Decimal(percent) > 100:
            raise ValueError(f'Persentase paling banyak 100: {percent}')
        tip_fields = [('55', '03'), ('57', percent)]
    drop = {'01', '54', '63', *(('55', '56', '57') if tip_fields else ())}
    kept = [(f.tag, f.value) for f in info.fields if f.tag not in drop]
    at = next((i for i, (tag, _) in enumerate(kept) if int(tag) > 54), len(kept))
    kept[at:at] = [('54', value), *tip_fields]
    kept.insert(1, ('01', '12'))
    body = ''.join(_field(tag, v) for tag, v in kept) + '6304'
    return body + qris_crc(body)


__all__ = [
    'QrisAdditionalData',
    'QrisField',
    'QrisInfo',
    'QrisMerchantAccount',
    'QrisTip',
    'QrisType',
    'parse_qris',
    'qris_crc',
    'set_qris_amount',
]

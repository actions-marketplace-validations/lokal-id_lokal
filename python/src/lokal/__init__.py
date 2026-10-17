"""Lokal: Indonesian data primitives for apps and AI agents.

NIK, NPWP, phone numbers, Rupiah, terbilang, holidays and working days, and Samaran, which masks Indonesian
personal data before it reaches an LLM and restores it afterwards. Region data lives in ``lokal.wilayah``, loaded
on first use.

The Python port of ``@lokal-id/core``: same rules, same data, same results.
"""

from .holidays import (
    HOLIDAY_YEARS,
    Holiday,
    HolidayType,
    HolidayYear,
    add_working_days,
    count_working_days,
    get_holidays,
    holidays_on,
    is_working_day,
)
from .nik import Gender, Issue, NikInfo, is_valid_nik, parse_nik
from .npwp import NpwpInfo, NpwpKind, format_npwp15, parse_npwp
from .phone import PhoneInfo, PhoneType, normalize_phone, parse_phone
from .provinces import PROVINCES
from .qris import QrisInfo, parse_qris, qris_crc, set_qris_amount
from .rupiah import ParsedRupiah, format_rupiah, format_rupiah_short, parse_rupiah
from .samaran import (
    PII_TYPES,
    UU_PDP_CATEGORY,
    Confidence,
    MaskedMatch,
    MaskResult,
    PiiMatch,
    PiiType,
    Samaran,
    detect_pii,
    field_type,
    mask_pii,
    partial_mask,
)
from .terbilang import terbilang

__version__ = '0.4.0'

__all__ = [
    'HOLIDAY_YEARS',
    'PII_TYPES',
    'PROVINCES',
    'UU_PDP_CATEGORY',
    'Confidence',
    'Gender',
    'Holiday',
    'HolidayType',
    'HolidayYear',
    'Issue',
    'MaskResult',
    'MaskedMatch',
    'NikInfo',
    'NpwpInfo',
    'NpwpKind',
    'ParsedRupiah',
    'PhoneInfo',
    'PhoneType',
    'QrisInfo',
    'PiiMatch',
    'PiiType',
    'Samaran',
    '__version__',
    'add_working_days',
    'count_working_days',
    'detect_pii',
    'field_type',
    'format_npwp15',
    'format_rupiah',
    'format_rupiah_short',
    'get_holidays',
    'holidays_on',
    'is_valid_nik',
    'is_working_day',
    'mask_pii',
    'normalize_phone',
    'parse_nik',
    'parse_npwp',
    'parse_phone',
    'parse_qris',
    'parse_rupiah',
    'partial_mask',
    'qris_crc',
    'set_qris_amount',
    'terbilang',
]

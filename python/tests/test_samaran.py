import json
import re

import pytest

from lokal import Samaran, detect_pii, mask_pii

CHAT = '\n'.join([
    'Halo kak, saya mau komplain. Nama: Budi Santoso',
    'NIK 3201011508950001, NPWP 01.234.567.8-901.000',
    'HP 0812-3456-7890 atau email budi.santoso@gmail.com',
    'Refund ke rek BCA 1234567890 a.n. Budi Santoso ya',
    'Alamat Jl. Mawar No. 5 RT 03/RW 07, motor B 1234 XYZ',
])


def values(text: str, types: list[str] | None = None) -> list[str]:
    return [f'{m.type}:{m.value}' for m in detect_pii(text, types=types)]  # type: ignore[arg-type]


def test_every_indonesian_identifier_in_one_chat() -> None:
    assert values(CHAT) == [
        'NAME:Budi Santoso',
        'NIK:3201011508950001',
        'NPWP:01.234.567.8-901.000',
        'PHONE:0812-3456-7890',
        'EMAIL:budi.santoso@gmail.com',
        'BANK_ACCOUNT:1234567890',
        'NAME:Budi Santoso',
        'ADDRESS:Jl. Mawar No. 5 RT 03/RW 07',
        'PLATE:B 1234 XYZ',
    ]


def test_mask_llm_unmask_round_trip() -> None:
    samaran = Samaran()
    text = samaran.mask(CHAT).text
    assert '3201011508950001' not in text
    assert 'Budi' not in text
    assert re.search(r'Nama: \[NAME_1\]', text)
    assert re.search(r'a\.n\. \[NAME_1\]', text), 'the same name gets the same placeholder'
    reply = 'Baik [NAME_1], refund ke [BANK_ACCOUNT_1] diproses. Kami hubungi [PHONE_1].'
    assert samaran.unmask(reply) == 'Baik Budi Santoso, refund ke 1234567890 diproses. Kami hubungi 0812-3456-7890.'


def test_same_number_different_format_same_placeholder() -> None:
    assert Samaran().mask('Hubungi 0812-3456-7890 atau +62 812 3456 7890').text == 'Hubungi [PHONE_1] atau [PHONE_1]'


def test_placeholder_for_a_value_known_to_be_personal() -> None:
    s = Samaran()
    text = s.mask('HP 0812-3456-7890').text
    assert s.placeholder('PHONE', '+62 812 3456 7890') == '[PHONE_1]'
    street = s.placeholder('ADDRESS', 'Jl. Melati No. 5')
    assert street == '[ADDRESS_1]'
    assert s.placeholder('ADDRESS', 'Jl. Melati No. 5') == street
    assert s.unmask(f'{text}, {street}') == 'HP 0812-3456-7890, Jl. Melati No. 5'
    with pytest.raises(ValueError, match='Unknown PII type'):
        s.placeholder('ALAMAT', 'x')  # type: ignore[arg-type]


def test_partial_mode() -> None:
    text = mask_pii('NIK 3201011508950001 HP 081234567890 email budi@gmail.com', mode='partial').text
    assert text == 'NIK 3201********0001 HP 0812****7890 email b***@gmail.com'


def test_no_false_positives_on_ordinary_numbers() -> None:
    for text in [
        'Total belanja Rp1.500.000 dibayar tanggal 2026-10-15 jam 14.30',
        'Order #1234567890123456 sudah dikirim',
        'Ibu Kota Nusantara ada di Kalimantan Timur',
        'Jalan Sudirman macet parah pagi ini',
        'Versi 3.2.1, build 20261015',
    ]:
        assert detect_pii(text) == [], text


def test_phone_after_transfer_is_still_a_phone() -> None:
    assert detect_pii('transfer DANA ke 081234567890 ya')[0].type == 'PHONE'


def test_phone_at_line_end_does_not_swallow_next_line() -> None:
    chat = 'Chat WhatsApp dengan +62 881-2345-6789\n14/10/26 08.30 - +62 881-2345-6789: halo'
    assert Samaran().mask(chat).text == 'Chat WhatsApp dengan [PHONE_1]\n14/10/26 08.30 - [PHONE_1]: halo'
    assert [m.value for m in detect_pii('hp 0812-3456-7890\n2026-10-01 error')] == ['0812-3456-7890']
    assert [m.value for m in detect_pii('kirim 0812-3456-7890 2 pcs')] == ['0812-3456-7890']


def test_card_luhn_and_bpjs_keyword() -> None:
    assert detect_pii('kartu 4539 1488 0343 6467')[0].type == 'CARD'
    assert detect_pii('kartu uji 4111 1111 1111 1111') == []  # published test card
    assert detect_pii('No BPJS 0001234567890')[0].type == 'BPJS'
    assert detect_pii('kode 0001234567890') == []


def test_titles_skipped() -> None:
    assert detect_pii('Surat untuk Bapak Dr. Ahmad Fauzi')[0].value == 'Ahmad Fauzi'


def test_allow_list_and_type_filter() -> None:
    samaran = Samaran(allow=['cs@toko.id'], types=['EMAIL'])
    text = samaran.mask('Hubungi cs@toko.id, bukan budi@gmail.com, HP 081234567890').text
    assert text == 'Hubungi cs@toko.id, bukan [EMAIL_1], HP 081234567890'
    assert Samaran(allow=[re.compile(r'@toko\.id$')]).mask('cs@toko.id, budi@gmail.com').text == 'cs@toko.id, [EMAIL_1]'


def test_csv_columns_from_header() -> None:
    csv = 'id;nama_lengkap;alamat;kota\n1;Siti Aminah;Jl. Melati 3;Depok\n2;"Rahmat, S.T.";Gg. Kenari 9;Bogor\n'
    assert values(csv) == ['NAME:Siti Aminah', 'ADDRESS:Jl. Melati 3', 'NAME:Rahmat, S.T.', 'ADDRESS:Gg. Kenari 9']


def test_label_does_not_swallow_other_fields() -> None:
    text = mask_pii('Nama: Budi Santoso, NIK 3201011508950001, refund ke rek BCA 1234567890, HP 0812-3456-7890').text
    assert text == 'Nama: [NAME_1], NIK [NIK_1], refund ke rek BCA [BANK_ACCOUNT_1], HP [PHONE_1]'
    assert values('alamat: Jl. Mawar No. 5, Depok, HP 0812-3456-7890') == [
        'ADDRESS:Jl. Mawar No. 5, Depok', 'PHONE:0812-3456-7890',
    ]
    # A new sentence that opens with a field name ends the address; "Kel." and "Kec." do not.
    assert values('Alamat: Jl. Melati No. 12, Kel. Sukamaju, Kec. Cibeunying, Bandung. Rekening BCA 1234567890.') == [
        'ADDRESS:Jl. Melati No. 12, Kel. Sukamaju, Kec. Cibeunying, Bandung', 'BANK_ACCOUNT:1234567890',
    ]


def test_sentence_with_commas_is_not_a_csv_header() -> None:
    assert detect_pii('Nama, alamat, dan NIK wajib diisi.\nTerima kasih, admin') == []


def test_json_yaml_values() -> None:
    json_text = '{"id": 7, "nama": "Dewi Lestari", "alamat": "Perum Griya Asri Blok C2", "name": "lokal"}'
    assert values(json_text) == ['NAME:Dewi Lestari', 'ADDRESS:Perum Griya Asri Blok C2']
    assert [m.value for m in detect_pii('customer_name: Andi Wijaya\n')] == ['Andi Wijaya']
    assert detect_pii('this.name = "ZodCompileError"; const x = { name: "Server" };') == []


def test_vault_export_import_across_processes() -> None:
    a = Samaran()
    text = a.mask('NIK 3201011508950001').text
    b = Samaran()
    b.import_vault(json.loads(json.dumps(a.export_vault())))  # survives a JSON round trip
    assert b.unmask(text) == 'NIK 3201011508950001'
    assert b.mask('lagi 3201011508950001').text == 'lagi [NIK_1]'
    assert len(b) == b.size == 1


def test_unlabeled_names_in_chat() -> None:
    for text, name in [
        ('atas nama budi santoso ya kak', 'budi santoso'),
        ('nama saya rina', 'rina'),
        ('a.n. Dewi Lestari', 'Dewi Lestari'),
        ('bapak ahmad mau ambil', 'ahmad'),
    ]:
        assert [m.value for m in detect_pii(text, types=['NAME'])] == [name], text


def test_names_split_across_json_keys() -> None:
    json_text = '{"customer_details":{"first_name":"Siti","last_name":"Rahayu","email":"siti@gmail.com"}}'
    assert values(json_text, ['NAME']) == ['NAME:Siti', 'NAME:Rahayu']
    assert values('first_name: "First Name"\nlast_name: "string"\nfamily_name: "Nama Belakang"', ['NAME']) == []


def test_whatsapp_export_senders() -> None:
    chat = '\n'.join([
        'Chat WhatsApp dengan Dewi Lestari',
        '12/10/26 09.14 - Dewi Lestari: kak mug nya pecah',
        '12/10/26 09.16 - Toko Kopi Senja: Mohon maaf',
        '[12/10/26 09.20:11] Maria Gebze: paket belum sampai',
        '10/12/26, 9:14 AM - Budi: ok',
    ])
    assert values(chat, ['NAME']) == ['NAME:Dewi Lestari', 'NAME:Dewi Lestari', 'NAME:Maria Gebze', 'NAME:Budi']
    assert values('12/10/26 09.14 - ERROR: koneksi gagal', ['NAME']) == []


def test_health_in_free_text() -> None:
    text = 'isinya obat insulin buat ibu saya (diabetes). Beliau dirawat di RSUD Cibinong karena DBD'
    assert values(text, ['HEALTH']) == [
        'HEALTH:insulin', 'HEALTH:diabetes', 'HEALTH:dirawat di RSUD Cibinong', 'HEALTH:DBD',
    ]
    for benign in ['minum oat tiap pagi', 'beli obat batuk', 'mobilnya dirawat di bengkel', 'karena macet']:
        assert values(benign, ['HEALTH']) == [], benign


def test_sql_dump_values_by_column() -> None:
    sql = (
        "INSERT INTO pelanggan (id, nama, nik, no_hp) VALUES (17, 'Hendra Gunawan', '1371011010850008', '0813-9999-0000'),\n"
        "(18, 'O''Brien Siregar', 3201011508950001, NULL);"
    )
    assert values(sql) == [
        'NAME:Hendra Gunawan', 'NIK:1371011010850008', 'PHONE:0813-9999-0000', "NAME:O''Brien Siregar",
        'NIK:3201011508950001',
    ]
    assert values("INSERT INTO produk (nama, harga) VALUES ('Kopi Gayo', 85000);") == []


def test_sql_dump_without_column_names_reads_create_table() -> None:
    sql = (
        'CREATE TABLE `pelanggan` (\n'
        '  `id` int NOT NULL AUTO_INCREMENT,\n'
        "  `nama` varchar(100) DEFAULT 'tanpa, nama',\n"
        "  `telepon` varchar(20) COMMENT 'nomor (hp)',\n"
        '  `nik` char(16),\n'
        '  PRIMARY KEY (`id`),\n'
        '  KEY `idx_nik` (`nik`)\n'
        ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n'
        "INSERT INTO `pelanggan` VALUES (1,'Budi Santoso','081234567890','3201011508950001'),"
        "(2,'Siti Aminah',NULL,'3201014408960002');\n"
        'CREATE TABLE `produk` (`id` int, `nama` varchar(50));\n'
        "INSERT INTO `produk` VALUES (1,'Kopi Susu Gula Aren');\n"
        "INSERT INTO `log` VALUES (1,'Hendra Gunawan');\n"
    )
    assert values(sql) == [
        'NAME:Budi Santoso', 'PHONE:081234567890', 'NIK:3201011508950001', 'NAME:Siti Aminah', 'NIK:3201014408960002',
    ]
    # pg_dump --inserts, with a schema and the table name in quotes.
    pg = (
        'CREATE TABLE public."Pasien" (\n    id integer,\n    nama_lengkap text,\n    diagnosa text\n);\n'
        "INSERT INTO public.\"Pasien\" VALUES (1, 'Rina Wati', 'Diabetes tipe 2');\n"
    )
    assert values(pg) == ['NAME:Rina Wati', 'HEALTH:Diabetes tipe 2']


def test_sql_dump_pg_copy_blocks() -> None:
    sql = (
        'COPY public.pelanggan (id, nama, alamat, no_hp) FROM stdin;\n'
        '1\tBudi Santoso\tJl. Melati No. 5\t081234567890\n'
        '2\t\\N\tJl. Mawar No. 3\t\\N\n'
        '\\.\n'
        'COPY public.produk (id, nama) FROM stdin;\n'
        '1\tKopi Gayo\n'
        '\\.\n'
        '3\tBukan Baris COPY\tx\tx\n'
    )
    assert values(sql) == ['NAME:Budi Santoso', 'ADDRESS:Jl. Melati No. 5', 'PHONE:081234567890', 'ADDRESS:Jl. Mawar No. 3']


def test_spelled_out_emails_and_casual_names() -> None:
    assert values('kirim ke siti.rahayu88 [at] gmail [dot] com ya') == ['EMAIL:siti.rahayu88 [at] gmail [dot] com']
    assert values('halo kak ini rina, pesanan saya batal', ['NAME']) == ['NAME:rina']
    assert values('tadi budi bilang udah dikirim', ['NAME']) == ['NAME:budi']
    for benign in ['halo kak ini mau tanya', 'halo ini stok ready?', 'tadi kurir bilang nyasar', 'kemarin mama nanya']:
        assert values(benign, ['NAME']) == [], benign


@pytest.mark.parametrize(('text', 'name'), [
    ('Nama: Budi Santoso ya kak', 'Budi Santoso'),
    ('Nama: Budi Santoso kak, mau tanya cicilan', 'Budi Santoso'),
    ('nama: budi santoso dong', 'budi santoso'),
    ('Nama: Budi Santoso 🙏', 'Budi Santoso'),
    ('Nama: Budi Santoso🙏 makasih', 'Budi Santoso'),
    ('Nama: Budi Santoso. Saya mau tanya', 'Budi Santoso'),
    ('Nama: Siti Aminah! tolong dibantu', 'Siti Aminah'),
    ('Nama: Budi Santoso terima kasih', 'Budi Santoso'),
    ('Pemesan: Rina Wati sudah transfer kak', 'Rina Wati'),
    ('Pembeli: Rina Wati', 'Rina Wati'),
    ('A/N: Budi Santoso', 'Budi Santoso'),
    # Not chat words: titles, initials, and name parts that look like them stay inside the name.
    ('Nama: M. Rizki Ramadhan', 'M. Rizki Ramadhan'),
    ('Nama: Dr. Ir. H. Ahmad Fauzi', 'Dr. Ir. H. Ahmad Fauzi'),
    ('Nama: Lee Dong Hae', 'Lee Dong Hae'),
    ('Nama: Ahmad bin Abdullah', 'Ahmad bin Abdullah'),
    # A nickname in brackets is part of the name; it used to make the whole value look like code.
    ('Nama: Siti Aminah (Ami)', 'Siti Aminah (Ami)'),
    ('nama_pemesan,hp\nRina Wati (Rin),0812-3456-7890', 'Rina Wati (Rin)'),
])
def test_labeled_names_stop_at_chat_words_and_emoji(text: str, name: str) -> None:
    assert values(text, ['NAME']) == [f'NAME:{name}']


@pytest.mark.parametrize('code', ['nama: getName(user)', 'name: fullName (string)', 'pembeli: User'])
def test_bracketed_code_is_not_a_name(code: str) -> None:
    assert [v for v in values(code, ['NAME']) if '(' in v] == []


def test_tab_tables_from_excel_word_and_pdf_text() -> None:
    assert values('Nama Pelanggan\tBudi Santoso\nNIK\t3201011508950001\nNo. HP\t0812-3456-7890') == [
        'NAME:Budi Santoso', 'NIK:3201011508950001', 'PHONE:0812-3456-7890',
    ]
    assert values(
        'Daftar peserta:\nNama\tNIK\tTelepon\nRina Wati\t3276014503920002\t0813-9999-0000\n'
        'Hendra Gunawan\t1371011010850008\nTotal 2 orang'
    ) == ['NAME:Rina Wati', 'NIK:3276014503920002', 'PHONE:0813-9999-0000', 'NAME:Hendra Gunawan', 'NIK:1371011010850008']
    assert values('Rekap nilai\r\nNo\tNama\tNilai\r\n1\tSiti Aminah\t90\r\n2\tDewi Lestari\t85', ['NAME']) == [
        'NAME:Siti Aminah', 'NAME:Dewi Lestari',
    ]
    # "Nama<TAB>: Budi" is a labeled field; the tab table must not add a second, overlapping match.
    assert values('Nama\t: Budi Santoso\nAgama\t:\tIslam') == ['NAME:Budi Santoso', 'RELIGION:Islam']


def test_line_numbered_files_from_agent_read_tools() -> None:
    arrow = chr(0x2192)
    text = f'1{arrow}nama,nik,kota\n2{arrow}Budi Santoso,3201011508950001,Bogor\n3{arrow}Siti Aminah,3276015508030002,Depok'
    assert values(text, ['NAME']) == ['NAME:Budi Santoso', 'NAME:Siti Aminah']
    assert values('     1\tnama,nik\n     2\tBudi Santoso,3201011508950001', ['NAME']) == ['NAME:Budi Santoso']
    assert values('1\tNama\tNIK\n2\tRina Wati\t3276014503920002', ['NAME']) == ['NAME:Rina Wati']
    # Numbers that do not count up are data, not line numbers.
    # (A name the gazetteer does not know, so only the header could make it a name.)
    assert values('12\tnama,nik\n7\tWiro Sableng,3201011508950001', ['NAME']) == []


@pytest.mark.parametrize('benign', [
    'n01687978\tagama\nn01688243\tfrilled lizard\nn01688961\tChamaeleo oweni',
    '\t\t\tuser\tuser name\n\t\t\thost\thost name\n\t\t\tpid\tPID of the Vim process',
    'dna\tUpper Grand Valley Dani\ndnb\tDumpu',
    '|:wn|\t   :wn[ext][!]\t\twrite file and edit next file',
])
def test_tabbed_data_files_are_not_tables(benign: str) -> None:
    # In the middle of a file; a header on the first line is a TSV header (_detect_csv_columns).
    assert values(f'...\n{benign}') == []


@pytest.mark.parametrize('text', [
    'Pasien: Siti   Aminah dan suami', 'Nama: Budi  Santoso', 'nama: Budi Santoso', 'Nama: Budi\tSantoso, HP 0812',
    'NAMA :  BUDI   SANTOSO  NIK: 3201011508950001', 'alamat:  Jl. Mawar  No. 5,  Depok',
    'Chat WhatsApp dengan Dewi 🌸 Lestari\n12/10/26 09.14 - Dewi 🌸 Lestari: 😭 HP 0812-3456-7890',
])
def test_matches_are_exactly_the_text_at_their_offsets(text: str) -> None:
    for m in detect_pii(text):
        assert text[m.start : m.end] == m.value
    s = Samaran()
    masked = s.mask(text).text
    assert not re.search(r'Aminah|Santoso|SANTOSO|Mawar|Lestari|3456', masked), masked
    assert s.unmask(masked) == text


def test_large_input_is_linear() -> None:
    import time

    text = ('Nama: Budi Santoso, NIK 3201011508950001, HP 0812-3456-7890. Total Rp1.500.000.\n' * 20000)
    started = time.perf_counter()
    masked = Samaran().mask(text).text
    assert '3201011508950001' not in masked
    assert time.perf_counter() - started < 20  # ~1.6 MB


def test_exclude_keeps_finance_and_names_readable_for_credit_simulations() -> None:
    text = 'gaji saya 8 juta, mau ambil cicilan 3 juta per bulan, a.n. Budi Santoso, HP 0812-3456-7890'
    assert Samaran(exclude=['FINANCIAL', 'NAME']).mask(text).text == (
        'gaji saya 8 juta, mau ambil cicilan 3 juta per bulan, a.n. Budi Santoso, HP [PHONE_1]'
    )
    assert mask_pii(text, exclude=['FINANCIAL']).text.startswith('gaji saya 8 juta')
    with pytest.raises(ValueError, match='Unknown PII type "FINANSIAL"'):
        Samaran(exclude=['FINANSIAL'])  # type: ignore[list-item]
    with pytest.raises(TypeError):
        detect_pii(text, exclude='FINANCIAL')  # type: ignore[arg-type]


def test_numbers_glued_to_codes_are_not_phones() -> None:
    for code in ['INV-081234567890', 'ORD/081234567890', 'TRX-6281234567890', 'inv.2026-081234567890']:
        assert detect_pii(code) == [], code
    for phone in ['hp-081234567890', 'no-081234567890', 'wa.me/6281377778888', 'https://wa.me/6281234567890']:
        assert detect_pii(phone)[0].type == 'PHONE', phone
    assert [m.value for m in detect_pii('081234567890/081298765432')] == ['081234567890', '081298765432']


def test_condition_after_a_pronoun() -> None:
    assert [m.value for m in detect_pii('saya diabetes, rutin obat insulin')] == ['diabetes', 'insulin']
    assert [m.value for m in detect_pii('ibu saya hipertensi')] == ['hipertensi']
    assert detect_pii('saya siap, dia datang besok') == []


def test_names_without_a_label() -> None:
    assert values('Pelanggan Budi Santoso minta refund, Kurir Supardi sudah antar', ['NAME']) == [
        'NAME:Budi Santoso', 'NAME:Supardi',
    ]
    assert values('Dear Mr. Hendra Gunawan,\nThank you.', ['NAME']) == ['NAME:Hendra Gunawan']
    assert values('Halo Budi,\nPesanan kamu sudah dikirim.', ['NAME']) == ['NAME:Budi']
    assert values('Mohon dibantu.\n\nSalam,\nRina Kartika Sari\nFinance', ['NAME']) == ['NAME:Rina Kartika Sari']
    assert values('From: Budi Santoso <budi.s@gmail.com>', ['NAME']) == ['NAME:Budi Santoso']
    assert values('/*! ws. MIT License. Einar Otto Stangvik <einaros@gmail.com> */', ['NAME']) == ['NAME:Einar Otto Stangvik']
    assert values('aku andi yg td chat', ['NAME']) == ['NAME:andi']
    assert values('No. KK: 3201012345678901 (kepala keluarga Bambang)', ['NAME']) == ['NAME:Bambang']
    # Not names: a role with an adjective, a greeting to a group or a city, a business signing off.
    text = 'Pelanggan Setia dapat diskon. Kurir JNE datang. Halo Semua, Halo Bandung, Hai Kakak!\n\nSalam,\nTim Lokal'
    assert values(text, ['NAME']) == []


def test_names_recognized_by_their_parts() -> None:
    text = 'Yang bertanggung jawab Togar Simanjuntak. Tamu: I Made Wirawan dan Ni Luh Putu Ayu. Pemilik koh Lim Swie Hong.'
    assert values(text, ['NAME']) == [
        'NAME:Togar Simanjuntak', 'NAME:I Made Wirawan', 'NAME:Ni Luh Putu Ayu', 'NAME:Lim Swie Hong',
    ]
    # A bank statement in capitals: the name starts at SITI, not at the transaction code.
    assert values('22/10 BI-FAST CR TRANSFER DR 014 SITI RAHAYU 75000.00', ['NAME']) == ['NAME:SITI RAHAYU']
    # Places and organizations named after people, and words that are also given names.
    text = (
        'Masjid Agung, Universitas Ahmad Dahlan, RS Siti Khadijah, Toko Budi Jaya, Jl. Ahmad Yani. Pendidikan Budi '
        'Pekerti. Permata Intan, Mekar Sari, Lumban Siregar.'
    )
    assert values(text, ['NAME']) == []


def test_identifiers_in_odd_places() -> None:
    assert values('upload KTP_3201011508950001.jpg, NIK3201011508950001', ['NIK']) == [
        'NIK:3201011508950001', 'NIK:3201011508950001',
    ]
    assert values('?name=Siti%20Rahayu&email=siti%40gmail.com') == ['NAME:Siti%20Rahayu', 'EMAIL:siti%40gmail.com']
    assert values('<input name="nik" value="3201011508950001"><input name="nama" value="Budi Santoso">') == [
        'NIK:3201011508950001', 'NAME:Budi Santoso',
    ]
    assert values('<tr><th>Nama</th><th>HP</th></tr><tr><td>Budi Santoso</td><td>081234567890</td></tr>') == [
        'NAME:Budi Santoso', 'PHONE:081234567890',
    ]
    assert values('cek DM dari @siti.rahayu88', ['NAME']) == ['NAME:siti.rahayu88']
    assert values('Transfer berhasil\r\nPenerima\r\nDEWI LESTARI\r\nNominal Rp 250.000', ['NAME']) == ['NAME:DEWI LESTARI']
    # Code: JSDoc tags, decorators, npm scopes, CSS, and the domain of a masked address.
    assert values('/** @param options.abortSignal */\n@pytest.fixture\nnpm i @types/node; @media print; b***@gmail.com') == []


def test_phones_and_addresses_written_loosely() -> None:
    text = 'Telp: +62 (812) 3456-7890, no wa 08 12 34 56 78 90, wa081234567890, rumah 0251 8321234'
    assert values(text, ['PHONE']) == [
        'PHONE:+62 (812) 3456-7890', 'PHONE:08 12 34 56 78 90', 'PHONE:081234567890', 'PHONE:0251 8321234',
    ]
    assert values('nomor gue nol delapan satu dua tiga empat lima enam tujuh delapan sembilan', ['PHONE']) == [
        'PHONE:nol delapan satu dua tiga empat lima enam tujuh delapan sembilan',
    ]
    assert values('Komplek Taman Asri blok B no 9, deket masjid', ['ADDRESS']) == ['ADDRESS:Komplek Taman Asri blok B no 9']
    assert values('Dusun Krajan RT 02 RW 01 Desa Sukamaju', ['ADDRESS']) == ['ADDRESS:Dusun Krajan RT 02 RW 01']
    assert values('alamat jl mawar 5 cibinong ya', ['ADDRESS']) == ['ADDRESS:jl mawar 5']
    # Not phones or addresses.
    assert values('kode pos 16911, harga 0251 8321, jalan kaki 5 menit, jl. raya macet 2 jam, SK No. 100.3.3.1-6117') == []


def test_uu_pdp_sensitive_data_in_everyday_language() -> None:
    assert values('saya muslim, suami saya kristen protestan', ['RELIGION']) == [
        'RELIGION:muslim', 'RELIGION:kristen protestan',
    ]
    assert values('saya sudah cerai sejak 2020, sekarang janda', ['MARITAL_STATUS']) == [
        'MARITAL_STATUS:cerai', 'MARITAL_STATUS:janda',
    ]
    assert values('ayah stroke, riwayat hipertensi dan diabetes melitus, alergi penisilin, keluhan demam', ['HEALTH']) == [
        'HEALTH:stroke', 'HEALTH:hipertensi dan diabetes melitus', 'HEALTH:penisilin', 'HEALTH:demam',
    ]
    assert values('utang pinjol 12 juta, udah galbay 3 bulan', ['FINANCIAL']) == ['FINANCIAL:12 juta', 'FINANCIAL:galbay']
    assert values('dia mantan napi kasus narkoba, pernah dipenjara 3 tahun', ['CRIMINAL_RECORD']) == [
        'CRIMINAL_RECORD:mantan napi kasus narkoba', 'CRIMINAL_RECORD:pernah dipenjara 3 tahun',
    ]
    # The same words about groups, institutions, or the news.
    text = (
        'Makanan halal untuk umat Muslim. Gereja Kristen Jawa. Hari Kanker Sedunia. Kasus narkoba meningkat menurut BNN. '
        'Risiko gagal bayar obligasi. Saya menikah tahun depan.'
    )
    assert values(text) == []


def test_placeholder_like_text_in_the_input_keeps_its_number() -> None:
    s = Samaran()
    text = 'Template: "Halo [NAME_1], NIK kamu [NIK_1]". Data: Budi Santoso, NIK 3201011508950001'
    masked = s.mask(text).text
    assert masked == 'Template: "Halo [NAME_1], NIK kamu [NIK_1]". Data: [NAME_2], NIK [NIK_2]'
    assert s.unmask(masked) == text
    assert s.mask('Bagaimana dengan [NAME_2]? Ada juga Siti Aminah.').text == 'Bagaimana dengan [NAME_2]? Ada juga [NAME_3].'
    r = Samaran()
    r.reserve('Pelanggan: Joko Susilo ... template: Yth. [NAME_4]')
    assert r.mask('Pelanggan: Joko Susilo').text == 'Pelanggan: [NAME_5]'
    assert mask_pii('[NIK_3] 3201011508950001', mode='partial').text == '[NIK_3] 3201********0001'
    assert Samaran().mask('[NIK_99999999999] NIK 3201011508950001').text == '[NIK_99999999999] NIK [NIK_1]'


def test_hostile_one_line_input_stays_linear() -> None:
    # 400 KB of "Nama: " was quadratic when each label scanned the rest of the line.
    import time

    for unit in ('Nama: ', '1234-5678-', 'NIK: 3201 '):
        started = time.perf_counter()
        detect_pii(unit * (400_000 // len(unit)))
        assert time.perf_counter() - started < 15, unit

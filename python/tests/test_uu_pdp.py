"""Coverage of the personal data categories in UU PDP Pasal 4, plus Indonesian identifiers."""

from lokal import UU_PDP_CATEGORY, detect_pii, mask_pii, partial_mask


def found(text: str) -> list[str]:
    return [f'{m.type}:{m.value}' for m in detect_pii(text)]


def test_general_personal_data() -> None:
    assert found('nama: budi santoso') == ['NAME:budi santoso']
    assert found('NAMA : BUDI SANTOSO') == ['NAME:BUDI SANTOSO']
    assert found('Agama: Islam, Status Perkawinan: Kawin') == ['RELIGION:Islam', 'MARITAL_STATUS:Kawin']
    assert found('Agama: Islam Status Perkawinan: Kawin') == ['RELIGION:Islam', 'MARITAL_STATUS:Kawin']
    assert found('dia beragama Katolik') == ['RELIGION:Katolik']
    assert found('Jenis Kelamin: Perempuan; Kewarganegaraan: WNI') == ['GENDER:Perempuan', 'NATIONALITY:WNI']


def test_birth_place_and_date() -> None:
    assert found('lahir 15 Agustus 1995, tgl lahir 15-08-1995') == ['BIRTH_DATE:15 Agustus 1995', 'BIRTH_DATE:15-08-1995']
    assert found('Tempat/Tgl Lahir : BOGOR, 15-08-1995') == ['BIRTH_DATE:BOGOR, 15-08-1995']


def test_specific_data_health() -> None:
    assert found('Pasien didiagnosis HIV dan diabetes tipe 2') == ['HEALTH:HIV dan diabetes tipe 2']
    assert found('anak saya positif covid, ibu saya pasien kanker payudara') == ['HEALTH:covid', 'HEALTH:kanker payudara']
    # Everyday uses of the same verbs are not health data.
    assert found('perusahaan menderita kerugian, tanggapan positif dari pelanggan') == []


def test_specific_data_finance_crime_biometrics() -> None:
    assert found('Gaji saya 8 juta, saldo rekening 25 juta') == ['FINANCIAL:8 juta', 'FINANCIAL:25 juta']
    assert found('pendapatan perusahaan naik 20 persen') == []
    assert found('Catatan Kriminal: pernah ditahan 2019') == ['CRIMINAL_RECORD:pernah ditahan 2019']
    assert found('foto_ktp: uploads/ktp/8812.jpg') == ['BIOMETRIC:uploads/ktp/8812.jpg']
    assert UU_PDP_CATEGORY['HEALTH'] == 'spesifik'
    assert UU_PDP_CATEGORY['FINANCIAL'] == 'spesifik'
    assert UU_PDP_CATEGORY['NAME'] == 'umum'


def test_identifiers() -> None:
    assert found('No KK 3201010101200001') == ['KK:3201010101200001']
    assert found('Paspor: A1234567') == ['PASSPORT:A1234567']
    assert found('No SIM 950812345678') == ['SIM:950812345678']
    assert found('NIP 19950815 202012 1 001') == ['NIP:19950815 202012 1 001']
    assert found('login dari 182.253.10.15 versi 1.2.3.4, bind 0.0.0.0') == ['IP:182.253.10.15']
    assert found('lokasi -6.200000, 106.816666') == ['GEO:-6.200000, 106.816666']
    # SIM label only applies to the number right after it.
    assert found('No SIM 950812345678, NIK 3201011508950001') == ['SIM:950812345678', 'NIK:3201011508950001']


def test_sensitive_csv_and_json_columns() -> None:
    assert found('nama,agama,diagnosa,gaji,jk\nBudi Santoso,Islam,Hipertensi,8000000,L') == [
        'NAME:Budi Santoso', 'RELIGION:Islam', 'HEALTH:Hipertensi', 'FINANCIAL:8000000', 'GENDER:L',
    ]
    assert found('{"nama_pelanggan": "siti", "tgl_lahir": "1995-08-15", "gol_darah": "O"}') == [
        'NAME:siti', 'BIRTH_DATE:1995-08-15', 'HEALTH:O',
    ]
    assert found('GET /daftar?nama=Budi&email=budi@x.id&hp=081234567890') == [
        'NAME:Budi', 'EMAIL:budi@x.id', 'PHONE:081234567890',
    ]


def test_code_schema_and_config_are_not_personal_data() -> None:
    code = '\n'.join([
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
        # Python, too.
        'class Pelanggan(BaseModel):\n    nama: str\n    nik: str = Field(min_length=16)',
        'email = request.form["email"]',
    ])
    assert found(code) == []


def test_generic_name_key_is_medium_confidence() -> None:
    assert detect_pii('name: Default Greeting')[0].confidence == 'medium'
    assert detect_pii('Nama: Budi Santoso')[0].confidence == 'high'
    assert [x.type for x in detect_pii('TTL: Bogor, 15-08-1995')] == ['BIRTH_DATE']
    assert [x.value for x in detect_pii('jenis_kelamin: L')] == ['L']


def test_mask_and_partial_for_new_types() -> None:
    text = mask_pii('Agama: Islam, didiagnosis TBC, gaji 8 juta, NIP 199508152020121001').text
    assert text == 'Agama: [RELIGION_1], didiagnosis [HEALTH_1], gaji [FINANCIAL_1], NIP [NIP_1]'
    assert partial_mask('IP', '182.253.10.15') == '182.253.*.*'
    assert partial_mask('HEALTH', 'HIV') == '***'
    assert partial_mask('KK', '3201010101200001') == '3201********0001'

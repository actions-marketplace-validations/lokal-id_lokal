import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNik, parsePhone } from '../src/index.ts';
import { Kembaran } from '../src/kembaran.ts';

const CSV = `nama,nik,tgl_lahir,hp,email,alamat,kota
Budi Santoso,3201011508950001,15-08-1995,0812-3456-7890,budi.santoso@gmail.com,"Jl. Mawar No. 5 RT 03/RW 07, Cibinong",Bogor
SITI AMINAH,3276015508030002,15 Agustus 2003,+62 857 1111 2222,siti@yahoo.co.id,"Jl. Kenanga Raya No. 12, Depok",Depok
Budi Santoso,3201011508950001,15-08-1995,081234567890,budi.santoso@gmail.com,"Jl. Mawar No. 5 RT 03/RW 07, Cibinong",Bogor`;
const SECRETS = ['Budi Santoso', 'SITI AMINAH', '3201011508950001', '3276015508030002', '3456-7890', '3456 7890', '1111', 'gmail.com', 'yahoo', 'Mawar', 'Kenanga'];

const rows = (text: string) => text.split('\n').slice(1).map((l) => l.match(/("[^"]*"|[^,]+)/g)!);

test('Kembaran: CSV pelanggan tanpa satu pun nilai asli, tetap konsisten dan valid', () => {
  const out = new Kembaran({ secret: 'uji' }).text(CSV);
  for (const s of SECRETS) assert.ok(!out.text.includes(s), `${s} survived`);
  assert.deepEqual(out.replaced, { NAME: 3, NIK: 3, BIRTH_DATE: 3, PHONE: 3, EMAIL: 3, ADDRESS: 3 });
  const [budi, siti, budiAgain] = rows(out.text);
  assert.deepEqual(budiAgain!.slice(0, 3), budi!.slice(0, 3), 'the same person gets the same stand-in');
  assert.equal(budiAgain![4], budi![4]);
  assert.equal(budi![6], 'Bogor', 'the city stays');
  assert.match(siti![0]!, /^[A-Z]+ [A-Z]+$/, 'casing follows the original');

  // A NIK stand-in is a valid NIK for the same district, gender, and birth year.
  const fake = parseNik(budi![1]!);
  assert.equal(fake.valid, true);
  assert.equal(budi![1]!.slice(0, 6), '320101');
  assert.equal(fake.gender, 'L');
  assert.equal(fake.birthDate!.slice(0, 4), '1995');
  assert.equal(parseNik(siti![1]!).gender, 'P');
  // The birth date column follows the stand-in NIK on its row.
  const [day, month] = budi![2]!.split('-');
  assert.equal(fake.birthDate, `1995-${month}-${day}`);
  assert.match(siti![2]!, /^\d{2} [A-Z][a-z]+ 2003$/);

  // Phones keep their operator and format; e-mail goes to a reserved domain; the address keeps its area.
  assert.match(budi![3]!, /^0812-\d{4}-\d{4}$/);
  assert.equal(parsePhone(budi![3]!).operator, 'Telkomsel');
  assert.equal(parsePhone(budiAgain![3]!).e164, parsePhone(budi![3]!).e164, '0812-… and 0812… are one person');
  assert.match(siti![3]!, /^\+62 857 \d{4} \d{4}$/);
  assert.match(budi![4]!, /^[a-z]+\.[a-z]+\d{2}@example\.com$/);
  assert.match(budi![5]!, /^"Jl\. [A-Z][a-z]+(?: [A-Z][a-z]+)? No\. \d+ RT 0\d\/RW 0\d, Cibinong"$/);
});

test('Kembaran: nilai yang sama konsisten antartabel, NPWP orang pribadi mengikuti NIK', () => {
  const k = new Kembaran({ secret: 'uji' });
  const a = k.text("INSERT INTO pelanggan (nama, nik, rekening) VALUES ('Budi Santoso', '3201011508950001', '1234567890');").text;
  const b = k.text('pelanggan_nik,npwp,gaji\n3201011508950001,3201011508950001,8500000').text;
  const nik = /'(\d{16})'/.exec(a)![1]!;
  const [fakeNik, fakeNpwp] = b.split('\n')[1]!.split(',');
  assert.equal(fakeNik, nik, 'the same NIK in another file');
  assert.equal(fakeNpwp, nik, 'an individual NPWP is their NIK');
  assert.doesNotMatch(a, /1234567890/);
  assert.doesNotMatch(b, /8500000/);
});

test('Kembaran: kunci yang sama memberi hasil yang sama, kunci lain berbeda, tanpa kunci acak', () => {
  const one = new Kembaran({ secret: 'staging' }).text(CSV).text;
  assert.equal(new Kembaran({ secret: 'staging' }).text(CSV).text, one);
  assert.notEqual(new Kembaran({ secret: 'lain' }).text(CSV).text, one);
  assert.notEqual(new Kembaran().text(CSV).text, new Kembaran().text(CSV).text);
});

test('Kembaran: 5.000 NIK dari kecamatan, tahun, dan jenis kelamin yang sama tidak pernah bertabrakan', () => {
  const k = new Kembaran({ secret: 'tabrakan' });
  const fakes = new Set<string>();
  for (let i = 1; i <= 5000; i++) {
    const nik = `320101150895${String(i).padStart(4, '0')}`;
    const fake = k.value('NIK', nik);
    assert.equal(parseNik(fake).valid, true, fake);
    fakes.add(fake);
  }
  assert.equal(fakes.size, 5000);
});

test('Kembaran: opsi keep, tanggal lahir utuh, dan teks bebas', () => {
  const kept = new Kembaran({ secret: 'k', keep: ['NAME', 'GENDER'], keepBirthDate: true }).text(CSV).text;
  assert.ok(kept.includes('Budi Santoso') && kept.includes('15-08-1995') && kept.includes('15 Agustus 2003'));
  assert.ok(!kept.includes('3201011508950001'));
  assert.equal(rows(kept)[0]![1]!.slice(6, 12), '150895', 'the NIK keeps the whole birth date too');
  assert.throws(() => new Kembaran({ keep: ['NAMA' as never] }), RangeError);

  const prose = new Kembaran({ secret: 'p' }).text(
    'Pasien: Siti Aminah, diagnosa: Diabetes tipe 2. Plat B 1234 XYZ, login dari 182.253.10.15, kartu 4539 1488 0343 6467. Agama: Islam',
  ).text;
  for (const s of ['Siti Aminah', 'Diabetes', '1234 XYZ', '182.253.10.15', '4539 1488 0343 6467']) assert.ok(!prose.includes(s), s);
  assert.match(prose, /Plat B \d{4} [A-Z]{3}/);
  assert.match(prose, /login dari (192\.0\.2|198\.51\.100|203\.0\.113)\.\d+/);
  const card = /kartu (\d{4} \d{4} \d{4} \d{4})/.exec(prose)![1]!.replace(/ /g, '');
  assert.ok(card.startsWith('453914'), 'the card keeps its issuer prefix');
  assert.ok(luhn(card), 'and passes Luhn');
  assert.match(prose, /Agama: Islam$/, 'religion is kept by default');
});

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

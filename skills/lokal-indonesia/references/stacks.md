# Stack-specific patterns

## Next.js (App Router) / Node

```sh
npm install @lokal-id/core
```

### Address data endpoint

The Kemendagri data loads from disk, so keep it on the Node runtime and cache the responses: it only changes when a new decree is issued.

```ts
// app/api/wilayah/route.ts
import { listWilayah } from '@lokal-id/core/wilayah';

export const runtime = 'nodejs';

export function GET(request: Request) {
  const parent = new URL(request.url).searchParams.get('parent') ?? undefined;
  return Response.json(listWilayah(parent), {
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800' },
  });
}
```

The client fetches `/api/wilayah`, then `/api/wilayah?parent=32`, and so on; a kelurahan/desa item carries `postalCode`, so set the kode pos field when one is chosen.

### Validation with zod

```ts
import { z } from 'zod';
import { parseNik, parsePhone, parseRupiah } from '@lokal-id/core';

export const checkoutSchema = z.object({
  nama: z.string().trim().min(2, 'Nama wajib diisi'),
  hp: z
    .string()
    .refine((v) => parsePhone(v).type === 'mobile' && parsePhone(v).valid, 'Nomor HP belum valid. Contoh: 0812-3456-7890')
    .transform((v) => parsePhone(v).e164!),
  provinsi: z.string().regex(/^\d{2}$/),
  kabupatenKota: z.string().regex(/^\d{2}\.\d{2}$/),
  kecamatan: z.string().regex(/^\d{2}\.\d{2}\.\d{2}$/),
  kelurahan: z.string().regex(/^\d{2}\.\d{2}\.\d{2}\.\d{4}$/),
  kodePos: z.string().regex(/^\d{5}$/, 'Kode pos harus 5 digit'),
  alamat: z.string().trim().min(5, 'Alamat lengkap wajib diisi'),
  patokan: z.string().optional(),
});

export const nikSchema = z.string().refine((v) => parseNik(v).valid, 'NIK tidak valid');

// Price filters typed by people: "50rb", "1,5jt"
export const priceInput = z.string().transform((v, ctx) => {
  const parsed = parseRupiah(v);
  if (!parsed) ctx.addIssue({ code: 'custom', message: 'Nominal tidak dikenali' });
  return parsed?.amount ?? 0;
});
```

### Display

```tsx
import { formatRupiah } from '@lokal-id/core';

<span>{formatRupiah(order.total)}</span>;  // Rp1.500.000
```

### Delivery estimates

```ts
import { addWorkingDays } from '@lokal-id/core';

addWorkingDays('2026-03-17', 1);                         // '2026-03-25': skips Nyepi and Lebaran
addWorkingDays('2026-03-17', 1, { cutiBersama: false }); // '2026-03-18': the company works on cuti bersama
```

`addWorkingDays` throws for years without an official holiday decree; catch it and fall back to calendar days with a note, rather than silently ignoring holidays.

### LLM features

Wrap every call that sends user text to an LLM API with Samaran — see the `samaran` skill.

## Laravel / PHP

There is no PHP package yet; these are the native equivalents.

### Address data

The data behind `@lokal-id/core/wilayah` comes from [cahyadsn/wilayah](https://github.com/cahyadsn/wilayah) and [cahyadsn/wilayah_kodepos](https://github.com/cahyadsn/wilayah_kodepos) (MIT), which ship as MySQL dumps: import `db/wilayah.sql` and `db/wilayah_kodepos.sql` directly.

```php
// Children of a region: provinces when $parent is null.
Route::get('/api/wilayah', function (Request $request) {
    $parent = $request->query('parent');
    $level = $parent ? substr_count($parent, '.') + 2 : 1;
    $query = DB::table('wilayah')
        ->leftJoin('wilayah_kodepos', 'wilayah.kode', '=', 'wilayah_kodepos.kode')
        ->select('wilayah.kode', 'wilayah.nama', 'wilayah_kodepos.kodepos')
        ->whereRaw('(LENGTH(wilayah.kode) - LENGTH(REPLACE(wilayah.kode, ".", ""))) = ?', [$level - 1])
        ->orderBy('wilayah.kode');
    if ($parent) {
        $query->where('wilayah.kode', 'like', $parent.'.%');
    }
    return response()->json($query->get())->header('Cache-Control', 'public, max-age=86400');
});
```

### Validation rules

```php
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

final class Nik implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $nik = preg_replace('/[\s.\-]/', '', (string) $value);
        if (! preg_match('/^\d{16}$/', $nik)) {
            $fail('NIK harus 16 digit angka.');
            return;
        }
        $day = (int) substr($nik, 6, 2);
        $month = (int) substr($nik, 8, 2);
        $yy = (int) substr($nik, 10, 2);
        if ($day > 40) {
            $day -= 40; // perempuan
        }
        $year = $yy <= (int) date('y') ? 2000 + $yy : 1900 + $yy;
        $province = (int) substr($nik, 0, 2);
        if ($province < 11 || $province > 96 || ! checkdate($month, $day, $year) || substr($nik, 12) === '0000') {
            $fail('NIK tidak valid.');
        }
    }
}

function normalize_hp(string $input): ?string
{
    $digits = preg_replace('/[^\d]/', '', $input);
    $digits = preg_replace('/^(62|0)/', '', $digits);
    return preg_match('/^8\d{8,11}$/', $digits) ? '+62'.$digits : null; // E.164
}
```

### Formatting and locale

```php
function rupiah(int $amount): string
{
    return 'Rp'.number_format($amount, 0, ',', '.'); // Rp1.500.000
}
```

- `config/app.php`: `'timezone' => 'Asia/Jakarta'`, `'locale' => 'id'`, `'faker_locale' => 'id_ID'`.
- Dates: `Carbon::parse($date)->locale('id')->translatedFormat('j F Y')` → `15 Oktober 2026`.
- Validation messages: publish `lang/id/validation.php` and translate them in the register you chose (Anda/kamu).
- Holidays: keep them in a table seeded from the yearly SKB (see `list_holidays`), not in code.

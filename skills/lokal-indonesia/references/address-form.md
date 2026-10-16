# Indonesian address form

## Data

```ts
// Server (Node): Kemendagri data shipped with @lokal-id/core
import { listWilayah, searchWilayah, getWilayah } from '@lokal-id/core/wilayah';

listWilayah();            // 38 provinces: { code: '32', name: 'Jawa Barat', type: 'provinsi', … }
listWilayah('32');        // kabupaten/kota in Jawa Barat
listWilayah('32.76');     // kecamatan in Kota Depok
listWilayah('32.76.01');  // kelurahan/desa in that kecamatan
searchWilayah('depok');   // [{ code: '32.76', name: 'Kota Depok', path: 'Kota Depok, Jawa Barat' }]
```

Expose this through one endpoint, e.g. `GET /api/wilayah?parent=32.76`, and cache it: the data only changes when Kemendagri issues a new decree.

## Form

```
Provinsi            [ Jawa Barat           ▾ ]
Kabupaten/Kota      [ Kota Depok           ▾ ]   ← enabled after provinsi
Kecamatan           [ Pancoran Mas         ▾ ]   ← enabled after kab/kota
Kelurahan/Desa      [ …                    ▾ ]   ← enabled after kecamatan
Kode Pos            [ 5 digit ]
Alamat lengkap      [ Jl. Mawar No. 5, RT 003/RW 007            ]
Patokan (opsional)  [ Depan masjid, pagar hijau                 ]
```

- Make the dropdowns searchable: Jawa Timur alone has 38 kabupaten/kota.
- Changing a level clears the levels below it.
- Store both codes and names: `{ provinceCode: '32', regencyCode: '32.76', districtCode: '32.76.01', villageCode: '32.76.01.1001', … }`.
- Recipient name and phone (Nomor HP penerima) belong in the same form for deliveries.
- Let users save several addresses with a label: Rumah, Kantor, Kos.

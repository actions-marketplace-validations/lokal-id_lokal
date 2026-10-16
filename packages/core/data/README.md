# Data wilayah

`wilayah.json` (provinsi, kabupaten/kota, kecamatan) and `desa.json` (kelurahan/desa) are generated from
[cahyadsn/wilayah](https://github.com/cahyadsn/wilayah) `db/wilayah.sql`, which follows
Kepmendagri No 300.2.2-2138 Tahun 2025 (as amended by 300.2.2-2430 Tahun 2025, which only reassigns four islands). The
totals match the decree exactly: 38 provinsi, 416 kabupaten, 98 kota, 7,285 kecamatan, 8,496 kelurahan, 75,266 desa.
That data is MIT-licensed; see `LICENSE-wilayah.txt`.

Regenerate after a new Kepmendagri decree:

```sh
curl -L -o wilayah.sql https://raw.githubusercontent.com/cahyadsn/wilayah/master/db/wilayah.sql
npm run data:wilayah -w @lokal-id/core -- path/to/wilayah.sql
```

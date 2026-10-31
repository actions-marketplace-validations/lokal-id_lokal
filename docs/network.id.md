# Apa yang tetap di perangkat Anda, dan apa yang bisa mengakses jaringan

[English](network.md)

Lokal mendeteksi dan menyamarkan data pribadi secara lokal. Lokal tidak punya server, akun, maupun telemetri, dan tidak pernah mengirim teks ke model untuk mencari data pribadi. Halaman ini mencatat, untuk tiap bagian, apa yang dibacanya, di mana nilai asli disimpan, dan setiap koneksi jaringan yang dibuatnya. Setiap baris sudah dicocokkan dengan kode sumbernya.

| Bagian | Koneksi jaringan | Di mana nilai asli disimpan |
|---|---|---|
| `@lokal-id/core`, `lokal-id` (Python) | Tidak ada. Kode wilayah, kode pos, dan hari libur sudah dibundel. | Di proses Anda, di objek `Samaran`, selama objek itu Anda simpan. |
| Server MCP (stdio), lewat plugin Claude Code atau `npx` | Tidak ada selama berjalan. `npx` mengunduh paket dari registry npm saat pertama kali dijalankan. | Di memori server, sampai `clear_vault` dipanggil, `vaultTtlMinutes` lewat tanpa dipakai, atau sesi berakhir. Tidak pernah ditulis ke disk. |
| Server MCP lewat HTTP (`serve --http`) | Mendengarkan di `127.0.0.1:3000`, kecuali Anda memilih alamat lain. Tidak membuat koneksi keluar. Hanya menyediakan tool data; tool file tidak disertakan. | Tidak ada, karena tool data tidak menyamarkan. |
| Samaran Guard (hook) | Tidak ada. Guard membaca file yang akan dibaca agent, di perangkat Anda. | Tidak ada. Guard menghitung nilai lalu memutuskan, tanpa menyimpan apa pun. |
| `lokal-mcp scan` | Tidak ada. Dengan `--staged` atau `--diff`, scan menjalankan `git` secara lokal. | Tidak ada. Temuan ditampilkan sebagian tersamar. |
| GitHub Action | Memasang `@lokal-id/mcp` dari npm di runner. Kalau sebuah push tidak punya commit induk, commit itu diambil dari repository Anda sendiri. | Tidak ada. Anotasi ditampilkan sebagian tersamar. |
| `lokal-mcp kembaran`, `anonymize_file` | Tidak ada. | Tidak ada. Hasilnya berisi orang-orang karangan. |
| Audit log, `lokal-mcp audit` | Tidak ada. | Tidak ada nilai. Tiap baris berisi jumlah per jenis, aksi, dan file atau path API. |
| **Samaran Proxy** | Mendengarkan di `127.0.0.1:8787`. Request yang sudah **disamarkan** dikirim ke upstream yang Anda atur (bawaannya OpenAI dan Anthropic). Request berisi jenis `route` dikirim **tanpa disamarkan** ke endpoint lokal di `.samaran.json`, dan tidak ke tempat lain. | Di memori, untuk satu request. Nilai dipulihkan di jawaban lalu dilupakan. |
| Model NER opsional (`lokal-id[ner-lokal]` atau `lokal-id[ner]`, Python) | Mengunduh model sekali, kecuali Anda memuatnya dari folder dengan `model_path`: model milik Lokal (125 MB, bawaan) dari GitHub release [`ner-base-v1`](https://github.com/lokal-id/lokal/releases/tag/ner-base-v1), dicek SHA-256-nya; `gold` (1,3 GB) dan `fast` (440 MB) dari Hugging Face di revisi yang di-pin. Setelah itu berjalan lokal. | Di proses Anda, seperti bagian lain library Python. |
| Model NER milik Lokal (`@lokal-id/ner`, Node; `"ner": true` di `.samaran.json` untuk server MCP dan proxy) | Mengunduh model (125 MB) sekali dari GitHub release [`ner-base-v1`](https://github.com/lokal-id/lokal/releases/tag/ner-base-v1) dan mencocokkan tiap file dengan SHA-256 di package, kecuali Anda memuatnya dari folder dengan `modelPath`. Setelah itu berjalan lokal, di WebAssembly. | Di proses Anda. Tidak ada yang dikirim: model membaca teks di mesin Anda. |
| Middleware Vercel AI SDK | Tidak membuat koneksi sendiri. Panggilan model dari aplikasi membawa teks yang sudah disamarkan. | Di memori, untuk satu panggilan. |
| Ekstensi browser | Tidak ada. Ekstensi tidak membuat request jaringan. Situs AI-lah yang mengirim pesan Anda, setelah disamarkan oleh ekstensi. Izinnya hanya `storage` dan `activeTab`, dan ekstensi hanya berjalan di situs AI yang tercantum di manifest-nya. | Di session storage browser, hanya di memori, sampai browser ditutup atau Anda memilih **Lupakan semua data asli**. |

## Apa yang sampai ke penyedia model

- **Lewat tool file MCP:** placeholder seperti `[NIK_1]`, bukan nilainya. Jenis dengan policy `allow` ditampilkan apa adanya. File yang berisi jenis `block` ditolak.
- **Lewat proxy atau middleware AI SDK:** request yang sudah disamarkan. Jawabannya dipulihkan di sisi Anda.
- **Lewat ekstensi browser:** pesan atau file yang sudah disamarkan.
- **Tidak tercakup:** apa pun yang Anda atau agent kirim tanpa melewati Lokal. Contohnya file mentah yang dibaca tanpa guard, prompt yang dikirim dengan `#izinkan-pii`, atau gambar dan PDF hasil scan yang tidak bisa dibaca Samaran. Lihat [Cakupan tiap integrasi](../README.id.md#cakupan-tiap-integrasi).

## Yang perlu diketahui

- **Routing mengirim data asli.** Endpoint `route` menerima request tanpa disamarkan. `lokal-mcp check` memberi peringatan kalau endpoint itu tidak berada di perangkat ini atau di jaringan privat.
- **Alamat proxy.** Kalau dijalankan dengan `--host 0.0.0.0`, proxy bisa diakses dari jaringan Anda, padahal proxy melihat data asli. Biarkan di `127.0.0.1`, atau pasang di balik firewall. [Contoh Docker Compose](../examples/proxy-ollama) hanya membuka proxy di `127.0.0.1`.
- **API key.** Proxy meneruskan key penyedia model Anda ke penyedia itu tanpa menyimpannya. Key itu tidak dikirim ke endpoint `route`; yang dikirim ke sana adalah `LOKAL_ROUTE_API_KEY`, kalau Anda mengisinya.
- **Unduhan paket.** `npx`, `npm install`, dan `pip install` mengakses registry masing-masing. Pin versinya, seperti yang dilakukan plugin (`@lokal-id/mcp@<versi>`). Rilis diterbitkan dari GitHub Actions dengan provenance npm dan Trusted Publishing PyPI.

# WebGIS Asap Karhutla Kabupaten Sorong

WebGIS statis (HTML, CSS, JavaScript) untuk PjBL SIG GD4103, Kelompok 6 K-02. Semua analisis dihitung di browser, jadi cukup dihosting di GitHub Pages tanpa server.

> **Status data (16 November 2026).** Sebaran asap adalah hasil HYSPLIT v5.4.2 dengan meteorologi GDAS1 dan titik panas VIIRS NOAA-20/21 untuk 1–10 Oktober 2026; fasilitas dari OpenStreetMap (ekspor HOTOSM di HDX) yang dipotong pada batas Kabupaten Sorong dari geoBoundaries. Hasil ini belum divalidasi, hanya satu skenario (rilis 300 m, emisi merata 24 jam), dan belum memakai peta gambut. Masukan dan keluaran model ada di folder `hasil_model` di luar folder ini. `data/aod.bin` adalah sisa data contoh dan tidak dipakai.

## Memasang di GitHub Pages

1. Buat repositori baru, lalu unggah **isi** folder ini (termasuk `.nojekyll`) ke cabang `main`.
2. Buka Settings → Pages, pilih sumber "Deploy from a branch", cabang `main`, folder `/ (root)`.
3. Tunggu sekitar satu menit; situs tampil di `https://<nama-pengguna>.github.io/<nama-repo>/`.

Untuk mencoba di komputer sendiri: `python -m http.server` di folder ini, lalu buka `http://localhost:8000`. Membuka `index.html` langsung dari berkas tidak akan memuat data.

## Fitur

- Peta sebaran asap per waktu dengan penggeser waktu, animasi, dan batang jumlah fasilitas terdampak.
- Daftar fasilitas terdampak pada waktu terpilih: pencarian, saring jenis, pilihan kelas ambang, unduh CSV.
- Rincian tiap fasilitas: kelas saat ini, lama terdampak, waktu pertama terdampak, grafik deret waktu.
- Analisis on-the-fly: faktor gambut dan kelompok sumber aktif (peta dihitung ulang sebagai jumlah terbobot komponen tiap kelompok sumber), serta bobot skor keterdampakan.
- Fasilitas berbentuk titik, garis (jalan), atau poligon; garis dan poligon memakai nilai sel tertinggi yang dilintasi.
- Validasi interaktif: peta cocok, luput, dan alarm palsu terhadap AOD dengan ambang yang bisa digeser, beserta FMS, POD, dan FAR.
- Simulasi cepat plume Gauss: pilih lokasi sumber di peta, atur arah dan kecepatan angin serta intensitas; fasilitas di dalam plume langsung didaftar.
- Layer: peta dasar, citra satelit harian, sebaran asap, fasilitas, sumber api, batas kabupaten; transparansi; legenda; skala.

## Format data (folder `data/`)

| Berkas | Isi |
|---|---|
| `meta.json` | `bbox` [barat, selatan, timur, utara]; `nx`, `ny`; `waktu_utc` (daftar waktu ISO, UTC); `kelompok` (id, nama, `gambut` true/false, lon, lat); `berkas`; `demo` |
| `tcm.bin` | Bilangan `uint16` little-endian, urutan: kelompok → waktu → baris (utara ke selatan) → kolom (barat ke timur). Nilainya sumbangan tiap kelompok sumber dengan emisi berbobot FRP, sebelum faktor gambut. Jumlah nilai harus `kelompok × waktu × ny × nx`. |
| `fasilitas.geojson` | Titik, garis, atau poligon dengan properti `id`, `nama`, `jenis` (`faskes`, `sekolah`, `bandara`, `pelabuhan`, `jalan`, `ibadah`, `kantor`, `utilitas`), `kelompok` (`sosial`/`vital`), `sensitivitas` (1–5), `distrik` |
| `aod.bin` | Opsional. `uint16`, urutan: citra → baris → kolom pada grid yang sama; nilai 0 berarti tanpa data (awan). Di `meta.json` tambahkan `"aod": {"berkas": "aod.bin", "skala": 0.001, "langkah": [...]}`; `langkah` berisi indeks waktu model untuk tiap citra. |
| `batas_kab_sorong.geojson` | Opsional. Bila ada, digambar sebagai garis batas dan peta dibuka pada cakupannya. |

`tools/buat_data_contoh.py` menunjukkan cara menulis ketiga berkas pertama; pakai sebagai pola saat mengonversi keluaran HYSPLIT (satu simulasi emisi satuan per kelompok sumber).

## Cara hitung di browser

- Indeks asap = jumlah terbobot komponen ÷ persentil ke-99 skenario awal, dibatasi 0–1.
- Kelas asap memakai persentil ke-50, 75, dan 90 dari indeks skenario awal (faktor gambut 3, semua sumber aktif). Ambang ini tetap saat bobot diubah, supaya perubahan terlihat. Angka persentil adalah asumsi kelompok; ubah di fungsi `acuan()` pada `js/app.js`.
- Fasilitas terdampak bila sel tempatnya berada mencapai kelas ambang yang dipilih.
- Skor = bobot sensitivitas × (sensitivitas ÷ 5) + bobot puncak × indeks puncak + bobot durasi × (langkah terdampak ÷ jumlah langkah).

- Validasi membandingkan sel model berkelas sedang ke atas dengan sel AOD di atas ambang, hanya pada sel yang punya AOD. Model yang dipakai adalah lapisan yang sama dengan peta; bila nanti lapisan kolom disimpan terpisah, bagian ini perlu disesuaikan.
- Plume Gauss memakai koefisien sebaran Briggs untuk kondisi netral, sumber di permukaan, dan angin seragam. Rumus itu lazimnya dipakai sampai sekitar 10 km dari sumber, jadi di luar jarak itu hasilnya hanya gambaran arah. Indeksnya relatif terhadap sumbu plume 10 km pada angin 3 m/s dan tidak setara dengan indeks model; fasilitas dihitung "di dalam plume" bila indeksnya minimal 0,1.

## Pustaka dan atribusi

Leaflet 1.9.4 dan Chart.js 4 disertakan di `lib/` agar situs tidak bergantung pada CDN. Peta dasar © OpenStreetMap contributors. Citra harian dari NASA GIBS (VIIRS NOAA-20); alamat layanannya belum diuji dari lingkungan pembuatan, jadi periksa layer itu setelah situs daring.

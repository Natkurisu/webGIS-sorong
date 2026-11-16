/* WebGIS Asap Karhutla Kabupaten Sorong - seluruh analisis dihitung di browser.
   Data: data/meta.json, data/tcm.bin, data/fasilitas.geojson (format di README.md). */
(function () {
  "use strict";

  const WARNA = ["#f1dfa6", "#e0a458", "#b5562b", "#5b2a3c"];
  const KELAS = ["Rendah", "Sedang", "Tinggi", "Sangat tinggi"];
  const JENIS = {
    faskes: "Fasilitas kesehatan", sekolah: "Sekolah", bandara: "Bandara", pelabuhan: "Pelabuhan",
    jalan: "Jalan utama", ibadah: "Tempat ibadah", kantor: "Kantor pemerintahan", utilitas: "Listrik dan air",
  };
  const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const AWAL = { gambut: 3, ws: 54, wi: 30, wd: 16, ambang: 2 };
  const $ = (id) => document.getElementById(id);

  const S = {              // keadaan aplikasi
    t: 0, gambut: AWAL.gambut, aktif: {}, ambang: AWAL.ambang, jenis: new Set(), cari: "", hanyaKena: true,
    alpha: 0.45, mode: "kelas", pilih: null, main: null, valid: false, pl: null, memilih: false,
  };
  let M, tcm, fas = [], ref = 1, q = [0.1, 0.3, 0.6], jamLangkah = 6;
  let peta, lapisAsap, lapisFas, lapisSumber, lapisBatas, lapisPlume, tandaPlume, dasar = {}, grafik = null, kanvas, aod = null;

  // ------------------------------------------------------------------ muat data
  Promise.all([
    fetch("data/meta.json").then(cek).then((r) => r.json()),
    fetch("data/fasilitas.geojson").then(cek).then((r) => r.json()),
  ]).then(([meta, gj]) => {
    M = meta;
    return fetch("data/" + M.berkas).then(cek).then((r) => r.arrayBuffer()).then((buf) => {
      tcm = new Uint16Array(buf);
      const harap = M.kelompok.length * M.waktu_utc.length * M.nx * M.ny;
      if (tcm.length !== harap) throw new Error("Ukuran " + M.berkas + " (" + tcm.length + " nilai) tidak cocok dengan meta.json (" + harap + ").");
      if (!M.aod) return mulai(gj);
      return fetch("data/" + M.aod.berkas).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => { if (b) aod = new Uint16Array(b); mulai(gj); });
    });
  }).catch((e) => {
    $("isi-fas").innerHTML = '<p class="kosong">Data tidak dapat dimuat: ' + e.message + " Periksa isi folder data.</p>";
  });
  function cek(r) { if (!r.ok) throw new Error(r.url.split("/").pop() + " tidak ditemukan."); return r; }

  // ------------------------------------------------------------------ hitungan inti
  const G = () => M.kelompok.length, T = () => M.waktu_utc.length, NC = () => M.nx * M.ny;
  function bobot() {
    return M.kelompok.map((g) => (S.aktif[g.id] ? (g.gambut ? S.gambut : 1) : 0));
  }
  function komposit(t, w) {            // jumlah terbobot seluruh kelompok sumber pada waktu t
    const nc = NC(), out = new Float32Array(nc), Tn = T();
    for (let g = 0; g < w.length; g++) {
      if (!w[g]) continue;
      const off = (g * Tn + t) * nc, wg = w[g];
      for (let i = 0; i < nc; i++) out[i] += wg * tcm[off + i];
    }
    return out;
  }
  function kelasDari(idx) { return idx <= 0.005 ? -1 : idx < q[0] ? 0 : idx < q[1] ? 1 : idx < q[2] ? 2 : 3; }
  function persentil(urut, p) { return urut.length ? urut[Math.min(urut.length - 1, Math.floor(p * urut.length))] : 0; }

  function acuan() {                   // normalisasi dan ambang kelas dari skenario awal; tetap selama sesi
    const w = M.kelompok.map((g) => (g.gambut ? AWAL.gambut : 1));
    const semua = [];
    for (let t = 0; t < T(); t++) { const k = komposit(t, w); for (let i = 0; i < k.length; i++) if (k[i] > 0) semua.push(k[i]); }
    semua.sort((a, b) => a - b);
    ref = persentil(semua, 0.99) || 1;
    const idx = semua.map((v) => Math.min(1, v / ref)).filter((v) => v > 0.005);
    q = [persentil(idx, 0.5), persentil(idx, 0.75), persentil(idx, 0.9)];
  }

  function siapkanFasilitas(gj) {
    const [w, s, e, n] = M.bbox, dx = (e - w) / M.nx, dy = (n - s) / M.ny, Tn = T(), nc = NC(), Gn = G();
    const selDari = (lon, lat) => { const c = Math.floor((lon - w) / dx), r = Math.floor((n - lat) / dy); return c >= 0 && c < M.nx && r >= 0 && r < M.ny ? r * M.nx + c : -1; };
    function selGeometri(g) {          // sel yang ditempati titik atau dilintasi garis/tepi poligon
      const set = new Set(), titik = (p) => { const i = selDari(p[0], p[1]); if (i >= 0) set.add(i); };
      const garis = (ks) => ks.forEach((b2, i) => {
        titik(b2); if (!i) return;
        const a2 = ks[i - 1], bagi = Math.ceil(Math.max(Math.abs(b2[0] - a2[0]) / dx, Math.abs(b2[1] - a2[1]) / dy) * 2);
        for (let k = 1; k < bagi; k++) titik([a2[0] + (b2[0] - a2[0]) * k / bagi, a2[1] + (b2[1] - a2[1]) * k / bagi]);
      });
      if (g.type === "Point") titik(g.coordinates);
      else if (g.type === "LineString") garis(g.coordinates);
      else if (g.type === "MultiLineString" || g.type === "Polygon") g.coordinates.forEach(garis);
      else if (g.type === "MultiPolygon") g.coordinates.forEach((pl) => pl.forEach(garis));
      return Array.from(set);
    }
    const wakil = (g) => {             // satu titik wakil untuk pop-up dan terbang ke lokasi
      let k = g.coordinates; while (Array.isArray(k[0][0])) k = k[0];
      return g.type === "Point" ? g.coordinates : k[Math.floor(k.length / 2)];
    };
    fas = gj.features.filter((f) => f.geometry).map((f) => {
      const p = f.properties || {}, sel = selGeometri(f.geometry), [lon, lat] = wakil(f.geometry);
      const komp = new Float32Array(sel.length * Gn * Tn);   // sumbangan tiap kelompok di tiap sel fasilitas, per waktu
      sel.forEach((ci, si) => { for (let g = 0; g < Gn; g++) for (let t = 0; t < Tn; t++) komp[(si * Gn + g) * Tn + t] = tcm[(g * Tn + t) * nc + ci]; });
      return { id: p.id, nama: p.nama || "Tanpa nama", jenis: p.jenis || "lain", kelompok: p.kelompok || "", distrik: p.distrik || "",
        sens: +p.sensitivitas || 1, lon, lat, geom: f.geometry, titik: f.geometry.type === "Point", nSel: sel.length, komp,
        idx: new Float32Array(Tn), kls: new Int8Array(Tn) };
    });
  }

  function hitungFasilitas() {         // deret indeks, kelas, durasi, puncak, dan skor tiap fasilitas
    const w = bobot(), Tn = T(), Gn = G();
    let ws = +$("w-s").value, wi = +$("w-i").value, wd = +$("w-d").value;
    const jum = ws + wi + wd || 1; ws /= jum; wi /= jum; wd /= jum;
    $("w-s-o").textContent = Math.round(ws * 100) + "%"; $("w-i-o").textContent = Math.round(wi * 100) + "%"; $("w-d-o").textContent = Math.round(wd * 100) + "%";
    fas.forEach((f) => {
      let puncak = 0, n = 0, awal = -1;
      for (let t = 0; t < Tn; t++) {
        let maks = 0;                    // garis dan poligon memakai nilai sel tertinggi yang dilintasi
        for (let si = 0; si < f.nSel; si++) {
          let v = 0;
          for (let g = 0; g < Gn; g++) if (w[g]) v += w[g] * f.komp[(si * Gn + g) * Tn + t];
          if (v > maks) maks = v;
        }
        const ix = Math.min(1, maks / ref);
        f.idx[t] = ix; f.kls[t] = kelasDari(ix);
        if (ix > puncak) puncak = ix;
        if (f.kls[t] >= S.ambang) { n++; if (awal < 0) awal = t; }
      }
      f.puncak = puncak; f.nKena = n; f.awal = awal;
      f.skor = n ? ws * (f.sens / 5) + wi * puncak + wd * (n / Tn) : 0;
    });
  }

  // ------------------------------------------------------------------ waktu
  function wit(iso) { return new Date(new Date(iso).getTime() + 9 * 3600e3); }
  function teksWaktu(t, pendek) {
    const d = wit(M.waktu_utc[t]);
    const jam = String(d.getUTCHours()).padStart(2, "0") + "." + String(d.getUTCMinutes()).padStart(2, "0");
    const tgl = d.getUTCDate() + " " + BULAN[d.getUTCMonth()] + (pendek ? "" : " " + d.getUTCFullYear());
    return tgl + ", " + jam + " WIT";
  }

  // ------------------------------------------------------------------ peta
  function buatPeta() {
    const [w, s, e, n] = M.bbox;
    peta = L.map("peta", { zoomControl: true, minZoom: 6, maxZoom: 14 }).setView([-1.05, 131.45], 9);
    const osm = "https://tile.openstreetmap.org/{z}/{x}/{y}.png", hak = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
    dasar.terang = L.tileLayer(osm, { attribution: hak, className: "ubin-terang" }).addTo(peta);   // OSM yang dipucatkan lewat CSS
    dasar.osm = L.tileLayer(osm, { attribution: hak });
    dasar.citra = L.tileLayer("", { attribution: "Citra: NASA GIBS, VIIRS NOAA-20", maxNativeZoom: 9 });
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(peta);
    peta.attributionControl.setPosition("topright").setPrefix(false);

    kanvas = document.createElement("canvas"); kanvas.width = M.nx; kanvas.height = M.ny;
    lapisAsap = L.imageOverlay(kanvas.toDataURL(), [[s, w], [n, e]], { opacity: 1 - S.alpha, className: "asap", interactive: false }).addTo(peta);

    lapisSumber = L.layerGroup(M.kelompok.map((g) =>
      L.circleMarker([g.lat, g.lon], { radius: 5, color: "#16302b", weight: 1.5, fillColor: "#ff7a1a", fillOpacity: 1 })
        .bindTooltip("Sumber api: " + g.nama))).addTo(peta);

    const kp = document.createElement("canvas"); kp.width = kp.height = 4;
    lapisPlume = L.imageOverlay(kp.toDataURL(), [[s, w], [n, e]], { opacity: 0.85, interactive: false });
    peta.on("click", (e) => {
      if (!S.memilih) return;
      S.pl = { lon: e.latlng.lng, lat: e.latlng.lat }; S.memilih = false;
      $("pl-pilih").setAttribute("aria-pressed", "false"); $("peta").classList.remove("memilih"); gambarPlume();
    });
    lapisFas = L.layerGroup().addTo(peta);
    fas.forEach((f) => {
      f.m = (f.titik ? L.circleMarker([f.lat, f.lon], { radius: 4 }) : L.geoJSON(f.geom)).bindTooltip(f.nama, { sticky: !f.titik });
      f.m.on("click", (e) => { L.DomEvent.stopPropagation(e); pilih(f, false); });
    });

    fetch("data/batas_kab_sorong.geojson").then((r) => (r.ok ? r.json() : null)).then((gj) => {
      if (!gj) { $("l-batas").closest("label").hidden = true; return; }
      lapisBatas = L.geoJSON(gj, { style: { color: "#16302b", weight: 1.5, fill: false, dashArray: "5 4" }, interactive: false }).addTo(peta);
      peta.fitBounds(lapisBatas.getBounds(), { padding: [20, 20] });
    }).catch(() => { $("l-batas").closest("label").hidden = true; });
  }

  function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  const RGB = WARNA.map(hex);
  function ramp(v) {                    // v 0..1 -> warna menerus
    const x = Math.max(0, Math.min(0.9999, v)) * 3, i = Math.floor(x), f = x - i, a = RGB[i], b = RGB[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  function gambarAsap() {
    const k = komposit(S.t, bobot()), ctx = kanvas.getContext("2d"), img = ctx.createImageData(M.nx, M.ny);
    const v = S.valid ? validasi(k) : null;
    gambarValidasi(v);
    const VW = [null, [15, 107, 92], [217, 164, 0], [59, 76, 192]];   // cocok, alarm palsu, luput
    for (let i = 0; i < k.length; i++) {
      let c, al;
      if (v) { if (!v.peta[i]) continue; c = VW[v.peta[i]]; al = 235; }
      else {
        const ix = Math.min(1, k[i] / ref), kl = kelasDari(ix);
        if (kl < 0) continue;
        c = S.mode === "kelas" ? RGB[kl] : ramp(ix); al = S.mode === "kelas" ? 235 : 110 + 145 * ix;
      }
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = al;
    }
    ctx.putImageData(img, 0, 0);
    lapisAsap.setUrl(kanvas.toDataURL());
  }

  // ------------------------------------------------------------------ validasi terhadap AOD
  function validasi(k) {
    const j = aod && M.aod ? M.aod.langkah.indexOf(S.t) : -1;
    if (j < 0) return null;
    const nc = NC(), amb = +$("v-aod").value, pt = new Int8Array(nc);
    let a = 0, b = 0, c = 0, nv = 0;
    for (let i = 0; i < nc; i++) {
      const mentah = aod[j * nc + i];
      if (!mentah) continue;             // 0 = tanpa data (awan)
      nv++;
      const obs = mentah * M.aod.skala >= amb, mod = kelasDari(Math.min(1, k[i] / ref)) >= 1;
      if (obs && mod) { a++; pt[i] = 1; } else if (mod) { b++; pt[i] = 2; } else if (obs) { c++; pt[i] = 3; }
    }
    return { a, b, c, nv, peta: pt };
  }
  function gambarValidasi(v) {
    const dl = $("v-angka"), pesan = $("v-pesan"), f2 = (x) => (isFinite(x) ? x.toFixed(2).replace(".", ",") : "\u2013");
    if (!aod) { dl.innerHTML = ""; pesan.textContent = "Data AOD belum tersedia. Tambahkan aod.bin dan bagian \"aod\" di meta.json (lihat README)."; return; }
    const hasil = v || (M.aod.langkah.indexOf(S.t) >= 0 ? validasi(komposit(S.t, bobot())) : null);
    if (!hasil) { dl.innerHTML = ""; pesan.textContent = "Tidak ada AOD pada waktu ini. AOD tersedia pada " + M.aod.langkah.length + " langkah waktu, misalnya " + teksWaktu(M.aod.langkah[0], true) + "."; return; }
    const { a, b, c, nv } = hasil;
    dl.innerHTML = [["FMS", f2(a / (a + b + c))], ["POD", f2(a / (a + c))], ["FAR", f2(b / (a + b))], ["Sel dengan AOD", nv]]
      .map((x) => "<div><dt>" + x[0] + "</dt><dd>" + x[1] + "</dd></div>").join("");
    pesan.textContent = "Cocok " + a + " sel, alarm palsu " + b + ", luput " + c + ".";
  }

  // ------------------------------------------------------------------ simulasi cepat plume Gauss
  function nilaiPlume(lon, lat, o) {     // indeks relatif 0..1 di satu lokasi; sigma Briggs, stabilitas netral
    const dE = (lon - S.pl.lon) * 111.32 * Math.cos(S.pl.lat * Math.PI / 180), dN = (lat - S.pl.lat) * 111.32;
    const x = (dE * o.ex + dN * o.en) * 1000, y = (-dE * o.en + dN * o.ex) * 1000;
    if (x < 50) return 0;
    const sy = 0.08 * x / Math.sqrt(1 + 0.0001 * x), sz = 0.06 * x / Math.sqrt(1 + 0.0015 * x);
    return Math.min(1, o.q / (Math.PI * o.u * sy * sz) * Math.exp(-y * y / (2 * sy * sy)) / o.acuan);
  }
  function gambarPlume() {
    const hasil = $("pl-hasil");
    if (!S.pl) { peta.removeLayer(lapisPlume); if (tandaPlume) peta.removeLayer(tandaPlume); hasil.textContent = ""; $("pl-hapus").hidden = true; return; }
    const ke = (+$("pl-arah").value + 180) * Math.PI / 180, u = +$("pl-u").value, q0 = +$("pl-q").value;
    const xr = 10000, syr = 0.08 * xr / Math.sqrt(1 + 0.0001 * xr), szr = 0.06 * xr / Math.sqrt(1 + 0.0015 * xr);
    const o = { ex: Math.sin(ke), en: Math.cos(ke), u, q: q0, acuan: 1 / (Math.PI * 3 * syr * szr) };   // acuan: sumbu plume 10 km, 3 m/s, intensitas 1
    const N = 200, rentang = 1.2, kv = document.createElement("canvas"); kv.width = kv.height = N;
    const ctx = kv.getContext("2d"), img = ctx.createImageData(N, N);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const ix = nilaiPlume(S.pl.lon - rentang + (c + 0.5) * 2 * rentang / N, S.pl.lat + rentang - (r + 0.5) * 2 * rentang / N, o);
      if (ix < 0.03) continue;
      const i = (r * N + c) * 4; img.data[i] = 59; img.data[i + 1] = 76; img.data[i + 2] = 192; img.data[i + 3] = 50 + 190 * Math.sqrt(ix);
    }
    ctx.putImageData(img, 0, 0);
    lapisPlume.setUrl(kv.toDataURL()); lapisPlume.setBounds([[S.pl.lat - rentang, S.pl.lon - rentang], [S.pl.lat + rentang, S.pl.lon + rentang]]).addTo(peta);
    if (tandaPlume) peta.removeLayer(tandaPlume);
    tandaPlume = L.circleMarker([S.pl.lat, S.pl.lon], { radius: 6, color: "#fff", weight: 2, fillColor: "#3b4cc0", fillOpacity: 1 }).bindTooltip("Sumber simulasi").addTo(peta);
    const kena = fas.filter((f) => nilaiPlume(f.lon, f.lat, o) >= 0.1).sort((a, b) => b.sens - a.sens);
    hasil.textContent = kena.length ? kena.length + " fasilitas di dalam plume: " + kena.slice(0, 6).map((f) => f.nama).join("; ") + (kena.length > 6 ? "; dan " + (kena.length - 6) + " lainnya." : ".")
      : "Tidak ada fasilitas di dalam plume ini.";
    $("pl-hapus").hidden = false;
  }

  function lolos(f) {
    if (!S.jenis.has(f.jenis)) return false;
    if (S.cari && (f.nama + " " + f.distrik).toLowerCase().indexOf(S.cari) < 0) return false;
    return true;
  }
  function gambarFasilitas() {
    lapisFas.clearLayers();
    if (!$("l-fas").checked) return;
    fas.filter(lolos).forEach((f) => {
      const kl = f.kls[S.t], kena = kl >= S.ambang, dipilih = S.pilih === f;
      if (f.titik) f.m.setStyle(kena
        ? { radius: dipilih ? 10 : 7, color: "#16302b", weight: dipilih ? 3 : 1.5, fillColor: WARNA[kl], fillOpacity: 1 }
        : { radius: dipilih ? 8 : 4, color: dipilih ? "#16302b" : "#6b7c77", weight: dipilih ? 3 : 1, fillColor: "#ffffff", fillOpacity: 0.95 });
      else f.m.setStyle({ color: kena ? WARNA[kl] : "#6b7c77", weight: (kena ? 5 : 2.5) + (dipilih ? 2 : 0), opacity: 1, fillOpacity: 0.15, dashArray: kena ? null : "6 5" });
      lapisFas.addLayer(f.m);
      if (kena) f.m.bringToFront();
    });
  }

  // ------------------------------------------------------------------ panel
  function terdaftar() {
    return fas.filter(lolos).filter((f) => !S.hanyaKena || f.kls[S.t] >= S.ambang)
      .sort((a, b) => (b.kls[S.t] >= S.ambang) - (a.kls[S.t] >= S.ambang) || b.skor - a.skor || a.nama.localeCompare(b.nama));
  }
  function gambarDaftar() {
    const ol = $("daftar"), baris = terdaftar(), dipantau = fas.filter(lolos);
    $("n-kena").textContent = dipantau.filter((f) => f.kls[S.t] >= S.ambang).length;
    $("n-total").textContent = dipantau.length;
    ol.textContent = "";
    baris.forEach((f) => {
      const kl = f.kls[S.t], kena = kl >= S.ambang;
      const li = document.createElement("li"), b = document.createElement("button");
      b.type = "button";
      b.innerHTML = '<span class="titik" style="background:' + (kena ? WARNA[kl] : "#fff") + '"></span>' +
        '<span><span class="d-nama"></span><br><span class="d-ket"></span></span><span class="d-skor"></span>';
      b.querySelector(".d-nama").textContent = f.nama;
      b.querySelector(".d-ket").textContent = (JENIS[f.jenis] || f.jenis) + ", " + (kl < 0 ? "tanpa asap" : "kelas " + KELAS[kl].toLowerCase());
      b.querySelector(".d-skor").textContent = f.skor ? "skor " + f.skor.toFixed(2).replace(".", ",") : "";
      b.addEventListener("click", () => pilih(f, true));
      li.appendChild(b); ol.appendChild(li);
    });
    const kosong = $("kosong");
    kosong.hidden = baris.length > 0;
    if (!baris.length) {
      kosong.textContent = !dipantau.length ? "Tidak ada fasilitas yang cocok dengan pencarian atau jenis yang dipilih."
        : "Tidak ada fasilitas terdampak pada waktu ini. Geser waktu, turunkan kelas ambang, atau hapus centang “Hanya yang terdampak”.";
    }
  }

  function gambarWaktu() {
    const Tn = T(), wadah = $("w-batang"), hitung = new Array(Tn).fill(0), cocok = fas.filter(lolos);
    for (let t = 0; t < Tn; t++) cocok.forEach((f) => { if (f.kls[t] >= S.ambang) hitung[t]++; });
    const maks = Math.max(1, ...hitung);
    if (wadah.children.length !== Tn) {
      wadah.textContent = "";
      for (let t = 0; t < Tn; t++) {
        const sp = document.createElement("span");
        if (t > 0 && wit(M.waktu_utc[t]).getUTCDate() !== wit(M.waktu_utc[t - 1]).getUTCDate()) sp.className = "hari";
        sp.addEventListener("click", () => setWaktu(t));
        wadah.appendChild(sp);
      }
    }
    for (let t = 0; t < Tn; t++) {
      const sp = wadah.children[t];
      sp.style.height = Math.max(6, (hitung[t] / maks) * 100) + "%";
      sp.classList.toggle("kini", t === S.t);
      sp.title = teksWaktu(t, true) + ": " + hitung[t] + " terdampak";
    }
    $("w-teks").textContent = teksWaktu(S.t);
    $("w-hitung").textContent = "Batang: jumlah fasilitas terdampak tiap " + jamLangkah + " jam";
    $("w-geser").value = S.t;
  }

  function gambarLegenda() {
    const pct = (v) => v.toFixed(2).replace(".", ",");
    let h = "<b>Indeks asap relatif</b>";
    if (S.mode === "kelas") {
      const batas = ["< " + pct(q[0]), pct(q[0]) + "–" + pct(q[1]), pct(q[1]) + "–" + pct(q[2]), "> " + pct(q[2])];
      KELAS.forEach((k, i) => { h += '<div><i style="background:' + WARNA[i] + '"></i>' + k + " (" + batas[i] + ")</div>"; });
    } else {
      h += '<div class="ramp"></div><div class="ujung"><span>0</span><span>1</span></div>';
    }
    h += '<hr><div><i class="bulat" style="background:' + WARNA[2] + '"></i>Fasilitas terdampak</div>' +
      '<div><i class="bulat" style="background:#fff"></i>Tidak terdampak</div>' +
      '<div><i class="bulat" style="background:#ff7a1a"></i>Kelompok sumber api</div>';
    if (S.valid) h = "<b>Model terhadap AOD</b>" + '<div><i style="background:#0f6b5c"></i>Cocok</div><div><i style="background:#d9a400"></i>Alarm palsu</div><div><i style="background:#3b4cc0"></i>Luput</div>' + h.slice(h.indexOf("<hr>"));
    $("legenda").innerHTML = h;
  }

  function pilih(f, terbang) {
    S.pilih = f;
    if (terbang) peta.flyTo([f.lat, f.lon], Math.max(peta.getZoom(), 11), { duration: 0.6 });
    gambarFasilitas(); gambarRinci();
  }
  function gambarRinci() {
    const f = S.pilih, kotak = $("rinci");
    if (!f) { kotak.hidden = true; return; }
    kotak.hidden = false;
    const kl = f.kls[S.t];
    $("r-nama").textContent = f.nama;
    $("r-meta").textContent = (JENIS[f.jenis] || f.jenis) + (f.kelompok ? ", fasilitas " + f.kelompok : "") + (f.distrik ? ", " + f.distrik : "");
    const isi = [
      ["Kelas saat ini", kl < 0 ? "Tanpa asap" : KELAS[kl]],
      ["Lama terdampak", f.nKena * jamLangkah + " jam"],
      ["Pertama terdampak", f.awal < 0 ? "Tidak pernah" : teksWaktu(f.awal, true)],
      ["Indeks puncak", f.puncak.toFixed(2).replace(".", ",")],
    ];
    $("r-angka").innerHTML = isi.map((x) => "<div><dt>" + x[0] + "</dt><dd>" + x[1] + "</dd></div>").join("");
    const label = M.waktu_utc.map((_, t) => teksWaktu(t, true));
    const batas = S.ambang === 1 ? q[0] : S.ambang === 2 ? q[1] : q[2];
    const data = {
      labels: label,
      datasets: [
        { label: "Indeks asap", data: Array.from(f.idx), borderColor: "#b5562b", backgroundColor: "rgba(181,86,43,.15)", fill: true, pointRadius: label.map((_, t) => (t === S.t ? 4 : 0)), pointBackgroundColor: "#16302b", borderWidth: 1.5, tension: 0.25 },
        { label: "Ambang terdampak", data: label.map(() => batas), borderColor: "#16302b", borderDash: [4, 3], borderWidth: 1, pointRadius: 0 },
      ],
    };
    if (grafik) { grafik.data = data; grafik.update("none"); return; }
    grafik = new Chart($("r-grafik"), {
      type: "line", data,
      options: { animation: false, responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 14, font: { size: 11 } } } },
        scales: { y: { min: 0, max: 1, ticks: { font: { size: 10 } } }, x: { ticks: { maxTicksLimit: 5, maxRotation: 0, font: { size: 10 } } } } },
    });
  }

  // ------------------------------------------------------------------ pembaruan
  function setWaktu(t) {
    S.t = Math.max(0, Math.min(T() - 1, t));
    gambarAsap(); gambarFasilitas(); gambarDaftar(); gambarWaktu(); gambarRinci(); citraHarian();
  }
  function hitungUlang() { hitungFasilitas(); setWaktu(S.t); }
  function citraHarian() {
    if (!peta.hasLayer(dasar.citra)) return;
    const tgl = M.waktu_utc[S.t].slice(0, 10);
    const url = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/" + tgl + "/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg";
    if (dasar.citra._url !== url) dasar.citra.setUrl(url);
  }

  function unduhCSV() {
    const kepala = ["id", "nama", "jenis", "kelompok", "distrik", "bujur", "lintang", "waktu_WIT", "kelas_saat_ini", "indeks_saat_ini", "jam_terdampak", "pertama_terdampak_WIT", "indeks_puncak", "skor"];
    const k = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const baris = terdaftar().map((f) => [f.id, f.nama, JENIS[f.jenis] || f.jenis, f.kelompok, f.distrik, f.lon, f.lat, teksWaktu(S.t),
      f.kls[S.t] < 0 ? "Tanpa asap" : KELAS[f.kls[S.t]], f.idx[S.t].toFixed(3), f.nKena * jamLangkah, f.awal < 0 ? "" : teksWaktu(f.awal), f.puncak.toFixed(3), f.skor.toFixed(3)].map(k).join(","));
    const blob = new Blob(["﻿" + kepala.join(",") + "\n" + baris.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "fasilitas_terdampak_" + M.waktu_utc[S.t].replace(/[:Z]/g, "") + ".csv";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ------------------------------------------------------------------ antarmuka
  function pasangAntarmuka() {
    // tab
    const tabs = [["tab-fas", "isi-fas"], ["tab-atur", "isi-atur"], ["tab-val", "isi-val"], ["tab-lapis", "isi-lapis"]];
    tabs.forEach(([tb, isi]) => $(tb).addEventListener("click", () => tabs.forEach(([a, b]) => {
      $(a).setAttribute("aria-selected", a === tb); $(b).hidden = b !== isi;
    })));
    $("buka").addEventListener("click", () => {
      const tutup = $("app").classList.toggle("tertutup");
      $("buka").setAttribute("aria-expanded", !tutup); setTimeout(() => peta.invalidateSize(), 50);
    });
    if (window.matchMedia("(max-width: 760px)").matches) { $("app").classList.add("tertutup"); $("buka").setAttribute("aria-expanded", "false"); }

    // jenis fasilitas
    const ada = Array.from(new Set(fas.map((f) => f.jenis)));
    ada.forEach((j) => {
      S.jenis.add(j);
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = JENIS[j] || j; b.setAttribute("aria-pressed", "true");
      b.addEventListener("click", () => {
        const on = !S.jenis.has(j); on ? S.jenis.add(j) : S.jenis.delete(j);
        b.setAttribute("aria-pressed", on); setWaktu(S.t);
      });
      $("jenis").appendChild(b);
    });

    $("cari").addEventListener("input", (e) => { S.cari = e.target.value.trim().toLowerCase(); setWaktu(S.t); });
    $("ambang").addEventListener("change", (e) => { S.ambang = +e.target.value; hitungUlang(); gambarLegenda(); });
    $("hanya-kena").addEventListener("change", (e) => { S.hanyaKena = e.target.checked; gambarDaftar(); });
    $("unduh").addEventListener("click", unduhCSV);

    // sumber emisi
    if (!M.kelompok.some((g) => g.gambut)) {      // tanpa peta gambut, faktor gambut tidak berpengaruh
      $("gambut").closest(".geser").hidden = true;
      $("isi-atur").querySelector(".ket").textContent = "Peta dihitung ulang langsung dari sumbangan tiap kelompok sumber. Faktor gambut belum tersedia karena peta gambut belum dimasukkan.";
    }
    M.kelompok.forEach((g) => {
      S.aktif[g.id] = true;
      const l = document.createElement("label"), c = document.createElement("input");
      c.type = "checkbox"; c.checked = true; c.dataset.id = g.id;
      c.addEventListener("change", () => { S.aktif[g.id] = c.checked; hitungUlang(); });
      l.appendChild(c); l.appendChild(document.createTextNode(g.nama));
      $("sumber").appendChild(l);
    });
    $("gambut").addEventListener("input", (e) => { S.gambut = +e.target.value; $("gambut-o").textContent = String(S.gambut).replace(".", ","); hitungUlang(); });
    ["w-s", "w-i", "w-d"].forEach((id) => $(id).addEventListener("input", () => { hitungFasilitas(); gambarDaftar(); }));
    $("reset").addEventListener("click", () => {
      S.gambut = AWAL.gambut; $("gambut").value = AWAL.gambut; $("gambut-o").textContent = AWAL.gambut;
      $("w-s").value = AWAL.ws; $("w-i").value = AWAL.wi; $("w-d").value = AWAL.wd;
      M.kelompok.forEach((g) => { S.aktif[g.id] = true; });
      $("sumber").querySelectorAll("input").forEach((c) => { c.checked = true; });
      hitungUlang();
    });

    // validasi dan plume
    $("v-aktif").addEventListener("change", (e) => { S.valid = e.target.checked; gambarAsap(); gambarLegenda(); });
    $("v-aod").addEventListener("input", (e) => { $("v-aod-o").textContent = (+e.target.value).toFixed(2).replace(".", ","); gambarAsap(); });
    $("pl-pilih").addEventListener("click", () => {
      S.memilih = !S.memilih; $("pl-pilih").setAttribute("aria-pressed", S.memilih); $("peta").classList.toggle("memilih", S.memilih);
      if (S.memilih && window.matchMedia("(max-width: 760px)").matches) $("buka").click();
    });
    [["pl-arah", ""], ["pl-u", ""], ["pl-q", ""]].forEach(([id]) => $(id).addEventListener("input", (e) => { $(id + "-o").textContent = String(e.target.value).replace(".", ","); gambarPlume(); }));
    $("pl-hapus").addEventListener("click", () => { S.pl = null; gambarPlume(); });

    // layer
    document.querySelectorAll('input[name="dasar"]').forEach((r) => r.addEventListener("change", () => {
      Object.keys(dasar).forEach((k) => peta.removeLayer(dasar[k]));
      dasar[r.value].addTo(peta).bringToBack(); citraHarian();
    }));
    const saklar = (id, lapis) => $(id).addEventListener("change", (e) => { const l = lapis(); if (l) e.target.checked ? l.addTo(peta) : peta.removeLayer(l); });
    saklar("l-asap", () => lapisAsap); saklar("l-sumber", () => lapisSumber); saklar("l-batas", () => lapisBatas);
    $("l-fas").addEventListener("change", gambarFasilitas);
    $("alpha").addEventListener("input", (e) => { S.alpha = e.target.value / 100; $("alpha-o").textContent = e.target.value; lapisAsap.setOpacity(1 - S.alpha); });
    document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", () => { S.mode = r.value; gambarAsap(); gambarLegenda(); }));

    // waktu
    $("w-geser").max = T() - 1;
    $("w-geser").addEventListener("input", (e) => setWaktu(+e.target.value));
    $("putar").addEventListener("click", () => {
      if (S.main) { clearInterval(S.main); S.main = null; $("putar").textContent = "▶"; $("putar").setAttribute("aria-label", "Putar animasi"); return; }
      $("putar").textContent = "❚❚"; $("putar").setAttribute("aria-label", "Hentikan animasi");
      S.main = setInterval(() => setWaktu((S.t + 1) % T()), 800);
    });
    $("tutup-rinci").addEventListener("click", () => { S.pilih = null; gambarRinci(); gambarFasilitas(); });
    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input, select, textarea")) return;
      if (e.key === "ArrowRight") setWaktu(S.t + 1);
      if (e.key === "ArrowLeft") setWaktu(S.t - 1);
    });
  }

  function mulai(gj) {
    if (M.waktu_utc.length > 1) jamLangkah = (new Date(M.waktu_utc[1]) - new Date(M.waktu_utc[0])) / 3600e3;
    $("demo").hidden = !M.demo;
    $("catatan-data").textContent = M.catatan || "";
    acuan(); siapkanFasilitas(gj); buatPeta(); pasangAntarmuka(); gambarLegenda(); hitungFasilitas();
    // buka pada waktu dengan fasilitas terdampak terbanyak
    let terbaik = 0, maks = -1;
    for (let t = 0; t < T(); t++) { const n = fas.filter((f) => f.kls[t] >= S.ambang).length; if (n > maks) { maks = n; terbaik = t; } }
    setWaktu(terbaik);
    window.__webgis = { S, fas, M, q: () => q, setWaktu, validasi: () => validasi(komposit(S.t, bobot())) };   // untuk pemeriksaan
  }
})();

#!/usr/bin/env python3
"""Membuat DATA CONTOH (sintetis) untuk WebGIS. Bukan hasil HYSPLIT.

Ganti keluaran skrip ini dengan hasil model yang sebenarnya; format berkas dijelaskan di README.md.
Jalankan dari folder situs:  python3 tools/buat_data_contoh.py
"""
import json, math, random, struct
from datetime import datetime, timedelta, timezone

random.seed(7)
W, S, E, N = 129.0, -4.5, 135.5, 0.5
RES = 0.1
NX, NY = round((E - W) / RES), round((N - S) / RES)
T0 = datetime(2026, 10, 1, 0, tzinfo=timezone.utc)
TIMES = [T0 + timedelta(hours=6 * i) for i in range(40)]

# kelompok sumber: (id, nama, gambut, bujur, lintang, kekuatan relatif ~ jumlah titik panas)
GROUPS = [
    ("sorsel_g", "Sorong Selatan (gambut)", True, 132.05, -1.75, 150),
    ("sorsel_n", "Sorong Selatan (non-gambut)", False, 132.20, -1.45, 125),
    ("rajaampat", "Raja Ampat", False, 130.90, -1.15, 186),
    ("maybrat", "Maybrat", False, 132.45, -1.30, 34),
    ("kabsorong_g", "Kabupaten Sorong (gambut)", True, 131.30, -1.40, 3),
    ("kabsorong_n", "Kabupaten Sorong (non-gambut)", False, 131.55, -1.10, 4),
    ("tambrauw", "Tambrauw", False, 132.50, -0.75, 20),
    ("kotasorong", "Kota Sorong", False, 131.29, -0.90, 1),
]

def wind(i):
    """arah tujuan angin (derajat dari timur, berlawanan jarum jam) dan jangkauan plume."""
    d = 140 + 50 * math.sin(i / 6.0) + 15 * math.sin(i / 2.3)   # rata-rata menuju barat laut
    reach = 1.6 + 0.5 * math.sin(i / 4.0)
    return math.radians(d), reach

def emis(i):
    day = i / 4.0
    peak = math.exp(-((day - 4.5) / 2.6) ** 2)                 # puncak sekitar 5-6 Okt
    diurnal = [0.6, 1.3, 1.0, 0.5][i % 4]                      # 00,06,12,18 UTC
    return (0.25 + peak) * diurnal

vals = []
for gid, name, peat, lon0, lat0, q in GROUPS:
    for i in range(len(TIMES)):
        th, reach = wind(i)
        ux, uy = math.cos(th), math.sin(th)
        em = emis(i) * q
        for r in range(NY):
            lat = N - (r + 0.5) * RES
            for c in range(NX):
                lon = W + (c + 0.5) * RES
                dx, dy = lon - lon0, lat - lat0
                along = dx * ux + dy * uy
                cross = -dx * uy + dy * ux
                if along < -0.15:
                    vals.append(0.0); continue
                a = max(along, 0.0)
                sig = 0.07 + 0.16 * a
                v = em / sig * math.exp(-cross * cross / (2 * sig * sig)) * math.exp(-a / reach)
                if along < 0:
                    v *= math.exp(-(along / 0.07) ** 2)
                vals.append(v)
vmax = max(vals)
scale = vmax / 65535.0
with open("data/tcm.bin", "wb") as f:
    f.write(struct.pack("<%dH" % len(vals), *[min(65535, round(v / scale)) for v in vals]))

meta = {
    "demo": True,
    "catatan": "Data contoh sintetis untuk menguji tampilan. Bukan hasil HYSPLIT.",
    "bbox": [W, S, E, N], "nx": NX, "ny": NY,
    "waktu_utc": [t.strftime("%Y-%m-%dT%H:%MZ") for t in TIMES],
    "kelompok": [{"id": g[0], "nama": g[1], "gambut": g[2], "lon": g[3], "lat": g[4]} for g in GROUPS],
    "skala": scale, "berkas": "tcm.bin", "tipe": "uint16",
}
# AOD contoh: satu citra per hari (langkah 06 UTC), berasal dari komposit yang digeser + derau, dengan lubang awan
NC, NT, AOD_SKALA = NX * NY, len(TIMES), 0.001
def komp(t):
    out = [0.0] * NC
    for gi, g in enumerate(GROUPS):
        wg = 3.0 if g[2] else 1.0
        off = (gi * NT + t) * NC
        for i in range(NC): out[i] += wg * vals[off + i]
    return out
semua = sorted(v for t in range(NT) for v in komp(t) if v > 0)
p99 = semua[int(0.99 * len(semua))]
langkah, aod = [t for t in range(NT) if t % 4 == 1], []
for t in langkah:
    k = komp(t); ph = random.random() * 6
    for r in range(NY):
        for c in range(NX):
            awan = math.sin(c / 5.0 + ph) * math.cos(r / 4.0 - ph) + random.gauss(0, 0.25) > 0.45
            src = k[r * NX + min(NX - 1, c + 1)]                       # geser satu sel agar tidak identik dengan model
            a = 0.12 + 1.7 * min(1.0, src / p99) + random.gauss(0, 0.07)
            aod.append(0 if awan else max(1, round(a / AOD_SKALA)))
with open("data/aod.bin", "wb") as f:
    f.write(struct.pack("<%dH" % len(aod), *aod))
meta["aod"] = {"berkas": "aod.bin", "skala": AOD_SKALA, "langkah": langkah}
json.dump(meta, open("data/meta.json", "w"), ensure_ascii=False, indent=1)

# fasilitas contoh di sekitar Kabupaten Sorong (posisi dan nama rekaan)
PUSAT = [("Aimas", 131.32, -0.98, 14), ("Mariat", 131.38, -1.02, 8), ("Klamono", 131.50, -1.12, 6),
         ("Salawati", 131.12, -1.22, 6), ("Seget", 131.25, -1.40, 5), ("Makbon", 131.52, -0.74, 5),
         ("Sayosa", 131.78, -0.96, 4), ("Beraur", 131.70, -1.26, 4), ("Klaso", 131.62, -0.82, 4)]
JENIS = [("faskes", "Puskesmas", 5, "sosial", 0.16), ("sekolah", "Sekolah", 4, "sosial", 0.36),
         ("bandara", "Lapangan terbang", 4, "vital", 0.03), ("pelabuhan", "Dermaga", 3, "vital", 0.07),
         ("ibadah", "Tempat ibadah", 2, "sosial", 0.20), ("kantor", "Kantor distrik", 2, "vital", 0.10),
         ("utilitas", "Instalasi listrik/air", 1, "vital", 0.08)]
feats, n = [], 0
for nama, lon, lat, k in PUSAT:
    for j in range(k):
        x = random.random(); acc = 0
        for kode, label, sens, kel, p in JENIS:
            acc += p
            if x <= acc: break
        n += 1
        feats.append({"type": "Feature",
                      "geometry": {"type": "Point", "coordinates": [round(lon + random.gauss(0, 0.045), 5), round(lat + random.gauss(0, 0.035), 5)]},
                      "properties": {"id": "F%03d" % n, "nama": "%s contoh %d %s" % (label, j + 1, nama), "jenis": kode,
                                     "kelompok": kel, "sensitivitas": sens, "distrik": nama}})
for nm, ks in [("Jalan contoh Aimas\u2013Klamono\u2013Beraur", [[131.30, -0.94], [131.40, -1.03], [131.50, -1.12], [131.70, -1.26]]),
               ("Jalan contoh Aimas\u2013Makbon", [[131.32, -0.98], [131.42, -0.86], [131.52, -0.74]])]:
    n += 1
    feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": ks},
                  "properties": {"id": "F%03d" % n, "nama": nm, "jenis": "jalan", "kelompok": "vital", "sensitivitas": 3, "distrik": "Lintas distrik"}})
json.dump({"type": "FeatureCollection", "features": feats}, open("data/fasilitas.geojson", "w"), ensure_ascii=False)
print("sel", NX, NY, "langkah", len(TIMES), "kelompok", len(GROUPS), "fasilitas", len(feats), "byte", len(vals) * 2)

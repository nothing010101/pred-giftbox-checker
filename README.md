# pred-giftbox-checker

Cek reward **PRED ($100K Gift Box / Surprise Box)** untuk ratusan alamat wallet sekaligus —
versi web (deploy ke Vercel) dan versi CLI.

Read-only. Tidak perlu login, API key, atau connect wallet.

## Versi Web (Vercel)

Halaman statis + satu serverless function sebagai proxy.

```
index.html      <- UI (statis, tanpa dependency)
api/pred.py     <- proxy ke pred.app (Python, stdlib saja)
vercel.json     <- konfigurasi function
```

**Fitur**

- Tempel daftar alamat atau upload `.txt` / `.csv` (auto-deteksi kolom `wallet_address`)
- Cek massal dengan **jeda 400ms per alamat**
- ✅ / ❌ per alamat, baris yang ada hadiah di-highlight hijau
- **Tombol salin alamat** di setiap baris
- Progress bar + Stop di tengah jalan
- Ringkasan: total dicek, ada hadiah, kosong, error, total reward USD, breakdown tier
- Filter: Semua / Ada hadiah / Kosong / Error
- Export CSV
- **Hasil disimpan di localStorage** — aman di-refresh, dan "Lewati yang sudah dicek"
  membuat pengecekan bisa dilanjutkan tanpa mengulang dari awal

**Deploy**: connect repo ini ke Vercel, root directory default, tanpa konfigurasi tambahan.

### Kenapa ada proxy?

Awalnya `index.html` memanggil `www.pred.app` langsung dari browser. Itu gagal dengan
`Failed to fetch` di beberapa jaringan — request-nya diblokir di sisi klien (pemblokiran
DNS/ISP, ad-blocker, atau CSP dari lingkungan preview), bukan oleh pred.app.

Sekarang browser hanya berbicara dengan domain Vercel, dan **server Vercel** yang mengambil
data dari pred.app. Efeknya: pemblokiran di sisi klien tidak lagi relevan, dan CORS hilang
sama sekali karena semuanya same-origin.

Halaman tetap punya **fallback**: kalau `/api/pred` tidak ada (misalnya `index.html` dibuka
lokal lewat `file://`), otomatis kembali memanggil pred.app langsung. Mode yang sedang aktif
ditampilkan di bawah tombol.

## Versi CLI

```bash
python3 pred_giftbox_check.py addresses.txt
python3 pred_giftbox_check.py wallets.csv --column address
python3 pred_giftbox_check.py --addresses 0xaaa...,0xbbb...
python3 pred_giftbox_check.py addresses.txt --out results.csv --workers 8
```

Python 3.8+, stdlib saja.

## Endpoint proxy

```
GET /api/pred
    -> { "id": "<campaign_id>", "name": "...", "end_date": "..." }

GET /api/pred?campaign_id=<id>&wallet_address=0x...
    -> { "eligible": true, "tier": "Tier 1", "reward_value": "200", "reward_type": "USD" }
```

## Cara kerja

Tombol `Check Now` di pred.app memanggil endpoint **publik tanpa autentikasi**:

```
GET https://www.pred.app/api/v1/campaigns/{campaign_id}/reward-eligibility?wallet_address=0x...
```

Campaign id diambil dari `GET /api/v1/campaigns/active`
(saat ini `1b48ffb5-cc02-4663-95aa-de7c863ecd92` — "Double Your 1st Win").

Endpoint itu mengembalikan `access-control-allow-origin: *`, jadi CORS sebenarnya bukan
masalah. Yang bermasalah adalah jangkauan jaringan dari perangkat pengunjung.

> `mainnet.pred.app` (base URL yang di-hardcode di bundle web pred.app) tidak resolve publik.
> API-nya diakses lewat reverse proxy `www.pred.app/api/...`.

## Tes

**Tes unit** (mock fetch, cepat):

```bash
npm install jsdom
node test_web.js          # 38 assertion
```

**Tes integrasi nyata** (halaman asli + function asli + API pred.app sungguhan):

```bash
python3 dev_server.py 8765 &
node test_live.js         # 15 assertion
```

`dev_server.py` menyajikan `index.html` dan memakai ulang `api/pred.py` yang sama persis
seperti di Vercel, jadi jalur proxy ikut teruji.

## Batasan & penggunaan yang bertanggung jawab

Tool ini hanya **membaca** eligibility. Tidak melakukan registrasi, autentikasi, atau klaim.

Jeda 400ms dipilih supaya tidak membebani server pred.app — jangan diturunkan.

Klaim massal lintas ratusan wallet adalah titik risiko akunnya — aturan PRED satu akun per
orang, dan reward farming lintas wallet bisa membuat semua alamat yang terlibat kena
blacklist, termasuk yang isinya saldo asli. Cek boleh; klaim hati-hati.

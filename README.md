# pred-giftbox-checker

Cek reward **PRED ($100K Gift Box / Surprise Box)** untuk ratusan alamat wallet sekaligus —
versi web (deploy ke Vercel) dan versi CLI.

Read-only. Tidak perlu login, API key, atau connect wallet.

## Versi Web (Vercel)

`index.html` — satu file, tanpa dependency, tanpa build step. Vercel otomatis
mendeteksinya sebagai static site.

**Fitur**

- Tempel daftar alamat atau upload `.txt` / `.csv` (auto-deteksi kolom `wallet_address`)
- Cek massal dengan **jeda 400ms per alamat** (santai terhadap rate limit)
- ✅ / ❌ per alamat, baris yang ada hadiah di-highlight hijau
- **Tombol salin alamat** di setiap baris
- Progress bar + Stop di tengah jalan
- Ringkasan: total dicek, ada hadiah, kosong, error, total reward USD, breakdown tier
- Filter: Semua / Ada hadiah / Kosong / Error
- Export CSV
- **Hasil disimpan di localStorage** — aman di-refresh, dan "Lewati yang sudah dicek"
  membuat pengecekan bisa dilanjutkan tanpa mengulang dari awal

**Deploy**: connect repo ini ke Vercel, root directory default. Selesai — tidak ada
konfigurasi tambahan. Jalan juga di GitHub Pages / Netlify (hosting statis apa pun).

## Versi CLI

```bash
python3 pred_giftbox_check.py addresses.txt
python3 pred_giftbox_check.py wallets.csv --column address
python3 pred_giftbox_check.py --addresses 0xaaa...,0xbbb...
python3 pred_giftbox_check.py addresses.txt --out results.csv --workers 8
```

Output CSV: `address, eligible, tier, reward_value, reward_type, status, note`,
plus ringkasan di stdout. Python 3.8+, stdlib saja.

## Cara kerja

Tombol `Check Now` di pred.app memanggil endpoint **publik tanpa autentikasi**:

```
GET https://www.pred.app/api/v1/campaigns/{campaign_id}/reward-eligibility?wallet_address=0x...
```

```json
{ "eligible": true, "tier": "Tier 1", "reward_value": "200", "reward_type": "USD" }
```

Campaign id diambil otomatis dari `GET /api/v1/campaigns/active`
(saat ini `1b48ffb5-cc02-4663-95aa-de7c863ecd92` — "Double Your 1st Win").

**Catatan penting soal CORS**: endpoint-nya mengembalikan `access-control-allow-origin: *`,
jadi browser boleh memanggilnya langsung dari domain mana pun. Itulah sebabnya versi web
ini cukup satu file HTML dan tidak butuh serverless function / proxy.

> `mainnet.pred.app` (base URL yang di-hardcode di bundle web pred.app) tidak resolve publik.
> API-nya diakses lewat reverse proxy `www.pred.app/api/...`, yang dipakai oleh kedua versi
> di repo ini.

## Tes

```bash
npm install jsdom
node test_web.js
```

37 assertion yang mencakup: boot, pengecekan, centang, tombol salin, localStorage,
resume setelah refresh, filter, export CSV, parsing upload CSV, dan alamat tidak valid.

## Batasan & penggunaan yang bertanggung jawab

Tool ini hanya **membaca** eligibility. Tidak melakukan registrasi, autentikasi, atau klaim.

Jeda 400ms dipilih supaya tidak membebani server pred.app. Menjalankan ini dari browser
artinya request keluar dari IP kamu sendiri, jadi jangan turunkan jedanya.

Klaim massal lintas ratusan wallet adalah titik risiko akunnya — aturan PRED satu akun per
orang, dan reward farming lintas wallet bisa membuat semua alamat yang terlibat kena
blacklist, termasuk yang isinya saldo asli. Cek boleh; klaim hati-hati.

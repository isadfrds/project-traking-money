# MoneyTrack

Frontend: HTML + Tailwind + JS (Vercel). Backend: Django (Render/Railway). Database: PostgreSQL di Neon.

## Fitur
- Catat pemasukan & pengeluaran, filter, pencarian, pagination (10 per halaman)
- **Saldo tidak bisa minus**: pengeluaran, edit, hapus, setor target, dan pemulihan data semuanya dicek di backend (dan dicek cepat di browser)
- **Login bertahan 30 hari**: kalau sudah login, halaman login/daftar langsung masuk ke dashboard
- Setelah daftar, user diarahkan ke halaman login (tidak otomatis masuk)
- Anggaran mingguan / dua mingguan / bulanan
- **Target tabungan**: setor, tarik, hapus (dana kembali ke saldo)
- Grafik kategori pengeluaran + **tren 6 bulan**
- Ekspor **PDF** dan **CSV**
- **Ubah password**
- Tampilan responsif: menu bawah + kartu transaksi di HP, sidebar + tabel di desktop

## Aturan saldo
Saldo = total pemasukan - total pengeluaran (setoran ke target dihitung sebagai pengeluaran,
tarikan dari target sebagai pemasukan). Setoran/tarikan target tidak dihitung di total
"Pemasukan/Pengeluaran" dan grafik, tapi tetap memengaruhi saldo.

## Menjalankan lokal
1. `cd Backend`, salin `.env.example` jadi `.env`, isi `SECRET_KEY` (dan `DATABASE_URL` Neon bila mau; kosongkan untuk SQLite lokal).
2. `pip install -r requirements.txt`
3. `python manage.py migrate` lalu `python manage.py runserver` (port 8000)
4. Buka `Frontend/login.html` dengan Live Server (port 5500). Buka lewat `127.0.0.1` atau `localhost`, jangan dicampur.

Menjalankan tes backend: `python manage.py test` (24 tes: aturan saldo, target tabungan, reset/pulihkan, login/daftar, CSRF).

## Deploy backend (Render)
- Root Directory: `Backend`
- Build Command: `bash build.sh` (otomatis menjalankan migrasi, termasuk tabel target tabungan yang baru)
- Start Command: `gunicorn config.wsgi:application`
- Environment variables:
  - `SECRET_KEY` = string acak panjang
  - `DEBUG` = `False`
  - `DATABASE_URL` = connection string Neon (ada `sslmode=require`)
  - `ALLOWED_HOSTS` = domain backend, mis. `moneytrack-api.onrender.com`
  - `CSRF_TRUSTED_ORIGINS` = `https://domain-vercel-kamu.vercel.app`
  - `CORS_ALLOWED_ORIGINS` = `https://domain-vercel-kamu.vercel.app`
- Cek: buka `https://domain-backend/api/health/`, harus muncul `{"status": "ok", ...}`.

## Deploy frontend (Vercel)
- Root Directory: `Frontend`
- Edit `Frontend/vercel.json`: ganti `GANTI-DENGAN-DOMAIN-BACKEND-KAMU` dengan domain backend (tanpa `https://`, tanpa `/api`).
- Push ke GitHub, Vercel deploy otomatis.

## Keamanan
- Jangan commit file `.env` (sudah ada di `.gitignore`).
- Kalau password database pernah terkirim/terbagikan, reset di dashboard Neon lalu perbarui `DATABASE_URL`.

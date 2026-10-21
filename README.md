# MoneyTrack

Frontend: HTML + Tailwind + JS (Vercel). Backend: Django (Render/Railway). Database: PostgreSQL di Neon.

## Menjalankan lokal
1. `cd Backend`, salin `.env.example` jadi `.env`, isi `SECRET_KEY` (dan `DATABASE_URL` Neon bila mau).
2. `pip install -r requirements.txt`
3. `python manage.py migrate` lalu `python manage.py runserver` (port 8000)
4. Buka `Frontend/login.html` dengan Live Server (port 5500). Buka lewat `127.0.0.1` atau `localhost`, jangan dicampur.

## Deploy backend (Render)
- Root Directory: `Backend`
- Build Command: `bash build.sh`
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

# OtterHub Node.js VPS backend

This is the standalone Node.js API used by the VPS release workflow. It serves `frontend/out`, stores metadata in SQLite, and keeps files/chunks on the VPS. Run it behind Nginx and HTTPS.

For local development, build the frontend, install this package, and copy `.env.example` to `.env`. From this directory, change `APP_ENV` to `development`, clear `BASIC_USER` and `BASIC_PASS`, and set `DATA_DIR=./data`, `DATABASE_PATH=./data/otterhub.sqlite3`, `STORAGE_DIR=./data/files`, `CHUNKS_DIR=./data/chunks`, `TEMP_UPLOAD_DIR=./data/uploads`, and `FRONTEND_DIR=../frontend/out`.

```bash
npm ci
npm test
npm start
```

The service listens on `127.0.0.1:8000` by default. See the root `README.md` for VPS bootstrap, environment variables, secrets, and release instructions.

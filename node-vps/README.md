# OtterHub Node.js VPS backend

This is the standalone Node.js API used by the VPS release workflow. It serves `frontend/out` and stores metadata/albums in SQLite through `sql.js` WebAssembly. Set `STORAGE_BACKEND=telegram` with `TG_BOT_TOKEN` and `TG_CHAT_ID` to store uploaded file bytes in the configured Telegram chat, matching the original Worker adapter; the metadata database remains on the VPS. Without Telegram settings, local disk storage remains available. Telegram file messages are not removed when an entry is deleted, matching the original Worker behavior. The backend does not need a native SQLite addon, compiler, or GLIBC-specific prebuild. Use Node.js 18 or newer for the API; the separately built Next.js frontend requires Node.js 20.9 or newer.

Run the frontend build in CI or on a compatible development machine before deploying. The release archive already contains `frontend/out`, so the VPS does not need to compile Next.js during startup. For local development, install this package and copy `.env.example` to `.env`. From this directory, change `APP_ENV` to `development`, clear `BASIC_USER` and `BASIC_PASS`, and set `DATA_DIR=./data`, `DATABASE_PATH=./data/otterhub.sqlite3`, `STORAGE_DIR=./data/files`, `CHUNKS_DIR=./data/chunks`, `TEMP_UPLOAD_DIR=./data/uploads`, and `FRONTEND_DIR=../frontend/out`.

```bash
npm ci
npm test
npm start
```

The service listens on `127.0.0.1:8000` by default. See the root `README.md` for VPS bootstrap, environment variables, secrets, and release instructions.

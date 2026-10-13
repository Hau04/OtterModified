'use strict';

const path = require('node:path');

function parseInteger(value, fallback, name, minimum = 1) {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return parsed;
}

function loadConfig(env = process.env) {
  const appEnv = String(env.APP_ENV || 'development').trim().toLowerCase();
  const basicUser = String(env.BASIC_USER || '');
  const basicPass = String(env.BASIC_PASS || '');
  if (
    appEnv === 'production' &&
    (!basicUser || basicUser.includes(':') || !basicPass ||
      basicUser === 'change-me' || basicPass === 'replace-with-a-long-random-password')
  ) {
    throw new Error('Set non-placeholder BASIC_USER and BASIC_PASS before production startup');
  }

  const telegramBotToken = String(env.TG_BOT_TOKEN || '').trim();
  const telegramChatId = String(env.TG_CHAT_ID || '').trim();
  const requestedStorageBackend = String(env.STORAGE_BACKEND || '').trim().toLowerCase();
  const storageBackend = requestedStorageBackend ||
    (telegramBotToken || telegramChatId ? 'telegram' : 'local');
  if (!['local', 'telegram'].includes(storageBackend)) {
    throw new Error('STORAGE_BACKEND must be either local or telegram');
  }
  if (storageBackend === 'telegram' && (!telegramBotToken || !telegramChatId)) {
    throw new Error('Set both TG_BOT_TOKEN and TG_CHAT_ID to use Telegram storage');
  }

  const repoRoot = path.resolve(__dirname, '../..');
  const dataDir = path.resolve(env.DATA_DIR || path.join(__dirname, '../data'));
  const maxFileCount = parseInteger(env.MAX_FILE_COUNT, 1000, 'MAX_FILE_COUNT', 0);
  const maxChunkCount = parseInteger(env.MAX_CHUNK_COUNT, 50, 'MAX_CHUNK_COUNT', 1);
  const telegramTimeoutMs = parseInteger(env.TELEGRAM_TIMEOUT_MS, 60_000, 'TELEGRAM_TIMEOUT_MS', 1);
  const port = parseInteger(env.PORT, 8000, 'PORT', 1);
  if (port > 65535) throw new Error('PORT must be between 1 and 65535');

  return Object.freeze({
    appEnv,
    host: env.HOST || '127.0.0.1',
    port,
    dataDir,
    databasePath: path.resolve(env.DATABASE_PATH || path.join(dataDir, 'otterhub.sqlite3')),
    storageDir: path.resolve(env.STORAGE_DIR || path.join(dataDir, 'files')),
    chunksDir: path.resolve(env.CHUNKS_DIR || path.join(dataDir, 'chunks')),
    tempUploadDir: path.resolve(env.TEMP_UPLOAD_DIR || path.join(dataDir, 'uploads')),
    frontendDir: path.resolve(env.FRONTEND_DIR || path.join(repoRoot, 'frontend', 'out')),
    basicUser,
    basicPass,
    storageBackend,
    telegramBotToken,
    telegramChatId,
    telegramTimeoutMs,
    maxUploadSizeBytes: parseInteger(
      env.MAX_UPLOAD_SIZE_BYTES,
      1024 * 1024 * 1024,
      'MAX_UPLOAD_SIZE_BYTES',
    ),
    chunkSizeBytes: parseInteger(env.CHUNK_SIZE_BYTES, 20 * 1024 * 1024, 'CHUNK_SIZE_BYTES'),
    maxChunkCount,
    maxFileCount,
    corsOrigins: String(env.CORS_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  });
}

module.exports = { loadConfig };

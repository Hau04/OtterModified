'use strict';

const path = require('node:path');

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MAX_UPLOAD_ATTEMPTS = 3;
const TELEGRAM_FILE_PREFIX = 'telegram-file:';
const TELEGRAM_CHUNKS_PREFIX = 'telegram-chunks:';

function encodeTelegramChunks(chunks) {
  return `${TELEGRAM_CHUNKS_PREFIX}${Buffer.from(JSON.stringify(chunks)).toString('base64url')}`;
}

function decodeTelegramChunks(storagePath) {
  if (typeof storagePath !== 'string' || !storagePath.startsWith(TELEGRAM_CHUNKS_PREFIX)) return null;
  try {
    const encoded = storagePath.slice(TELEGRAM_CHUNKS_PREFIX.length);
    const chunks = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!Array.isArray(chunks)) return null;
    return chunks.every((chunk) =>
      Number.isInteger(chunk.idx) && typeof chunk.fileId === 'string' &&
      Number.isSafeInteger(chunk.size) && chunk.size >= 0,
    ) ? chunks : null;
  } catch {
    return null;
  }
}

function describeMedia(contentType, fileName) {
  const mimeType = String(contentType || '').toLowerCase();
  const extension = path.extname(String(fileName || '')).slice(1).toLowerCase();

  if (mimeType.startsWith('image/') && !['gif', 'webp'].includes(extension)) {
    return { method: 'sendPhoto', field: 'photo' };
  }
  if (mimeType.startsWith('video/')) return { method: 'sendVideo', field: 'video' };
  if (mimeType.startsWith('audio/')) return { method: 'sendAudio', field: 'audio' };
  return { method: 'sendDocument', field: 'document' };
}

function extractUploadedFile(result) {
  if (Array.isArray(result?.photo) && result.photo.length) {
    return result.photo.reduce((largest, photo) =>
      Number(photo.file_size || 0) > Number(largest.file_size || 0) ? photo : largest,
    );
  }
  return result?.document || result?.video || result?.audio || result?.animation || result?.sticker || null;
}

class TelegramStorage {
  constructor({ botToken, chatId, fetchImpl = globalThis.fetch, apiBase = TELEGRAM_API_BASE, timeoutMs = 60_000 }) {
    if (!botToken || !chatId) throw new Error('TG_BOT_TOKEN and TG_CHAT_ID are required for Telegram storage');
    if (typeof fetchImpl !== 'function') throw new Error('Fetch API is unavailable for Telegram storage');
    this.botToken = String(botToken);
    this.chatId = String(chatId);
    this.fetchImpl = fetchImpl;
    this.apiBase = String(apiBase).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  apiUrl(method) {
    return `${this.apiBase}/bot${this.botToken}/${method}`;
  }

  fileUrl(filePath) {
    const encodedPath = String(filePath).split('/').map(encodeURIComponent).join('/');
    return `${this.apiBase}/file/bot${this.botToken}/${encodedPath}`;
  }

  async fetchWithTimeout(url, options, operation) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`${operation} timed out after ${this.timeoutMs}ms`);
      }
      throw new Error(`${operation} failed: ${error?.message || 'network error'}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async parseApiResponse(response, operation) {
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok || !body?.ok) {
      const description = body?.description || `HTTP ${response.status}`;
      throw new Error(`${operation} failed: ${description}`);
    }
    return body.result;
  }

  async sendOnce(method, field, buffer, fileName, contentType) {
    const form = new FormData();
    form.append('chat_id', this.chatId);
    form.append(field, new Blob([buffer], { type: contentType || 'application/octet-stream' }), fileName);
    const response = await this.fetchWithTimeout(
      this.apiUrl(method),
      { method: 'POST', body: form },
      `Telegram ${method}`,
    );
    return this.parseApiResponse(response, `Telegram ${method}`);
  }

  async sendWithRetries(method, field, buffer, fileName, contentType) {
    let lastError;
    for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      try {
        return await this.sendOnce(method, field, buffer, fileName, contentType);
      } catch (error) {
        lastError = error;
        if (attempt + 1 < MAX_UPLOAD_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }

  async uploadFile(buffer, { fileName, contentType }) {
    const descriptor = describeMedia(contentType, fileName);
    let result;
    try {
      result = await this.sendWithRetries(
        descriptor.method,
        descriptor.field,
        buffer,
        fileName,
        contentType,
      );
    } catch (error) {
      // Match the original Telegram adapter: retry a photo upload as a document
      // if Telegram rejects the photo method/format.
      if (descriptor.method !== 'sendPhoto') throw error;
      result = await this.sendWithRetries('sendDocument', 'document', buffer, fileName, contentType);
    }

    const uploadedFile = extractUploadedFile(result);
    if (!uploadedFile?.file_id) throw new Error('Telegram response did not include a file_id');
    return {
      fileId: uploadedFile.file_id,
      fileSize: Number(uploadedFile.file_size || buffer.length),
    };
  }

  async uploadChunk(buffer, { fileName }) {
    const result = await this.sendWithRetries(
      'sendDocument',
      'document',
      buffer,
      fileName,
      'application/octet-stream',
    );
    const uploadedFile = extractUploadedFile(result);
    if (!uploadedFile?.file_id) throw new Error('Telegram chunk response did not include a file_id');
    return {
      fileId: uploadedFile.file_id,
      fileSize: Number(uploadedFile.file_size || buffer.length),
    };
  }

  async getFileInfo(fileId) {
    const url = new URL(this.apiUrl('getFile'));
    url.searchParams.set('file_id', fileId);
    const response = await this.fetchWithTimeout(url, { method: 'GET' }, 'Telegram getFile');
    const result = await this.parseApiResponse(response, 'Telegram getFile');
    if (!result?.file_path) throw new Error('Telegram getFile did not return a file_path');
    return {
      filePath: result.file_path,
      fileSize: Number(result.file_size || 0),
    };
  }

  async downloadFilePath(filePath) {
    const response = await this.fetchWithTimeout(
      this.fileUrl(filePath),
      { method: 'GET' },
      'Telegram file download',
    );
    if (!response.ok || !response.body) {
      throw new Error(`Telegram file download failed: HTTP ${response.status}`);
    }
    return response;
  }

  async getFile(fileId) {
    const info = await this.getFileInfo(fileId);
    const response = await this.downloadFilePath(info.filePath);
    return { ...info, response };
  }
}

module.exports = {
  TELEGRAM_FILE_PREFIX,
  TELEGRAM_CHUNKS_PREFIX,
  TelegramStorage,
  decodeTelegramChunks,
  describeMedia,
  encodeTelegramChunks,
  extractUploadedFile,
};

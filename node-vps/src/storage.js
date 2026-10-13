'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const mime = require('mime-types');

const FILE_TYPES = new Set(['img', 'audio', 'video', 'doc']);
const KEY_PATTERN = /^(img|audio|video|doc):([A-Za-z0-9_-]+)(?:\.([A-Za-z0-9]{1,10}))?$/;

function safeFilename(value) {
  const filename = String(value || 'upload')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .trim()
    .slice(0, 100);
  return filename || 'upload';
}

function safeExtension(filename) {
  const extension = path.extname(filename).slice(1).toLowerCase();
  return extension && /^[A-Za-z0-9]{1,10}$/.test(extension) ? `.${extension}` : '';
}

function classifyFile(contentType, filename) {
  const type = String(contentType || '').toLowerCase();
  if (type.startsWith('image/')) return 'img';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  const guessed = String(mime.lookup(filename) || '').toLowerCase();
  if (guessed.startsWith('image/')) return 'img';
  if (guessed.startsWith('audio/')) return 'audio';
  if (guessed.startsWith('video/')) return 'video';
  return 'doc';
}

function makeFileKey(fileType, filename, chunked = false) {
  const id = `${chunked ? 'chunk_' : ''}${crypto.randomBytes(18).toString('base64url')}`;
  return `${fileType}:${id}${safeExtension(filename)}`;
}

function resolveFilePath(storageDir, key) {
  const match = KEY_PATTERN.exec(key);
  if (!match) return null;
  const basename = `${match[2]}${match[3] ? `.${match[3]}` : ''}`;
  return path.join(storageDir, basename);
}

function chunkDirectory(chunksDir, key) {
  const digest = crypto.createHash('sha256').update(key).digest('hex');
  return path.join(chunksDir, digest);
}

function contentDisposition(filename) {
  const cleaned = safeFilename(filename).replace(/[\r\n]/g, '');
  const fallback = cleaned.replace(/[^\x20-\x7e]/g, '?').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(cleaned).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function parseRange(value, fileSize) {
  if (!value) return null;
  const invalid = (message) => {
    const error = new Error(message);
    error.status = 416;
    error.headers = { 'Content-Range': `bytes */${fileSize}` };
    throw error;
  };

  if (!value.startsWith('bytes=') || value.includes(',')) {
    invalid('Only one byte range is supported');
  }
  const range = value.slice(6).trim();
  const separator = range.indexOf('-');
  if (separator < 0) invalid('Invalid byte range');
  const startText = range.slice(0, separator);
  const endText = range.slice(separator + 1);
  let start;
  let end;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || fileSize === 0) {
      invalid('Invalid byte range');
    }
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : fileSize - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      invalid('Invalid byte range');
    }
  }
  if (start < 0 || end < start || start >= fileSize) {
    invalid('Requested range is not satisfiable');
  }
  return { start, end: Math.min(end, fileSize - 1) };
}

module.exports = {
  FILE_TYPES,
  KEY_PATTERN,
  chunkDirectory,
  classifyFile,
  contentDisposition,
  makeFileKey,
  parseRange,
  resolveFilePath,
  safeFilename,
};

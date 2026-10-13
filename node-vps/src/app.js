'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const mime = require('mime-types');
const multer = require('multer');
const {
  FILE_TYPES,
  KEY_PATTERN,
  chunkDirectory,
  classifyFile,
  contentDisposition,
  makeFileKey,
  parseRange,
  resolveFilePath,
  safeFilename,
} = require('./storage');

const MAX_FOLDER_NAME_LENGTH = 80;
const LIST_LIMIT = 1000;
const CHUNK_LOCKS = new Map();

function apiOk(res, data = null, message = null, status = 200) {
  return res.status(status).json({ success: true, data, message });
}

function apiFail(res, message, status = 400, headers = {}) {
  return res.status(status).set(headers).json({ success: false, data: null, message });
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function normalizedFolderName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= MAX_FOLDER_NAME_LENGTH ? name : null;
}

function parseBasicAuth(header) {
  if (!header || !/^Basic\s/i.test(header)) return null;
  try {
    const decoded = Buffer.from(header.replace(/^Basic\s/i, ''), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;
    return [decoded.slice(0, separator), decoded.slice(separator + 1)];
  } catch {
    return null;
  }
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function withKeyLock(key, callback) {
  const previous = CHUNK_LOCKS.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  CHUNK_LOCKS.set(key, current);
  await previous;
  try {
    return await callback();
  } finally {
    release();
    if (CHUNK_LOCKS.get(key) === current) CHUNK_LOCKS.delete(key);
  }
}

async function moveFile(source, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fsp.rename(source, destination);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await fsp.copyFile(source, destination);
    await fsp.rm(source, { force: true });
  }
}

async function assembleChunks(chunksDir, storageDir, key, totalChunks, expectedSize) {
  const sourceDir = chunkDirectory(chunksDir, key);
  const destination = resolveFilePath(storageDir, key);
  const temporary = `${destination}.assembling`;
  await fsp.mkdir(storageDir, { recursive: true });
  await fsp.rm(temporary, { force: true });

  const output = await fsp.open(temporary, 'w');
  const buffer = Buffer.alloc(1024 * 1024);
  let totalSize = 0;
  try {
    for (let index = 0; index < totalChunks; index += 1) {
      const chunkPath = path.join(sourceDir, `${String(index).padStart(8, '0')}.part`);
      const input = await fsp.open(chunkPath, 'r');
      try {
        while (true) {
          const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
          if (bytesRead === 0) break;
          totalSize += bytesRead;
          if (totalSize > expectedSize) {
            throw new Error('Combined upload is larger than declared');
          }
          let written = 0;
          while (written < bytesRead) {
            const result = await output.write(buffer, written, bytesRead - written, null);
            if (result.bytesWritten === 0) throw new Error('Unable to write assembled upload');
            written += result.bytesWritten;
          }
        }
      } finally {
        await input.close();
      }
    }
    if (totalSize !== expectedSize) {
      throw new Error('Combined upload size does not match the declared size');
    }
    await output.sync();
  } catch (error) {
    await output.close().catch(() => {});
    await fsp.rm(temporary, { force: true });
    throw error;
  }
  await output.close();
  await fsp.rename(temporary, destination);
  return destination;
}

function makeUploadMiddleware(config, maxFileSize) {
  const storage = multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, config.tempUploadDir),
    filename: (_req, _file, callback) => callback(null, crypto.randomUUID()),
  });
  return multer({ storage, limits: { fileSize: maxFileSize, files: 1 } });
}

function createApp(config, options = {}) {
  for (const directory of [
    config.dataDir,
    path.dirname(config.databasePath),
    config.storageDir,
    config.chunksDir,
    config.tempUploadDir,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const store = options.store;
  if (!store) throw new Error('createApp requires an initialized DatabaseStore');
  const app = express();
  app.disable('x-powered-by');
  app.locals.store = store;
  app.locals.config = config;

  app.use(cors({
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'If-Range'],
    exposedHeaders: ['Accept-Ranges', 'Content-Range', 'Content-Disposition', 'ETag'],
  }));

  app.use((req, res, next) => {
    if (req.path === '/healthz') return next();
    if (!config.basicUser || !config.basicPass) return next();
    const credentials = parseBasicAuth(req.get('authorization'));
    if (
      credentials &&
      constantTimeEqual(credentials[0], config.basicUser) &&
      constantTimeEqual(credentials[1], config.basicPass)
    ) {
      return next();
    }
    return apiFail(res, 'Unauthorized', 401, {
      'WWW-Authenticate': 'Basic realm="OtterHub Admin", charset="UTF-8"',
    });
  });

  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/check', (_req, res) => apiOk(res));
  app.post('/api/logout', (_req, res) => apiFail(res, 'Logged out.', 401, {
    'WWW-Authenticate': 'Basic realm="OtterHub Admin", charset="UTF-8"',
  }));

  app.get('/api/list', (req, res) => {
    const fileType = req.query.fileType;
    if (fileType && !FILE_TYPES.has(fileType)) return apiFail(res, 'Unsupported file type');
    const rawLimit = req.query.limit === undefined ? '100' : String(req.query.limit);
    const rawCursor = req.query.cursor === undefined ? '0' : String(req.query.cursor || '0');
    const requestedLimit = Number(rawLimit);
    const offset = Number(rawCursor);
    if (!Number.isInteger(requestedLimit) || !Number.isInteger(offset) || offset < 0) {
      return apiFail(res, 'Invalid pagination parameters');
    }
    const limit = Math.max(1, Math.min(requestedLimit, LIST_LIMIT));
    const prefix = fileType ? `${fileType}:` : '';
    const result = store.listFiles(prefix, limit, offset);
    return apiOk(res, {
      keys: result.keys,
      list_complete: !result.hasMore,
      cursor: result.hasMore ? String(offset + result.keys.length) : null,
    });
  });

  app.get('/api/folders', (_req, res) => apiOk(res, { folders: store.listFolders() }));

  app.post('/api/folders', (req, res) => {
    const name = normalizedFolderName(req.body?.name);
    if (!name) {
      return apiFail(res, `Folder name must be between 1 and ${MAX_FOLDER_NAME_LENGTH} characters`);
    }
    if (store.folderNameExists(name)) return apiFail(res, 'A folder with this name already exists', 409);
    const now = Date.now();
    const folder = { id: crypto.randomUUID(), name, coverKey: null, createdAt: now, updatedAt: now };
    try {
      store.createFolder(folder);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return apiFail(res, 'A folder with this name already exists', 409);
      }
      throw error;
    }
    return apiOk(res, folder, 'Photo folder created');
  });

  app.patch('/api/folders/:folderId', (req, res) => {
    const folder = store.getFolder(req.params.folderId);
    if (!folder) return apiFail(res, 'Photo folder not found', 404);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const updated = { ...folder, updatedAt: Date.now() };

    if (Object.hasOwn(body, 'name')) {
      const name = normalizedFolderName(body.name);
      if (!name) {
        return apiFail(res, `Folder name must be between 1 and ${MAX_FOLDER_NAME_LENGTH} characters`);
      }
      if (store.folderNameExists(name, folder.id)) {
        return apiFail(res, 'A folder with this name already exists', 409);
      }
      updated.name = name;
    }

    if (Object.hasOwn(body, 'coverKey')) {
      if (body.coverKey === null) {
        updated.coverKey = null;
      } else if (typeof body.coverKey === 'string' && body.coverKey.startsWith('img:')) {
        const file = store.getFile(body.coverKey);
        if (!file || file.metadata.folderId !== folder.id) {
          return apiFail(res, 'The poster image must belong to this folder');
        }
        updated.coverKey = body.coverKey;
      } else {
        return apiFail(res, 'Invalid poster image');
      }
    }

    try {
      store.updateFolder(updated);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return apiFail(res, 'A folder with this name already exists', 409);
      }
      throw error;
    }
    return apiOk(res, updated, 'Photo folder updated');
  });

  app.delete('/api/folders/:folderId', (req, res) => {
    const detachedKeys = store.deleteFolder(req.params.folderId);
    if (detachedKeys === null) return apiFail(res, 'Photo folder not found', 404);
    return apiOk(res, { id: req.params.folderId, detachedKeys }, 'Photo folder deleted');
  });

  function ensureFileCapacity(_req, res, next) {
    if (config.maxFileCount > 0 && store.countFiles() >= config.maxFileCount) {
      return apiFail(res, 'File count exceeds the configured limit');
    }
    return next();
  }

  const directUpload = makeUploadMiddleware(config, config.chunkSizeBytes);
  const chunkUpload = makeUploadMiddleware(config, config.chunkSizeBytes);

  app.post('/api/upload', ensureFileCapacity, directUpload.single('file'), asyncRoute(async (req, res) => {
    const temporaryPath = req.file?.path;
    try {
      if (!req.file) return apiFail(res, 'No file uploaded');
      const filename = safeFilename(req.file.originalname);
      const fileType = classifyFile(req.file.mimetype, filename);
      const folderId = typeof req.body.folderId === 'string' ? req.body.folderId : '';
      if (folderId) {
        if (fileType !== 'img') return apiFail(res, 'Only image files can be uploaded to photo folders');
        if (!store.getFolder(folderId)) return apiFail(res, 'Photo folder not found', 404);
      }

      const key = makeFileKey(fileType, filename);
      const destination = resolveFilePath(config.storageDir, key);
      const metadata = {
        fileName: filename,
        fileSize: req.file.size,
        uploadedAt: Date.now(),
        liked: false,
        tags: req.body.nsfw === 'true' ? ['nsfw'] : [],
      };
      if (folderId) metadata.folderId = folderId;

      await moveFile(temporaryPath, destination);
      try {
        store.createFile(key, metadata, destination);
      } catch (error) {
        await fsp.rm(destination, { force: true });
        throw error;
      }
      return apiOk(res, key);
    } finally {
      if (temporaryPath) await fsp.rm(temporaryPath, { force: true });
    }
  }));

  app.get('/api/upload/chunk', (req, res) => {
    if (config.maxFileCount > 0 && store.countFiles() >= config.maxFileCount) {
      return apiFail(res, 'File count exceeds the configured limit');
    }
    const fileType = String(req.query.fileType || '');
    const filename = safeFilename(req.query.fileName);
    const fileSize = Number(req.query.fileSize);
    const totalChunks = Number(req.query.totalChunks);
    if (
      !FILE_TYPES.has(fileType) ||
      !Number.isSafeInteger(fileSize) || fileSize <= 0 ||
      !Number.isInteger(totalChunks) || totalChunks <= 0
    ) {
      return apiFail(res, 'Invalid chunk upload parameters');
    }
    if (fileSize > config.maxUploadSizeBytes) {
      return apiFail(res, 'File exceeds the configured upload limit', 413);
    }
    if (totalChunks !== Math.ceil(fileSize / config.chunkSizeBytes)) {
      return apiFail(res, 'Chunk count does not match the declared file size');
    }

    const folderId = typeof req.query.folderId === 'string' ? req.query.folderId : '';
    if (folderId) {
      if (fileType !== 'img') return apiFail(res, 'Only image files can be uploaded to photo folders');
      if (!store.getFolder(folderId)) return apiFail(res, 'Photo folder not found', 404);
    }

    const key = makeFileKey(fileType, filename, true);
    const metadata = {
      fileName: filename,
      fileSize,
      uploadedAt: Date.now(),
      liked: false,
      tags: req.query.nsfw === 'true' ? ['nsfw'] : [],
      chunkInfo: { total: totalChunks, uploadedIndices: [] },
    };
    if (folderId) metadata.folderId = folderId;
    store.createFile(key, metadata, null);
    return apiOk(res, key);
  });

  app.post('/api/upload/chunk', chunkUpload.single('chunkFile'), asyncRoute(async (req, res) => {
    const temporaryPath = req.file?.path;
    try {
      if (!req.file) return apiFail(res, 'No chunk uploaded');
      const key = String(req.body.key || '');
      if (!KEY_PATTERN.test(key)) return apiFail(res, 'Invalid file key');
      const chunkIndex = Number(req.body.chunkIndex);
      if (!Number.isInteger(chunkIndex)) return apiFail(res, 'Invalid chunk index');

      return await withKeyLock(key, async () => {
        const file = store.getFile(key);
        if (!file) return apiFail(res, 'Chunk upload was not initialized', 404);
        const metadata = file.metadata;
        const chunkInfo = metadata.chunkInfo;
        if (!chunkInfo) return apiFail(res, 'Not a chunked upload');
        if (chunkIndex < 0 || chunkIndex >= chunkInfo.total) return apiFail(res, 'Invalid chunk index');
        if (file.storagePath) return apiOk(res, chunkIndex);

        const directory = chunkDirectory(config.chunksDir, key);
        await fsp.mkdir(directory, { recursive: true });
        const partPath = path.join(directory, `${String(chunkIndex).padStart(8, '0')}.part`);
        let uploadedIndices = new Set(chunkInfo.uploadedIndices || []);
        if (uploadedIndices.has(chunkIndex)) {
          try {
            await fsp.access(partPath);
          } catch {
            uploadedIndices.delete(chunkIndex);
          }
        }

        if (!uploadedIndices.has(chunkIndex)) {
          const expectedSize = Math.min(
            config.chunkSizeBytes,
            metadata.fileSize - chunkIndex * config.chunkSizeBytes,
          );
          if (req.file.size !== expectedSize) {
            return apiFail(res, 'Chunk size does not match the expected size');
          }
          await moveFile(temporaryPath, partPath);
          uploadedIndices.add(chunkIndex);
          chunkInfo.uploadedIndices = [...uploadedIndices].sort((left, right) => left - right);
          metadata.chunkInfo = chunkInfo;
          store.updateFile(key, metadata);
        }

        if (uploadedIndices.size === chunkInfo.total) {
          const finalPath = await assembleChunks(
            config.chunksDir,
            config.storageDir,
            key,
            chunkInfo.total,
            metadata.fileSize,
          );
          try {
            store.updateFile(key, metadata, finalPath);
          } catch (error) {
            await fsp.rm(finalPath, { force: true });
            throw error;
          }
          await fsp.rm(directory, { recursive: true, force: true });
        }
        return apiOk(res, chunkIndex);
      });
    } finally {
      if (temporaryPath) await fsp.rm(temporaryPath, { force: true });
    }
  }));

  app.patch('/api/editFileMeta/:key', (req, res) => {
    const key = req.params.key;
    const file = store.getFile(key);
    if (!file) return apiFail(res, `File metadata not found for key: ${key}`, 404);
    const metadata = { ...file.metadata };
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    if (Object.hasOwn(body, 'fileName')) {
      const filename = safeFilename(body.fileName);
      if (!filename) return apiFail(res, 'File name must not be empty');
      metadata.fileName = filename;
    }
    if (Object.hasOwn(body, 'tags')) {
      if (!Array.isArray(body.tags) || !body.tags.every((tag) => typeof tag === 'string')) {
        return apiFail(res, 'Tags must be an array of strings');
      }
      metadata.tags = body.tags;
    }

    const previousFolderId = metadata.folderId;
    if (Object.hasOwn(body, 'folderId')) {
      if (!key.startsWith('img:')) {
        return apiFail(res, 'Only image files can be assigned to photo folders');
      }
      if (body.folderId === null || body.folderId === '') {
        delete metadata.folderId;
      } else if (typeof body.folderId === 'string' && store.getFolder(body.folderId)) {
        metadata.folderId = body.folderId;
      } else if (typeof body.folderId === 'string') {
        return apiFail(res, 'Photo folder not found', 404);
      } else {
        return apiFail(res, 'Invalid photo folder');
      }
    }

    store.updateFile(key, metadata);
    const nextFolderId = metadata.folderId;
    if (previousFolderId && previousFolderId !== nextFolderId) {
      const previousFolder = store.getFolder(previousFolderId);
      if (previousFolder?.coverKey === key) store.clearFolderCover(previousFolderId, key);
    }
    return apiOk(res, { metadata }, 'File metadata updated');
  });

  app.post('/api/toggleLike/:key', (req, res) => {
    const file = store.getFile(req.params.key);
    if (!file) return apiFail(res, `File metadata not found for key: ${req.params.key}`, 404);
    const metadata = { ...file.metadata, liked: !Boolean(file.metadata.liked) };
    store.updateFile(req.params.key, metadata);
    return apiOk(res, { liked: metadata.liked });
  });

  app.post('/api/delete/:key', asyncRoute(async (req, res) => {
    const deleted = store.deleteFile(req.params.key);
    if (!deleted) return apiFail(res, 'Failed to delete file', 404);
    const filePath = resolveFilePath(config.storageDir, req.params.key);
    if (filePath) await fsp.rm(filePath, { force: true });
    else if (deleted.storagePath) await fsp.rm(deleted.storagePath, { force: true });
    await fsp.rm(chunkDirectory(config.chunksDir, req.params.key), { recursive: true, force: true });
    const folderId = deleted.metadata.folderId;
    if (folderId) {
      const folder = store.getFolder(folderId);
      if (folder?.coverKey === req.params.key) store.clearFolderCover(folderId, req.params.key);
    }
    return apiOk(res, true, 'File deleted successfully');
  }));

  async function serveFile(req, res) {
    const key = req.params.key;
    const record = store.getFile(key);
    if (!record) return apiFail(res, `File not found for key: ${key}`, 404);
    if (!record.storagePath) return apiFail(res, 'File upload is incomplete', 425);
    const filePath = resolveFilePath(config.storageDir, key);
    if (!filePath) return apiFail(res, `File not found for key: ${key}`, 404);

    let stats;
    try {
      stats = await fsp.stat(filePath);
    } catch {
      return apiFail(res, `File not found for key: ${key}`, 404);
    }
    const fileSize = stats.size;
    let range;
    try {
      range = parseRange(req.get('range'), fileSize);
    } catch (error) {
      return apiFail(res, error.message, error.status || 416, error.headers || {});
    }

    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': mime.lookup(record.metadata.fileName || filePath) || 'application/octet-stream',
      'Content-Disposition': contentDisposition(record.metadata.fileName || path.basename(filePath)),
      'Cache-Control': 'private, max-age=3600',
      ETag: `"${fileSize.toString(16)}-${stats.mtimeMs.toString(16)}"`,
    };
    let status = 200;
    let start = 0;
    let end = fileSize - 1;
    if (range) {
      ({ start, end } = range);
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
    }
    headers['Content-Length'] = String(fileSize === 0 ? 0 : end - start + 1);
    res.set(headers).status(status);
    if (req.method === 'HEAD' || fileSize === 0) return res.end();

    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', (error) => {
      if (res.headersSent) return res.destroy(error);
      return apiFail(res, 'Unable to read file', 500);
    });
    stream.pipe(res);
  }

  app.route('/file/:key').get(asyncRoute(serveFile)).head(asyncRoute(serveFile));
  app.use('/api', (_req, res) => apiFail(res, 'API route not found', 404));
  app.use('/file', (_req, res) => apiFail(res, 'File not found', 404));

  if (fs.existsSync(config.frontendDir)) {
    app.use(express.static(config.frontendDir, { fallthrough: true }));
  }
  app.use((req, res) => apiFail(res, `Not found: ${req.path}`, 404));

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return apiFail(res, error.message, status);
    }
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error('OtterHub request failed:', error);
    const message = status >= 500 && config.appEnv === 'production'
      ? 'Internal server error'
      : error.message || 'Request failed';
    return apiFail(res, message, status);
  });

  return app;
}

module.exports = { createApp };

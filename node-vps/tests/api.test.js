'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const request = require('supertest');
const { loadConfig } = require('../src/config');
const { DatabaseStore } = require('../src/database');
const { createApp } = require('../src/app');

let root;
let app;
let store;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'otterhub-node-test-'));
  const staticDir = path.join(root, 'static');
  await fs.mkdir(staticDir, { recursive: true });
  await fs.writeFile(path.join(staticDir, 'index.html'), '<main>OtterHub test frontend</main>');
  const config = loadConfig({
    APP_ENV: 'test',
    DATA_DIR: path.join(root, 'data'),
    DATABASE_PATH: path.join(root, 'data', 'db.sqlite3'),
    STORAGE_DIR: path.join(root, 'data', 'files'),
    CHUNKS_DIR: path.join(root, 'data', 'chunks'),
    TEMP_UPLOAD_DIR: path.join(root, 'data', 'uploads'),
    FRONTEND_DIR: staticDir,
    MAX_UPLOAD_SIZE_BYTES: String(1024 * 1024),
    CHUNK_SIZE_BYTES: '4',
    MAX_FILE_COUNT: '100',
  });
  store = await DatabaseStore.open(config.databasePath);
  app = createApp(config, { store });
});

after(async () => {
  store?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('serves the exported frontend and exposes an open health check', async () => {
  const frontend = await request(app).get('/');
  assert.equal(frontend.status, 200);
  assert.match(frontend.text, /OtterHub test frontend/);
  assert.deepEqual((await request(app).get('/healthz')).body, { status: 'ok' });
  assert.equal((await request(app).get('/api/check')).body.success, true);
});

test('supports photo folders, range reads, likes, and safe folder deletion', async () => {
  const uploaded = await request(app)
    .post('/api/upload')
    .attach('file', Buffer.from('abcd'), {
      filename: 'photo.png',
      contentType: 'image/png',
    });
  assert.equal(uploaded.status, 200);
  const key = uploaded.body.data;

  const created = await request(app).post('/api/folders').send({ name: 'Weekend' });
  assert.equal(created.status, 200);
  const folder = created.body.data;

  const assigned = await request(app)
    .patch(`/api/editFileMeta/${key}`)
    .send({ folderId: folder.id });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.data.metadata.folderId, folder.id);

  const poster = await request(app)
    .patch(`/api/folders/${folder.id}`)
    .send({ coverKey: key });
  assert.equal(poster.status, 200);
  assert.equal(poster.body.data.coverKey, key);

  const ranged = await request(app).get(`/file/${key}`).set('Range', 'bytes=1-2');
  assert.equal(ranged.status, 206);
  assert.deepEqual(ranged.body, Buffer.from('bc'));
  assert.equal(ranged.headers['content-range'], 'bytes 1-2/4');

  const liked = await request(app).post(`/api/toggleLike/${key}`);
  assert.equal(liked.body.data.liked, true);

  const deletedFolder = await request(app).delete(`/api/folders/${folder.id}`);
  assert.equal(deletedFolder.status, 200);
  assert.deepEqual(deletedFolder.body.data.detachedKeys, [key]);
  const listed = await request(app).get('/api/list?fileType=img');
  const item = listed.body.data.keys.find((file) => file.name === key);
  assert.ok(item);
  assert.equal(item.metadata.folderId, undefined);
  assert.equal(item.metadata.liked, true);

  const deletedFile = await request(app).post(`/api/delete/${key}`);
  assert.equal(deletedFile.status, 200);
  assert.equal((await request(app).get(`/file/${key}`)).status, 404);
});

test('assembles chunked uploads and retains NSFW metadata', async () => {
  const initialized = await request(app).get('/api/upload/chunk').query({
    fileType: 'video',
    fileName: 'clip.mp4',
    fileSize: '6',
    totalChunks: '2',
    nsfw: 'true',
  });
  assert.equal(initialized.status, 200);
  const key = initialized.body.data;

  for (const [index, chunk] of [[0, 'abcd'], [1, 'ef']]) {
    const result = await request(app)
      .post('/api/upload/chunk')
      .field('key', key)
      .field('chunkIndex', String(index))
      .attach('chunkFile', Buffer.from(chunk), `part-${index}`);
    assert.equal(result.status, 200);
  }

  const downloaded = await request(app).get(`/file/${key}`);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(downloaded.body, Buffer.from('abcdef'));
  const listed = await request(app).get('/api/list?fileType=video');
  const item = listed.body.data.keys.find((file) => file.name === key);
  assert.deepEqual(item.metadata.chunkInfo.uploadedIndices, [0, 1]);
  assert.deepEqual(item.metadata.tags, ['nsfw']);
});

test('enforces Basic Auth while keeping health checks available', async () => {
  const authConfig = loadConfig({
    APP_ENV: 'production',
    BASIC_USER: 'otter',
    BASIC_PASS: 'secret',
    DATA_DIR: path.join(root, 'auth-data'),
    DATABASE_PATH: path.join(root, 'auth-data', 'db.sqlite3'),
    STORAGE_DIR: path.join(root, 'auth-data', 'files'),
    CHUNKS_DIR: path.join(root, 'auth-data', 'chunks'),
    TEMP_UPLOAD_DIR: path.join(root, 'auth-data', 'uploads'),
    FRONTEND_DIR: path.join(root, 'missing-static'),
  });
  const authStore = await DatabaseStore.open(authConfig.databasePath);
  const authApp = createApp(authConfig, { store: authStore });
  const unauthorized = await request(authApp).get('/api/list');
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers['www-authenticate'], /^Basic /);
  assert.equal((await request(authApp).get('/healthz')).status, 200);
  assert.equal((await request(authApp).get('/api/list').auth('otter', 'secret')).status, 200);
  authStore.close();
});

test('persists SQLite data when the store is reopened', async () => {
  const databasePath = path.join(root, 'persistent-data', 'metadata.sqlite3');
  const first = await DatabaseStore.open(databasePath);
  first.createFile('img:persistent', { uploadedAt: 123, liked: true }, '/files/persistent');
  first.createFolder({
    id: 'folder-persistent',
    name: 'Persistent album',
    coverKey: 'img:persistent',
    createdAt: 123,
    updatedAt: 123,
  });
  first.close();

  const reopened = await DatabaseStore.open(databasePath);
  assert.deepEqual(reopened.getFile('img:persistent'), {
    name: 'img:persistent',
    metadata: { uploadedAt: 123, liked: true },
    storagePath: '/files/persistent',
  });
  assert.equal(reopened.getFolder('folder-persistent').name, 'Persistent album');
  reopened.close();
});

test('rejects placeholder production credentials and foldered non-image uploads', async () => {
  assert.throws(() => loadConfig({
    APP_ENV: 'production',
    BASIC_USER: 'change-me',
    BASIC_PASS: 'replace-with-a-long-random-password',
  }), /non-placeholder BASIC_USER and BASIC_PASS/);

  const folder = await request(app).post('/api/folders').send({ name: 'Images only' });
  const rejected = await request(app)
    .post('/api/upload')
    .field('folderId', folder.body.data.id)
    .attach('file', Buffer.from('text'), {
      filename: 'notes.txt',
      contentType: 'text/plain',
    });
  assert.equal(rejected.status, 400);
});

'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { TelegramStorage, describeMedia } = require('../src/telegram-storage');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('matches the Worker media method selection for Telegram uploads', () => {
  assert.deepEqual(describeMedia('image/jpeg', 'photo.jpg'), { method: 'sendPhoto', field: 'photo' });
  assert.deepEqual(describeMedia('image/gif', 'animation.gif'), { method: 'sendDocument', field: 'document' });
  assert.deepEqual(describeMedia('video/mp4', 'clip.mp4'), { method: 'sendVideo', field: 'video' });
  assert.deepEqual(describeMedia('audio/mpeg', 'track.mp3'), { method: 'sendAudio', field: 'audio' });
  assert.deepEqual(describeMedia('application/pdf', 'scan.pdf'), { method: 'sendDocument', field: 'document' });
});

test('sends media to the configured Telegram chat and selects the largest photo file_id', async () => {
  const calls = [];
  const storage = new TelegramStorage({
    botToken: 'test-token',
    chatId: '-1001234567890',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse({
        ok: true,
        result: {
          photo: [
            { file_id: 'small-photo', file_size: 10 },
            { file_id: 'large-photo', file_size: 20 },
          ],
        },
      });
    },
  });

  const uploaded = await storage.uploadFile(Buffer.from('image-bytes'), {
    fileName: 'photo.jpg',
    contentType: 'image/jpeg',
  });
  assert.deepEqual(uploaded, { fileId: 'large-photo', fileSize: 20 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.telegram.org/bottest-token/sendPhoto');
  assert.equal(calls[0].options.body.get('chat_id'), '-1001234567890');
  assert.equal(calls[0].options.body.get('photo').name, 'photo.jpg');
});

test('resolves Telegram file metadata and fetches the private file through the server adapter', async () => {
  const calls = [];
  const storage = new TelegramStorage({
    botToken: 'test-token',
    chatId: '-1001234567890',
    fetchImpl: async (url) => {
      const value = String(url);
      calls.push(value);
      if (value.includes('/getFile?')) {
        return jsonResponse({ ok: true, result: { file_path: 'documents/sample.pdf', file_size: 4 } });
      }
      return new Response(Buffer.from('data'));
    },
  });

  const downloaded = await storage.getFile('telegram-file-id');
  assert.equal(downloaded.filePath, 'documents/sample.pdf');
  assert.equal(downloaded.fileSize, 4);
  assert.deepEqual(Buffer.from(await downloaded.response.arrayBuffer()), Buffer.from('data'));
  assert.match(calls[0], /getFile\?file_id=telegram-file-id$/);
  assert.equal(calls[1], 'https://api.telegram.org/file/bottest-token/documents/sample.pdf');
});

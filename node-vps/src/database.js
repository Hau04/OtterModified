'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Sqlite = require('better-sqlite3');

class DatabaseStore {
  constructor(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Sqlite(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        name TEXT PRIMARY KEY,
        metadata TEXT NOT NULL,
        storage_path TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);

      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        cover_key TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  static decodeMetadata(raw) {
    try {
      const value = JSON.parse(raw);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  getFile(name) {
    const row = this.db.prepare(
      'SELECT name, metadata, storage_path FROM files WHERE name = ?',
    ).get(name);
    if (!row) return null;
    return {
      name: row.name,
      metadata: DatabaseStore.decodeMetadata(row.metadata),
      storagePath: row.storage_path,
    };
  }

  createFile(name, metadata, storagePath = null) {
    this.db.prepare(`
      INSERT INTO files (name, metadata, storage_path, created_at)
      VALUES (?, ?, ?, ?)
    `).run(
      name,
      JSON.stringify(metadata),
      storagePath,
      Number(metadata.uploadedAt || Date.now()),
    );
  }

  updateFile(name, metadata, storagePath) {
    if (arguments.length < 3) {
      return this.db.prepare('UPDATE files SET metadata = ? WHERE name = ?')
        .run(JSON.stringify(metadata), name).changes > 0;
    }
    return this.db.prepare(
      'UPDATE files SET metadata = ?, storage_path = ? WHERE name = ?',
    ).run(JSON.stringify(metadata), storagePath, name).changes > 0;
  }

  deleteFile(name) {
    const record = this.getFile(name);
    if (!record) return null;
    this.db.prepare('DELETE FROM files WHERE name = ?').run(name);
    return record;
  }

  listFiles(prefix, limit, offset) {
    const rows = this.db.prepare(`
      SELECT name, metadata FROM files
      WHERE substr(name, 1, ?) = ?
      ORDER BY name ASC
      LIMIT ? OFFSET ?
    `).all(prefix.length, prefix, limit + 1, offset);
    const hasMore = rows.length > limit;
    return {
      keys: rows.slice(0, limit).map((row) => ({
        name: row.name,
        metadata: DatabaseStore.decodeMetadata(row.metadata),
      })),
      hasMore,
    };
  }

  countFiles() {
    return this.db.prepare('SELECT COUNT(*) AS count FROM files').get().count;
  }

  getFolder(folderId) {
    const row = this.db.prepare(`
      SELECT id, name, cover_key, created_at, updated_at FROM folders WHERE id = ?
    `).get(folderId);
    return row ? DatabaseStore.folderFromRow(row) : null;
  }

  listFolders() {
    return this.db.prepare(`
      SELECT id, name, cover_key, created_at, updated_at FROM folders
      ORDER BY created_at DESC, name ASC
    `).all().map(DatabaseStore.folderFromRow);
  }

  folderNameExists(name, excludeId = null) {
    const row = excludeId
      ? this.db.prepare('SELECT 1 FROM folders WHERE name = ? COLLATE NOCASE AND id != ?')
        .get(name, excludeId)
      : this.db.prepare('SELECT 1 FROM folders WHERE name = ? COLLATE NOCASE').get(name);
    return Boolean(row);
  }

  createFolder(folder) {
    this.db.prepare(`
      INSERT INTO folders (id, name, cover_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      folder.id,
      folder.name,
      folder.coverKey,
      folder.createdAt,
      folder.updatedAt,
    );
  }

  updateFolder(folder) {
    return this.db.prepare(`
      UPDATE folders SET name = ?, cover_key = ?, updated_at = ? WHERE id = ?
    `).run(folder.name, folder.coverKey, folder.updatedAt, folder.id).changes > 0;
  }

  deleteFolder(folderId) {
    return this.db.transaction((id) => {
      const folder = this.db.prepare('SELECT id FROM folders WHERE id = ?').get(id);
      if (!folder) return null;

      const detachedKeys = [];
      const rows = this.db.prepare('SELECT name, metadata FROM files').all();
      const update = this.db.prepare('UPDATE files SET metadata = ? WHERE name = ?');
      for (const row of rows) {
        const metadata = DatabaseStore.decodeMetadata(row.metadata);
        if (metadata.folderId !== id) continue;
        delete metadata.folderId;
        update.run(JSON.stringify(metadata), row.name);
        detachedKeys.push(row.name);
      }
      this.db.prepare('DELETE FROM folders WHERE id = ?').run(id);
      return detachedKeys;
    })(folderId);
  }

  clearFolderCover(folderId, coverKey) {
    this.db.prepare(
      'UPDATE folders SET cover_key = NULL WHERE id = ? AND cover_key = ?',
    ).run(folderId, coverKey);
  }

  close() {
    this.db.close();
  }

  static folderFromRow(row) {
    return {
      id: row.id,
      name: row.name,
      coverKey: row.cover_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

module.exports = { DatabaseStore };

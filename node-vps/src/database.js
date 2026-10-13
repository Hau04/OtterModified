'use strict';

const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');

let sqlModulePromise;

function loadSqlModule() {
  if (!sqlModulePromise) {
    const distDirectory = path.dirname(require.resolve('sql.js'));
    sqlModulePromise = initSqlJs({
      locateFile: (file) => path.join(distDirectory, file),
    });
  }
  return sqlModulePromise;
}

class DatabaseStore {
  constructor(databasePath, SQL) {
    this.databasePath = databasePath;
    this.transactionDepth = 0;
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });

    const initialBytes = fs.existsSync(databasePath)
      ? new Uint8Array(fs.readFileSync(databasePath))
      : undefined;
    this.db = new SQL.Database(initialBytes);
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
    this.persist();
  }

  static async open(databasePath) {
    return new DatabaseStore(databasePath, await loadSqlModule());
  }

  static decodeMetadata(raw) {
    try {
      const value = JSON.parse(raw);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  get(sql, parameters = []) {
    const statement = this.db.prepare(sql);
    try {
      if (parameters.length) statement.bind(parameters);
      return statement.step() ? statement.getAsObject() : undefined;
    } finally {
      statement.free();
    }
  }

  all(sql, parameters = []) {
    const statement = this.db.prepare(sql);
    try {
      if (parameters.length) statement.bind(parameters);
      const rows = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }

  run(sql, parameters = []) {
    this.db.run(sql, parameters);
    const changes = this.db.getRowsModified();
    if (this.transactionDepth === 0) this.persist();
    return { changes };
  }

  transaction(callback) {
    return (...args) => {
      this.db.run('BEGIN');
      this.transactionDepth += 1;
      let result;
      try {
        result = callback(...args);
        this.db.run('COMMIT');
      } catch (error) {
        try {
          this.db.run('ROLLBACK');
        } finally {
          this.transactionDepth -= 1;
        }
        throw error;
      }
      this.transactionDepth -= 1;
      if (this.transactionDepth === 0) this.persist();
      return result;
    };
  }

  persist() {
    const temporaryPath = `${this.databasePath}.tmp`;
    fs.writeFileSync(temporaryPath, Buffer.from(this.db.export()), { mode: 0o600 });
    fs.renameSync(temporaryPath, this.databasePath);
  }

  getFile(name) {
    const row = this.get(
      'SELECT name, metadata, storage_path FROM files WHERE name = ?',
      [name],
    );
    if (!row) return null;
    return {
      name: row.name,
      metadata: DatabaseStore.decodeMetadata(row.metadata),
      storagePath: row.storage_path,
    };
  }

  createFile(name, metadata, storagePath = null) {
    this.run(`
      INSERT INTO files (name, metadata, storage_path, created_at)
      VALUES (?, ?, ?, ?)
    `, [
      name,
      JSON.stringify(metadata),
      storagePath,
      Number(metadata.uploadedAt || Date.now()),
    ]);
  }

  updateFile(name, metadata, storagePath) {
    if (arguments.length < 3) {
      return this.run(
        'UPDATE files SET metadata = ? WHERE name = ?',
        [JSON.stringify(metadata), name],
      ).changes > 0;
    }
    return this.run(
      'UPDATE files SET metadata = ?, storage_path = ? WHERE name = ?',
      [JSON.stringify(metadata), storagePath, name],
    ).changes > 0;
  }

  deleteFile(name) {
    const record = this.getFile(name);
    if (!record) return null;
    this.run('DELETE FROM files WHERE name = ?', [name]);
    return record;
  }

  listFiles(prefix, limit, offset) {
    const rows = this.all(`
      SELECT name, metadata FROM files
      WHERE substr(name, 1, ?) = ?
      ORDER BY name ASC
      LIMIT ? OFFSET ?
    `, [prefix.length, prefix, limit + 1, offset]);
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
    return this.get('SELECT COUNT(*) AS count FROM files').count;
  }

  getFolder(folderId) {
    const row = this.get(`
      SELECT id, name, cover_key, created_at, updated_at FROM folders WHERE id = ?
    `, [folderId]);
    return row ? DatabaseStore.folderFromRow(row) : null;
  }

  listFolders() {
    return this.all(`
      SELECT id, name, cover_key, created_at, updated_at FROM folders
      ORDER BY created_at DESC, name ASC
    `).map(DatabaseStore.folderFromRow);
  }

  folderNameExists(name, excludeId = null) {
    const row = excludeId
      ? this.get('SELECT 1 FROM folders WHERE name = ? COLLATE NOCASE AND id != ?', [name, excludeId])
      : this.get('SELECT 1 FROM folders WHERE name = ? COLLATE NOCASE', [name]);
    return Boolean(row);
  }

  createFolder(folder) {
    this.run(`
      INSERT INTO folders (id, name, cover_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `, [folder.id, folder.name, folder.coverKey, folder.createdAt, folder.updatedAt]);
  }

  updateFolder(folder) {
    return this.run(`
      UPDATE folders SET name = ?, cover_key = ?, updated_at = ? WHERE id = ?
    `, [folder.name, folder.coverKey, folder.updatedAt, folder.id]).changes > 0;
  }

  deleteFolder(folderId) {
    return this.transaction((id) => {
      const folder = this.get('SELECT id FROM folders WHERE id = ?', [id]);
      if (!folder) return null;

      const detachedKeys = [];
      const rows = this.all('SELECT name, metadata FROM files');
      for (const row of rows) {
        const metadata = DatabaseStore.decodeMetadata(row.metadata);
        if (metadata.folderId !== id) continue;
        delete metadata.folderId;
        this.run('UPDATE files SET metadata = ? WHERE name = ?', [JSON.stringify(metadata), row.name]);
        detachedKeys.push(row.name);
      }
      this.run('DELETE FROM folders WHERE id = ?', [id]);
      return detachedKeys;
    })(folderId);
  }

  clearFolderCover(folderId, coverKey) {
    this.run(
      'UPDATE folders SET cover_key = NULL WHERE id = ? AND cover_key = ?',
      [folderId, coverKey],
    );
  }

  close() {
    this.persist();
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

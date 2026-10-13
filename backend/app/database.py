from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


@contextmanager
def _connect(database_path: Path) -> Iterator[sqlite3.Connection]:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


class Database:
    def __init__(self, database_path: Path):
        self.database_path = database_path
        self.initialize()

    def initialize(self) -> None:
        with _connect(self.database_path) as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS files (
                    name TEXT PRIMARY KEY,
                    metadata TEXT NOT NULL,
                    storage_path TEXT,
                    created_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_files_created_at
                    ON files(created_at DESC);

                CREATE TABLE IF NOT EXISTS folders (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    cover_key TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_name_casefold
                    ON folders(lower(name));
                """
            )

    @staticmethod
    def _decode_metadata(raw: str) -> dict[str, Any]:
        value = json.loads(raw)
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _encode_metadata(metadata: dict[str, Any]) -> str:
        return json.dumps(metadata, ensure_ascii=False, separators=(",", ":"))

    def create_file(
        self,
        name: str,
        metadata: dict[str, Any],
        storage_path: Path | None,
    ) -> None:
        with _connect(self.database_path) as connection:
            connection.execute(
                "INSERT INTO files (name, metadata, storage_path, created_at) VALUES (?, ?, ?, ?)",
                (
                    name,
                    self._encode_metadata(metadata),
                    str(storage_path) if storage_path else None,
                    int(metadata.get("uploadedAt", 0)),
                ),
            )

    def get_file(self, name: str) -> dict[str, Any] | None:
        with _connect(self.database_path) as connection:
            row = connection.execute(
                "SELECT name, metadata, storage_path FROM files WHERE name = ?",
                (name,),
            ).fetchone()

        if row is None:
            return None
        return {
            "name": row["name"],
            "metadata": self._decode_metadata(row["metadata"]),
            "storage_path": row["storage_path"],
        }

    def update_file(
        self,
        name: str,
        metadata: dict[str, Any],
        storage_path: Path | None | object = ...,
    ) -> bool:
        with _connect(self.database_path) as connection:
            if storage_path is ...:
                cursor = connection.execute(
                    "UPDATE files SET metadata = ? WHERE name = ?",
                    (self._encode_metadata(metadata), name),
                )
            else:
                cursor = connection.execute(
                    "UPDATE files SET metadata = ?, storage_path = ? WHERE name = ?",
                    (
                        self._encode_metadata(metadata),
                        str(storage_path) if storage_path else None,
                        name,
                    ),
                )
            return cursor.rowcount > 0

    def delete_file(self, name: str) -> dict[str, Any] | None:
        with _connect(self.database_path) as connection:
            row = connection.execute(
                "SELECT name, metadata, storage_path FROM files WHERE name = ?",
                (name,),
            ).fetchone()
            if row is None:
                return None

            connection.execute("DELETE FROM files WHERE name = ?", (name,))
            return {
                "name": row["name"],
                "metadata": self._decode_metadata(row["metadata"]),
                "storage_path": row["storage_path"],
            }

    def list_files(
        self,
        prefix: str,
        limit: int,
        offset: int,
    ) -> tuple[list[dict[str, Any]], bool]:
        with _connect(self.database_path) as connection:
            rows = connection.execute(
                """
                SELECT name, metadata FROM files
                WHERE substr(name, 1, ?) = ?
                ORDER BY name ASC
                LIMIT ? OFFSET ?
                """,
                (len(prefix), prefix, limit + 1, offset),
            ).fetchall()

        has_more = len(rows) > limit
        return [
            {"name": row["name"], "metadata": self._decode_metadata(row["metadata"])}
            for row in rows[:limit]
        ], has_more

    def count_files(self) -> int:
        with _connect(self.database_path) as connection:
            row = connection.execute("SELECT COUNT(*) AS count FROM files").fetchone()
        return int(row["count"])

    def create_folder(self, folder: dict[str, Any]) -> None:
        with _connect(self.database_path) as connection:
            connection.execute(
                "INSERT INTO folders (id, name, cover_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (
                    folder["id"],
                    folder["name"],
                    folder.get("coverKey"),
                    folder["createdAt"],
                    folder["updatedAt"],
                ),
            )

    def get_folder(self, folder_id: str) -> dict[str, Any] | None:
        with _connect(self.database_path) as connection:
            row = connection.execute(
                "SELECT id, name, cover_key, created_at, updated_at FROM folders WHERE id = ?",
                (folder_id,),
            ).fetchone()
        return self._folder_from_row(row) if row else None

    def list_folders(self) -> list[dict[str, Any]]:
        with _connect(self.database_path) as connection:
            rows = connection.execute(
                "SELECT id, name, cover_key, created_at, updated_at FROM folders ORDER BY created_at DESC, name ASC"
            ).fetchall()
        return [self._folder_from_row(row) for row in rows]

    def folder_name_exists(self, name: str, exclude_id: str | None = None) -> bool:
        query = "SELECT 1 FROM folders WHERE lower(name) = lower(?)"
        params: tuple[Any, ...] = (name,)
        if exclude_id is not None:
            query += " AND id != ?"
            params += (exclude_id,)
        with _connect(self.database_path) as connection:
            return connection.execute(query, params).fetchone() is not None

    def update_folder(self, folder: dict[str, Any]) -> None:
        with _connect(self.database_path) as connection:
            connection.execute(
                "UPDATE folders SET name = ?, cover_key = ?, updated_at = ? WHERE id = ?",
                (
                    folder["name"],
                    folder.get("coverKey"),
                    folder["updatedAt"],
                    folder["id"],
                ),
            )

    def delete_folder(self, folder_id: str) -> list[str] | None:
        with _connect(self.database_path) as connection:
            folder_row = connection.execute(
                "SELECT id FROM folders WHERE id = ?", (folder_id,)
            ).fetchone()
            if folder_row is None:
                return None

            rows = connection.execute(
                "SELECT name, metadata FROM files"
            ).fetchall()
            detached_keys: list[str] = []
            for row in rows:
                metadata = self._decode_metadata(row["metadata"])
                if metadata.get("folderId") != folder_id:
                    continue
                metadata.pop("folderId", None)
                connection.execute(
                    "UPDATE files SET metadata = ? WHERE name = ?",
                    (self._encode_metadata(metadata), row["name"]),
                )
                detached_keys.append(row["name"])

            connection.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
            return detached_keys

    def clear_folder_cover(self, folder_id: str, cover_key: str) -> None:
        with _connect(self.database_path) as connection:
            connection.execute(
                "UPDATE folders SET cover_key = NULL WHERE id = ? AND cover_key = ?",
                (folder_id, cover_key),
            )

    @staticmethod
    def _folder_from_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "name": row["name"],
            "coverKey": row["cover_key"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

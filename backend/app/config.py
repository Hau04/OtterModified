from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[1]
REPOSITORY_DIR = BACKEND_DIR.parent
load_dotenv(BACKEND_DIR / ".env", override=False)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    app_env: str
    data_dir: Path
    database_path: Path
    storage_dir: Path
    chunks_dir: Path
    frontend_dir: Path
    basic_user: str
    basic_pass: str
    max_upload_size_bytes: int
    chunk_size_bytes: int
    max_file_count: int
    cors_origins: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "Settings":
        app_env = os.getenv("APP_ENV", "development").strip().lower()
        basic_user = os.getenv("BASIC_USER", "")
        basic_pass = os.getenv("BASIC_PASS", "")
        if app_env == "production" and (
            not basic_user
            or ":" in basic_user
            or not basic_pass
            or basic_user == "change-me"
            or basic_pass == "replace-with-a-long-random-password"
        ):
            raise ValueError(
                "Set non-placeholder BASIC_USER and BASIC_PASS values before production startup"
            )

        data_dir = Path(os.getenv("DATA_DIR", str(BACKEND_DIR / "data"))).expanduser()
        frontend_dir = Path(
            os.getenv("FRONTEND_DIR", str(REPOSITORY_DIR / "frontend" / "out"))
        ).expanduser()
        cors_origins = tuple(
            origin.strip()
            for origin in os.getenv("CORS_ORIGINS", "").split(",")
            if origin.strip()
        )

        return cls(
            app_env=app_env,
            data_dir=data_dir,
            database_path=Path(
                os.getenv("DATABASE_PATH", str(data_dir / "otterhub.sqlite3"))
            ).expanduser(),
            storage_dir=Path(
                os.getenv("STORAGE_DIR", str(data_dir / "files"))
            ).expanduser(),
            chunks_dir=Path(
                os.getenv("CHUNKS_DIR", str(data_dir / "chunks"))
            ).expanduser(),
            frontend_dir=frontend_dir,
            basic_user=basic_user,
            basic_pass=basic_pass,
            max_upload_size_bytes=max(
                1, _env_int("MAX_UPLOAD_SIZE_BYTES", 1024 * 1024 * 1024)
            ),
            chunk_size_bytes=max(
                1, _env_int("CHUNK_SIZE_BYTES", 20 * 1024 * 1024)
            ),
            max_file_count=max(0, _env_int("MAX_FILE_COUNT", 1000)),
            cors_origins=cors_origins,
        )

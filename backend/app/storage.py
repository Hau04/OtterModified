from __future__ import annotations

import hashlib
import mimetypes
import re
import secrets
import shutil
import urllib.parse
from pathlib import Path
from typing import Iterator

from fastapi import HTTPException


KEY_PATTERN = re.compile(r"^(img|audio|video|doc):([A-Za-z0-9_-]+)(?:\.([A-Za-z0-9]{1,10}))?$")
FILE_TYPES = {"img", "audio", "video", "doc"}


def classify_file(content_type: str | None, filename: str) -> str:
    mime = (content_type or "").lower()
    if mime.startswith("image/"):
        return "img"
    if mime.startswith("audio/"):
        return "audio"
    if mime.startswith("video/"):
        return "video"

    guessed, _ = mimetypes.guess_type(filename)
    if guessed:
        if guessed.startswith("image/"):
            return "img"
        if guessed.startswith("audio/"):
            return "audio"
        if guessed.startswith("video/"):
            return "video"
    return "doc"


def safe_filename(value: str | None) -> str:
    filename = (value or "upload").replace("\\", "/").split("/")[-1].strip()
    if not filename:
        filename = "upload"
    return filename[:100]


def safe_extension(filename: str) -> str:
    suffix = Path(filename).suffix.lower().lstrip(".")
    if not suffix or not suffix.isascii() or not suffix.isalnum() or len(suffix) > 10:
        return ""
    return f".{suffix}"


def make_file_key(file_type: str, extension: str) -> str:
    return f"{file_type}:{secrets.token_urlsafe(18)}{extension}"


def resolve_file_path(storage_dir: Path, key: str) -> Path:
    match = KEY_PATTERN.fullmatch(key)
    if not match:
        raise HTTPException(status_code=404, detail="File not found")
    return storage_dir / f"{match.group(2)}{'.' + match.group(3) if match.group(3) else ''}"


def chunk_directory(chunks_dir: Path, key: str) -> Path:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return chunks_dir / digest


def content_type_for(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def content_disposition(filename: str, disposition: str = "inline") -> str:
    cleaned = filename.replace("\r", "").replace("\n", "")
    ascii_fallback = cleaned.encode("ascii", "replace").decode("ascii").replace('"', "'")
    encoded = urllib.parse.quote(cleaned, safe="")
    return f'{disposition}; filename="{ascii_fallback}"; filename*=UTF-8\'\'{encoded}'


def parse_range(range_header: str | None, file_size: int) -> tuple[int, int] | None:
    if not range_header:
        return None
    if not range_header.startswith("bytes=") or "," in range_header:
        raise HTTPException(
            status_code=416,
            detail="Only one byte range is supported",
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    range_value = range_header.removeprefix("bytes=").strip()
    start_text, separator, end_text = range_value.partition("-")
    if not separator:
        raise HTTPException(
            status_code=416,
            detail="Invalid byte range",
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    try:
        if not start_text:
            suffix_length = int(end_text)
            if suffix_length <= 0 or file_size == 0:
                raise ValueError
            start = max(0, file_size - suffix_length)
            end = file_size - 1
        else:
            start = int(start_text)
            end = int(end_text) if end_text else file_size - 1
    except ValueError as error:
        raise HTTPException(
            status_code=416,
            detail="Invalid byte range",
            headers={"Content-Range": f"bytes */{file_size}"},
        ) from error

    if start < 0 or end < start or start >= file_size:
        raise HTTPException(
            status_code=416,
            detail="Requested range is not satisfiable",
            headers={"Content-Range": f"bytes */{file_size}"},
        )
    return start, min(end, file_size - 1)


def iter_file_range(path: Path, start: int, length: int, block_size: int = 1024 * 1024) -> Iterator[bytes]:
    remaining = length
    with path.open("rb") as stream:
        stream.seek(start)
        while remaining > 0:
            block = stream.read(min(block_size, remaining))
            if not block:
                break
            remaining -= len(block)
            yield block


def remove_file(path: Path | None) -> None:
    if path is None:
        return
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def remove_chunk_directory(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)

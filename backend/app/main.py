from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import math
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .config import Settings
from .database import Database
from .storage import (
    FILE_TYPES,
    KEY_PATTERN,
    chunk_directory,
    classify_file,
    content_disposition,
    content_type_for,
    iter_file_range,
    make_file_key,
    parse_range,
    remove_chunk_directory,
    remove_file,
    resolve_file_path,
    safe_extension,
    safe_filename,
)


CHUNK_LOCKS: dict[str, asyncio.Lock] = {}
MAX_FOLDER_NAME_LENGTH = 80
LIST_LIMIT = 1000


def api_ok(data: Any = None, message: str | None = None, status_code: int = 200) -> JSONResponse:
    return JSONResponse(
        {"success": True, "data": data, "message": message},
        status_code=status_code,
    )


def api_fail(message: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse(
        {"success": False, "data": None, "message": message},
        status_code=status_code,
    )


def _now_ms() -> int:
    return int(time.time() * 1000)


def _validate_folder_name(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if not cleaned or len(cleaned) > MAX_FOLDER_NAME_LENGTH:
        return None
    return cleaned


def _folder_response(folder: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": folder["id"],
        "name": folder["name"],
        "coverKey": folder.get("coverKey"),
        "createdAt": folder["createdAt"],
        "updatedAt": folder["updatedAt"],
    }


def _parse_basic_auth(header: str | None) -> tuple[str, str] | None:
    if not header or not header.startswith("Basic "):
        return None
    try:
        decoded = base64.b64decode(header[6:], validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    username, separator, password = decoded.partition(":")
    if not separator:
        return None
    return username, password


def _save_upload_file(upload: UploadFile, destination: Path, maximum_size: int) -> int:
    """Copy a spooled upload to disk without loading the whole file into memory."""
    upload.file.seek(0)
    total = 0
    try:
        with destination.open("wb") as output:
            while True:
                block = upload.file.read(1024 * 1024)
                if not block:
                    break
                total += len(block)
                if total > maximum_size:
                    raise ValueError("File exceeds the configured upload limit")
                output.write(block)
        return total
    except Exception:
        destination.unlink(missing_ok=True)
        raise


def _merge_chunks(chunk_path: Path, destination: Path, total_chunks: int, expected_size: int) -> int:
    temporary = destination.with_suffix(destination.suffix + ".part")
    size = 0
    try:
        with temporary.open("wb") as output:
            for index in range(total_chunks):
                part = chunk_path / f"{index:08d}.part"
                if not part.is_file():
                    raise FileNotFoundError(f"Missing upload chunk {index}")
                with part.open("rb") as source:
                    while block := source.read(1024 * 1024):
                        size += len(block)
                        if size > expected_size:
                            raise ValueError("Combined upload is larger than declared")
                        output.write(block)
        if size != expected_size:
            raise ValueError("Combined upload size does not match the declared size")
        temporary.replace(destination)
        return size
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    settings.chunks_dir.mkdir(parents=True, exist_ok=True)
    database = Database(settings.database_path)

    app = FastAPI(
        title="OtterHub Python API",
        version="1.0.0",
        docs_url="/docs" if settings.app_env != "production" else None,
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.database = database

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_credentials=True,
            allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS", "HEAD"],
            allow_headers=["Content-Type", "Authorization", "Range", "If-Range"],
            expose_headers=["Accept-Ranges", "Content-Range", "Content-Disposition", "ETag"],
        )

    @app.middleware("http")
    async def basic_authentication(request: Request, call_next):
        if request.url.path == "/healthz":
            return await call_next(request)

        if settings.basic_user and settings.basic_pass:
            credentials = _parse_basic_auth(request.headers.get("authorization"))
            if not credentials or not (
                hmac.compare_digest(
                    credentials[0].encode("utf-8"), settings.basic_user.encode("utf-8")
                )
                and hmac.compare_digest(
                    credentials[1].encode("utf-8"), settings.basic_pass.encode("utf-8")
                )
            ):
                return JSONResponse(
                    {"success": False, "data": None, "message": "Unauthorized"},
                    status_code=401,
                    headers={
                        "WWW-Authenticate": 'Basic realm="OtterHub Admin", charset="UTF-8"'
                    },
                )
        return await call_next(request)

    @app.get("/healthz")
    async def health_check():
        return {"status": "ok"}

    @app.get("/api/check")
    async def api_check():
        return api_ok()

    @app.post("/api/logout")
    async def logout():
        return JSONResponse(
            {"success": False, "data": None, "message": "Logged out."},
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="OtterHub Admin", charset="UTF-8"'},
        )

    @app.get("/api/list")
    async def list_files(request: Request):
        file_type = request.query_params.get("fileType")
        if file_type and file_type not in FILE_TYPES:
            return api_fail("Unsupported file type", 400)

        try:
            limit = int(request.query_params.get("limit", "100"))
            offset = int(request.query_params.get("cursor", "0") or "0")
        except ValueError:
            return api_fail("Invalid pagination parameters", 400)

        limit = max(1, min(limit, LIST_LIMIT))
        offset = max(0, offset)
        prefix = f"{file_type}:" if file_type else ""
        keys, has_more = database.list_files(prefix, limit, offset)
        next_cursor = str(offset + len(keys)) if has_more else None
        return api_ok(
            {
                "keys": keys,
                "list_complete": not has_more,
                "cursor": next_cursor,
            }
        )

    @app.get("/api/folders")
    async def list_folders():
        return api_ok({"folders": database.list_folders()})

    @app.post("/api/folders")
    async def create_folder(body: dict[str, Any] = Body(...)):
        name = _validate_folder_name(body.get("name"))
        if name is None:
            return api_fail(
                f"Folder name must be between 1 and {MAX_FOLDER_NAME_LENGTH} characters",
                400,
            )
        if database.folder_name_exists(name):
            return api_fail("A folder with this name already exists", 409)

        now = _now_ms()
        folder = {
            "id": str(uuid.uuid4()),
            "name": name,
            "coverKey": None,
            "createdAt": now,
            "updatedAt": now,
        }
        try:
            database.create_folder(folder)
        except Exception as error:
            if database.folder_name_exists(name):
                return api_fail("A folder with this name already exists", 409)
            raise error
        return api_ok(folder, "Photo folder created")

    @app.patch("/api/folders/{folder_id}")
    async def update_folder(folder_id: str, body: dict[str, Any] = Body(...)):
        folder = database.get_folder(folder_id)
        if folder is None:
            return api_fail("Photo folder not found", 404)

        updated = dict(folder)
        if "name" in body:
            name = _validate_folder_name(body["name"])
            if name is None:
                return api_fail(
                    f"Folder name must be between 1 and {MAX_FOLDER_NAME_LENGTH} characters",
                    400,
                )
            if database.folder_name_exists(name, exclude_id=folder_id):
                return api_fail("A folder with this name already exists", 409)
            updated["name"] = name

        if "coverKey" in body:
            cover_key = body["coverKey"]
            if cover_key is None:
                updated["coverKey"] = None
            elif isinstance(cover_key, str) and cover_key.startswith("img:"):
                file_record = database.get_file(cover_key)
                if not file_record or file_record["metadata"].get("folderId") != folder_id:
                    return api_fail("The poster image must belong to this folder", 400)
                updated["coverKey"] = cover_key
            else:
                return api_fail("Invalid poster image", 400)

        updated["updatedAt"] = _now_ms()
        database.update_folder(updated)
        return api_ok(_folder_response(updated), "Photo folder updated")

    @app.delete("/api/folders/{folder_id}")
    async def delete_folder(folder_id: str):
        detached_keys = database.delete_folder(folder_id)
        if detached_keys is None:
            return api_fail("Photo folder not found", 404)
        return api_ok(
            {"id": folder_id, "detachedKeys": detached_keys},
            "Photo folder deleted",
        )

    @app.post("/api/upload")
    async def upload_file(
        file: UploadFile = File(...),
        nsfw: str | None = Form(default=None),
        folder_id: str | None = Form(default=None, alias="folderId"),
    ):
        if settings.max_file_count and database.count_files() >= settings.max_file_count:
            return api_fail("File count exceeds the configured limit", 400)

        filename = safe_filename(file.filename)
        file_type = classify_file(file.content_type, filename)
        if folder_id:
            if file_type != "img":
                return api_fail("Only image files can be uploaded to photo folders", 400)
            if database.get_folder(folder_id) is None:
                return api_fail("Photo folder not found", 404)

        extension = safe_extension(filename)
        key = make_file_key(file_type, extension)
        final_path = resolve_file_path(settings.storage_dir, key)
        temporary_path = final_path.with_suffix(final_path.suffix + ".uploading")
        metadata: dict[str, Any] = {
            "fileName": filename,
            "fileSize": 0,
            "uploadedAt": _now_ms(),
            "liked": False,
            "tags": ["nsfw"] if nsfw == "true" else [],
        }
        if folder_id:
            metadata["folderId"] = folder_id

        try:
            size = await asyncio.to_thread(
                _save_upload_file,
                file,
                temporary_path,
                settings.max_upload_size_bytes,
            )
            temporary_path.replace(final_path)
            metadata["fileSize"] = size
            database.create_file(key, metadata, final_path)
        except ValueError as error:
            remove_file(temporary_path)
            return api_fail(str(error), 413)
        except Exception:
            remove_file(temporary_path)
            remove_file(final_path)
            raise
        finally:
            await file.close()

        return api_ok(key)

    @app.get("/api/upload/chunk")
    async def initialize_chunk_upload(request: Request):
        if settings.max_file_count and database.count_files() >= settings.max_file_count:
            return api_fail("File count exceeds the configured limit", 400)

        params = request.query_params
        file_type = params.get("fileType", "")
        filename = safe_filename(params.get("fileName"))
        try:
            file_size = int(params.get("fileSize", "0"))
            total_chunks = int(params.get("totalChunks", "0"))
        except ValueError:
            return api_fail("Invalid upload size", 400)

        if file_type not in FILE_TYPES or file_size <= 0 or total_chunks <= 0:
            return api_fail("Invalid chunk upload parameters", 400)
        if file_size > settings.max_upload_size_bytes:
            return api_fail("File exceeds the configured upload limit", 413)
        expected_chunks = math.ceil(file_size / settings.chunk_size_bytes)
        if total_chunks != expected_chunks:
            return api_fail("Chunk count does not match the declared file size", 400)

        folder_id = params.get("folderId")
        if folder_id:
            if file_type != "img":
                return api_fail("Only image files can be uploaded to photo folders", 400)
            if database.get_folder(folder_id) is None:
                return api_fail("Photo folder not found", 404)

        key = make_file_key(file_type, safe_extension(filename))
        metadata: dict[str, Any] = {
            "fileName": filename,
            "fileSize": file_size,
            "uploadedAt": _now_ms(),
            "liked": False,
            "tags": ["nsfw"] if params.get("nsfw") == "true" else [],
            "chunkInfo": {"total": total_chunks, "uploadedIndices": []},
        }
        if folder_id:
            metadata["folderId"] = folder_id
        database.create_file(key, metadata, None)
        return api_ok(key)

    @app.post("/api/upload/chunk")
    async def upload_chunk(
        key: str = Form(...),
        chunk_index: int = Form(..., alias="chunkIndex"),
        chunk_file: UploadFile = File(..., alias="chunkFile"),
    ):
        if not KEY_PATTERN.fullmatch(key):
            return api_fail("Invalid file key", 400)
        lock = CHUNK_LOCKS.setdefault(key, asyncio.Lock())

        async with lock:
            try:
                file_record = database.get_file(key)
                if file_record is None:
                    return api_fail("Chunk upload was not initialized", 404)
                metadata = file_record["metadata"]
                chunk_info = metadata.get("chunkInfo")
                if not chunk_info:
                    return api_fail("Not a chunked upload", 400)

                total_chunks = int(chunk_info.get("total", 0))
                if chunk_index < 0 or chunk_index >= total_chunks:
                    return api_fail("Invalid chunk index", 400)
                if file_record["storage_path"]:
                    return api_ok(chunk_index)

                part_directory = chunk_directory(settings.chunks_dir, key)
                part_directory.mkdir(parents=True, exist_ok=True)
                part_path = part_directory / f"{chunk_index:08d}.part"
                uploaded_indices = set(chunk_info.get("uploadedIndices", []))

                if chunk_index not in uploaded_indices:
                    expected_size = min(
                        settings.chunk_size_bytes,
                        int(metadata["fileSize"]) - chunk_index * settings.chunk_size_bytes,
                    )
                    try:
                        chunk_size = await asyncio.to_thread(
                            _save_upload_file,
                            chunk_file,
                            part_path,
                            settings.chunk_size_bytes,
                        )
                    except ValueError as error:
                        return api_fail(str(error), 413)

                    if chunk_size != expected_size:
                        remove_file(part_path)
                        return api_fail("Chunk size does not match the expected size", 400)

                    uploaded_indices.add(chunk_index)
                    chunk_info["uploadedIndices"] = sorted(uploaded_indices)
                    metadata["chunkInfo"] = chunk_info
                    database.update_file(key, metadata)

                if len(uploaded_indices) == total_chunks:
                    final_path = resolve_file_path(settings.storage_dir, key)
                    try:
                        await asyncio.to_thread(
                            _merge_chunks,
                            part_directory,
                            final_path,
                            total_chunks,
                            int(metadata["fileSize"]),
                        )
                        database.update_file(key, metadata, final_path)
                        remove_chunk_directory(part_directory)
                    except Exception as error:
                        remove_file(final_path)
                        return api_fail(f"Failed to assemble upload: {error}", 500)

                return api_ok(chunk_index)
            finally:
                await chunk_file.close()

    @app.patch("/api/editFileMeta/{key:path}")
    async def edit_file_metadata(key: str, body: dict[str, Any] = Body(...)):
        file_record = database.get_file(key)
        if file_record is None:
            return api_fail(f"File metadata not found for key: {key}", 404)

        metadata = dict(file_record["metadata"])
        if "fileName" in body:
            filename = safe_filename(body["fileName"])
            if not filename:
                return api_fail("File name must not be empty", 400)
            metadata["fileName"] = filename

        if "tags" in body:
            tags = body["tags"]
            if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
                return api_fail("Tags must be an array of strings", 400)
            metadata["tags"] = tags

        previous_folder_id = metadata.get("folderId")
        if "folderId" in body:
            if not key.startswith("img:"):
                return api_fail("Only image files can be assigned to photo folders", 400)
            folder_id = body["folderId"]
            if folder_id in (None, ""):
                metadata.pop("folderId", None)
            elif isinstance(folder_id, str) and database.get_folder(folder_id):
                metadata["folderId"] = folder_id
            elif isinstance(folder_id, str):
                return api_fail("Photo folder not found", 404)
            else:
                return api_fail("Invalid photo folder", 400)

        database.update_file(key, metadata)
        new_folder_id = metadata.get("folderId")
        if previous_folder_id and previous_folder_id != new_folder_id:
            previous_folder = database.get_folder(previous_folder_id)
            if previous_folder and previous_folder.get("coverKey") == key:
                database.clear_folder_cover(previous_folder_id, key)

        return api_ok({"metadata": metadata}, "File metadata updated")

    @app.post("/api/toggleLike/{key:path}")
    async def toggle_like(key: str):
        file_record = database.get_file(key)
        if file_record is None:
            return api_fail(f"File metadata not found for key: {key}", 404)
        metadata = dict(file_record["metadata"])
        metadata["liked"] = not bool(metadata.get("liked", False))
        database.update_file(key, metadata)
        return api_ok({"liked": metadata["liked"]})

    @app.post("/api/delete/{key:path}")
    async def delete_file(key: str):
        deleted = database.delete_file(key)
        if deleted is None:
            return api_fail("Failed to delete file", 404)

        remove_file(Path(deleted["storage_path"]) if deleted["storage_path"] else None)
        remove_chunk_directory(chunk_directory(settings.chunks_dir, key))
        metadata = deleted["metadata"]
        folder_id = metadata.get("folderId")
        if folder_id:
            folder = database.get_folder(folder_id)
            if folder and folder.get("coverKey") == key:
                database.clear_folder_cover(folder_id, key)

        return api_ok(True, "File deleted successfully")

    async def serve_file(key: str, request: Request):
        file_record = database.get_file(key)
        if file_record is None:
            return api_fail(f"File not found for key: {key}", 404)
        if not file_record["storage_path"]:
            return api_fail("File upload is incomplete", 425)

        path = Path(file_record["storage_path"])
        if not path.is_file():
            return api_fail(f"File not found for key: {key}", 404)

        file_size = path.stat().st_size
        try:
            byte_range = parse_range(request.headers.get("range"), file_size)
        except HTTPException as error:
            return JSONResponse(
                {"success": False, "data": None, "message": str(error.detail)},
                status_code=error.status_code,
                headers=error.headers or {},
            )

        headers = {
            "Accept-Ranges": "bytes",
            "Content-Type": content_type_for(path),
            "Content-Disposition": content_disposition(
                file_record["metadata"].get("fileName", path.name)
            ),
            "Cache-Control": "private, max-age=3600",
            "ETag": f'"{path.stat().st_size:x}-{path.stat().st_mtime_ns:x}"',
        }

        if byte_range is None:
            start, end = 0, file_size - 1
            status_code = 200
        else:
            start, end = byte_range
            status_code = 206
            headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

        length = max(0, end - start + 1)
        headers["Content-Length"] = str(length)
        if request.method == "HEAD":
            return Response(status_code=status_code, headers=headers)
        return StreamingResponse(
            iter_file_range(path, start, length),
            status_code=status_code,
            headers=headers,
        )

    @app.api_route("/file/{key:path}", methods=["GET", "HEAD"])
    async def get_file(key: str, request: Request):
        return await serve_file(key, request)

    if settings.frontend_dir.is_dir():
        app.mount(
            "/",
            StaticFiles(directory=str(settings.frontend_dir), html=True),
            name="frontend",
        )

    return app


app = create_app()

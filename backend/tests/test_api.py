from __future__ import annotations

import base64
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def make_settings(tmp_path: Path, **overrides) -> Settings:
    values = {
        "app_env": "test",
        "data_dir": tmp_path / "data",
        "database_path": tmp_path / "data" / "otterhub.sqlite3",
        "storage_dir": tmp_path / "data" / "files",
        "chunks_dir": tmp_path / "data" / "chunks",
        "frontend_dir": tmp_path / "frontend",
        "basic_user": "",
        "basic_pass": "",
        "max_upload_size_bytes": 1024 * 1024,
        "chunk_size_bytes": 4,
        "max_file_count": 100,
        "cors_origins": (),
    }
    values.update(overrides)
    return Settings(**values)


def test_photo_folder_lifecycle_range_and_file_delete(tmp_path: Path) -> None:
    client = TestClient(create_app(make_settings(tmp_path)))

    upload = client.post(
        "/api/upload",
        files={"file": ("photo.png", b"abcdef", "image/png")},
    )
    assert upload.status_code == 200
    key = upload.json()["data"]

    created = client.post("/api/folders", json={"name": "Weekend"})
    assert created.status_code == 200
    folder = created.json()["data"]

    assigned = client.patch(
        f"/api/editFileMeta/{key}",
        json={"folderId": folder["id"]},
    )
    assert assigned.status_code == 200
    assert assigned.json()["data"]["metadata"]["folderId"] == folder["id"]

    poster = client.patch(
        f"/api/folders/{folder['id']}",
        json={"coverKey": key},
    )
    assert poster.status_code == 200
    assert poster.json()["data"]["coverKey"] == key

    ranged = client.get(f"/file/{key}", headers={"Range": "bytes=1-3"})
    assert ranged.status_code == 206
    assert ranged.content == b"bcd"
    assert ranged.headers["content-range"] == "bytes 1-3/6"

    liked = client.post(f"/api/toggleLike/{key}")
    assert liked.json()["data"]["liked"] is True

    deleted_folder = client.delete(f"/api/folders/{folder['id']}")
    assert deleted_folder.status_code == 200
    assert deleted_folder.json()["data"]["detachedKeys"] == [key]

    listed = client.get("/api/list?fileType=img").json()["data"]["keys"]
    photo = next(item for item in listed if item["name"] == key)
    assert "folderId" not in photo["metadata"]
    assert photo["metadata"]["liked"] is True

    deleted = client.post(f"/api/delete/{key}")
    assert deleted.status_code == 200
    assert deleted.json()["data"] is True
    assert client.get(f"/file/{key}").status_code == 404


def test_chunked_upload_is_assembled_and_listed(tmp_path: Path) -> None:
    client = TestClient(create_app(make_settings(tmp_path)))

    initialized = client.get(
        "/api/upload/chunk",
        params={
            "fileType": "video",
            "fileName": "clip.mp4",
            "fileSize": "6",
            "totalChunks": "2",
        },
    )
    assert initialized.status_code == 200
    key = initialized.json()["data"]

    first = client.post(
        "/api/upload/chunk",
        data={"key": key, "chunkIndex": "0"},
        files={"chunkFile": ("part-0", b"abcd", "application/octet-stream")},
    )
    assert first.status_code == 200

    second = client.post(
        "/api/upload/chunk",
        data={"key": key, "chunkIndex": "1"},
        files={"chunkFile": ("part-1", b"ef", "application/octet-stream")},
    )
    assert second.status_code == 200

    response = client.get(f"/file/{key}")
    assert response.status_code == 200
    assert response.content == b"abcdef"

    files = client.get("/api/list?fileType=video").json()["data"]["keys"]
    item = next(file for file in files if file["name"] == key)
    assert item["metadata"]["chunkInfo"]["uploadedIndices"] == [0, 1]


def test_basic_auth_protects_api_but_allows_health_check(tmp_path: Path) -> None:
    client = TestClient(
        create_app(
            make_settings(
                tmp_path,
                basic_user="otter",
                basic_pass="secret秘密",
            )
        )
    )

    unauthorized = client.get("/api/list")
    assert unauthorized.status_code == 401
    assert unauthorized.headers["www-authenticate"].startswith("Basic ")
    assert client.get("/healthz").status_code == 200

    credentials = base64.b64encode("otter:secret秘密".encode("utf-8")).decode("ascii")
    authorized = client.get(
        "/api/list",
        headers={"Authorization": f"Basic {credentials}"},
    )
    assert authorized.status_code == 200
    assert authorized.json()["success"] is True


def test_direct_photo_upload_can_target_folder_and_keeps_nsfw_tag(tmp_path: Path) -> None:
    client = TestClient(create_app(make_settings(tmp_path)))
    folder = client.post("/api/folders", json={"name": "Travel"}).json()["data"]

    upload = client.post(
        "/api/upload",
        data={"folderId": folder["id"], "nsfw": "true"},
        files={"file": ("portrait.png", b"png-bytes", "image/png")},
    )
    assert upload.status_code == 200
    key = upload.json()["data"]
    listed = client.get("/api/list?fileType=img").json()["data"]["keys"]
    item = next(file for file in listed if file["name"] == key)
    assert item["metadata"]["folderId"] == folder["id"]
    assert item["metadata"]["tags"] == ["nsfw"]

    rejected = client.post(
        "/api/upload",
        data={"folderId": folder["id"]},
        files={"file": ("notes.txt", b"text", "text/plain")},
    )
    assert rejected.status_code == 400


def test_production_settings_reject_placeholder_credentials(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("BASIC_USER", "change-me")
    monkeypatch.setenv("BASIC_PASS", "replace-with-a-long-random-password")
    with pytest.raises(ValueError, match="non-placeholder BASIC_USER and BASIC_PASS"):
        Settings.from_env()

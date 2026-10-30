import os
import pytest
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.mark.asyncio
async def test_upload_file():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/upload",
            files={"file": ("test.mp3", b"fake mp3 content", "audio/mpeg")},
        )
    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert data["original_filename"] == "test.mp3"
    assert data["media_type"] == "mp3"


@pytest.mark.asyncio
async def test_upload_rejects_unsupported_type():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/upload",
            files={"file": ("test.txt", b"not audio", "text/plain")},
        )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_upload_webm_file():
    """WebM files should be accepted for browser recordings."""
    transport = ASGITransport(app=app)
    with patch("app.routers.upload.convert_to_mp3", new_callable=AsyncMock) as mock_convert:
        mock_convert.return_value = "/tmp/fake.mp3"
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/upload",
                files={"file": ("test.webm", b"\x1a\x45\xdf\xa3" + b"\x00" * 100, "audio/webm")},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["original_filename"] == "test.webm"
        assert data["media_type"] == "webm"
        mock_convert.assert_called_once()


@pytest.mark.asyncio
async def test_get_media_file():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Upload first
        upload_resp = await client.post(
            "/api/upload",
            files={"file": ("test.mp3", b"fake mp3 content", "audio/mpeg")},
        )
        file_id = upload_resp.json()["id"]

        # Retrieve media
        response = await client.get(f"/api/media/{file_id}")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_rename_file():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Upload first
        upload_resp = await client.post(
            "/api/upload",
            files={"file": ("test.mp3", b"fake mp3 content", "audio/mpeg")},
        )
        file_id = upload_resp.json()["id"]

        # Rename
        response = await client.patch(
            f"/api/files/{file_id}/rename",
            json={"filename": "my-meeting"},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["original_filename"] == "my-meeting.mp3"
    assert data["id"] == file_id


@pytest.mark.asyncio
async def test_rename_file_empty_name():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        upload_resp = await client.post(
            "/api/upload",
            files={"file": ("test.mp3", b"fake mp3 content", "audio/mpeg")},
        )
        file_id = upload_resp.json()["id"]

        response = await client.patch(
            f"/api/files/{file_id}/rename",
            json={"filename": "   "},
        )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_rename_file_not_found():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.patch(
            "/api/files/nonexistent/rename",
            json={"filename": "new-name"},
        )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_rename_preserves_extension():
    transport = ASGITransport(app=app)
    with patch("app.routers.upload.convert_to_mp3", new_callable=AsyncMock) as mock_convert:
        mock_convert.return_value = "/tmp/fake.mp3"
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            upload_resp = await client.post(
                "/api/upload",
                files={"file": ("recording.webm", b"\x1a\x45\xdf\xa3" + b"\x00" * 100, "audio/webm")},
            )
            file_id = upload_resp.json()["id"]

            response = await client.patch(
                f"/api/files/{file_id}/rename",
                json={"filename": "team-standup"},
            )
    assert response.status_code == 200
    data = response.json()
    assert data["original_filename"] == "team-standup.webm"


@pytest.mark.asyncio
async def test_rename_strips_caller_supplied_extension():
    # "meeting.webm" + original ".webm" must not become "meeting.webm.webm".
    transport = ASGITransport(app=app)
    with patch("app.routers.upload.convert_to_mp3", new_callable=AsyncMock) as mock_convert:
        mock_convert.return_value = "/tmp/fake.mp3"
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            upload_resp = await client.post(
                "/api/upload",
                files={"file": ("recording.webm", b"\x1a\x45\xdf\xa3" + b"\x00" * 100, "audio/webm")},
            )
            file_id = upload_resp.json()["id"]

            response = await client.patch(
                f"/api/files/{file_id}/rename",
                json={"filename": "meeting.webm"},
            )
    assert response.status_code == 200
    assert response.json()["original_filename"] == "meeting.webm"


@pytest.mark.asyncio
async def test_upload_mp3_has_video_false():
    """Audio files should have has_video=False."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/upload",
            files={"file": ("test.mp3", b"fake mp3 content", "audio/mpeg")},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["has_video"] is False


@pytest.mark.asyncio
async def test_upload_with_has_video_param():
    """Recorder can pass has_video query param to skip ffprobe."""
    transport = ASGITransport(app=app)
    with patch("app.routers.upload.convert_to_mp3", new_callable=AsyncMock) as mock_convert:
        mock_convert.return_value = "/tmp/fake.mp3"
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/upload?has_video=false",
                files={"file": ("recording.webm", b"\x1a\x45\xdf\xa3" + b"\x00" * 100, "audio/webm")},
            )
    assert response.status_code == 200
    data = response.json()
    assert data["has_video"] is False


@pytest.mark.asyncio
async def test_upload_with_has_video_true():
    """Recorder with camera passes has_video=true."""
    transport = ASGITransport(app=app)
    with patch("app.routers.upload.convert_to_mp3", new_callable=AsyncMock) as mock_convert, \
         patch("app.routers.upload.has_video_stream", new_callable=AsyncMock) as mock_detect:
        mock_convert.return_value = "/tmp/fake.mp3"
        mock_detect.return_value = True
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/upload?has_video=true",
                files={"file": ("recording.webm", b"\x1a\x45\xdf\xa3" + b"\x00" * 100, "audio/webm")},
            )
    assert response.status_code == 200
    data = response.json()
    assert data["has_video"] is True


@pytest.mark.asyncio
async def test_failed_conversion_removes_upload(tmp_path, monkeypatch):
    from app.routers.upload import settings
    monkeypatch.setattr(settings, "TEMP_PATH", str(tmp_path / "media"))
    transport = ASGITransport(app=app)
    with patch("app.routers.upload.convert_to_mp3", new_callable=AsyncMock, side_effect=RuntimeError("bad audio")):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/upload",
                files={"file": ("test.wav", b"not audio", "audio/wav")},
            )
    assert response.status_code == 422
    assert response.json()["detail"] == "Could not read the audio in this file."
    assert os.listdir(settings.TEMP_PATH) == []


INTRUDER = {"X-Auth-Request-User": "intruder"}


@pytest.mark.asyncio
async def test_upload_too_large_is_rejected_and_partial_file_removed(tmp_path, monkeypatch):
    from app.routers.upload import settings
    monkeypatch.setattr(settings, "TEMP_PATH", str(tmp_path / "media"))
    monkeypatch.setattr("app.routers.upload.MAX_FILE_SIZE", 10)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/upload", files={"file": ("big.mp3", b"x" * 11, "audio/mpeg")})
        listing = await client.get("/api/transcriptions")
    assert response.status_code == 413
    assert os.listdir(settings.TEMP_PATH) == []
    assert listing.json() == []


@pytest.mark.asyncio
async def test_upload_without_extension_is_rejected():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/upload", files={"file": ("noext", b"x", "audio/mpeg")})
    assert response.status_code == 400


async def _upload(client, name="test.mp3", headers=None):
    resp = await client.post("/api/upload", files={"file": (name, b"fake audio", "audio/mpeg")}, headers=headers)
    assert resp.status_code == 200
    return resp.json()["id"]


async def _paths(file_id):
    from app.database import get_db
    async with get_db() as db:
        row = await (await db.execute("SELECT file_path, mp3_path FROM files WHERE id = ?", (file_id,))).fetchone()
    return row["file_path"], row["mp3_path"]


@pytest.mark.asyncio
async def test_media_is_scoped_to_owner():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        file_id = await _upload(client)
        assert (await client.get(f"/api/media/{file_id}", headers=INTRUDER)).status_code == 404
        assert (await client.get(f"/api/media/{file_id}/fallback", headers=INTRUDER)).status_code == 404
        assert (await client.patch(f"/api/files/{file_id}/rename", json={"filename": "x"}, headers=INTRUDER)).status_code == 404
        own = await client.get(f"/api/media/{file_id}")
    assert own.status_code == 200
    assert own.headers["content-type"] == "audio/mpeg"


@pytest.mark.asyncio
async def test_media_404_when_file_missing_on_disk():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        file_id = await _upload(client)
        file_path, _ = await _paths(file_id)
        os.remove(file_path)
        resp = await client.get(f"/api/media/{file_id}")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "File not found on disk"


@pytest.mark.asyncio
async def test_media_fallback_serves_the_mp3_copy():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        file_id = await _upload(client, name="clip.wav")
        resp = await client.get(f"/api/media/{file_id}/fallback")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "audio/mpeg"
    assert resp.content == b"fake audio"  # conftest's fake conversion copies the bytes


@pytest.mark.asyncio
async def test_media_fallback_404s():
    from app.database import get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/media/missing/fallback")).status_code == 404

        gone = await _upload(client, name="gone.wav")
        os.remove((await _paths(gone))[1])
        missing_on_disk = await client.get(f"/api/media/{gone}/fallback")

        no_mp3 = await _upload(client, name="nomp3.wav")
        async with get_db() as db:
            await db.execute("UPDATE files SET mp3_path = NULL WHERE id = ?", (no_mp3,))
            await db.commit()
        no_fallback = await client.get(f"/api/media/{no_mp3}/fallback")
    assert missing_on_disk.status_code == 404
    assert missing_on_disk.json()["detail"] == "Fallback file not found on disk"
    assert no_fallback.status_code == 404
    assert no_fallback.json()["detail"] == "No fallback available"


@pytest.mark.asyncio
async def test_rename_rejects_too_long_name():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        file_id = await _upload(client)
        resp = await client.patch(f"/api/files/{file_id}/rename", json={"filename": "a" * 252})
        ok = await client.patch(f"/api/files/{file_id}/rename", json={"filename": "a" * 251})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Filename too long"
    assert ok.status_code == 200
    assert ok.json()["original_filename"] == "a" * 251 + ".mp3"

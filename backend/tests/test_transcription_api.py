import pytest
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.models import TranscriptionStatus, TranscriptionResult, Utterance

@pytest.fixture
def mock_asr():
    mock = AsyncMock()
    mock.submit.return_value = "asr-job-123"
    mock.get_status.return_value = TranscriptionStatus(id="asr-job-123", status="completed")
    mock.get_result.return_value = TranscriptionResult(
        id="asr-job-123", status="completed",
        utterances=[Utterance(start=0, end=1000, text="Hello", speaker="Speaker 1")],
        text="Hello", language="en",
    )
    return mock

@pytest.mark.asyncio
async def test_transcribe_creates_job(mock_asr):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        upload_resp = await client.post(
            "/api/upload",
            files={"file": ("test.mp3", b"fake", "audio/mpeg")},
        )
        file_id = upload_resp.json()["id"]

        with patch("app.routers.transcription.get_asr_backend", return_value=mock_asr):
            resp = await client.post("/api/transcribe", json={
                "file_id": file_id, "language": "en", "model": "base",
            })

    assert resp.status_code == 200
    assert "id" in resp.json()
    assert resp.json()["status"] == "pending"

@pytest.mark.asyncio
async def test_get_transcriptions_list(mock_asr):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Upload a file first so we have something in the list
        upload_resp = await client.post(
            "/api/upload",
            files={"file": ("test.mp3", b"fake", "audio/mpeg")},
        )
        file_id = upload_resp.json()["id"]

        with patch("app.routers.transcription.get_asr_backend", return_value=mock_asr):
            await client.post("/api/transcribe", json={
                "file_id": file_id, "language": "en", "model": "base",
            })

        resp = await client.get("/api/transcriptions")
    assert resp.status_code == 200
    items = resp.json()
    assert isinstance(items, list)
    assert len(items) > 0
    item = items[0]
    assert "expires_at" in item
    assert "archived" in item
    assert item["archived"] is False

@pytest.mark.asyncio
async def test_archive_transcription(mock_asr):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        upload_resp = await client.post(
            "/api/upload",
            files={"file": ("test.mp3", b"fake", "audio/mpeg")},
        )
        file_id = upload_resp.json()["id"]

        with patch("app.routers.transcription.get_asr_backend", return_value=mock_asr):
            transcribe_resp = await client.post("/api/transcribe", json={
                "file_id": file_id, "language": "en", "model": "base",
            })
        transcription_id = transcribe_resp.json()["id"]

        resp = await client.post(f"/api/transcription/{transcription_id}/archive")
        assert resp.status_code == 200
        assert resp.json()["status"] == "archived"
        assert "expires_at" in resp.json()

        # Verify list reflects archived state
        list_resp = await client.get("/api/transcriptions")
        items = list_resp.json()
        archived_item = next(i for i in items if i["id"] == transcription_id)
        assert archived_item["archived"] is True

@pytest.mark.asyncio
async def test_archive_nonexistent_transcription():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/transcription/nonexistent-id/archive")
    assert resp.status_code == 404

@pytest.mark.asyncio
async def test_deleted_during_processing_skips_title(mock_asr):
    """A transcription deleted mid-run must not have its text sent to the LLM."""
    from unittest.mock import MagicMock
    from app.database import get_db
    from app.models import TranscriptionSettings as TranscriptionSettingsModel
    from app.routers.transcription import _run_transcription

    async with get_db() as db:
        await db.execute(
            "INSERT INTO transcriptions (id, asr_backend, status) VALUES (?, ?, ?)",
            ("txn-del", "murmurai", "pending"),
        )
        await db.commit()

    original_result = mock_asr.get_result.return_value

    async def delete_row_then_return(job_id):
        async with get_db() as db:
            await db.execute("DELETE FROM transcriptions WHERE id = ?", ("txn-del",))
            await db.commit()
        return original_result

    mock_asr.get_result.side_effect = delete_row_then_return
    provider = MagicMock()
    provider.generate_title = AsyncMock(return_value="A title")
    req = TranscriptionSettingsModel(file_id="file-1", language="en", model="base")

    with patch("app.routers.transcription.get_asr_backend", return_value=mock_asr), \
         patch("app.services.llm.get_llm_provider", return_value=provider):
        await _run_transcription("txn-del", "/nonexistent/audio.mp3", req, submitted_at=0.0)

    provider.generate_title.assert_not_awaited()
    mock_asr.cleanup.assert_awaited_once_with("asr-job-123")
    async with get_db() as db:
        cursor = await db.execute("SELECT id FROM transcriptions WHERE id = ?", ("txn-del",))
        assert await cursor.fetchone() is None


@pytest.mark.asyncio
async def test_completion_stores_the_asr_result_as_the_original(mock_asr):
    import json
    from app.database import get_db
    from app.models import TranscriptionSettings as TranscriptionSettingsModel
    from app.routers.transcription import _run_transcription

    async with get_db() as db:
        await db.execute(
            "INSERT INTO transcriptions (id, asr_backend, status) VALUES (?, ?, ?)",
            ("txn-orig", "murmurai", "pending"),
        )
        await db.commit()
    req = TranscriptionSettingsModel(file_id="file-1", language="en", model="base")

    with patch("app.routers.transcription.get_asr_backend", return_value=mock_asr), \
         patch("app.services.llm.get_llm_provider", return_value=None):
        await _run_transcription("txn-orig", "/nonexistent/audio.mp3", req, submitted_at=0.0)

    async with get_db() as db:
        cursor = await db.execute(
            "SELECT status, result_json, original_result_json FROM transcriptions WHERE id = ?",
            ("txn-orig",),
        )
        row = await cursor.fetchone()
    assert row["status"] == "completed"
    assert row["original_result_json"] == row["result_json"]
    assert json.loads(row["original_result_json"]) == [
        {"start": 0, "end": 1000, "text": "Hello", "speaker": "Speaker 1"}
    ]


async def _insert_file(file_path, mp3_path):
    from app.database import get_db
    async with get_db() as db:
        await db.execute("INSERT OR IGNORE INTO users (id, email) VALUES ('dev-user', 'dev@localhost')")
        await db.execute(
            "INSERT INTO files (id, user_id, original_filename, file_path, mp3_path, media_type, file_size, expires_at) "
            "VALUES ('legacy', 'dev-user', 'a.mp3', ?, ?, 'mp3', 1, '2999-01-01 00:00:00')",
            (file_path, mp3_path),
        )
        await db.commit()


async def _stored_mp3_path():
    from app.database import get_db
    async with get_db() as db:
        cursor = await db.execute("SELECT mp3_path FROM files WHERE id = 'legacy'")
        return (await cursor.fetchone())["mp3_path"]


@pytest.mark.asyncio
async def test_transcribe_cleans_an_mp3_uploaded_before_the_asr_copy_was(mock_asr, tmp_path, monkeypatch):
    """Such a row's mp3_path is the original upload, tags and all."""
    import asyncio
    from app.services.audio import ensure_clean_asr_copy
    from tests.test_audio import _ffmpeg, _probe

    monkeypatch.setattr("app.routers.transcription.ensure_clean_asr_copy", ensure_clean_asr_copy)
    upload = tmp_path / "legacy.mp3"
    _ffmpeg(
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libmp3lame",
        "-id3v2_version", "3", "-metadata", "title=SECRET-TITLE", str(upload),
    )
    await _insert_file(str(upload), str(upload))

    transport = ASGITransport(app=app)
    with patch("app.routers.transcription.get_asr_backend", return_value=mock_asr), \
         patch("app.services.llm.get_llm_provider", return_value=None):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/transcribe", json={
                "file_id": "legacy", "language": "en", "model": "base",
            })
        for _ in range(500):
            if mock_asr.cleanup.await_count:
                break
            await asyncio.sleep(0.01)

    assert resp.status_code == 200
    clean = str(tmp_path / "legacy.asr.mp3")
    assert await _stored_mp3_path() == clean
    assert "SECRET-TITLE" not in _probe(clean)
    mock_asr.submit.assert_awaited_once()
    assert mock_asr.submit.await_args.args[0] == clean


@pytest.mark.asyncio
async def test_transcribe_422_when_the_asr_copy_cannot_be_prepared(mock_asr, monkeypatch):
    from app.database import get_db

    async def fail(file_path, mp3_path):
        raise RuntimeError("ffmpeg failed")

    monkeypatch.setattr("app.routers.transcription.ensure_clean_asr_copy", fail)
    await _insert_file("/data/legacy.mp3", "/data/legacy.mp3")

    transport = ASGITransport(app=app)
    with patch("app.routers.transcription.get_asr_backend", return_value=mock_asr):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/transcribe", json={
                "file_id": "legacy", "language": "en", "model": "base",
            })

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Could not prepare the audio for transcription."
    assert await _stored_mp3_path() == "/data/legacy.mp3"
    async with get_db() as db:
        cursor = await db.execute("SELECT COUNT(*) FROM transcriptions WHERE file_id = 'legacy'")
        assert (await cursor.fetchone())[0] == 0
    mock_asr.submit.assert_not_awaited()

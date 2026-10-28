import asyncio
import json

import pytest
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient, ASGITransport
import app.routers.transcription as transcription_module
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


# ---------------------------------------------------------------------------
# Read/edit/export/delete endpoints, user scoping and job state transitions
# ---------------------------------------------------------------------------

OWNER = "dev-user"  # what DEV_MODE resolves a header-less request to
INTRUDER = {"X-Auth-Request-User": "intruder"}

_UTTS = [
    {"start": 0, "end": 1500, "text": "Hello there", "speaker": "SPEAKER_00"},
    {"start": 1500, "end": 3000, "text": "General Kenobi", "speaker": "SPEAKER_01"},
]


async def _seed(txn_id, *, status="completed", user_id=OWNER, file_id=None,
                file_path=None, mp3_path=None, utterances=_UTTS, asr_job_id=None,
                error_message=None):
    """Insert a user, a file and a transcription row; return the file id."""
    from app.database import get_db
    file_id = file_id or f"file-{txn_id}"
    async with get_db() as db:
        await db.execute("INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)", (user_id, f"{user_id}@x"))
        await db.execute(
            "INSERT OR IGNORE INTO files (id, user_id, original_filename, file_path, mp3_path, media_type, file_size, expires_at) "
            "VALUES (?, ?, 'a.mp3', ?, ?, 'mp3', 1, '2999-01-01 00:00:00')",
            (file_id, user_id, file_path, mp3_path),
        )
        await db.execute(
            "INSERT INTO transcriptions (id, user_id, file_id, asr_backend, asr_job_id, status, language, result_json, error_message) "
            "VALUES (?, ?, ?, 'murmurai', ?, ?, 'en', ?, ?)",
            (txn_id, user_id, file_id, asr_job_id, status,
             json.dumps(utterances) if status == "completed" else None, error_message),
        )
        await db.commit()
    return file_id


async def _row(txn_id):
    from app.database import get_db
    async with get_db() as db:
        cursor = await db.execute("SELECT * FROM transcriptions WHERE id = ?", (txn_id,))
        return await cursor.fetchone()


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_transcribe_404_for_another_users_file(mock_asr):
    await _seed("t-foreign-file", user_id="someone-else")
    with patch("app.routers.transcription.get_asr_backend", return_value=mock_asr):
        async with _client() as client:
            resp = await client.post("/api/transcribe", json={"file_id": "file-t-foreign-file"})
    assert resp.status_code == 404
    mock_asr.submit.assert_not_awaited()


@pytest.mark.asyncio
async def test_transcribe_404_for_unknown_file():
    async with _client() as client:
        resp = await client.post("/api/transcribe", json={"file_id": "nope"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_transcribe_422_without_file_id():
    async with _client() as client:
        resp = await client.post("/api/transcribe", json={"language": "en"})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_status_reports_state_and_error():
    await _seed("t-status-failed", status="failed", error_message="ASR exploded")
    async with _client() as client:
        resp = await client.get("/api/status/t-status-failed")
    assert resp.status_code == 200
    assert resp.json()["status"] == "failed"
    assert resp.json()["error"] == "ASR exploded"


@pytest.mark.asyncio
async def test_status_is_scoped_to_owner():
    await _seed("t-status-scope")
    async with _client() as client:
        assert (await client.get("/api/status/t-status-scope", headers=INTRUDER)).status_code == 404
        assert (await client.get("/api/status/does-not-exist")).status_code == 404


@pytest.mark.asyncio
async def test_get_transcription_returns_utterances_text_and_mappings():
    await _seed("t-get")
    async with _client() as client:
        await client.put("/api/transcription/t-get/speakers", json={"mappings": {"SPEAKER_00": "Obi-Wan"}})
        resp = await client.get("/api/transcription/t-get")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "completed"
    assert data["text"] == "Hello there General Kenobi"
    assert data["language"] == "en"
    assert [u["text"] for u in data["utterances"]] == ["Hello there", "General Kenobi"]
    assert data["speaker_mappings"] == {"SPEAKER_00": "Obi-Wan"}


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["pending", "processing", "failed"])
async def test_get_transcription_400_until_completed(status):
    await _seed(f"t-get-{status}", status=status)
    async with _client() as client:
        resp = await client.get(f"/api/transcription/t-get-{status}")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_get_transcription_is_scoped_to_owner():
    await _seed("t-get-scope")
    async with _client() as client:
        resp = await client.get("/api/transcription/t-get-scope", headers=INTRUDER)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_export_each_format_applies_speaker_mappings():
    await _seed("t-export")
    async with _client() as client:
        await client.put("/api/transcription/t-export/speakers", json={"mappings": {"SPEAKER_00": "Obi-Wan"}})
        srt = await client.get("/api/transcription/t-export/export/srt")
        vtt = await client.get("/api/transcription/t-export/export/vtt")
        txt = await client.get("/api/transcription/t-export/export/txt")
        js = await client.get("/api/transcription/t-export/export/json")

    assert srt.status_code == 200
    assert srt.headers["content-type"].startswith("text/srt")
    assert "1\n00:00:00,000 --> 00:00:01,500\n[Obi-Wan]: Hello there" in srt.text
    assert "[SPEAKER_01]: General Kenobi" in srt.text

    assert vtt.headers["content-type"].startswith("text/vtt")
    assert vtt.text.startswith("WEBVTT")
    assert "00:00:01.500 --> 00:00:03.000\n[SPEAKER_01]: General Kenobi" in vtt.text

    assert txt.headers["content-type"].startswith("text/plain")
    assert txt.text == "[Obi-Wan]: Hello there\n[SPEAKER_01]: General Kenobi"

    assert js.headers["content-type"].startswith("application/json")
    assert js.json() == [{**_UTTS[0], "speaker": "Obi-Wan"}, _UTTS[1]]


@pytest.mark.asyncio
async def test_export_rejects_unknown_format():
    await _seed("t-export-bad")
    async with _client() as client:
        resp = await client.get("/api/transcription/t-export-bad/export/docx")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_export_404_for_unfinished_or_foreign_transcription():
    await _seed("t-export-pending", status="pending")
    await _seed("t-export-foreign")
    async with _client() as client:
        assert (await client.get("/api/transcription/t-export-pending/export/txt")).status_code == 404
        assert (await client.get("/api/transcription/t-export-foreign/export/txt", headers=INTRUDER)).status_code == 404


@pytest.mark.asyncio
async def test_update_transcription_replaces_utterances():
    await _seed("t-edit")
    new = [{"start": 0, "end": 900, "text": "Edited", "speaker": None}]
    async with _client() as client:
        resp = await client.put("/api/transcription/t-edit", json={"utterances": new})
        assert resp.status_code == 200
        got = await client.get("/api/transcription/t-edit")
    assert got.json()["utterances"] == new


@pytest.mark.asyncio
async def test_update_transcription_validates_body():
    await _seed("t-edit-invalid")
    async with _client() as client:
        resp = await client.put("/api/transcription/t-edit-invalid", json={"utterances": [{"text": "no times"}]})
    assert resp.status_code == 422
    assert json.loads((await _row("t-edit-invalid"))["result_json"]) == _UTTS


@pytest.mark.asyncio
async def test_update_transcription_refuses_foreign_or_unfinished():
    await _seed("t-edit-foreign")
    await _seed("t-edit-pending", status="processing")
    new = {"utterances": [{"start": 0, "end": 1, "text": "pwned"}]}
    async with _client() as client:
        assert (await client.put("/api/transcription/t-edit-foreign", json=new, headers=INTRUDER)).status_code == 404
        assert (await client.put("/api/transcription/t-edit-pending", json=new)).status_code == 404
    assert json.loads((await _row("t-edit-foreign"))["result_json"]) == _UTTS
    assert (await _row("t-edit-pending"))["result_json"] is None


@pytest.mark.asyncio
async def test_speaker_mappings_are_replaced_not_merged():
    await _seed("t-speakers")
    async with _client() as client:
        await client.put("/api/transcription/t-speakers/speakers", json={"mappings": {"SPEAKER_00": "A", "SPEAKER_01": "B"}})
        await client.put("/api/transcription/t-speakers/speakers", json={"mappings": {"SPEAKER_01": "Bee"}})
        resp = await client.get("/api/transcription/t-speakers")
    assert resp.json()["speaker_mappings"] == {"SPEAKER_01": "Bee"}


@pytest.mark.asyncio
async def test_speaker_mappings_refuse_foreign_transcription():
    await _seed("t-speakers-foreign")
    async with _client() as client:
        resp = await client.put("/api/transcription/t-speakers-foreign/speakers",
                                json={"mappings": {"SPEAKER_00": "pwned"}}, headers=INTRUDER)
        assert resp.status_code == 404
        own = await client.get("/api/transcription/t-speakers-foreign")
    assert own.json()["speaker_mappings"] == {}


@pytest.mark.asyncio
async def test_update_title_and_scoping():
    await _seed("t-title")
    async with _client() as client:
        assert (await client.patch("/api/transcription/t-title/title", json={"title": "Mine"})).status_code == 200
        assert (await client.patch("/api/transcription/t-title/title", json={"title": "Theirs"}, headers=INTRUDER)).status_code == 404
        assert (await client.patch("/api/transcription/t-title/title", json={})).status_code == 422
        items = (await client.get("/api/transcriptions")).json()
    assert next(i for i in items if i["id"] == "t-title")["title"] == "Mine"


@pytest.mark.asyncio
async def test_list_only_shows_own_transcriptions():
    await _seed("t-list-mine")
    await _seed("t-list-theirs", user_id="intruder")
    async with _client() as client:
        mine = {i["id"] for i in (await client.get("/api/transcriptions")).json()}
        theirs = {i["id"] for i in (await client.get("/api/transcriptions", headers=INTRUDER)).json()}
    assert mine == {"t-list-mine"}
    assert theirs == {"t-list-theirs"}


@pytest.mark.asyncio
async def test_archive_refuses_foreign_transcription():
    await _seed("t-archive-foreign")
    async with _client() as client:
        resp = await client.post("/api/transcription/t-archive-foreign/archive", headers=INTRUDER)
    assert resp.status_code == 404
    from app.database import get_db
    async with get_db() as db:
        row = await (await db.execute("SELECT is_archived FROM files WHERE id = 'file-t-archive-foreign'")).fetchone()
    assert row["is_archived"] == 0


@pytest.mark.asyncio
async def test_delete_removes_rows_files_and_remote_copy(tmp_path, mock_asr):
    from app.database import get_db
    upload, mp3 = tmp_path / "u.wav", tmp_path / "u.mp3"
    upload.write_bytes(b"x")
    mp3.write_bytes(b"y")
    await _seed("t-del", file_path=str(upload), mp3_path=str(mp3), asr_job_id="remote-1")
    async with get_db() as db:
        await db.execute("INSERT INTO analyses (id, transcription_id, analysis_json) VALUES ('a1', 't-del', '{}')")
        await db.commit()

    with patch("app.routers.transcription.get_asr_backend", return_value=mock_asr):
        async with _client() as client:
            await client.put("/api/transcription/t-del/speakers", json={"mappings": {"SPEAKER_00": "X"}})
            resp = await client.delete("/api/transcription/t-del")
            for _ in range(100):
                if mock_asr.cleanup.await_count:
                    break
                await asyncio.sleep(0.01)
            assert (await client.get("/api/status/t-del")).status_code == 404

    assert resp.status_code == 200
    assert resp.json() == {"status": "deleted"}
    mock_asr.cleanup.assert_awaited_once_with("remote-1")
    assert not upload.exists() and not mp3.exists()
    async with get_db() as db:
        for sql in ("SELECT 1 FROM files WHERE id = 'file-t-del'",
                    "SELECT 1 FROM analyses WHERE transcription_id = 't-del'",
                    "SELECT 1 FROM speaker_mappings WHERE transcription_id = 't-del'"):
            assert await (await db.execute(sql)).fetchone() is None


@pytest.mark.asyncio
async def test_delete_keeps_a_file_another_transcription_still_uses(tmp_path, mock_asr):
    from app.database import get_db
    upload = tmp_path / "shared.mp3"
    upload.write_bytes(b"x")
    file_id = await _seed("t-shared-1", file_path=str(upload), mp3_path=str(upload))
    await _seed("t-shared-2", file_id=file_id)

    with patch("app.routers.transcription.get_asr_backend", return_value=mock_asr):
        async with _client() as client:
            resp = await client.delete("/api/transcription/t-shared-1")

    assert resp.status_code == 200
    assert upload.exists()
    # No remote job id was recorded. get_asr_backend is patched so that a call
    # fails here instead of reaching the real ASR host, whose cleanup never raises.
    mock_asr.cleanup.assert_not_called()
    async with get_db() as db:
        assert await (await db.execute("SELECT 1 FROM files WHERE id = ?", (file_id,))).fetchone() is not None
    assert await _row("t-shared-2") is not None


@pytest.mark.asyncio
async def test_delete_tolerates_files_already_gone(tmp_path):
    await _seed("t-del-gone", file_path=str(tmp_path / "gone.wav"), mp3_path=str(tmp_path / "gone.mp3"))
    async with _client() as client:
        resp = await client.delete("/api/transcription/t-del-gone")
    assert resp.status_code == 200
    assert await _row("t-del-gone") is None


@pytest.mark.asyncio
async def test_delete_refuses_foreign_transcription(tmp_path):
    upload = tmp_path / "keep.mp3"
    upload.write_bytes(b"x")
    await _seed("t-del-foreign", file_path=str(upload), mp3_path=str(upload))
    async with _client() as client:
        resp = await client.delete("/api/transcription/t-del-foreign", headers=INTRUDER)
    assert resp.status_code == 404
    assert upload.exists()
    assert await _row("t-del-foreign") is not None


async def _run(txn_id, mock_asr, provider=None, duration=10.0):
    from app.models import TranscriptionSettings as TranscriptionSettingsModel

    async def _duration(_path):
        return duration

    req = TranscriptionSettingsModel(file_id=f"file-{txn_id}", language="en", model="base")
    with patch("app.routers.transcription.get_asr_backend", return_value=mock_asr), \
         patch("app.routers.transcription.get_media_duration", _duration), \
         patch("app.services.llm.get_llm_provider", return_value=provider):
        await transcription_module._run_transcription(txn_id, "/x/audio.mp3", req, submitted_at=0.0)


@pytest.mark.asyncio
async def test_run_moves_pending_to_completed_and_stores_title(mock_asr):
    from unittest.mock import MagicMock
    await _seed("t-run-ok", status="pending")
    seen = []

    async def _status(job_id):
        seen.append((await _row("t-run-ok"))["status"])
        return TranscriptionStatus(id=job_id, status="completed")

    mock_asr.get_status.side_effect = _status
    provider = MagicMock()
    provider.generate_title = AsyncMock(return_value="Greetings")
    await _run("t-run-ok", mock_asr, provider)

    row = await _row("t-run-ok")
    assert seen == ["processing"]  # marked processing while the ASR job runs
    assert row["status"] == "completed"
    assert row["asr_job_id"] == "asr-job-123"
    assert row["completed_at"] is not None
    assert json.loads(row["result_json"]) == [
        {"start": 0, "end": 1000, "text": "Hello", "speaker": "Speaker 1"}
    ]
    assert row["title"] == "Greetings"
    provider.generate_title.assert_awaited_once_with("Hello")
    mock_asr.cleanup.assert_awaited_once_with("asr-job-123")


@pytest.mark.asyncio
async def test_run_title_failure_still_completes(mock_asr):
    from unittest.mock import MagicMock
    await _seed("t-run-title-fail", status="pending")
    provider = MagicMock()
    provider.generate_title = AsyncMock(side_effect=RuntimeError("llm down"))
    await _run("t-run-title-fail", mock_asr, provider)
    row = await _row("t-run-title-fail")
    assert row["status"] == "completed"
    assert row["title"] == ""  # attempt over; the API shows it as null


@pytest.mark.asyncio
async def test_run_marks_failed_when_backend_reports_failure(mock_asr):
    await _seed("t-run-asr-failed", status="pending")
    mock_asr.get_status.return_value = TranscriptionStatus(id="asr-job-123", status="failed", error="GPU on fire")
    await _run("t-run-asr-failed", mock_asr)
    row = await _row("t-run-asr-failed")
    assert row["status"] == "failed"
    assert row["error_message"] == "GPU on fire"
    mock_asr.get_result.assert_not_awaited()
    mock_asr.cleanup.assert_awaited_once_with("asr-job-123")


@pytest.mark.asyncio
async def test_run_marks_failed_on_submit_error_without_remote_cleanup(mock_asr):
    await _seed("t-run-submit-err", status="pending")
    mock_asr.submit.side_effect = ConnectionError("asr unreachable")
    await _run("t-run-submit-err", mock_asr)
    row = await _row("t-run-submit-err")
    assert row["status"] == "failed"
    assert "asr unreachable" in row["error_message"]
    assert row["asr_job_id"] is None
    mock_asr.cleanup.assert_not_awaited()


@pytest.mark.asyncio
async def test_run_times_out_a_job_stuck_in_processing(mock_asr, monkeypatch):
    await _seed("t-run-stuck", status="pending")
    mock_asr.get_status.return_value = TranscriptionStatus(id="asr-job-123", status="processing")
    monkeypatch.setattr(transcription_module, "_job_timeout_for", lambda _d: -1)
    await _run("t-run-stuck", mock_asr)
    row = await _row("t-run-stuck")
    assert row["status"] == "failed"
    assert "stuck in 'processing'" in row["error_message"]
    mock_asr.cleanup.assert_awaited_once_with("asr-job-123")


@pytest.mark.asyncio
async def test_run_failure_after_delete_does_not_recreate_row(mock_asr):
    from app.database import get_db
    await _seed("t-run-del-fail", status="pending")

    async def _delete_then_fail(*_a, **_k):
        async with get_db() as db:
            await db.execute("DELETE FROM transcriptions WHERE id = 't-run-del-fail'")
            await db.commit()
        raise RuntimeError("boom")

    mock_asr.get_status.side_effect = _delete_then_fail
    await _run("t-run-del-fail", mock_asr)
    assert await _row("t-run-del-fail") is None
    mock_asr.cleanup.assert_awaited_once_with("asr-job-123")


# --- WebSocket status -------------------------------------------------------

def _ws_seed(tmp_path, *rows):
    """Init a DB without running the app lifespan; rows are _seed kwargs."""
    from app.database import init_db

    async def _go():
        await init_db(str(tmp_path / "ws.db"))
        for txn_id, kwargs in rows:
            await _seed(txn_id, **kwargs)

    asyncio.run(_go())


def test_ws_reports_completed_and_closes(tmp_path):
    from starlette.testclient import TestClient
    _ws_seed(tmp_path, ("t-ws-done", {}))
    client = TestClient(app)
    with client.websocket_connect("/api/ws/status/t-ws-done", headers={"X-Auth-Request-User": OWNER}) as ws:
        assert ws.receive_json() == {"type": "status", "status": "completed"}


def test_ws_includes_error_for_failed_jobs(tmp_path):
    from starlette.testclient import TestClient
    _ws_seed(tmp_path, ("t-ws-failed", {"status": "failed", "error_message": "nope"}))
    client = TestClient(app)
    with client.websocket_connect("/api/ws/status/t-ws-failed", headers={"X-Auth-Request-User": OWNER}) as ws:
        assert ws.receive_json() == {"type": "status", "status": "failed", "error": "nope"}


def test_ws_refuses_other_users_transcription(tmp_path):
    from starlette.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect
    _ws_seed(tmp_path, ("t-ws-foreign", {}))
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/ws/status/t-ws-foreign", headers=INTRUDER) as ws:
            ws.receive_json()
    assert exc.value.code == 4003


def test_ws_refusal_closes_after_releasing_the_db_connection(tmp_path):
    """The 4003 close is sent after `async with get_db()` has exited (#291).

    A client may stop its event loop as soon as it has the close frame, while
    aiosqlite's worker thread is still closing the connection.
    """
    from contextlib import asynccontextmanager
    from starlette.testclient import TestClient
    from starlette.websockets import WebSocket, WebSocketDisconnect
    import app.routers.transcription as transcription_module
    _ws_seed(tmp_path, ("t-ws-foreign", {}))
    open_connections = 0
    open_at_close: list[int] = []
    real_get_db = transcription_module.get_db

    @asynccontextmanager
    async def counting_get_db():
        nonlocal open_connections
        async with real_get_db() as db:
            open_connections += 1
            try:
                yield db
            finally:
                open_connections -= 1

    real_close = WebSocket.close

    async def recording_close(self, *args, **kwargs):
        open_at_close.append(open_connections)
        await real_close(self, *args, **kwargs)

    client = TestClient(app)
    with patch.object(transcription_module, "get_db", counting_get_db), \
         patch.object(WebSocket, "close", recording_close):
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect("/api/ws/status/t-ws-foreign", headers=INTRUDER) as ws:
                ws.receive_json()
    assert exc.value.code == 4003
    # The first close is the refusal; the handler's `finally` closes once more.
    assert open_at_close[0] == 0


def test_ws_requires_authentication(tmp_path):
    from starlette.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect
    _ws_seed(tmp_path, ("t-ws-anon", {}))
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/ws/status/t-ws-anon") as ws:
            ws.receive_json()
    assert exc.value.code == 4001


@pytest.mark.asyncio
async def test_transcribe_passes_timeout_and_request_id_to_backend(mock_asr, monkeypatch):
    # The router's own reference: importlib.reload in other tests replaces config.settings.
    from app.routers.transcription import settings
    monkeypatch.setattr(settings, "ASR_JOB_TIMEOUT_MIN", 1234)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        upload_resp = await client.post("/api/upload", files={"file": ("test.mp3", b"fake", "audio/mpeg")})
        file_id = upload_resp.json()["id"]
        with patch("app.routers.transcription.get_asr_backend", return_value=mock_asr):
            resp = await client.post("/api/transcribe", json={"file_id": file_id, "language": "en", "model": "base"})
            for _ in range(200):
                if mock_asr.submit.await_count:
                    break
                await asyncio.sleep(0.01)
    ts = mock_asr.submit.await_args.args[1]
    assert ts.request_id == resp.json()["id"]
    assert ts.job_timeout == 1234.0

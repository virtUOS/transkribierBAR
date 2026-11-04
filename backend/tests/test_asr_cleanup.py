"""The remote ASR copy of a transcript is deleted once the app has its own.

MurmurAI keeps every transcript it produces until a client deletes it, while the
app expires its copy after DEFAULT_EXPIRY_HOURS. Without the cleanup call the
remote copy outlives the user's, indefinitely.
"""
import asyncio

import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch

from app.database import get_db
from app.main import app, cleanup_old_files
from app.models import TranscriptionResult, TranscriptionStatus, Utterance
from app.models import TranscriptionSettings as TranscriptionSettingsModel
from app.routers.transcription import _run_transcription


def _backend():
    backend = AsyncMock()
    backend.submit.return_value = "asr-job-123"
    backend.get_status.return_value = TranscriptionStatus(id="asr-job-123", status="completed")
    backend.get_result.return_value = TranscriptionResult(
        id="asr-job-123", status="completed",
        utterances=[Utterance(start=0, end=1000, text="Hello", speaker=None)],
        text="Hello", language="en",
    )
    return backend


async def _run(backend):
    req = TranscriptionSettingsModel(file_id="file-1", language="en", model="base")
    with patch("app.routers.transcription.get_asr_backend", return_value=backend), \
         patch("app.services.llm.get_llm_provider", return_value=None):
        await _run_transcription("txn-1", "/nonexistent/audio.mp3", req, submitted_at=0.0)


@pytest.mark.asyncio
async def test_remote_transcript_deleted_after_result_is_stored():
    backend = _backend()
    await _run(backend)
    backend.cleanup.assert_awaited_once_with("asr-job-123")


@pytest.mark.asyncio
async def test_remote_transcript_deleted_when_job_fails_after_submit():
    """A job that failed or timed out still left a row on the remote side."""
    backend = _backend()
    backend.get_result.side_effect = RuntimeError("asr exploded")
    await _run(backend)
    backend.cleanup.assert_awaited_once_with("asr-job-123")


@pytest.mark.asyncio
async def test_no_remote_delete_when_submit_itself_failed():
    """Nothing was created remotely, so there is nothing to delete."""
    backend = _backend()
    backend.submit.side_effect = RuntimeError("asr unreachable")
    await _run(backend)
    backend.cleanup.assert_not_awaited()


async def _insert(file_id, expires_at, transcriptions):
    """Insert a file and its transcriptions, given as (id, status, asr_job_id)."""
    async with get_db() as db:
        await db.execute("INSERT OR IGNORE INTO users (id, email) VALUES ('dev-user', 'dev@localhost')")
        await db.execute(
            "INSERT INTO files (id, user_id, original_filename, media_type, file_size, expires_at) "
            "VALUES (?, 'dev-user', 'a.mp3', 'mp3', 1, ?)",
            (file_id, expires_at),
        )
        for tid, status, job in transcriptions:
            await db.execute(
                "INSERT INTO transcriptions (id, user_id, file_id, status, asr_job_id) VALUES (?, 'dev-user', ?, ?, ?)",
                (tid, file_id, status, job),
            )
        await db.commit()


@pytest.mark.asyncio
async def test_expiry_deletes_remote_transcripts_of_expired_rows():
    """Every expired row with a job id gets a remote delete, so one that failed earlier is retried."""
    await _insert("f-old", "2000-01-01 00:00:00", [("t-old", "completed", "job-old"), ("t-nojob", "failed", None)])
    await _insert("f-new", "2999-01-01 00:00:00", [("t-new", "completed", "job-new")])
    backend = AsyncMock()

    with patch("app.main.get_asr_backend", return_value=backend), \
         patch("app.main.delete_orphaned_media", AsyncMock(return_value=0)), \
         patch("app.main.asyncio.sleep", AsyncMock(side_effect=[None, asyncio.CancelledError()])):
        with pytest.raises(asyncio.CancelledError):
            await cleanup_old_files()

    backend.cleanup.assert_awaited_once_with("job-old")
    async with get_db() as db:
        cursor = await db.execute("SELECT id FROM transcriptions")
        assert [row["id"] for row in await cursor.fetchall()] == ["t-new"]

@pytest.mark.asyncio
async def test_expiry_deletes_local_rows_before_contacting_the_asr_host():
    """An unreachable ASR host must not hold back the local retention."""
    await _insert("f-old", "2000-01-01 00:00:00", [("t-old", "completed", "job-old")])
    release = asyncio.Event()
    seen = {}
    backend = AsyncMock()

    async def blocked_cleanup(job_id):
        if not seen:
            async with get_db() as db:
                for table in ("files", "transcriptions"):
                    cursor = await db.execute(f"SELECT COUNT(*) AS n FROM {table}")  # noqa: S608  # test's own tuple
                    seen[table] = (await cursor.fetchone())["n"]
        await release.wait()

    backend.cleanup.side_effect = blocked_cleanup
    real_sleep = asyncio.sleep  # asyncio.sleep is patched below, for the loop's pause

    with patch("app.main.get_asr_backend", return_value=backend), \
         patch("app.main.delete_orphaned_media", AsyncMock(return_value=0)), \
         patch("app.main.asyncio.sleep", AsyncMock(side_effect=[None, asyncio.CancelledError()])):
        task = asyncio.create_task(cleanup_old_files())
        try:
            for _ in range(200):
                if seen:
                    break
                await real_sleep(0.01)
        finally:
            release.set()
        with pytest.raises(asyncio.CancelledError):
            await task

    assert seen == {"files": 0, "transcriptions": 0}


async def _delete(backend, tid):
    with patch("app.routers.transcription.get_asr_backend", return_value=backend):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.delete(f"/api/transcription/{tid}")
        # The remote delete runs as a task after the response.
        for _ in range(5):
            await asyncio.sleep(0)
    return resp


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["pending", "processing", "completed", "failed"])
async def test_deleting_a_transcription_deletes_its_remote_transcript(status):
    """Whatever its status, a transcription with a job id leaves nothing on the ASR host."""
    await _insert("f-1", "2999-01-01 00:00:00", [("t-1", status, "job-1")])
    backend = AsyncMock()

    resp = await _delete(backend, "t-1")

    assert resp.status_code == 200
    backend.cleanup.assert_awaited_once_with("job-1")


@pytest.mark.asyncio
async def test_deleting_without_a_job_id_makes_no_remote_call():
    await _insert("f-1", "2999-01-01 00:00:00", [("t-1", "failed", None)])
    backend = AsyncMock()

    resp = await _delete(backend, "t-1")

    assert resp.status_code == 200
    backend.cleanup.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_response_does_not_wait_for_the_asr_host():
    await _insert("f-1", "2999-01-01 00:00:00", [("t-1", "completed", "job-1")])
    release = asyncio.Event()
    backend = AsyncMock()

    async def slow_cleanup(job_id):
        await release.wait()

    backend.cleanup.side_effect = slow_cleanup

    try:
        resp = await asyncio.wait_for(_delete(backend, "t-1"), timeout=2)
    finally:
        release.set()

    assert resp.status_code == 200
    backend.cleanup.assert_awaited_once_with("job-1")
    async with get_db() as db:
        cursor = await db.execute("SELECT 1 FROM transcriptions WHERE id = 't-1'")
        assert await cursor.fetchone() is None


@pytest.mark.asyncio
async def test_run_deleted_then_failed_cleans_up_without_counting_a_failure(caplog):
    """The user deleted the row mid-run: the failure is not an app error, but the remote copy still goes."""
    backend = _backend()
    backend.get_result.side_effect = RuntimeError("asr exploded")
    with patch("app.routers.transcription.inc") as inc_mock:
        await _run(backend)

    backend.cleanup.assert_awaited_once_with("asr-job-123")
    assert not [c for c in inc_mock.call_args_list if "failed" in c.args or "transcription_failed" in c.args]
    assert not [r for r in caplog.records if r.levelname == "ERROR"]


@pytest.mark.asyncio
async def test_run_failure_of_a_live_row_still_counts_and_logs(caplog):
    await _insert("file-1", "2999-01-01 00:00:00", [("txn-1", "pending", None)])
    backend = _backend()
    backend.get_result.side_effect = RuntimeError("asr exploded")
    with patch("app.routers.transcription.inc") as inc_mock:
        await _run(backend)

    assert any("failed" in c.args for c in inc_mock.call_args_list)
    assert [r for r in caplog.records if r.levelname == "ERROR"]
    backend.cleanup.assert_awaited_once_with("asr-job-123")

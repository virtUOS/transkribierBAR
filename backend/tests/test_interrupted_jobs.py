"""Transcriptions a restart interrupted are failed, and their remote transcripts deleted."""
import asyncio
import threading
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.testclient import TestClient

from app.config import settings
from app.database import get_db, init_db
from app.main import (
    INTERRUPTED_MESSAGE,
    app,
    cleanup_remote_jobs,
    clear_interrupted_llm_steps,
    fail_interrupted_transcriptions,
)


@pytest.mark.asyncio
async def test_interrupted_rows_marked_failed():
    async with get_db() as db:
        for tid, status, job in [
            ("t-pending", "pending", None),
            ("t-processing", "processing", "job-1"),
            ("t-completed", "completed", "job-2"),
            ("t-failed", "failed", "job-3"),
        ]:
            await db.execute(
                "INSERT INTO transcriptions (id, status, asr_job_id, error_message) VALUES (?, ?, ?, ?)",
                (tid, status, job, "old error" if status == "failed" else None),
            )
        await db.commit()

    assert await fail_interrupted_transcriptions() == ["job-1"]

    async with get_db() as db:
        cursor = await db.execute("SELECT id, status, error_message FROM transcriptions")
        rows = {r["id"]: (r["status"], r["error_message"]) for r in await cursor.fetchall()}
    assert rows["t-pending"] == ("failed", INTERRUPTED_MESSAGE)
    assert rows["t-processing"] == ("failed", INTERRUPTED_MESSAGE)
    assert rows["t-completed"] == ("completed", None)
    assert rows["t-failed"] == ("failed", "old error")


@pytest.mark.asyncio
async def test_interrupted_rows_carry_the_restart_code():
    """The web interface translates the code; the English message stays for API clients."""
    async with get_db() as db:
        await db.execute("INSERT INTO transcriptions (id, status) VALUES ('t-processing', 'processing')")
        await db.execute("INSERT INTO transcriptions (id, status) VALUES ('t-completed', 'completed')")
        await db.commit()

    await fail_interrupted_transcriptions()

    async with get_db() as db:
        cursor = await db.execute("SELECT id, error_code FROM transcriptions")
        codes = {r["id"]: r["error_code"] for r in await cursor.fetchall()}
    assert codes == {"t-processing": "server_restarted", "t-completed": None}


@pytest.mark.asyncio
async def test_interrupted_llm_markers_cleared():
    async with get_db() as db:
        await db.execute(
            "INSERT INTO transcriptions (id, status, refined_utterances_json) VALUES ('t-refining', 'completed', '')"
        )
        await db.execute(
            "INSERT INTO transcriptions (id, status, translated_utterances_json, translation_language, "
            "translation_source, translation_source_hash) VALUES ('t-translating', 'completed', '', 'en', 'src', 'h')"
        )
        await db.execute(
            "INSERT INTO transcriptions (id, status, refined_utterances_json, translated_utterances_json, "
            "translation_language) VALUES ('t-done', 'completed', '[1]', '[2]', 'de')"
        )
        await db.execute("INSERT INTO analyses (id, transcription_id, analysis_json) VALUES ('a-running', 't-done', NULL)")
        await db.execute("INSERT INTO analyses (id, transcription_id, analysis_json) VALUES ('a-done', 't-done', '{}')")
        await db.commit()

    await clear_interrupted_llm_steps()

    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, refined_utterances_json AS r, translated_utterances_json AS t, translation_language AS l, "
            "translation_source AS s, translation_source_hash AS h FROM transcriptions"
        )
        rows = {r["id"]: (r["r"], r["t"], r["l"], r["s"], r["h"]) for r in await cursor.fetchall()}
        cursor = await db.execute("SELECT id FROM analyses")
        analyses = [r["id"] for r in await cursor.fetchall()]
    assert rows["t-refining"] == (None, None, None, None, None)
    assert rows["t-translating"] == (None, None, None, None, None)
    assert rows["t-done"] == ("[1]", "[2]", "de", None, None)
    assert analyses == ["a-done"]


@pytest.mark.asyncio
async def test_cleanup_remote_jobs_deletes_each_transcript():
    backend = AsyncMock()
    with patch("app.main.get_asr_backend", return_value=backend):
        await cleanup_remote_jobs(["job-1", "job-2"])
    assert [c.args for c in backend.cleanup.await_args_list] == [("job-1",), ("job-2",)]


def test_startup_does_not_wait_for_remote_cleanup(tmp_path, monkeypatch):
    release = threading.Event()
    started = threading.Event()

    async def blocked_cleanup(job_id):
        started.set()
        while not release.is_set():
            await asyncio.sleep(0.01)

    backend = MagicMock()
    backend.cleanup = blocked_cleanup

    # lifespan initializes settings.db_path, so seed that database
    monkeypatch.setattr(settings, "DATABASE_PATH", str(tmp_path / "startup.db"))

    async def seed():
        await init_db(settings.db_path)
        async with get_db() as db:
            await db.execute(
                "INSERT INTO transcriptions (id, status, refined_utterances_json) VALUES ('t-refining', 'completed', '')"
            )
            await db.commit()

    async def refined_marker():
        async with get_db() as db:
            cursor = await db.execute("SELECT refined_utterances_json AS r FROM transcriptions WHERE id = 't-refining'")
            return (await cursor.fetchone())["r"]

    asyncio.run(seed())
    with patch("app.main.fail_interrupted_transcriptions", AsyncMock(return_value=["job-1"])), \
         patch("app.main.get_asr_backend", return_value=backend):
        try:
            with TestClient(app) as client:
                assert client.get("/api/health").status_code == 200
                assert started.wait(5)
                assert not release.is_set()
                # lifespan clears the markers a restart left behind
                assert asyncio.run(refined_marker()) is None
        finally:
            release.set()

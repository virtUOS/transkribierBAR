"""A failed transcription stores a stable code next to its English message.

The message is English and API clients may rely on it, so it stays as it is;
the web interface translates the known codes instead.
"""
import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch

from app.config import settings
from app.database import get_db
from app.main import app
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
    async with get_db() as db:
        await db.execute("INSERT INTO transcriptions (id, status) VALUES ('txn-1', 'pending')")
        await db.commit()
    req = TranscriptionSettingsModel(file_id="file-1", language="en", model="base")
    with patch("app.routers.transcription.get_asr_backend", return_value=backend), \
         patch("app.services.llm.get_llm_provider", return_value=None):
        await _run_transcription("txn-1", "/nonexistent/audio.mp3", req, submitted_at=0.0)
    async with get_db() as db:
        cursor = await db.execute("SELECT status, error_message, error_code FROM transcriptions WHERE id = 'txn-1'")
        return await cursor.fetchone()


@pytest.mark.asyncio
async def test_job_timeout_stores_timeout(monkeypatch):
    monkeypatch.setattr(settings, "ASR_JOB_TIMEOUT_MIN", -1)
    backend = _backend()
    backend.get_status.return_value = TranscriptionStatus(id="asr-job-123", status="processing")

    row = await _run(backend)

    assert row["status"] == "failed"
    assert row["error_code"] == "timeout"
    assert "stuck in 'processing'" in row["error_message"]


@pytest.mark.asyncio
async def test_failed_job_stores_asr_failed():
    backend = _backend()
    backend.get_status.return_value = TranscriptionStatus(id="asr-job-123", status="failed", error="GPU OOM")

    row = await _run(backend)

    assert (row["error_code"], row["error_message"]) == ("asr_failed", "GPU OOM")


@pytest.mark.asyncio
async def test_unreachable_server_stores_asr_unreachable():
    backend = _backend()
    backend.submit.side_effect = httpx.ConnectError("All connection attempts failed")

    row = await _run(backend)

    assert (row["error_code"], row["error_message"]) == ("asr_unreachable", "All connection attempts failed")


@pytest.mark.asyncio
async def test_http_error_from_the_server_stores_asr_unreachable():
    backend = _backend()
    request = httpx.Request("GET", "http://asr/v1/transcript/asr-job-123")
    backend.get_status.side_effect = httpx.HTTPStatusError(
        "Server error '502 Bad Gateway'", request=request, response=httpx.Response(502, request=request),
    )

    row = await _run(backend)

    assert row["error_code"] == "asr_unreachable"


@pytest.mark.asyncio
async def test_any_other_error_stores_unknown():
    backend = _backend()
    backend.get_result.side_effect = RuntimeError("asr exploded")

    row = await _run(backend)

    assert (row["error_code"], row["error_message"]) == ("unknown", "asr exploded")


@pytest.mark.asyncio
async def test_status_endpoint_returns_the_code_next_to_the_message():
    async with get_db() as db:
        await db.execute("INSERT INTO users (id, email) VALUES ('dev-user', 'dev@localhost')")
        await db.execute(
            "INSERT INTO transcriptions (id, user_id, status, error_message, error_code) "
            "VALUES ('t-1', 'dev-user', 'failed', 'ASR job x stuck', 'timeout')"
        )
        await db.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/status/t-1")

    assert resp.status_code == 200
    assert resp.json()["error"] == "ASR job x stuck"
    assert resp.json()["error_code"] == "timeout"


@pytest.mark.asyncio
async def test_backend_timeout_error_stores_timeout():
    backend = _backend()
    backend.submit.side_effect = TimeoutError("ASR request exceeded 1800s")
    row = await _run(backend)
    assert (row["status"], row["error_code"]) == ("failed", "timeout")

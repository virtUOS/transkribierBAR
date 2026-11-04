"""Tests for the shared ASR concurrency limit and the poll-loop timeout.

Both guard against a wedged ASR backend: the semaphore caps how many jobs can be
in flight at once, and the timeout stops a job stuck in "processing" from being
polled forever.
"""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.config import settings
from app.models import TranscriptionStatus
from app.routers.transcription import _job_timeout_for, _poll_until_done
from app.services.asr import base as asr_base


@pytest.fixture
def fake_clock(monkeypatch):
    """Drive the poll loop's clock forward on sleep instead of really waiting."""
    clock = {"t": 0.0}
    monkeypatch.setattr("app.routers.transcription.time.monotonic", lambda: clock["t"])

    async def fake_sleep(seconds):
        clock["t"] += seconds

    monkeypatch.setattr("app.routers.transcription.asyncio.sleep", fake_sleep)
    return clock


def test_no_backend_acquires_the_semaphore_itself():
    """Backends must not acquire asr_semaphore; the caller already holds it.

    _run_transcription holds the semaphore across submit and polling, so a backend
    acquiring it again deadlocks once more jobs than permits are in flight.
    """
    import inspect
    from app.services.asr import murmurai, whisperx

    for module in (whisperx, murmurai):
        source = inspect.getsource(module)
        assert "async with asr_semaphore" not in source, (
            f"{module.__name__} acquires asr_semaphore; the caller already holds it"
        )


@pytest.mark.asyncio
async def test_nested_acquire_would_deadlock():
    """Guards the reason backends must not re-acquire: nesting starves under load."""
    sem = asyncio.Semaphore(3)

    async def nested_job():
        async with sem:
            async with sem:
                await asyncio.sleep(0.01)

    # 7 jobs (the incident load) each needing 2 of 3 permits cannot all proceed.
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(
            asyncio.gather(*(nested_job() for _ in range(7))), timeout=1
        )


def test_semaphore_size_matches_config():
    """The shared semaphore is sized from ASR_MAX_CONCURRENT."""
    # _value is the remaining capacity of an untouched semaphore.
    assert asr_base.asr_semaphore._value == settings.ASR_MAX_CONCURRENT


@pytest.mark.asyncio
async def test_semaphore_caps_concurrent_holders():
    """Only N coroutines may hold the semaphore at once."""
    sem = asyncio.Semaphore(2)
    concurrent = 0
    peak = 0

    async def worker():
        nonlocal concurrent, peak
        async with sem:
            concurrent += 1
            peak = max(peak, concurrent)
            await asyncio.sleep(0.01)
            concurrent -= 1

    await asyncio.gather(*(worker() for _ in range(6)))

    assert peak == 2


def test_job_timeout_uses_floor_when_duration_unknown(monkeypatch):
    """Duration probing can fail; the floor still applies."""
    monkeypatch.setattr(settings, "ASR_JOB_TIMEOUT_MIN", 1800)
    monkeypatch.setattr(settings, "ASR_JOB_TIMEOUT_FACTOR", 10)

    assert _job_timeout_for(None) == 1800
    assert _job_timeout_for(0) == 1800


def test_job_timeout_scales_with_long_audio(monkeypatch):
    """Long audio gets a proportionally longer ceiling than the floor."""
    monkeypatch.setattr(settings, "ASR_JOB_TIMEOUT_MIN", 1800)
    monkeypatch.setattr(settings, "ASR_JOB_TIMEOUT_FACTOR", 10)

    # 600s of audio * 10 = 6000s, above the 1800s floor.
    assert _job_timeout_for(600) == 6000
    # 60s of audio * 10 = 600s, below the floor, so the floor wins.
    assert _job_timeout_for(60) == 1800


@pytest.mark.asyncio
async def test_poll_loop_times_out_on_stuck_job(monkeypatch, fake_clock):
    """A job stuck in 'processing' fails instead of polling forever.

    This is the incident case: the backend keeps returning 'processing' with no
    error, so without a ceiling the loop never exits.
    """
    monkeypatch.setattr(settings, "ASR_JOB_TIMEOUT_MIN", 30)
    monkeypatch.setattr(settings, "ASR_JOB_TIMEOUT_FACTOR", 10)

    backend = MagicMock()
    backend.get_status = AsyncMock(
        return_value=TranscriptionStatus(id="stuck-job-1", status="processing")
    )

    with pytest.raises(TimeoutError, match="stuck in 'processing'"):
        await _poll_until_done(backend, "stuck-job-1", audio_duration=None)

    assert fake_clock["t"] > 30


@pytest.mark.asyncio
async def test_poll_loop_returns_on_completion(monkeypatch, fake_clock):
    """A job that completes before the ceiling is unaffected by the timeout."""
    monkeypatch.setattr(settings, "ASR_JOB_TIMEOUT_MIN", 300)

    backend = MagicMock()
    backend.get_status = AsyncMock(
        side_effect=[
            TranscriptionStatus(id="job-2", status="processing"),
            TranscriptionStatus(id="job-2", status="processing"),
            TranscriptionStatus(id="job-2", status="completed"),
        ]
    )

    await _poll_until_done(backend, "job-2", audio_duration=None)

    assert backend.get_status.await_count == 3


@pytest.mark.asyncio
async def test_poll_loop_raises_on_backend_failure(monkeypatch, fake_clock):
    """An explicit backend failure surfaces its error, not a timeout."""
    monkeypatch.setattr(settings, "ASR_JOB_TIMEOUT_MIN", 300)

    backend = MagicMock()
    backend.get_status = AsyncMock(
        return_value=TranscriptionStatus(id="job-3", status="failed", error="GPU OOM")
    )

    with pytest.raises(RuntimeError, match="GPU OOM"):
        await _poll_until_done(backend, "job-3", audio_duration=None)


@pytest.mark.asyncio
async def test_poll_loop_allows_long_audio_past_floor(monkeypatch, fake_clock):
    """A long job that would exceed the floor still runs to completion."""
    monkeypatch.setattr(settings, "ASR_JOB_TIMEOUT_MIN", 30)
    monkeypatch.setattr(settings, "ASR_JOB_TIMEOUT_FACTOR", 10)

    # Stays "processing" past the 30s floor, then completes. With a 600s audio
    # duration the ceiling is 6000s, so this must not time out.
    statuses = [TranscriptionStatus(id="job-4", status="processing")] * 20
    statuses.append(TranscriptionStatus(id="job-4", status="completed"))

    backend = MagicMock()
    backend.get_status = AsyncMock(side_effect=statuses)

    await _poll_until_done(backend, "job-4", audio_duration=600)

    assert fake_clock["t"] > 30

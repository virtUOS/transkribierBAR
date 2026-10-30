"""What the status WebSocket sends about a finished transcription."""
import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import app.routers.transcription as transcription_module
from app.database import get_db
from app.main import app
from app.models import TranscriptionResult, TranscriptionStatus, Utterance
from app.models import TranscriptionSettings as TranscriptionSettingsModel


async def _seed(user_id: str, transcription_id: str, **columns) -> None:
    names = ", ".join(["id", "user_id", *columns])
    marks = ", ".join("?" * (len(columns) + 2))
    async with get_db() as db:
        await db.execute("INSERT INTO users (id, email) VALUES (?, ?)", (user_id, f"{user_id}@x"))
        await db.execute(
            f"INSERT INTO transcriptions ({names}) VALUES ({marks})",
            (transcription_id, user_id, *columns.values()),
        )
        await db.commit()


def test_failed_message_carries_the_error_code():
    user_id, transcription_id = str(uuid.uuid4()), str(uuid.uuid4())
    with TestClient(app) as client:
        asyncio.run(_seed(
            user_id, transcription_id, status="failed",
            error_message="The server restarted while this transcription was running.",
            error_code="server_restarted",
        ))
        with client.websocket_connect(
            f"/api/ws/status/{transcription_id}", headers={"X-Auth-Request-User": user_id},
        ) as ws:
            msg = ws.receive_json()

    assert msg == {
        "type": "status", "status": "failed",
        "error": "The server restarted while this transcription was running.",
        "error_code": "server_restarted",
    }


UTTERANCES = '[{"start": 0, "end": 1000, "text": "Hello", "speaker": null}]'


@pytest.fixture
def fast_title_wait(monkeypatch):
    """An LLM is configured; poll quickly and give up after a short cap."""
    monkeypatch.setattr(transcription_module.settings, "LLM_PROVIDER", "openai")
    monkeypatch.setattr(transcription_module.settings, "LLM_TIMEOUT", 2)
    monkeypatch.setattr(transcription_module, "WS_POLL_SECONDS", 0.02)


@pytest.fixture
def no_title_wait(monkeypatch):
    """Fail at once, instead of after the cap, if the socket starts waiting for a title."""
    async def must_not_wait(*args):
        raise AssertionError("the socket waited for a title")

    monkeypatch.setattr(transcription_module, "_send_title_when_ready", must_not_wait)


def _closes_within(ws, seconds: float) -> None:
    """The next thing the client sees is the close, sooner than the test's cap would allow."""
    started = time.monotonic()
    with pytest.raises(WebSocketDisconnect):
        ws.receive_json()
    assert time.monotonic() - started < seconds


async def _set(transcription_id: str, sql: str) -> None:
    async with get_db() as db:
        await db.execute(sql, (transcription_id,))
        await db.commit()


def _connect(client, user_id, transcription_id):
    return client.websocket_connect(
        f"/api/ws/status/{transcription_id}", headers={"X-Auth-Request-User": user_id},
    )


def test_completed_message_carries_a_title_that_is_already_there(fast_title_wait):
    user_id, transcription_id = str(uuid.uuid4()), str(uuid.uuid4())
    with TestClient(app) as client:
        asyncio.run(_seed(user_id, transcription_id, status="completed", result_json=UTTERANCES, title="Weekly meeting"))
        with _connect(client, user_id, transcription_id) as ws:
            assert ws.receive_json() == {"type": "status", "status": "completed", "title": "Weekly meeting"}
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()


def test_title_written_after_completion_is_sent_then_the_socket_closes(fast_title_wait):
    user_id, transcription_id = str(uuid.uuid4()), str(uuid.uuid4())
    with TestClient(app) as client:
        asyncio.run(_seed(user_id, transcription_id, status="completed", result_json=UTTERANCES))
        with _connect(client, user_id, transcription_id) as ws:
            assert ws.receive_json() == {"type": "status", "status": "completed"}
            asyncio.run(_set(transcription_id, "UPDATE transcriptions SET title = 'Weekly meeting' WHERE id = ?"))
            assert ws.receive_json() == {"type": "title", "title": "Weekly meeting"}
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()


def test_no_title_wait_without_an_llm(fast_title_wait, no_title_wait, monkeypatch):
    monkeypatch.setattr(transcription_module.settings, "LLM_PROVIDER", "")
    user_id, transcription_id = str(uuid.uuid4()), str(uuid.uuid4())
    with TestClient(app) as client:
        asyncio.run(_seed(user_id, transcription_id, status="completed", result_json=UTTERANCES))
        with _connect(client, user_id, transcription_id) as ws:
            assert ws.receive_json() == {"type": "status", "status": "completed"}
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()


def test_no_title_wait_for_a_transcript_without_utterances(fast_title_wait, no_title_wait):
    """_run_transcription asks for no title then, so none will come."""
    user_id, transcription_id = str(uuid.uuid4()), str(uuid.uuid4())
    with TestClient(app) as client:
        asyncio.run(_seed(user_id, transcription_id, status="completed", result_json="[]"))
        with _connect(client, user_id, transcription_id) as ws:
            assert ws.receive_json() == {"type": "status", "status": "completed"}
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()


def test_title_wait_ends_silently_at_the_cap(fast_title_wait, monkeypatch):
    monkeypatch.setattr(transcription_module.settings, "LLM_TIMEOUT", 0.1)
    user_id, transcription_id = str(uuid.uuid4()), str(uuid.uuid4())
    with TestClient(app) as client:
        asyncio.run(_seed(user_id, transcription_id, status="completed", result_json=UTTERANCES))
        with _connect(client, user_id, transcription_id) as ws:
            assert ws.receive_json() == {"type": "status", "status": "completed"}
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()


def test_title_wait_ends_silently_when_the_row_is_deleted(fast_title_wait):
    user_id, transcription_id = str(uuid.uuid4()), str(uuid.uuid4())
    with TestClient(app) as client:
        asyncio.run(_seed(user_id, transcription_id, status="completed", result_json=UTTERANCES))
        with _connect(client, user_id, transcription_id) as ws:
            assert ws.receive_json() == {"type": "status", "status": "completed"}
            asyncio.run(_set(transcription_id, "DELETE FROM transcriptions WHERE id = ?"))
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()


@pytest.mark.asyncio
async def test_title_wait_ends_when_the_client_leaves(monkeypatch):
    """The wait sends nothing that would fail on a closed connection, so it listens instead."""
    monkeypatch.setattr(transcription_module.settings, "LLM_TIMEOUT", 600)
    websocket = AsyncMock()
    websocket.receive.return_value = {"type": "websocket.disconnect", "code": 1001}

    await asyncio.wait_for(transcription_module._send_title_when_ready(websocket, "t-1", None), timeout=2)

    assert websocket.receive.await_count == 1
    websocket.send_json.assert_not_awaited()


def test_no_title_wait_after_an_attempt_without_a_title(fast_title_wait, no_title_wait):
    """'' is what _run_transcription leaves when the title attempt produced nothing."""
    user_id, transcription_id = str(uuid.uuid4()), str(uuid.uuid4())
    with TestClient(app) as client:
        asyncio.run(_seed(user_id, transcription_id, status="completed", result_json=UTTERANCES, title=""))
        with _connect(client, user_id, transcription_id) as ws:
            assert ws.receive_json() == {"type": "status", "status": "completed"}
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()


def test_title_wait_ends_when_the_attempt_ends_without_a_title(fast_title_wait):
    user_id, transcription_id = str(uuid.uuid4()), str(uuid.uuid4())
    with TestClient(app) as client:
        asyncio.run(_seed(user_id, transcription_id, status="completed", result_json=UTTERANCES))
        with _connect(client, user_id, transcription_id) as ws:
            assert ws.receive_json() == {"type": "status", "status": "completed"}
            asyncio.run(_set(transcription_id, "UPDATE transcriptions SET title = '' WHERE id = ?"))
            _closes_within(ws, 1)


def test_late_client_waits_only_for_what_is_left_of_the_cap(fast_title_wait):
    """The cap counts from completion, not from when this client connected."""
    user_id, transcription_id = str(uuid.uuid4()), str(uuid.uuid4())
    completed_at = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
    with TestClient(app) as client:
        asyncio.run(_seed(
            user_id, transcription_id, status="completed", result_json=UTTERANCES, completed_at=completed_at,
        ))
        with _connect(client, user_id, transcription_id) as ws:
            assert ws.receive_json() == {"type": "status", "status": "completed"}
            _closes_within(ws, 1)


async def _run_with_title_reply(generate_title: AsyncMock) -> str | None:
    """Run a transcription to completion with an LLM whose title call is generate_title; return the stored title."""
    async with get_db() as db:
        await db.execute("INSERT INTO transcriptions (id, status) VALUES ('txn-1', 'pending')")
        await db.commit()
    backend = AsyncMock()
    backend.submit.return_value = "asr-job-123"
    backend.get_status.return_value = TranscriptionStatus(id="asr-job-123", status="completed")
    backend.get_result.return_value = TranscriptionResult(
        id="asr-job-123", status="completed",
        utterances=[Utterance(start=0, end=1000, text="Hello", speaker=None)], text="Hello", language="en",
    )
    provider = MagicMock()
    provider.generate_title = generate_title
    req = TranscriptionSettingsModel(file_id="file-1", language="en", model="base")
    with patch("app.routers.transcription.get_asr_backend", return_value=backend), \
         patch("app.services.llm.get_llm_provider", return_value=provider):
        await transcription_module._run_transcription("txn-1", "/nonexistent/audio.mp3", req, submitted_at=0.0)
    async with get_db() as db:
        cursor = await db.execute("SELECT status, title FROM transcriptions WHERE id = 'txn-1'")
        row = await cursor.fetchone()
    assert row["status"] == "completed"
    return row["title"]


@pytest.mark.asyncio
async def test_title_reply_is_stored():
    assert await _run_with_title_reply(AsyncMock(return_value="Weekly meeting")) == "Weekly meeting"


@pytest.mark.asyncio
async def test_failed_title_attempt_leaves_an_empty_title():
    assert await _run_with_title_reply(AsyncMock(side_effect=RuntimeError("LLM down"))) == ""


@pytest.mark.asyncio
async def test_blank_title_reply_leaves_an_empty_title():
    assert await _run_with_title_reply(AsyncMock(return_value="  ")) == ""


@pytest.mark.asyncio
async def test_a_failed_title_attempt_keeps_a_title_the_user_set_meanwhile():
    async def user_renames_then_llm_fails(text):
        await _set("txn-1", "UPDATE transcriptions SET title = 'Mine' WHERE id = ?")
        raise RuntimeError("LLM down")

    assert await _run_with_title_reply(AsyncMock(side_effect=user_renames_then_llm_fails)) == "Mine"


@pytest.mark.asyncio
async def test_a_generated_title_does_not_overwrite_a_title_the_user_set_meanwhile():
    async def user_renames_then_llm_answers(text):
        await _set("txn-1", "UPDATE transcriptions SET title = 'Mine' WHERE id = ?")
        return "Generated"

    assert await _run_with_title_reply(AsyncMock(side_effect=user_renames_then_llm_answers)) == "Mine"


@pytest.mark.asyncio
async def test_list_shows_an_empty_title_as_null():
    """'' only tells the WebSocket the attempt is over; API clients keep seeing null."""
    async with get_db() as db:
        await db.execute("INSERT INTO users (id, email) VALUES ('dev-user', 'dev@localhost')")
        await db.execute(
            "INSERT INTO files (id, user_id, original_filename, media_type, file_size, expires_at) "
            "VALUES ('f-1', 'dev-user', 'a.mp3', 'mp3', 1, '2999-01-01 00:00:00')"
        )
        await db.execute(
            "INSERT INTO transcriptions (id, user_id, file_id, status, title) "
            "VALUES ('t-1', 'dev-user', 'f-1', 'completed', '')"
        )
        await db.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/transcriptions")

    assert resp.status_code == 200
    assert [item["title"] for item in resp.json()] == [None]

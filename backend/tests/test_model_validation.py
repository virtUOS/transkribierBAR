"""The API only accepts transcription models the instance offers."""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch

from app.config import settings
from app.database import get_db
from app.main import app
from app.models import TranscriptionResult, TranscriptionStatus, Utterance


@pytest.fixture
def instance_models(monkeypatch):
    monkeypatch.setattr(settings, "WHISPER_MODELS", ["tiny", "large-v3"])
    monkeypatch.setattr(settings, "DEFAULT_WHISPER_MODEL", "tiny")


@pytest.fixture
def mock_asr():
    mock = AsyncMock()
    mock.submit.return_value = "asr-job-1"
    mock.get_status.return_value = TranscriptionStatus(id="asr-job-1", status="completed")
    mock.get_result.return_value = TranscriptionResult(
        id="asr-job-1", status="completed",
        utterances=[Utterance(start=0, end=1000, text="Hello", speaker=None)],
        text="Hello", language="en",
    )
    return mock


async def _transcribe(client, mock_asr, **fields):
    upload = await client.post("/api/upload", files={"file": ("t.mp3", b"x", "audio/mpeg")})
    with patch("app.routers.transcription.get_asr_backend", return_value=mock_asr):
        return await client.post("/api/transcribe", json={"file_id": upload.json()["id"], **fields})


async def _stored_model(txn_id):
    async with get_db() as db:
        row = await (await db.execute("SELECT model FROM transcriptions WHERE id = ?", (txn_id,))).fetchone()
    return row["model"]


@pytest.mark.asyncio
@pytest.mark.parametrize("fields", [{}, {"model": None}])
async def test_missing_model_uses_the_instance_default(instance_models, mock_asr, fields):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await _transcribe(client, mock_asr, **fields)
    assert resp.status_code == 200
    assert await _stored_model(resp.json()["id"]) == "tiny"


@pytest.mark.asyncio
async def test_unknown_model_is_rejected(instance_models, mock_asr):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await _transcribe(client, mock_asr, model="gpt-9000")
    assert resp.status_code == 422
    assert "gpt-9000" in resp.json()["detail"]
    mock_asr.submit.assert_not_called()


@pytest.mark.asyncio
async def test_listed_model_is_accepted(instance_models, mock_asr):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await _transcribe(client, mock_asr, model="large-v3")
    assert resp.status_code == 200
    assert await _stored_model(resp.json()["id"]) == "large-v3"


@pytest_asyncio.fixture
async def preset_user():
    async with get_db() as db:
        await db.execute("INSERT OR IGNORE INTO users (id, email) VALUES ('test-user', 'test-user@test.com')")
        await db.commit()
    return {"X-Auth-Request-User": "test-user", "X-Auth-Request-Email": "test-user@test.com"}


@pytest.mark.asyncio
async def test_preset_with_unknown_model_is_rejected(instance_models, preset_user):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=preset_user) as client:
        created = await client.post("/api/presets/transcription", json={"name": "ok", "model": "large-v3"})
        assert created.status_code == 201
        bad_create = await client.post("/api/presets/transcription", json={"name": "bad", "model": "nope"})
        bad_update = await client.put(
            f"/api/presets/transcription/{created.json()['id']}", json={"name": "ok", "model": "nope"},
        )
    assert bad_create.status_code == 422
    assert "nope" in bad_create.json()["detail"]
    assert bad_update.status_code == 422
    assert "nope" in bad_update.json()["detail"]


@pytest.mark.asyncio
async def test_preset_without_model_uses_the_instance_default(instance_models, preset_user):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=preset_user) as client:
        resp = await client.post("/api/presets/transcription", json={"name": "no model"})
    assert resp.status_code == 201
    assert resp.json()["model"] == "tiny"


@pytest.mark.asyncio
@pytest.mark.parametrize("bounds", [
    {"min_speakers": -1}, {"max_speakers": -2}, {"min_speakers": 3, "max_speakers": 2},
])
async def test_invalid_speaker_bounds_are_rejected(instance_models, mock_asr, bounds):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await _transcribe(client, mock_asr, model="tiny", **bounds)
    assert resp.status_code == 422
    mock_asr.submit.assert_not_awaited()


@pytest.mark.asyncio
async def test_min_speakers_alone_is_accepted(instance_models, mock_asr):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await _transcribe(client, mock_asr, model="tiny", min_speakers=2, max_speakers=0)
    assert resp.status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("fields", [{}, {"language": None}, {"language": "auto"}])
async def test_auto_detect_is_stored_as_no_language(instance_models, mock_asr, fields):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await _transcribe(client, mock_asr, **fields)
    assert resp.status_code == 200
    async with get_db() as db:
        row = await (await db.execute(
            "SELECT language FROM transcriptions WHERE id = ?", (resp.json()["id"],),
        )).fetchone()
    assert row["language"] is None

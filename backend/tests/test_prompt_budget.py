from pathlib import Path

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database import get_db
from app.services.prompt_budget import PROMPT_TOKEN_LIMIT, prompt_tokens

DEV_HEADERS = {"X-Auth-Request-User": "test-user", "X-Auth-Request-Email": "test@test.com"}

# Exactly the limit: " a" is one token, and the hotwords add one more.
AT_LIMIT_PROMPT = "a" + " a" * (PROMPT_TOKEN_LIMIT - 2)
AT_LIMIT_HOTWORDS = "a"


# Counted with the tokenizer.json of Systran/faster-whisper-large-v3, which the ASR
# server loads (the large-v3-turbo one counts text the same way).
@pytest.mark.parametrize("text, tokens", [
    ("Sitzung des Fachbereichsrats mit Prof. Müller und Dr. Schneider.", 19),
    ("Fachbereichsrat, Berufungskommission, Akkreditierung, Osnabrück, virtUOS", 25),
    ("A lecture on machine learning: gradient descent and regularization.", 12),
    ("这是关于机器学习的讲座。", 14),
    ("Лекция о машинном обучении.", 11),
    ("  padded with spaces  ", 4),
])
def test_counts_match_the_asr_servers_tokenizer(text, tokens):
    assert prompt_tokens(text, None) == tokens
    assert prompt_tokens(None, text) == tokens


def test_empty_fields_count_nothing():
    assert prompt_tokens(None, None) == 0
    assert prompt_tokens("", "") == 0


def test_both_fields_add_up():
    assert prompt_tokens(AT_LIMIT_PROMPT, AT_LIMIT_HOTWORDS) == PROMPT_TOKEN_LIMIT


@pytest_asyncio.fixture
async def client():
    async with get_db() as db:
        await db.execute(
            "INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)", ("test-user", "test@test.com"),
        )
        await db.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _upload(client) -> str:
    resp = await client.post(
        "/api/upload", files={"file": ("test.mp3", b"fake", "audio/mpeg")}, headers=DEV_HEADERS,
    )
    return resp.json()["id"]


@pytest.mark.asyncio
async def test_budget_endpoint_reports_tokens_and_limit(client):
    resp = await client.post(
        "/api/prompt-budget",
        json={"initial_prompt": AT_LIMIT_PROMPT, "hotwords": AT_LIMIT_HOTWORDS},
        headers=DEV_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json() == {"tokens": PROMPT_TOKEN_LIMIT, "limit": PROMPT_TOKEN_LIMIT}


@pytest.mark.asyncio
async def test_transcribe_accepts_a_prompt_at_the_limit(client):
    file_id = await _upload(client)
    with patch("app.routers.transcription.get_asr_backend", return_value=AsyncMock()):
        resp = await client.post("/api/transcribe", json={
            "file_id": file_id, "initial_prompt": AT_LIMIT_PROMPT, "hotwords": AT_LIMIT_HOTWORDS,
        }, headers=DEV_HEADERS)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_transcribe_rejects_a_prompt_over_the_limit(client):
    file_id = await _upload(client)
    backend = AsyncMock()
    with patch("app.routers.transcription.get_asr_backend", return_value=backend):
        resp = await client.post("/api/transcribe", json={
            "file_id": file_id, "initial_prompt": AT_LIMIT_PROMPT, "hotwords": AT_LIMIT_HOTWORDS + " b",
        }, headers=DEV_HEADERS)
    assert resp.status_code == 422
    assert resp.json()["code"] == "prompt_too_long"
    assert f"224 of {PROMPT_TOKEN_LIMIT} tokens" in resp.json()["detail"]
    backend.submit.assert_not_called()
    async with get_db() as db:
        cursor = await db.execute("SELECT COUNT(*) FROM transcriptions")
        assert (await cursor.fetchone())[0] == 0


@pytest.mark.asyncio
async def test_preset_create_rejects_a_prompt_over_the_limit(client):
    resp = await client.post("/api/presets/transcription", json={
        "name": "Too long", "initial_prompt": AT_LIMIT_PROMPT, "hotwords": AT_LIMIT_HOTWORDS + " b",
    }, headers=DEV_HEADERS)
    assert resp.status_code == 422
    assert resp.json()["code"] == "prompt_too_long"
    resp = await client.get("/api/presets/transcription", headers=DEV_HEADERS)
    assert resp.json() == []


@pytest.mark.asyncio
async def test_preset_update_rejects_a_prompt_over_the_limit(client):
    resp = await client.post("/api/presets/transcription", json={
        "name": "Fits", "initial_prompt": AT_LIMIT_PROMPT, "hotwords": AT_LIMIT_HOTWORDS,
    }, headers=DEV_HEADERS)
    assert resp.status_code == 201
    preset_id = resp.json()["id"]

    resp = await client.put(f"/api/presets/transcription/{preset_id}", json={
        "name": "Fits", "initial_prompt": AT_LIMIT_PROMPT, "hotwords": AT_LIMIT_HOTWORDS + " b",
    }, headers=DEV_HEADERS)
    assert resp.status_code == 422
    assert resp.json()["code"] == "prompt_too_long"
    resp = await client.get(f"/api/presets/transcription/{preset_id}", headers=DEV_HEADERS)
    assert resp.json()["hotwords"] == AT_LIMIT_HOTWORDS


@pytest.mark.asyncio
async def test_presets_saved_before_the_limit_stay_readable(client):
    too_long = AT_LIMIT_PROMPT + " b"
    async with get_db() as db:
        await db.execute(
            """INSERT INTO transcription_presets
               (id, user_id, name, language, model, min_speakers, max_speakers, initial_prompt, hotwords)
               VALUES ('old', 'test-user', 'Old', NULL, 'base', 0, 0, ?, ?)""",
            (too_long, AT_LIMIT_HOTWORDS),
        )
        await db.commit()

    resp = await client.get("/api/presets/transcription", headers=DEV_HEADERS)
    assert [p["initial_prompt"] for p in resp.json()] == [too_long]
    resp = await client.get("/api/presets/transcription/old", headers=DEV_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["initial_prompt"] == too_long


@pytest.mark.parametrize("lang, phrase", [
    ("en", f"at most {PROMPT_TOKEN_LIMIT} tokens"),
    ("de", f"höchstens {PROMPT_TOKEN_LIMIT} Tokens"),
])
def test_the_api_help_names_the_limit(lang, phrase):
    help_page = Path(__file__).resolve().parents[2] / "frontend" / "src" / "help" / lang / "14-api-access.md"
    assert phrase in help_page.read_text(encoding="utf-8")

import time

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.database import get_db
from app.main import app
from app.routers import assistant
from app.services import support_assistant as sa
from app.services.llm.base import OutputLimitExceeded

USER = "alice"
HEADERS = {"X-Auth-Request-User": USER, "X-Auth-Request-Email": "alice@example.org"}


class FakeProvider:
    def __init__(self, chunks=("Hal", "lo"), error=None):
        self.chunks = chunks
        self.error = error
        self.seen = None

    async def stream_chat(self, messages, operation, max_tokens):
        self.seen = (messages, operation, max_tokens)
        for c in self.chunks:
            yield c
        if self.error:
            raise self.error


@pytest.fixture(autouse=True)
def setup(monkeypatch):
    monkeypatch.setattr(settings, "ENABLE_SUPPORT_ASSISTANT", True)
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")
    monkeypatch.setattr(settings, "DEV_MODE", True)
    monkeypatch.setattr(sa, "CORPORA", {"de": "HANDBUCH-DE", "en": "MANUAL-EN"})
    assistant._in_flight.clear()
    yield
    assistant._in_flight.clear()


def use(monkeypatch, provider):
    monkeypatch.setattr("app.routers.assistant.get_llm_provider", lambda: provider)
    return provider


def body(**kw):
    d = {
        "messages": [{"role": "user", "content": "Hi"}],
        "lang": "en",
        "view": "archive",
    }
    d.update(kw)
    return d


async def post(payload, headers=HEADERS):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post("/api/assistant/chat", json=payload, headers=headers)


@pytest.mark.asyncio
async def test_unavailable_returns_404(monkeypatch):
    use(monkeypatch, FakeProvider())
    monkeypatch.setattr(settings, "ENABLE_SUPPORT_ASSISTANT", False)
    assert (await post(body())).status_code == 404


@pytest.mark.asyncio
async def test_api_token_is_refused(monkeypatch):
    use(monkeypatch, FakeProvider())
    r = await post(body(), {**HEADERS, "Authorization": "Bearer tw_x"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_streams_deltas_then_done(monkeypatch):
    fake = use(monkeypatch, FakeProvider())
    msgs = [
        {"role": "user", "content": "Hi"},
        {"role": "assistant", "content": "Hello"},
        {"role": "user", "content": "More"},
    ]
    r = await post(body(messages=msgs))
    assert r.status_code == 200
    assert r.text == 'data: {"delta": "Hal"}\n\ndata: {"delta": "lo"}\n\nevent: done\ndata: {}\n\n'
    assert r.headers["content-type"].startswith("text/event-stream")
    assert r.headers["cache-control"] == "no-cache"
    sent, op, max_tokens = fake.seen
    assert sent[0]["role"] == "system" and "MANUAL-EN" in sent[0]["content"]
    assert sent[1:] == msgs
    assert (op, max_tokens) == ("support", 1500)


@pytest.mark.asyncio
async def test_provider_error_after_first_delta_sends_error_event(monkeypatch):
    use(monkeypatch, FakeProvider(chunks=("Hal",), error=RuntimeError("boom")))
    r = await post(body())
    assert r.text.startswith('data: {"delta": "Hal"}\n\n')
    assert r.text.endswith('event: error\ndata: {"code": "llm_error"}\n\n')
    assert "done" not in r.text


@pytest.mark.asyncio
async def test_output_limit_sends_error_event(monkeypatch):
    use(monkeypatch, FakeProvider(error=OutputLimitExceeded()))
    r = await post(body())
    assert r.text.endswith('event: error\ndata: {"code": "output_limit"}\n\n')


U = {"role": "user", "content": "Hi"}
A = {"role": "assistant", "content": "Yo"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        body(messages=[]),
        body(messages=[U] * 21),
        body(messages=[U, A]),
        body(messages=[{"role": "user", "content": "x" * 4001}]),
        body(messages=[{"role": "user", "content": "   "}]),
        body(lang="fr"),
        body(view="admin"),
        body(messages=[{"role": "assistant", "content": "a" * 8000}] * 7 + [U]),
    ],
    ids=["empty", "21", "last-assistant", "4001", "blank", "lang", "view", "total"],
)
async def test_validation_rejected(monkeypatch, payload):
    use(monkeypatch, FakeProvider())
    assert (await post(payload)).status_code == 422


@pytest.mark.asyncio
async def test_long_assistant_reply_in_history_is_accepted(monkeypatch):
    use(monkeypatch, FakeProvider())
    msgs = [U, {"role": "assistant", "content": "a" * 6000}, U]
    assert (await post(body(messages=msgs))).status_code == 200


@pytest.mark.asyncio
async def test_second_concurrent_request_is_busy(monkeypatch):
    use(monkeypatch, FakeProvider())
    assistant._in_flight[USER] = time.monotonic()
    r = await post(body())
    assert r.status_code == 429
    assert r.json()["code"] == "assistant_busy"


@pytest.mark.asyncio
async def test_stale_lock_does_not_block(monkeypatch):
    use(monkeypatch, FakeProvider())
    assistant._in_flight[USER] = time.monotonic() - 181
    assert (await post(body())).status_code == 200


@pytest.mark.asyncio
async def test_lock_released_after_stream(monkeypatch):
    use(monkeypatch, FakeProvider())
    assert (await post(body())).status_code == 200
    assert USER not in assistant._in_flight


@pytest.mark.asyncio
async def test_lock_released_when_client_aborts():
    assistant._in_flight[USER] = time.monotonic()
    gen = assistant._event_stream(USER, FakeProvider(), [{"role": "user", "content": "Hi"}])
    await gen.__anext__()
    await gen.aclose()
    assert USER not in assistant._in_flight


@pytest.mark.asyncio
async def test_situation_uses_open_transcription(monkeypatch):
    fake = use(monkeypatch, FakeProvider())
    async with get_db() as db:
        await db.execute("INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)", (USER, "alice@example.org"))
        await db.execute(
            "INSERT INTO transcriptions (id, user_id, status, error_code, error_message, language, model) "
            "VALUES ('t-1', ?, 'failed', 'timeout', 'too slow', NULL, 'large-v3')",
            (USER,),
        )
        await db.commit()
    r = await post(body(view="detail", transcription_id="t-1"))
    assert r.status_code == 200
    assert "Error code: timeout" in fake.seen[0][0]["content"]

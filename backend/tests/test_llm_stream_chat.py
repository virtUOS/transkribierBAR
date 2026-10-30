import json
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config import settings
from app.services.llm.base import OutputLimitExceeded
from app.services.llm.ollama import OllamaProvider
from app.services.llm.openai import OpenAIProvider

MESSAGES = [{"role": "user", "content": "Hi"}]


def _chunk(content=None, reasoning=None, finish=None):
    delta = SimpleNamespace(content=content, reasoning_content=reasoning)
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=delta, finish_reason=finish)], usage=None,
    )


class FakeStream:
    def __init__(self, chunks):
        self._chunks = chunks
        self.close = AsyncMock()

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for c in self._chunks:
            yield c


def _openai(chunks):
    provider = OpenAIProvider()
    stream = FakeStream(chunks)
    create = AsyncMock(return_value=stream)
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    provider._client = MagicMock()
    provider._client.with_options.return_value = client
    return provider, create, stream


async def _collect(gen):
    return "".join([t async for t in gen])


@pytest.mark.asyncio
async def test_openai_stream_yields_content_and_tracks_usage(monkeypatch):
    monkeypatch.setattr(settings, "LLM_DISABLE_THINKING", True)
    usage = SimpleNamespace(prompt_tokens=10, completion_tokens=2)
    chunks = [
        _chunk("Hal"), _chunk("lo"), _chunk(None, reasoning="x"),
        SimpleNamespace(choices=[], usage=usage),
    ]
    provider, create, stream = _openai(chunks)
    with patch("app.services.llm.openai.track_llm_tokens") as track:
        text = await _collect(provider.stream_chat(MESSAGES, "support", 1500))
    assert text == "Hallo"
    provider._client.with_options.assert_called_once_with(timeout=90)
    kwargs = create.call_args.kwargs
    assert kwargs["stream"] is True
    assert kwargs["stream_options"] == {"include_usage": True}
    assert kwargs["max_tokens"] == 1500
    assert kwargs["temperature"] == 0.2
    assert "chat_template_kwargs" in kwargs["extra_body"]
    track.assert_called_once()
    assert track.call_args.args[2] == "support"
    assert track.call_args.args[3] is usage
    stream.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_openai_stream_length_raises_after_text():
    provider, _, _ = _openai([_chunk("Hal"), _chunk("lo", finish="length")])
    got = []
    with patch("app.services.llm.openai.track_llm_tokens"):
        with pytest.raises(OutputLimitExceeded):
            async for t in provider.stream_chat(MESSAGES, "support", 1500):
                got.append(t)
    assert "".join(got) == "Hallo"


def _ollama(lines):
    seen = {}

    class Resp:
        def raise_for_status(self):
            pass

        async def aiter_lines(self):
            for line in lines:
                yield line

    @asynccontextmanager
    async def fake_stream(self, method, url, **kwargs):
        seen["method"], seen["url"], seen["json"] = method, url, kwargs["json"]
        seen["exited"] = False
        try:
            yield Resp()
        finally:
            seen["exited"] = True

    return fake_stream, seen


def _ndjson(done_reason):
    return [
        json.dumps({"message": {"content": "Hal"}, "done": False}),
        "",
        json.dumps({"message": {"content": "lo"}, "done": False}),
        json.dumps({"message": {"content": ""}, "done": True, "done_reason": done_reason,
                    "prompt_eval_count": 10, "eval_count": 2}),
    ]


@pytest.mark.asyncio
async def test_ollama_stream_yields_content_and_tracks_usage():
    fake, seen = _ollama(_ndjson("stop"))
    provider = OllamaProvider()
    with patch("httpx.AsyncClient.stream", fake), \
            patch("app.services.llm.ollama.track_llm_tokens") as track:
        text = await _collect(provider.stream_chat(MESSAGES, "support", 1500))
    assert text == "Hallo"
    assert seen["json"]["stream"] is True
    assert seen["json"]["options"]["num_predict"] == 1500
    assert seen["url"].endswith("/api/chat")
    track.assert_called_once()
    assert track.call_args.args[2] == "support"
    assert track.call_args.args[3]["eval_count"] == 2


@pytest.mark.asyncio
async def test_ollama_stream_length_raises():
    fake, _ = _ollama(_ndjson("length"))
    provider = OllamaProvider()
    got = []
    with patch("httpx.AsyncClient.stream", fake), \
            patch("app.services.llm.ollama.track_llm_tokens"):
        with pytest.raises(OutputLimitExceeded):
            async for t in provider.stream_chat(MESSAGES, "support", 1500):
                got.append(t)
    assert "".join(got) == "Hallo"


@pytest.mark.asyncio
async def test_openai_stream_early_close_closes_upstream():
    provider, _, stream = _openai([_chunk("Hal"), _chunk("lo"), _chunk("!")])
    gen = provider.stream_chat(MESSAGES, "support", 1500)
    with patch("app.services.llm.openai.track_llm_tokens"):
        assert await gen.__anext__() == "Hal"
        stream.close.assert_not_awaited()
        await gen.aclose()
    stream.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_ollama_stream_early_close_closes_upstream():
    fake, seen = _ollama(_ndjson("stop"))
    provider = OllamaProvider()
    gen = provider.stream_chat(MESSAGES, "support", 1500)
    with patch("httpx.AsyncClient.stream", fake), \
            patch("app.services.llm.ollama.track_llm_tokens"):
        assert await gen.__anext__() == "Hal"
        assert seen["exited"] is False
        await gen.aclose()
    assert seen["exited"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("chars,expected", [(100, 8192), (90000, 32768), (10_000_000, 65536)])
async def test_ollama_stream_sends_num_ctx_sized_from_the_prompt(chars, expected):
    fake, seen = _ollama(_ndjson("stop"))
    provider = OllamaProvider()
    messages = [{"role": "system", "content": "x" * chars}]
    with patch("httpx.AsyncClient.stream", fake), \
            patch("app.services.llm.ollama.track_llm_tokens"):
        await _collect(provider.stream_chat(messages, "support", 1500))
    assert seen["json"]["options"]["num_ctx"] == expected


@pytest.mark.asyncio
async def test_ollama_stream_error_line_raises():
    lines = [
        json.dumps({"message": {"content": "Hal"}, "done": False}),
        json.dumps({"error": "model runner crashed"}),
    ]
    fake, _ = _ollama(lines)
    provider = OllamaProvider()
    with patch("httpx.AsyncClient.stream", fake), \
            patch("app.services.llm.ollama.track_llm_tokens"):
        with pytest.raises(RuntimeError):
            await _collect(provider.stream_chat(MESSAGES, "support", 1500))


@pytest.mark.asyncio
async def test_ollama_stream_without_done_raises():
    lines = [json.dumps({"message": {"content": "Hal"}, "done": False})]
    fake, _ = _ollama(lines)
    provider = OllamaProvider()
    with patch("httpx.AsyncClient.stream", fake), \
            patch("app.services.llm.ollama.track_llm_tokens"):
        with pytest.raises(RuntimeError):
            await _collect(provider.stream_chat(MESSAGES, "support", 1500))

"""A refinement or translation chunk must carry an output-token ceiling.

Refinement echoes the chunk back with small corrections, so output size is
bounded by input size: a 50-utterance chunk replayed against the deployed
endpoint returned 2275-3615 completion tokens. Nothing in the request said so,
though, and vLLM serves the model with --max-model-len 262144, so a chunk that
fails to stop is free to generate until it hits the context window.

That is not hypothetical. On the deployed endpoint:

    vllm:request_success_total{finished_reason="length"}  11
    requests over 600s (e2e latency histogram)            11

The same eleven requests. Six of them emitted more than 200k output tokens. At
the throughput measured that afternoon (79 tok/s) 100k tokens is 21 minutes, so
these blow any per-request timeout no matter how the chunk is sized -- the
existing chunk-size reasoning assumes output scales with input, and for a
runaway it does not.

The cost is not only our own job failing. Measured across every key on the
shared deployment, this app averaged 17167 output tokens per request against
2928 for the next heaviest key, and accounted for roughly 70% of all output
tokens on the model while making 20% of the requests. Capping turns a runaway
into a fast, retryable failure instead of ten GPU-minutes taken from everyone.

The utterance cap is sized for a chunk echo. Analysis consolidates rather than
echoes, so it must not inherit this cap from _json_chat; it carries its own,
larger LLM_ANALYSIS_MAX_TOKENS via analysis_json_chat (test_analysis_retry).
"""
import asyncio
import importlib

import pytest

from app.services.llm.prompt import REFINEMENT_OUTPUT_TOKEN_CAP


def test_cap_clears_a_real_chunk_by_a_wide_margin():
    """Sized from measurement, not guesswork.

    The largest real 50-utterance chunk replayed against the endpoint produced
    3615 completion tokens. The cap has to clear that comfortably -- a chunk
    truncated by our own ceiling fails the utterance-count check and burns the
    retries -- while staying far below the 262144 context window a runaway
    otherwise walks to.
    """
    assert REFINEMENT_OUTPUT_TOKEN_CAP >= 3615 * 2, (
        "cap must leave headroom over the largest measured chunk"
    )
    assert REFINEMENT_OUTPUT_TOKEN_CAP <= 32768, (
        "a cap this high stops bounding anything useful"
    )


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "virtUOS")
    monkeypatch.setenv("LLM_MODEL", "test-model")
    monkeypatch.setenv("LLM_BASE_URL", "https://example.invalid/v1")
    from app import config
    importlib.reload(config)
    from app.services.llm import openai as openai_module
    importlib.reload(openai_module)
    return openai_module.OpenAIProvider()


def _fake_create(seen):
    async def fake_create(**kwargs):
        seen.update(kwargs)

        class _M:
            content = '{"utterances": [], "changes_summary": "x"}'

        class _C:
            message = _M()

        class _R:
            choices = [_C()]
            usage = None

        return _R()

    return fake_create


def test_openai_utterance_call_sends_the_cap(provider, monkeypatch):
    seen = {}
    monkeypatch.setattr(provider._client.chat.completions, "create", _fake_create(seen))

    asyncio.run(provider._json_chat("sys", "user", "refinement",
                                    max_tokens=REFINEMENT_OUTPUT_TOKEN_CAP))

    assert seen.get("max_tokens") == REFINEMENT_OUTPUT_TOKEN_CAP, (
        f"expected max_tokens={REFINEMENT_OUTPUT_TOKEN_CAP}, got {seen.get('max_tokens')!r}"
    )


def test_openai_analysis_call_does_not_inherit_the_utterance_cap(provider, monkeypatch):
    """Analysis consolidates rather than echoes; a refinement-sized cap truncates it.
    Its own cap is applied by analysis_json_chat, not by _json_chat."""
    seen = {}
    monkeypatch.setattr(provider._client.chat.completions, "create", _fake_create(seen))

    asyncio.run(provider._json_chat("sys", "user", "analysis"))

    assert seen.get("max_tokens") is None, (
        f"analysis must not inherit the utterance cap, got {seen.get('max_tokens')!r}"
    )


def test_chunked_utterance_call_applies_the_cap():
    """The cap has to ride on the shared helper, or each path forgets it separately."""
    from app.services.llm import base as base_module

    seen = []

    class _Provider:
        async def _json_chat(self, system, user, operation, max_tokens=None):
            seen.append(max_tokens)
            return {"utterances": [{"text": "a"}], "changes_summary": "x"}

    asyncio.run(base_module.chunked_utterance_call(
        _Provider(), [{"text": "a"}],
        build_system=lambda: "sys",
        operation="refinement",
        expect_same_count=True,
    ))

    assert seen == [REFINEMENT_OUTPUT_TOKEN_CAP], (
        f"chunked call must pass the cap through, saw {seen!r}"
    )


def test_ollama_utterance_call_sends_the_cap(monkeypatch):
    """Parity: the other provider must bound its output too."""
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    from app import config
    importlib.reload(config)
    from app.services.llm import ollama as ollama_module
    importlib.reload(ollama_module)

    seen = {}

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"message": {"content": '{"utterances": [], "changes_summary": "x"}'}}

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None):
            seen.update(json or {})
            return _Resp()

    monkeypatch.setattr(ollama_module.httpx, "AsyncClient", lambda **kw: _Client())

    provider = ollama_module.OllamaProvider()
    asyncio.run(provider._json_chat("sys", "user", "refinement",
                                    max_tokens=REFINEMENT_OUTPUT_TOKEN_CAP))

    num_predict = (seen.get("options") or {}).get("num_predict")
    assert num_predict == REFINEMENT_OUTPUT_TOKEN_CAP, (
        f"ollama bounds output via options.num_predict, got {num_predict!r}"
    )

import asyncio
import json

import pytest

from app.services.llm.base import LLMProvider, chunked_utterance_call


def _utterances(n):
    return [
        {"start": i * 1000, "end": i * 1000 + 500,
         "speaker": "SPEAKER_00", "text": f"line {i}"}
        for i in range(n)
    ]


class _Recorder(LLMProvider):
    def __init__(self, payload_key="utterances"):
        self.payload_key = payload_key
        self.calls = 0
        self.concurrent = 0
        self.max_concurrent = 0
        self.operations = []

    async def _json_chat(self, system, user, operation, max_tokens=None):
        self.calls += 1
        self.operations.append(operation)
        self.concurrent += 1
        self.max_concurrent = max(self.max_concurrent, self.concurrent)
        chunk = json.loads(user)
        # Earlier chunks sleep longest so completion order reverses input order.
        await asyncio.sleep(0.05 / (chunk[0]["start"] / 1000 + 1))
        self.concurrent -= 1
        return {self.payload_key: chunk, "changes_summary": f"at {chunk[0]['start']}"}

    async def _consolidate_refinement_summaries(self, summaries):
        return " | ".join(summaries)

    async def generate_title(self, transcript):
        return "title"


@pytest.mark.asyncio
async def test_preserves_input_order_not_completion_order():
    provider = _Recorder()
    results = await chunked_utterance_call(
        provider, _utterances(150),
        build_system=lambda: "sys",
        operation="refinement",
    )
    merged = [u for data in results for u in data.get("utterances", [])]
    starts = [u["start"] for u in merged]
    assert starts == sorted(starts)
    assert len(merged) == 150


@pytest.mark.asyncio
async def test_runs_chunks_concurrently_under_a_bound():
    provider = _Recorder()
    await chunked_utterance_call(
        provider, _utterances(400),
        build_system=lambda: "sys",
        operation="translation",
    )
    assert provider.calls == 8, "400 utterances at 50 per chunk"
    assert 1 < provider.max_concurrent <= 4, "should be concurrent but bounded"


@pytest.mark.asyncio
async def test_passes_the_operation_label_through():
    provider = _Recorder()
    await chunked_utterance_call(
        provider, _utterances(60),
        build_system=lambda: "sys",
        operation="translation",
    )
    assert set(provider.operations) == {"translation"}


@pytest.mark.asyncio
async def test_single_chunk_transcript_still_works():
    provider = _Recorder()
    results = await chunked_utterance_call(
        provider, _utterances(10),
        build_system=lambda: "sys",
        operation="refinement",
    )
    assert provider.calls == 1
    assert len(results[0]["utterances"]) == 10


class _RenamesSpeakers(_Recorder):
    async def _json_chat(self, system, user, operation, max_tokens=None):
        chunk = json.loads(user)
        return {"utterances": [{**u, "speaker": "Alice"} for u in chunk], "changes_summary": "x"}


@pytest.mark.asyncio
async def test_same_count_call_returns_the_sent_speakers():
    sent = _utterances(60)          # two chunks, SPEAKER_00 everywhere
    sent[1]["speaker"] = None
    del sent[55]["speaker"]
    results = await chunked_utterance_call(
        _RenamesSpeakers(), sent, build_system=lambda: "sys",
        operation="refinement", expect_same_count=True,
    )
    got = [u.get("speaker") for data in results for u in data["utterances"]]
    assert got == [u.get("speaker") for u in sent]

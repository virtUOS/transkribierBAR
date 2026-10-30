import asyncio
import json
from collections.abc import Callable
from types import SimpleNamespace

import pytest

from app.routers.translation import _call_llm_translation
from app.services.llm.openai import OpenAIProvider


def _utterances(n):
    return [
        {"start": i * 1000, "end": i * 1000 + 500,
         "speaker": "SPEAKER_00", "text": f"line {i}"}
        for i in range(n)
    ]


class _FakeCompletions:
    def __init__(self, tracker, speaker_for=None):
        self.tracker = tracker
        self.speaker_for = speaker_for

    async def create(self, *, model, messages, **kwargs):
        self.tracker["calls"] += 1
        self.tracker["concurrent"] += 1
        self.tracker["max_concurrent"] = max(
            self.tracker["max_concurrent"], self.tracker["concurrent"]
        )
        chunk = json.loads(messages[1]["content"])
        # Earlier chunks sleep longest, so completion order reverses input order.
        await asyncio.sleep(0.05 / (chunk[0]["start"] / 1000 + 1))
        self.tracker["concurrent"] -= 1
        if self.speaker_for is not None:
            chunk = [{**u, "speaker": self.speaker_for(u)} for u in chunk]
        payload = json.dumps({"utterances": chunk})
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=payload))],
            usage=None,
        )


def _fake_provider(
    tracker, speaker_for: Callable[[dict], str | None] | None = None
):
    provider = OpenAIProvider.__new__(OpenAIProvider)
    provider._model = "fake"
    provider._client = SimpleNamespace(
        chat=SimpleNamespace(completions=_FakeCompletions(tracker, speaker_for))
    )
    return provider


@pytest.mark.asyncio
async def test_translation_preserves_utterance_order():
    tracker = {"calls": 0, "concurrent": 0, "max_concurrent": 0}
    utterances = _utterances(150)
    result = await _call_llm_translation(_fake_provider(tracker), utterances, "de")

    assert len(result) == len(utterances)
    starts = [u["start"] for u in result]
    assert starts == sorted(starts), "utterances came back out of order"


@pytest.mark.asyncio
async def test_translation_runs_chunks_concurrently():
    """Translation echoes back every utterance translated, so like refinement its
    latency scales with chunk size and a sequential loop waits for the sum."""
    tracker = {"calls": 0, "concurrent": 0, "max_concurrent": 0}
    await _call_llm_translation(_fake_provider(tracker), _utterances(150), "de")

    assert tracker["calls"] > 1, "expected the transcript to be chunked"
    assert tracker["max_concurrent"] > 1, "chunks were sent sequentially"


@pytest.mark.asyncio
async def test_translation_returns_the_source_speakers():
    utterances = _utterances(120)
    for i, u in enumerate(utterances):
        u["speaker"] = f"SPEAKER_0{i % 2}"
    tracker = {"calls": 0, "concurrent": 0, "max_concurrent": 0}
    provider = _fake_provider(tracker, speaker_for=lambda u: u["speaker"].replace("SPEAKER", "SPRECHER"))
    result = await _call_llm_translation(provider, utterances, "de")
    assert [u["speaker"] for u in result] == [u["speaker"] for u in utterances]

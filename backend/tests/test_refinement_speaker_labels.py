"""Stored refinements and translations keep the original SPEAKER_xx labels, so
a rename reaches the Refined view, exports and translations (issue #215).

Uses a real LLMProvider subclass so router -> generate_refinement ->
chunked_utterance_call runs end to end."""
import json
from contextlib import ExitStack
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.database import get_db
from app.main import app
from app.services.llm.base import LLMProvider

ORIG = [
    {"start": 0, "end": 5000, "text": "hello there", "speaker": "SPEAKER_00"},
    {"start": 5000, "end": 10000, "text": "general kenobi", "speaker": "SPEAKER_01"},
]


class _ScriptedLLM(LLMProvider):
    """Real chunking path; records each request's user payload per operation and
    replies with upper-cased text and reply_speaker(u) as the speaker."""

    def __init__(self, reply_speaker=lambda u: "Alice"):
        self.reply_speaker, self.sent = reply_speaker, {}

    async def _json_chat(self, system, user, operation, max_tokens=None):
        self.sent.setdefault(operation, []).append(user)
        if operation == "analysis":
            return {"summary": "ok", "chapters": []}
        return {
            "utterances": [
                {**u, "text": u["text"].upper(), "speaker": self.reply_speaker(u)}
                for u in json.loads(user)
            ],
            "changes_summary": "upper-cased",
        }

    async def _consolidate_refinement_summaries(self, summaries):
        return " | ".join(summaries)

    async def generate_title(self, transcript):
        return "t"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _patched(llm):
    stack = ExitStack()
    for mod in ("refinement", "translation", "analysis"):
        stack.enter_context(patch(f"app.routers.{mod}.get_llm_provider", return_value=llm))
    return stack


async def _setup(client, txn_id, *, original=ORIG, refined=None, metadata=None):
    upload = await client.post("/api/upload", files={"file": ("t.mp3", b"fake", "audio/mpeg")})
    file_id = upload.json()["id"]
    async with get_db() as db:
        cursor = await db.execute("SELECT user_id FROM files WHERE id = ?", (file_id,))
        user_id = (await cursor.fetchone())[0]
        await db.execute(
            """INSERT INTO transcriptions
               (id, user_id, file_id, asr_backend, status, language, result_json,
                refined_utterances_json, refinement_metadata_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (txn_id, user_id, file_id, "murmurai", "completed", "de", json.dumps(original),
             json.dumps(refined) if refined is not None else None,
             json.dumps(metadata) if metadata is not None else None),
        )
        await db.commit()
    return txn_id


async def _rename(client, txn, mappings):
    resp = await client.put(f"/api/transcription/{txn}/speakers", json={"mappings": mappings})
    assert resp.status_code == 200, resp.text


def _speakers(utterances):
    return [u["speaker"] for u in utterances]


def _sent_speakers(payload):
    return _speakers(json.loads(payload))


@pytest.mark.asyncio
async def test_refinement_sends_labels_not_names():
    llm = _ScriptedLLM()
    async with _client() as client:
        txn = await _setup(client, "lbl-1")
        await _rename(client, txn, {"SPEAKER_00": "Alice"})
        with _patched(llm):
            resp = await client.post(f"/api/refine/{txn}")
        assert resp.status_code == 200, resp.text
    assert _sent_speakers(llm.sent["refinement"][0]) == ["SPEAKER_00", "SPEAKER_01"]
    assert "Alice" not in "".join(llm.sent["refinement"])


@pytest.mark.asyncio
async def test_refinement_stores_labels_whatever_the_model_returns():
    llm = _ScriptedLLM(reply_speaker=lambda u: {"SPEAKER_00": "Alice"}.get(u["speaker"]))
    async with _client() as client:
        txn = await _setup(client, "lbl-2")
        await _rename(client, txn, {"SPEAKER_00": "Alice"})
        with _patched(llm):
            resp = await client.post(f"/api/refine/{txn}")
        assert resp.status_code == 200, resp.text
        get = await client.get(f"/api/refine/{txn}")
    labels = ["SPEAKER_00", "SPEAKER_01"]
    assert _speakers(resp.json()["utterances"]) == labels
    assert _speakers(get.json()["utterances"]) == labels


@pytest.mark.asyncio
async def test_rename_after_refinement_reaches_the_refined_utterances():
    llm = _ScriptedLLM()
    async with _client() as client:
        txn = await _setup(client, "lbl-3")
        await _rename(client, txn, {"SPEAKER_00": "Alice"})
        with _patched(llm):
            assert (await client.post(f"/api/refine/{txn}")).status_code == 200
        await _rename(client, txn, {"SPEAKER_00": "Bob"})
        refined = (await client.get(f"/api/refine/{txn}")).json()["utterances"]
        detail = (await client.get(f"/api/transcription/{txn}")).json()
    assert refined[0]["speaker"] == "SPEAKER_00"
    assert detail["speaker_mappings"][refined[0]["speaker"]] == "Bob"


@pytest.mark.asyncio
async def test_retry_sends_and_stores_labels():
    original = [
        {"start": i * 1000, "end": i * 1000 + 500, "text": f"line {i}",
         "speaker": f"SPEAKER_0{i % 2}"}
        for i in range(4)
    ]
    refined = [dict(u) for u in original]
    refined[0]["text"], refined[1]["text"] = "LINE 0", "LINE 1"
    metadata = {
        "changed_indices": [0, 1],
        "changes_summary": "upper-cased first half",
        "context": "meeting notes",
        "llm_provider": "test",
        "llm_model": "m",
        "created_at": "2026-09-18T00:00:00+00:00",
        "failed_ranges": [[2, 4]],
    }
    llm = _ScriptedLLM()
    async with _client() as client:
        txn = await _setup(client, "lbl-4", original=original, refined=refined, metadata=metadata)
        await _rename(client, txn, {"SPEAKER_00": "Alice", "SPEAKER_01": "Bob"})
        with _patched(llm):
            resp = await client.post(f"/api/refine/{txn}/retry")
        assert resp.status_code == 200, resp.text
        got = (await client.get(f"/api/refine/{txn}")).json()["utterances"]
    assert llm.sent["refinement"]
    for payload in llm.sent["refinement"]:
        assert all(s.startswith("SPEAKER_") for s in _sent_speakers(payload))
    assert _speakers(got) == ["SPEAKER_00", "SPEAKER_01", "SPEAKER_00", "SPEAKER_01"]


@pytest.mark.asyncio
async def test_merged_speakers_keep_their_own_labels():
    llm = _ScriptedLLM()
    async with _client() as client:
        txn = await _setup(client, "lbl-5")
        await _rename(client, txn, {"SPEAKER_00": "Alice", "SPEAKER_01": "Alice"})
        with _patched(llm):
            assert (await client.post(f"/api/refine/{txn}")).status_code == 200
        got = (await client.get(f"/api/refine/{txn}")).json()["utterances"]
    assert _speakers(got) == ["SPEAKER_00", "SPEAKER_01"]


@pytest.mark.asyncio
async def test_name_equal_to_another_label_is_not_misassigned():
    llm = _ScriptedLLM()
    async with _client() as client:
        txn = await _setup(client, "lbl-6")
        await _rename(client, txn, {"SPEAKER_00": "Alice", "SPEAKER_01": "SPEAKER_00"})
        with _patched(llm):
            assert (await client.post(f"/api/refine/{txn}")).status_code == 200
            resp = await client.post(
                f"/api/analysis/{txn}", json={"template": "summary", "source": "refined"},
            )
        assert resp.status_code == 200, resp.text
    prompt = llm.sent["analysis"][0]
    assert "Alice: HELLO THERE" in prompt
    assert "SPEAKER_00: GENERAL KENOBI" in prompt


@pytest.mark.asyncio
async def test_analysis_from_refined_uses_current_names():
    llm = _ScriptedLLM()
    async with _client() as client:
        txn = await _setup(client, "lbl-7")
        await _rename(client, txn, {"SPEAKER_00": "Alice"})
        with _patched(llm):
            assert (await client.post(f"/api/refine/{txn}")).status_code == 200
            await _rename(client, txn, {"SPEAKER_00": "Bob"})
            resp = await client.post(
                f"/api/analysis/{txn}", json={"template": "summary", "source": "refined"},
            )
        assert resp.status_code == 200, resp.text
    prompt = llm.sent["analysis"][0]
    assert "Bob: HELLO THERE" in prompt
    assert "Alice" not in prompt


@pytest.mark.asyncio
async def test_translation_from_refined_keeps_labels():
    llm = _ScriptedLLM()
    async with _client() as client:
        txn = await _setup(client, "lbl-8")
        await _rename(client, txn, {"SPEAKER_00": "Alice"})
        with _patched(llm):
            assert (await client.post(f"/api/refine/{txn}")).status_code == 200
            llm.reply_speaker = lambda u: (u["speaker"] or "").replace("SPEAKER", "SPRECHER")
            resp = await client.post(
                f"/api/translate/{txn}", json={"target_language": "en", "source": "refined"},
            )
        assert resp.status_code == 200, resp.text
        got = (await client.get(f"/api/translate/{txn}")).json()["utterances"]
    assert _sent_speakers(llm.sent["translation"][0]) == ["SPEAKER_00", "SPEAKER_01"]
    assert _speakers(got) == ["SPEAKER_00", "SPEAKER_01"]

"""The ASR result stays retrievable after saved edits, so the editor can restore it."""
import json

import pytest
from httpx import ASGITransport, AsyncClient

from app.database import get_db
from app.main import app
from app.services.source_tracking import hash_utterance_texts

TXN = "restore-original"
H = {"X-Auth-Request-User": "owner"}
ORIG = [
    {"start": 0, "end": 1000, "text": "Hello world", "speaker": "SPEAKER_00"},
    {"start": 1000, "end": 2000, "text": "Grüße", "speaker": "SPEAKER_01"},
]
EDITED = [{**ORIG[0], "text": "Goodbye world"}, ORIG[1]]


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _insert(client, txn_id=TXN, *, status="completed", original=ORIG, refined=None, metadata=None):
    upload = await client.post("/api/upload", files={"file": ("t.mp3", b"x", "audio/mpeg")}, headers=H)
    file_id = upload.json()["id"]
    # Same content as result_json but different bytes (reversed key order).
    original_json = (
        None if original is None
        else json.dumps([dict(reversed(list(u.items()))) for u in original], ensure_ascii=False)
    )
    async with get_db() as db:
        await db.execute(
            """INSERT INTO transcriptions
               (id, user_id, file_id, asr_backend, status, language, result_json,
                original_result_json, refined_utterances_json, refinement_metadata_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (txn_id, "owner", file_id, "murmurai", status, "en", json.dumps(ORIG), original_json,
             json.dumps(refined) if refined is not None else None,
             json.dumps(metadata) if metadata is not None else None),
        )
        await db.commit()


async def _put(client, utterances):
    return await client.put(f"/api/transcription/{TXN}", json={"utterances": utterances}, headers=H)


async def _get(client):
    return await client.get(f"/api/transcription/{TXN}", headers=H)


@pytest.mark.asyncio
async def test_original_survives_a_saved_edit():
    async with _client() as client:
        await _insert(client)
        assert (await _put(client, EDITED)).status_code == 200
        original = await client.get(f"/api/transcription/{TXN}/original", headers=H)
        current = await _get(client)
    assert original.status_code == 200
    assert original.json() == {"utterances": ORIG}
    assert current.json()["utterances"] == EDITED


@pytest.mark.asyncio
async def test_edited_follows_the_saved_version():
    async with _client() as client:
        await _insert(client)
        await client.put(f"/api/transcription/{TXN}/speakers", json={"mappings": {"SPEAKER_00": "Alice"}}, headers=H)
        assert (await _get(client)).json()["edited"] is False
        assert (await _put(client, EDITED)).json() == {"status": "ok", "edited": True}
        assert (await _get(client)).json()["edited"] is True
        assert (await _put(client, ORIG)).json() == {"status": "ok", "edited": False}
        final = (await _get(client)).json()
    assert final["edited"] is False
    assert final["speaker_mappings"] == {"SPEAKER_00": "Alice"}


@pytest.mark.asyncio
async def test_without_a_stored_original_nothing_counts_as_edited():
    async with _client() as client:
        await _insert(client, original=None)
        assert (await _get(client)).json()["edited"] is False
        assert (await _put(client, EDITED)).json()["edited"] is False
        resp = await client.get(f"/api/transcription/{TXN}/original", headers=H)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Original transcription not available"


@pytest.mark.asyncio
async def test_original_is_only_served_to_its_owner_and_when_completed():
    async with _client() as client:
        await _insert(client)
        await _insert(client, "txn-running", status="processing")
        intruder = await client.get(
            f"/api/transcription/{TXN}/original", headers={"X-Auth-Request-User": "intruder"})
        running = await client.get("/api/transcription/txn-running/original", headers=H)
        missing = await client.get("/api/transcription/nope/original", headers=H)
    for resp in (intruder, running, missing):
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Transcription not found"


@pytest.mark.asyncio
async def test_responses_and_exports_do_not_carry_the_original():
    async with _client() as client:
        await _insert(client)
        await _put(client, EDITED)
        body = (await _get(client)).json()
        assert set(body) == {"id", "status", "utterances", "text", "language", "detected_language", "speaker_mappings", "edited"}
        for fmt in ("json", "txt", "srt", "vtt"):
            text = (await client.get(f"/api/transcription/{TXN}/export/{fmt}", headers=H)).text
            assert "Goodbye world" in text
            assert "Hello world" not in text


@pytest.mark.asyncio
async def test_saving_the_original_back_makes_a_refinement_of_it_current_again():
    async with _client() as client:
        await _insert(
            client, refined=ORIG,
            metadata={"changed_indices": [], "changes_summary": "x", "source_hash": hash_utterance_texts(ORIG)},
        )
        await _put(client, EDITED)
        assert (await client.get(f"/api/refine/{TXN}", headers=H)).json()["stale"] is True
        await _put(client, ORIG)
        assert (await client.get(f"/api/refine/{TXN}", headers=H)).json()["stale"] is False

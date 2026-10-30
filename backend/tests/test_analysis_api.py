"""Analysis endpoints: templates, generation paths, CRUD and user scoping."""
import json

import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch

from app.main import app
from app.database import get_db
from app.models import SummaryResult, ProtocolResult
from tests.test_analysis_output_limit import _setup

INTRUDER = {"X-Auth-Request-User": "intruder"}


def _client(**kwargs):
    return AsyncClient(transport=ASGITransport(app=app, **kwargs), base_url="http://test")


def _summary():
    return SummaryResult(summary="ok", chapters=[{"title": "c1", "start_time": 0, "end_time": 1, "summary": "s"},
                                                 {"title": "c2", "start_time": 1, "end_time": 2, "summary": "t"}])


async def _analysis_count(txn_id):
    async with get_db() as db:
        row = await (await db.execute("SELECT COUNT(*) FROM analyses WHERE transcription_id = ?", (txn_id,))).fetchone()
    return row[0]


async def _create_summary(client, txn_id):
    provider = AsyncMock()
    provider.generate_summary.return_value = _summary()
    with patch("app.routers.analysis.get_llm_provider", return_value=provider):
        resp = await client.post(f"/api/analysis/{txn_id}", json={"template": "summary"})
    assert resp.status_code == 200
    return resp.json()["id"]


@pytest.mark.asyncio
async def test_templates_lists_builtin_templates():
    async with _client() as client:
        resp = await client.get("/api/analysis/templates")
    assert resp.status_code == 200
    ids = [t["id"] for t in resp.json()]
    assert ids == ["summary", "protocol", "agenda"]
    assert all(t["name"] and t["description"] and t["default_prompt"] for t in resp.json())


@pytest.mark.asyncio
async def test_generate_503_without_llm_provider():
    async with _client() as client:
        await _setup(client, "t-an-nollm")
        with patch("app.routers.analysis.get_llm_provider", return_value=None):
            resp = await client.post("/api/analysis/t-an-nollm", json={})
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_generate_404_for_foreign_or_unfinished_transcription():
    async with _client() as client:
        await _setup(client, "t-an-foreign")
        async with get_db() as db:
            await db.execute("UPDATE transcriptions SET status = 'processing' WHERE id = 't-an-foreign'")
            await db.commit()
        provider = AsyncMock()
        with patch("app.routers.analysis.get_llm_provider", return_value=provider):
            unfinished = await client.post("/api/analysis/t-an-foreign", json={})
            async with get_db() as db:
                await db.execute("UPDATE transcriptions SET status = 'completed' WHERE id = 't-an-foreign'")
                await db.commit()
            foreign = await client.post("/api/analysis/t-an-foreign", json={}, headers=INTRUDER)
    assert unfinished.status_code == 404
    assert foreign.status_code == 404
    provider.generate_summary.assert_not_awaited()
    assert await _analysis_count("t-an-foreign") == 0


@pytest.mark.asyncio
async def test_generate_429_while_another_analysis_is_running():
    async with _client() as client:
        await _setup(client, "t-an-busy")
        async with get_db() as db:
            await db.execute("INSERT INTO analyses (id, transcription_id, analysis_json) VALUES ('ph', 't-an-busy', NULL)")
            await db.commit()
        provider = AsyncMock()
        with patch("app.routers.analysis.get_llm_provider", return_value=provider):
            resp = await client.post("/api/analysis/t-an-busy", json={})
    assert resp.status_code == 429
    provider.generate_summary.assert_not_awaited()


@pytest.mark.asyncio
async def test_generate_without_body_defaults_to_summary_in_transcript_language():
    async with _client() as client:
        await _setup(client, "t-an-nobody")
        provider = AsyncMock()
        provider.generate_summary.return_value = _summary()
        with patch("app.routers.analysis.get_llm_provider", return_value=provider):
            resp = await client.post("/api/analysis/t-an-nobody")
    assert resp.status_code == 200
    data = resp.json()
    assert data["template"] == "summary"
    assert data["language"] == "en"
    assert data["source"] == "original"
    transcript, hints, language = provider.generate_summary.await_args.args
    assert "A: original text" in transcript
    assert hints is None and language == "en"


@pytest.mark.asyncio
async def test_generate_protocol_uses_speaker_mappings():
    async with _client() as client:
        await _setup(client, "t-an-protocol")
        await client.put("/api/transcription/t-an-protocol/speakers", json={"mappings": {"A": "Alice"}})
        provider = AsyncMock()
        provider.generate_protocol.return_value = ProtocolResult(
            title="Meeting", participants=["Alice"], key_points=[], decisions=[],
            action_items=[{"task": "t", "assignee": "Alice", "timestamp": None}],
        )
        with patch("app.routers.analysis.get_llm_provider", return_value=provider):
            resp = await client.post("/api/analysis/t-an-protocol", json={"template": "protocol", "language": "de"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["template"] == "protocol"
    assert data["language"] == "de"
    assert data["participants"] == ["Alice"]
    transcript, _, language = provider.generate_protocol.await_args.args
    assert "Alice: original text" in transcript
    assert language == "de"


@pytest.mark.asyncio
async def test_generate_custom_prompt_goes_through_json_chat():
    async with _client() as client:
        await _setup(client, "t-an-custom")
        chat = AsyncMock(return_value={"bullets": ["one"]})
        with patch("app.routers.analysis.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.analysis.analysis_json_chat", chat):
            resp = await client.post("/api/analysis/t-an-custom",
                                     json={"template": "summary", "custom_prompt": "List bullets", "language": "fr"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["bullets"] == ["one"]
        assert data["custom_prompt"] == "List bullets"
        _provider, system_prompt, user_content = chat.await_args.args
        assert system_prompt == "Respond in French.\nList bullets"
        assert "original text" in user_content

        stored = await client.get(f"/api/analysis/t-an-custom/{data['id']}")
    assert stored.json()["bullets"] == ["one"]


@pytest.mark.asyncio
async def test_generate_long_transcript_consolidates_chunks():
    async with _client() as client:
        await _setup(client, "t-an-chunks")
        chat = AsyncMock(side_effect=[{"part": 1}, {"part": 2}, {"merged": True}])
        with patch("app.routers.analysis.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.analysis.chunk_transcript", return_value=["chunk-one", "chunk-two"]), \
             patch("app.routers.analysis.analysis_json_chat", chat):
            resp = await client.post("/api/analysis/t-an-chunks", json={"template": "agenda", "agenda": "1. X"})
    assert resp.status_code == 200
    assert resp.json()["merged"] is True
    assert resp.json()["template"] == "agenda"
    calls = [c.args[2] for c in chat.await_args_list]
    assert calls[:2] == ["chunk-one", "chunk-two"]
    assert '{"part": 1}' in calls[2] and '{"part": 2}' in calls[2]
    # No explicit language: falls back to the transcript's own
    assert "Respond in English." in calls[2]


@pytest.mark.asyncio
async def test_unexpected_llm_error_removes_placeholder():
    async with _client(raise_app_exceptions=False) as client:
        await _setup(client, "t-an-crash")
        provider = AsyncMock()
        provider.generate_summary.side_effect = RuntimeError("boom")
        with patch("app.routers.analysis.get_llm_provider", return_value=provider):
            resp = await client.post("/api/analysis/t-an-crash", json={})
    assert resp.status_code == 500
    assert await _analysis_count("t-an-crash") == 0


@pytest.mark.asyncio
async def test_list_excludes_placeholders_and_is_scoped():
    async with _client() as client:
        await _setup(client, "t-an-list")
        analysis_id = await _create_summary(client, "t-an-list")
        async with get_db() as db:
            await db.execute("INSERT INTO analyses (id, transcription_id, analysis_json) VALUES ('ph3', 't-an-list', NULL)")
            await db.commit()
        own = await client.get("/api/analysis/t-an-list")
        foreign = await client.get("/api/analysis/t-an-list", headers=INTRUDER)
    assert own.status_code == 200
    assert [a["id"] for a in own.json()] == [analysis_id]
    assert own.json()[0]["template"] == "summary"
    assert own.json()[0]["source"] == "original"
    assert foreign.status_code == 404


@pytest.mark.asyncio
async def test_get_analysis_404s():
    async with _client() as client:
        await _setup(client, "t-an-get")
        analysis_id = await _create_summary(client, "t-an-get")
        async with get_db() as db:
            await db.execute("INSERT INTO analyses (id, transcription_id, analysis_json) VALUES ('ph4', 't-an-get', NULL)")
            await db.commit()
        assert (await client.get(f"/api/analysis/t-an-get/{analysis_id}", headers=INTRUDER)).status_code == 404
        assert (await client.get("/api/analysis/t-an-get/missing")).status_code == 404
        assert (await client.get("/api/analysis/t-an-get/ph4")).status_code == 404
        ok = await client.get(f"/api/analysis/t-an-get/{analysis_id}")
    assert ok.status_code == 200
    assert ok.json()["stale"] is False
    assert ok.json()["source_available"] is True


@pytest.mark.asyncio
async def test_analysis_of_another_transcription_is_not_reachable_via_own_id():
    """An analysis id only resolves under the transcription it belongs to."""
    async with _client() as client:
        await _setup(client, "t-an-x1")
        await _setup(client, "t-an-x2")
        analysis_id = await _create_summary(client, "t-an-x1")
        assert (await client.get(f"/api/analysis/t-an-x2/{analysis_id}")).status_code == 404
        assert (await client.delete(f"/api/analysis/t-an-x2/{analysis_id}")).status_code == 404
    assert await _analysis_count("t-an-x1") == 1


@pytest.mark.asyncio
async def test_get_analysis_stale_when_refined_source_removed():
    async with _client() as client:
        await _setup(client, "t-an-refined-gone")
        async with get_db() as db:
            await db.execute(
                "UPDATE transcriptions SET refined_utterances_json = ? WHERE id = 't-an-refined-gone'",
                (json.dumps([{"start": 0, "end": 1000, "text": "refined", "speaker": "A"}]),),
            )
            await db.commit()
        analysis_id = await _create_summary(client, "t-an-refined-gone")
        async with get_db() as db:
            await db.execute("UPDATE transcriptions SET refined_utterances_json = NULL WHERE id = 't-an-refined-gone'")
            await db.commit()
        resp = await client.get(f"/api/analysis/t-an-refined-gone/{analysis_id}")
    assert resp.json()["source"] == "refined"
    assert resp.json()["source_available"] is False
    assert resp.json()["stale"] is True


@pytest.mark.asyncio
async def test_delete_analysis_and_scoping():
    async with _client() as client:
        await _setup(client, "t-an-del")
        analysis_id = await _create_summary(client, "t-an-del")
        assert (await client.delete(f"/api/analysis/t-an-del/{analysis_id}", headers=INTRUDER)).status_code == 404
        assert await _analysis_count("t-an-del") == 1
        resp = await client.delete(f"/api/analysis/t-an-del/{analysis_id}")
        assert resp.status_code == 200
        assert (await client.delete(f"/api/analysis/t-an-del/{analysis_id}")).status_code == 404
    assert await _analysis_count("t-an-del") == 0


@pytest.mark.asyncio
async def test_delete_analysis_item_removes_one_entry():
    async with _client() as client:
        await _setup(client, "t-an-item")
        analysis_id = await _create_summary(client, "t-an-item")
        resp = await client.delete(f"/api/analysis/t-an-item/{analysis_id}/items/chapters/0")
        assert resp.status_code == 200
        assert [c["title"] for c in resp.json()["chapters"]] == ["c2"]
        stored = await client.get(f"/api/analysis/t-an-item/{analysis_id}")
    assert [c["title"] for c in stored.json()["chapters"]] == ["c2"]


@pytest.mark.asyncio
async def test_delete_analysis_item_errors():
    async with _client() as client:
        await _setup(client, "t-an-item-err")
        analysis_id = await _create_summary(client, "t-an-item-err")
        base = f"/api/analysis/t-an-item-err/{analysis_id}/items"
        assert (await client.delete(f"{base}/summary/0")).status_code == 400          # not an allowed field
        assert (await client.delete(f"{base}/key_points/0")).status_code == 400       # allowed, but not in a summary
        assert (await client.delete(f"{base}/chapters/2")).status_code == 404         # out of range
        assert (await client.delete(f"{base}/chapters/-1")).status_code == 404
        assert (await client.delete(f"{base}/chapters/abc")).status_code == 422
        assert (await client.delete(f"{base}/chapters/0", headers=INTRUDER)).status_code == 404
        assert (await client.delete("/api/analysis/t-an-item-err/missing/items/chapters/0")).status_code == 404
        stored = await client.get(f"/api/analysis/t-an-item-err/{analysis_id}")
    assert len(stored.json()["chapters"]) == 2

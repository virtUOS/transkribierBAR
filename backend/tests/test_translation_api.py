import json
import pytest
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient, ASGITransport
from app.main import app


async def _setup(client, *, txn_id="test-translate", with_refined=False):
    upload_resp = await client.post("/api/upload", files={"file": ("t.mp3", b"x", "audio/mpeg")})
    file_id = upload_resp.json()["id"]
    from app.database import get_db
    async with get_db() as db:
        row = await (await db.execute("SELECT user_id FROM files WHERE id = ?", (file_id,))).fetchone()
        user_id = row[0]
        original = json.dumps([
            {"start": 0, "end": 1000, "text": "Hallo Welt", "speaker": "A"},
            {"start": 1000, "end": 2000, "text": "Wie geht es dir", "speaker": "B"},
        ])
        refined = json.dumps([
            {"start": 0, "end": 1000, "text": "Hallo, Welt.", "speaker": "A"},
            {"start": 1000, "end": 2000, "text": "Wie geht es dir?", "speaker": "B"},
        ]) if with_refined else None
        await db.execute(
            """INSERT INTO transcriptions
               (id, user_id, file_id, asr_backend, status, result_json, refined_utterances_json)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (txn_id, user_id, file_id, "murmurai", "completed", original, refined),
        )
        await db.commit()
    return txn_id, user_id


def _translated(texts):
    return [{"start": i * 1000, "end": (i + 1) * 1000, "text": t, "speaker": None}
            for i, t in enumerate(texts)]


@pytest.mark.asyncio
async def test_translate_defaults_to_refined_when_available():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        txn_id, _ = await _setup(client, with_refined=True)
        translated = _translated(["Hello, world.", "How are you?"])
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation", return_value=translated):
            resp = await client.post(f"/api/translate/{txn_id}", json={"target_language": "en"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["source"] == "refined"
    assert data["source_available"] is True
    assert data["stale"] is False
    assert data["source_hash"] is not None


@pytest.mark.asyncio
async def test_translate_defaults_to_original_without_refinement():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        txn_id, _ = await _setup(client, txn_id="test-translate-orig", with_refined=False)
        translated = _translated(["Hello world", "How are you"])
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation", return_value=translated):
            resp = await client.post(f"/api/translate/{txn_id}", json={"target_language": "en"})
    assert resp.json()["source"] == "original"


@pytest.mark.asyncio
async def test_translate_explicit_refined_without_refinement_returns_400():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        txn_id, _ = await _setup(client, txn_id="test-translate-400", with_refined=False)
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()):
            resp = await client.post(
                f"/api/translate/{txn_id}",
                json={"target_language": "en", "source": "refined"},
            )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_translate_explicit_original_uses_original_even_with_refinement():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        txn_id, _ = await _setup(client, txn_id="test-translate-force-orig", with_refined=True)
        translated = _translated(["Hello world", "How are you"])
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation", return_value=translated):
            resp = await client.post(
                f"/api/translate/{txn_id}",
                json={"target_language": "en", "source": "original"},
            )
    assert resp.json()["source"] == "original"


@pytest.mark.asyncio
async def test_get_translation_reports_stale_when_source_changes():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        txn_id, user_id = await _setup(client, txn_id="test-translate-stale", with_refined=False)
        translated = _translated(["Hello world", "How are you"])
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation", return_value=translated):
            await client.post(f"/api/translate/{txn_id}", json={"target_language": "en"})

        # Mutate the original utterances to simulate a post-save edit.
        from app.database import get_db
        async with get_db() as db:
            await db.execute(
                "UPDATE transcriptions SET result_json = ? WHERE id = ?",
                (json.dumps([
                    {"start": 0, "end": 1000, "text": "Hallo Welt EDITED", "speaker": "A"},
                    {"start": 1000, "end": 2000, "text": "Wie geht es dir", "speaker": "B"},
                ]), txn_id),
            )
            await db.commit()

        resp = await client.get(f"/api/translate/{txn_id}")
    assert resp.status_code == 200
    assert resp.json()["stale"] is True


@pytest.mark.asyncio
async def test_get_translation_reports_source_unavailable_after_refinement_deleted():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        txn_id, _ = await _setup(client, txn_id="test-translate-missing", with_refined=True)
        translated = _translated(["Hello, world.", "How are you?"])
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation", return_value=translated):
            await client.post(f"/api/translate/{txn_id}", json={"target_language": "en"})

        from app.database import get_db
        async with get_db() as db:
            await db.execute(
                "UPDATE transcriptions SET refined_utterances_json = NULL WHERE id = ?",
                (txn_id,),
            )
            await db.commit()

        resp = await client.get(f"/api/translate/{txn_id}")
    data = resp.json()
    assert data["source"] == "refined"
    assert data["source_available"] is False


@pytest.mark.asyncio
async def test_translate_rejects_the_transcripts_own_language():
    """Translating into the language the transcript is already in is a
    degenerate request. The model has nothing to do and may return something
    unusable — in production it echoed the schema back — which surfaced to the
    user as an opaque 500. Reject it up front instead."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        txn_id, _ = await _setup(client, txn_id="test-translate-same-lang")
        from app.database import get_db
        async with get_db() as db:
            await db.execute(
                "UPDATE transcriptions SET language = 'de' WHERE id = ?", (txn_id,)
            )
            await db.commit()

        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()):
            resp = await client.post(f"/api/translate/{txn_id}", json={"target_language": "de"})

    assert resp.status_code == 400
    assert "already" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_translate_allows_a_different_language():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        txn_id, _ = await _setup(client, txn_id="test-translate-other-lang")
        from app.database import get_db
        async with get_db() as db:
            await db.execute(
                "UPDATE transcriptions SET language = 'de' WHERE id = ?", (txn_id,)
            )
            await db.commit()

        translated = _translated(["Hello world", "How are you"])
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation", return_value=translated):
            resp = await client.post(f"/api/translate/{txn_id}", json={"target_language": "en"})

    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_translate_allows_same_language_when_source_language_unknown():
    """`language` is NULL for some transcriptions, so an unknown source language
    must not block translation."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        txn_id, _ = await _setup(client, txn_id="test-translate-null-lang")
        translated = _translated(["Hallo Welt", "Wie geht es dir"])
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation", return_value=translated):
            resp = await client.post(f"/api/translate/{txn_id}", json={"target_language": "de"})

    assert resp.status_code == 200


async def _translate_then_edit_source(client, txn_id):
    """Store an English translation, then change the original's text so the
    stored translation is out of date."""
    with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
         patch("app.routers.translation._call_llm_translation",
               return_value=_translated(["Hello world", "How are you"])):
        await client.post(f"/api/translate/{txn_id}", json={"target_language": "en"})

    from app.database import get_db
    async with get_db() as db:
        await db.execute(
            "UPDATE transcriptions SET result_json = ? WHERE id = ?",
            (json.dumps([
                {"start": 0, "end": 1000, "text": "Hallo schöne Welt", "speaker": "A"},
                {"start": 1000, "end": 2000, "text": "Wie geht es dir", "speaker": "B"},
            ]), txn_id),
        )
        await db.commit()


@pytest.mark.asyncio
async def test_translate_without_force_returns_the_stale_cached_translation():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        txn_id, _ = await _setup(client, txn_id="test-translate-stale-cached")
        await _translate_then_edit_source(client, txn_id)

        llm = AsyncMock(return_value=_translated(["Hello beautiful world", "How are you"]))
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation", llm):
            resp = await client.post(f"/api/translate/{txn_id}", json={"target_language": "en"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["stale"] is True
    assert [u["text"] for u in data["utterances"]] == ["Hello world", "How are you"]
    llm.assert_not_called()


@pytest.mark.asyncio
async def test_translate_with_force_replaces_the_stale_translation():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        txn_id, _ = await _setup(client, txn_id="test-translate-force")
        await _translate_then_edit_source(client, txn_id)

        llm = AsyncMock(return_value=_translated(["Hello beautiful world", "How are you"]))
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation", llm):
            resp = await client.post(
                f"/api/translate/{txn_id}",
                json={"target_language": "en", "source": "original", "force": True},
            )
        stored = await client.get(f"/api/translate/{txn_id}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["stale"] is False
    assert [u["text"] for u in data["utterances"]] == ["Hello beautiful world", "How are you"]
    llm.assert_awaited_once()
    assert [u["text"] for u in llm.await_args.args[1]] == ["Hallo schöne Welt", "Wie geht es dir"]
    assert stored.json()["stale"] is False
    assert [u["text"] for u in stored.json()["utterances"]] == ["Hello beautiful world", "How are you"]


@pytest.mark.asyncio
async def test_translate_with_force_while_a_translation_is_in_progress_returns_429():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        txn_id, _ = await _setup(client, txn_id="test-translate-force-busy")
        from app.database import get_db
        async with get_db() as db:
            await db.execute(
                "UPDATE transcriptions SET translated_utterances_json = '', "
                "translation_language = 'en' WHERE id = ?",
                (txn_id,),
            )
            await db.commit()

        llm = AsyncMock(return_value=_translated(["Hello world", "How are you"]))
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation", llm):
            resp = await client.post(
                f"/api/translate/{txn_id}",
                json={"target_language": "en", "force": True},
            )

    assert resp.status_code == 429
    llm.assert_not_called()


async def _stored_translation(txn_id):
    from app.database import get_db
    async with get_db() as db:
        row = await (await db.execute(
            "SELECT translated_utterances_json, translation_language, "
            "translation_source, translation_source_hash FROM transcriptions WHERE id = ?",
            (txn_id,),
        )).fetchone()
    return tuple(row)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["provider_raises", "count_mismatch"])
async def test_failed_retranslation_keeps_the_stored_translation(failure):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        txn_id, _ = await _setup(client, txn_id=f"test-translate-keep-{failure}")
        await _translate_then_edit_source(client, txn_id)
        before = await _stored_translation(txn_id)
        before_get = (await client.get(f"/api/translate/{txn_id}")).json()

        if failure == "provider_raises":
            llm = AsyncMock(side_effect=RuntimeError("LLM down"))
        else:
            llm = AsyncMock(return_value=_translated(["only one"]))
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation", llm):
            resp = await client.post(
                f"/api/translate/{txn_id}",
                json={"target_language": "fr", "source": "original", "force": True},
            )
        after_get = (await client.get(f"/api/translate/{txn_id}")).json()

    assert resp.status_code == 500
    assert await _stored_translation(txn_id) == before
    assert before[1] == "en"
    assert after_get == before_get
    assert after_get["stale"] is True


@pytest.mark.asyncio
async def test_failed_first_translation_leaves_no_translation():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        txn_id, _ = await _setup(client, txn_id="test-translate-fail-fresh")
        llm = AsyncMock(side_effect=RuntimeError("LLM down"))
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation", llm):
            resp = await client.post(f"/api/translate/{txn_id}", json={"target_language": "en"})

    assert resp.status_code == 500
    assert resp.json()["detail"] == "Translation failed"
    assert await _stored_translation(txn_id) == (None, None, None, None)


# ---------------------------------------------------------------------------
# Error paths, caching, in-progress guard and user scoping
# ---------------------------------------------------------------------------

INTRUDER = {"X-Auth-Request-User": "intruder"}


def _client(**kwargs):
    return AsyncClient(transport=ASGITransport(app=app, **kwargs), base_url="http://test")


@pytest.mark.asyncio
async def test_translate_503_without_llm_provider():
    async with _client() as client:
        txn_id, _ = await _setup(client, txn_id="tr-nollm")
        with patch("app.routers.translation.get_llm_provider", return_value=None):
            resp = await client.post(f"/api/translate/{txn_id}", json={"target_language": "en"})
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_translate_requires_target_language():
    async with _client() as client:
        txn_id, _ = await _setup(client, txn_id="tr-422")
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()):
            resp = await client.post(f"/api/translate/{txn_id}", json={})
            bad_source = await client.post(f"/api/translate/{txn_id}", json={"target_language": "en", "source": "bogus"})
    assert resp.status_code == 422
    assert bad_source.status_code == 422


@pytest.mark.asyncio
async def test_translate_404_for_foreign_transcription():
    async with _client() as client:
        txn_id, _ = await _setup(client, txn_id="tr-foreign")
        llm = AsyncMock()
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation", llm):
            resp = await client.post(f"/api/translate/{txn_id}", json={"target_language": "en"}, headers=INTRUDER)
    assert resp.status_code == 404
    llm.assert_not_awaited()
    assert await _stored_translation(txn_id) == (None, None, None, None)


@pytest.mark.asyncio
async def test_translate_400_while_transcription_not_completed():
    from app.database import get_db
    async with _client() as client:
        txn_id, _ = await _setup(client, txn_id="tr-pending")
        async with get_db() as db:
            await db.execute("UPDATE transcriptions SET status = 'processing' WHERE id = ?", (txn_id,))
            await db.commit()
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()):
            resp = await client.post(f"/api/translate/{txn_id}", json={"target_language": "en"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_translate_429_while_translation_in_progress():
    from app.database import get_db
    async with _client() as client:
        txn_id, _ = await _setup(client, txn_id="tr-busy")
        async with get_db() as db:
            await db.execute(
                "UPDATE transcriptions SET translated_utterances_json = '', translation_language = 'fr' WHERE id = ?",
                (txn_id,),
            )
            await db.commit()
        llm = AsyncMock()
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation", llm):
            resp = await client.post(f"/api/translate/{txn_id}", json={"target_language": "en"})
            get_resp = await client.get(f"/api/translate/{txn_id}")
    assert resp.status_code == 429
    llm.assert_not_awaited()
    assert get_resp.status_code == 404  # the in-progress marker is not a translation


@pytest.mark.asyncio
async def test_translate_returns_cached_result_for_same_language():
    async with _client() as client:
        txn_id, _ = await _setup(client, txn_id="tr-cache")
        llm = AsyncMock(return_value=_translated(["Hello world", "How are you"]))
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation", llm):
            first = await client.post(f"/api/translate/{txn_id}", json={"target_language": "en"})
            second = await client.post(f"/api/translate/{txn_id}", json={"target_language": "en"})
            third = await client.post(f"/api/translate/{txn_id}", json={"target_language": "fr"})
    assert first.status_code == second.status_code == third.status_code == 200
    assert second.json()["utterances"] == first.json()["utterances"]
    assert second.json()["stale"] is False
    assert second.json()["source_hash"] == first.json()["source_hash"]
    # Only the first and the different-language request reached the LLM
    assert llm.await_count == 2
    assert third.json()["language"] == "fr"


@pytest.mark.asyncio
async def test_translate_count_mismatch_is_rejected_and_reset():
    async with _client() as client:
        txn_id, _ = await _setup(client, txn_id="tr-mismatch")
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation", AsyncMock(return_value=_translated(["only one"]))):
            resp = await client.post(f"/api/translate/{txn_id}", json={"target_language": "en"})
    assert resp.status_code == 500
    assert "expected 2" in resp.json()["detail"]
    assert await _stored_translation(txn_id) == (None, None, None, None)


@pytest.mark.asyncio
async def test_call_llm_translation_concatenates_chunks_in_order():
    from app.routers.translation import _call_llm_translation
    chunked = AsyncMock(return_value=[{"utterances": [{"text": "a"}]}, {"utterances": [{"text": "b"}, {"text": "c"}]}, {}])
    with patch("app.routers.translation.chunked_utterance_call", chunked):
        out = await _call_llm_translation(AsyncMock(), [{"text": "x"}] * 3, "en")
    assert out == [{"text": "a"}, {"text": "b"}, {"text": "c"}]
    kwargs = chunked.await_args.kwargs
    assert kwargs["operation"] == "translation"
    assert kwargs["expect_same_count"] is True
    assert "English" in kwargs["build_system"]()


@pytest.mark.asyncio
async def test_get_translation_404s():
    async with _client() as client:
        txn_id, _ = await _setup(client, txn_id="tr-get-404")
        none_yet = await client.get(f"/api/translate/{txn_id}")
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation",
                   AsyncMock(return_value=_translated(["Hello world", "How are you"]))):
            await client.post(f"/api/translate/{txn_id}", json={"target_language": "en"})
        foreign = await client.get(f"/api/translate/{txn_id}", headers=INTRUDER)
        missing = await client.get("/api/translate/does-not-exist")
        own = await client.get(f"/api/translate/{txn_id}")
    assert none_yet.status_code == 404
    assert foreign.status_code == 404
    assert missing.status_code == 404
    assert own.status_code == 200
    assert own.json()["language"] == "en"
    assert own.json()["stale"] is False


@pytest.mark.asyncio
async def test_delete_translation_and_scoping():
    async with _client() as client:
        txn_id, _ = await _setup(client, txn_id="tr-del")
        with patch("app.routers.translation.get_llm_provider", return_value=AsyncMock()), \
             patch("app.routers.translation._call_llm_translation",
                   AsyncMock(return_value=_translated(["Hello world", "How are you"]))):
            await client.post(f"/api/translate/{txn_id}", json={"target_language": "en"})

        foreign = await client.delete(f"/api/translate/{txn_id}", headers=INTRUDER)
        assert foreign.status_code == 404
        assert (await _stored_translation(txn_id))[1] == "en"

        resp = await client.delete(f"/api/translate/{txn_id}")
        assert resp.status_code == 200
        assert (await client.get(f"/api/translate/{txn_id}")).status_code == 404
    assert await _stored_translation(txn_id) == (None, None, None, None)

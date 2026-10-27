import json
import logging

import aiosqlite
import pytest
from app.database import get_db, init_db
from app.services.source_tracking import hash_utterance_texts
from app.services.speaker_labels import (
    RelabelCounts,
    relabel_stored_speakers,
    utterances_aligned,
    with_speakers_from,
)


def test_with_speakers_from_copies_speakers_by_position():
    source = [{"speaker": "SPEAKER_00"}, {"speaker": None}, {"text": "no speaker key"}]
    target = [{"start": 0, "end": 1, "text": "a", "speaker": "Alice"},
              {"start": 1, "end": 2, "text": "b", "speaker": "SPEAKER_00"},
              {"start": 2, "end": 3, "text": "c"}]
    before = [dict(t) for t in target]
    out = with_speakers_from(source, target)
    assert [u["speaker"] for u in out] == ["SPEAKER_00", None, None]
    assert [(u["start"], u["text"]) for u in out] == [(0, "a"), (1, "b"), (2, "c")]
    assert target == before


def test_with_speakers_from_rejects_different_lengths():
    with pytest.raises(ValueError):
        with_speakers_from([{"speaker": "SPEAKER_00"}], [])


# --- One-time relabel of rows stored before the fix -------------------------

ORIG = [
    {"start": 0, "end": 1000, "text": "hallo", "speaker": "SPEAKER_00"},
    {"start": 1000, "end": 2000, "text": "welt", "speaker": "SPEAKER_01"},
]
REFINED_NAMED = [
    {**ORIG[0], "text": "Hallo.", "speaker": "Alice"},
    {**ORIG[1], "text": "Welt.", "speaker": "Bob"},
]
TRANSLATED_NAMED = [
    {**ORIG[0], "text": "Hello.", "speaker": "Alice"},
    {**ORIG[1], "text": "World.", "speaker": "Bob"},
]


def _dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def _transcription(tid, **columns) -> tuple[str, dict]:
    return "transcriptions", {"id": tid, "status": "completed", **columns}


async def _insert(path, rows):
    async with get_db(path) as db:
        for table, values in rows:
            await db.execute(
                f"INSERT INTO {table} ({', '.join(values)}) VALUES ({', '.join('?' for _ in values)})",
                tuple(values.values()),
            )
        await db.commit()


async def _relabel_legacy(tmp_path, rows) -> str:
    """Store ``rows`` as a release before the fix left them, then start up again."""
    path = str(tmp_path / "legacy.db")
    await init_db(path)  # a fresh database starts at user_version 1
    await _insert(path, rows)
    async with get_db(path) as db:
        await db.execute("PRAGMA user_version = 0")
        await db.commit()
    await init_db(path)
    return path


async def _row(path, tid) -> dict:
    async with get_db(path) as db:
        cursor = await db.execute("SELECT * FROM transcriptions WHERE id = ?", (tid,))
        return dict(await cursor.fetchone())


def _speakers(column_json: str) -> list:
    return [u.get("speaker") for u in json.loads(column_json)]


def _texts(column_json: str) -> list:
    return [u.get("text") for u in json.loads(column_json)]


def test_utterances_aligned():
    other = [
        {"start": 0, "end": 1000, "text": "anders", "speaker": "Alice"},
        {"start": 1000, "end": 2000, "text": "auch", "speaker": "Bob"},
    ]
    assert utterances_aligned(ORIG, other) is True
    assert utterances_aligned([], []) is True
    assert utterances_aligned(ORIG, other[:1]) is False
    assert utterances_aligned(ORIG, [other[0], {**other[1], "end": 1999}]) is False
    assert utterances_aligned(ORIG, [other[0], 1]) is False


@pytest.mark.asyncio
async def test_relabel_rewrites_named_refinement_and_translation(tmp_path):
    path = await _relabel_legacy(tmp_path, [
        _transcription(
            "t1", result_json=_dumps(ORIG),
            refined_utterances_json=_dumps(REFINED_NAMED),
            translated_utterances_json=_dumps(TRANSLATED_NAMED), translation_language="en",
        ),
    ])
    row = await _row(path, "t1")
    assert _speakers(row["refined_utterances_json"]) == ["SPEAKER_00", "SPEAKER_01"]
    assert _speakers(row["translated_utterances_json"]) == ["SPEAKER_00", "SPEAKER_01"]
    assert _texts(row["refined_utterances_json"]) == ["Hallo.", "Welt."]
    assert _texts(row["translated_utterances_json"]) == ["Hello.", "World."]


@pytest.mark.asyncio
async def test_relabel_uses_source_hash_when_times_were_edited(tmp_path):
    edited = [{**ORIG[0], "end": 900}, ORIG[1]]
    translated = _dumps(TRANSLATED_NAMED)
    path = await _relabel_legacy(tmp_path, [
        _transcription(
            "t1", result_json=_dumps(edited),
            refined_utterances_json=_dumps(REFINED_NAMED),
            refinement_metadata_json=_dumps({"changed_indices": [0, 1],
                                             "source_hash": hash_utterance_texts(ORIG)}),
            translated_utterances_json=translated, translation_language="en",
        ),
    ])
    row = await _row(path, "t1")
    assert _speakers(row["refined_utterances_json"]) == ["SPEAKER_00", "SPEAKER_01"]
    assert _texts(row["refined_utterances_json"]) == ["Hallo.", "Welt."]
    # The translation has no source hash for the original, and its times no longer match.
    assert row["translated_utterances_json"] == translated


@pytest.mark.asyncio
async def test_relabel_splits_merged_speakers_by_position(tmp_path):
    merged = [{**REFINED_NAMED[0], "speaker": "Alice"}, {**REFINED_NAMED[1], "speaker": "Alice"}]
    path = await _relabel_legacy(tmp_path, [
        _transcription("t1", result_json=_dumps(ORIG), refined_utterances_json=_dumps(merged)),
        ("speaker_mappings", {"transcription_id": "t1", "original_label": "SPEAKER_00", "custom_name": "Alice"}),
        ("speaker_mappings", {"transcription_id": "t1", "original_label": "SPEAKER_01", "custom_name": "Alice"}),
    ])
    row = await _row(path, "t1")
    assert _speakers(row["refined_utterances_json"]) == ["SPEAKER_00", "SPEAKER_01"]


@pytest.mark.asyncio
async def test_relabel_leaves_unaligned_rows_untouched(tmp_path):
    added = ORIG + [{"start": 2000, "end": 3000, "text": "neu", "speaker": "SPEAKER_00"}]
    edited = [{**ORIG[0], "end": 900, "text": "hallo du"}, ORIG[1]]
    refined = _dumps(REFINED_NAMED)
    translated = _dumps(TRANSLATED_NAMED)
    metadata = _dumps({"changed_indices": [0, 1], "source_hash": hash_utterance_texts(ORIG)})
    path = await _relabel_legacy(tmp_path, [
        _transcription("t-added", result_json=_dumps(added), refined_utterances_json=refined,
                       refinement_metadata_json=metadata,
                       translated_utterances_json=translated, translation_language="en"),
        _transcription("t-edited", result_json=_dumps(edited), refined_utterances_json=refined,
                       refinement_metadata_json=metadata,
                       translated_utterances_json=translated, translation_language="en"),
    ])
    for tid in ("t-added", "t-edited"):
        row = await _row(path, tid)
        assert row["refined_utterances_json"] == refined
        assert row["translated_utterances_json"] == translated
        assert row["refinement_metadata_json"] == metadata


@pytest.mark.asyncio
async def test_relabel_skips_unreadable_and_in_progress_rows(tmp_path):
    rows = [
        _transcription("t-refining", result_json=_dumps(ORIG), refined_utterances_json="",
                       translated_utterances_json=""),
        # As test_interrupted_jobs.py stores a finished row: no original, '[1]' and '[2]'.
        _transcription("t-done", refined_utterances_json="[1]", translated_utterances_json="[2]",
                       translation_language="de"),
        _transcription("t-bad", result_json=_dumps(ORIG), refined_utterances_json="not json",
                       translated_utterances_json="not json either", translation_language="en"),
        _transcription("t-no-original", result_json=None, refined_utterances_json=_dumps(REFINED_NAMED)),
        # JSON, but not lists: an empty original would otherwise "line up" with them.
        _transcription("t-not-lists", result_json="[]", refined_utterances_json="{}",
                       translated_utterances_json='""', translation_language="en"),
    ]
    path = await _relabel_legacy(tmp_path, rows)
    for _, values in rows:
        row = await _row(path, values["id"])
        for column, stored in values.items():
            assert row[column] == stored, (values["id"], column)


@pytest.mark.asyncio
async def test_relabel_keeps_source_hashes_valid(tmp_path):
    metadata = _dumps({"changed_indices": [0, 1], "changes_summary": "Satzzeichen",
                       "source_hash": hash_utterance_texts(ORIG), "failed_ranges": []})
    refined_hash = hash_utterance_texts(REFINED_NAMED)
    path = await _relabel_legacy(tmp_path, [
        _transcription(
            "t1", result_json=_dumps(ORIG),
            refined_utterances_json=_dumps(REFINED_NAMED), refinement_metadata_json=metadata,
            translated_utterances_json=_dumps(TRANSLATED_NAMED), translation_language="en",
            translation_source="refined", translation_source_hash=refined_hash,
        ),
        ("analyses", {"id": "a1", "transcription_id": "t1", "analysis_json": "{}",
                      "source": "refined", "source_hash": refined_hash}),
    ])
    row = await _row(path, "t1")
    async with get_db(path) as db:
        cursor = await db.execute("SELECT source_hash FROM analyses WHERE id = 'a1'")
        analysis_hash = (await cursor.fetchone())["source_hash"]
    new_refined = json.loads(row["refined_utterances_json"])
    assert [u["speaker"] for u in new_refined] == ["SPEAKER_00", "SPEAKER_01"]
    assert hash_utterance_texts(new_refined) == row["translation_source_hash"] == analysis_hash
    assert row["translation_source"] == "refined"
    assert row["refinement_metadata_json"] == metadata
    # The refinement is not reported as made from an older original.
    assert json.loads(metadata)["source_hash"] == hash_utterance_texts(json.loads(row["result_json"]))


@pytest.mark.asyncio
async def test_relabel_runs_once(tmp_path):
    path = await _relabel_legacy(tmp_path, [
        _transcription(
            "t1", result_json=_dumps(ORIG),
            refined_utterances_json=_dumps(REFINED_NAMED),
            translated_utterances_json=_dumps(TRANSLATED_NAMED), translation_language="en",
        ),
    ])
    relabelled = [{**ORIG[0], "speaker": "SPEAKER_05"}, {**ORIG[1], "speaker": "SPEAKER_06"}]
    async with get_db(path) as db:
        await db.execute("UPDATE transcriptions SET result_json = ? WHERE id = 't1'", (_dumps(relabelled),))
        await db.commit()
    await init_db(path)
    async with get_db(path) as db:
        cursor = await db.execute("PRAGMA user_version")
        assert (await cursor.fetchone())[0] == 1
    row = await _row(path, "t1")
    assert _speakers(row["refined_utterances_json"]) == ["SPEAKER_00", "SPEAKER_01"]


@pytest.mark.asyncio
async def test_relabel_counts_rows_and_logs_no_content(tmp_path, caplog, capsys):
    path = str(tmp_path / "counts.db")
    await init_db(path)
    await _insert(path, [
        _transcription("t-named", result_json=_dumps(ORIG),
                       refined_utterances_json=_dumps(REFINED_NAMED),
                       translated_utterances_json=_dumps(TRANSLATED_NAMED), translation_language="en"),
        # Already labelled: lines up, but nothing to rewrite.
        _transcription("t-clean", result_json=_dumps(ORIG),
                       refined_utterances_json=_dumps(with_speakers_from(ORIG, REFINED_NAMED))),
        _transcription("t-bad", result_json=_dumps(ORIG), refined_utterances_json="not json"),
        _transcription("t-added", result_json=_dumps(ORIG + ORIG),
                       translated_utterances_json=_dumps(TRANSLATED_NAMED), translation_language="en"),
    ])
    caplog.set_level(logging.INFO, logger="app.services.speaker_labels")
    # Positional rows, as init_db's connection returns them.
    async with aiosqlite.connect(path) as db:
        counts = await relabel_stored_speakers(db)
        await db.commit()
    assert counts == RelabelCounts(refinements=1, translations=1, skipped=2)
    out = capsys.readouterr().out
    assert "1 refinements and 1 translations rewritten, 2 skipped" in out
    assert "t-bad" in caplog.text and "JSONDecodeError" in caplog.text
    for secret in ("Alice", "Bob", "hallo", "Hallo.", "Hello.", "not json"):
        assert secret not in caplog.text
        assert secret not in out

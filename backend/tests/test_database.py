import os

import pytest
from app.database import init_db, get_db


@pytest.mark.asyncio
async def test_init_db_creates_tables(tmp_db_path):
    await init_db(tmp_db_path)
    async with get_db(tmp_db_path) as db:
        cursor = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        tables = [row[0] for row in await cursor.fetchall()]
    assert "users" in tables
    assert "files" in tables
    assert "transcriptions" in tables
    assert "speaker_mappings" in tables
    assert "analyses" in tables


@pytest.mark.asyncio
async def test_init_db_is_idempotent(tmp_db_path):
    await init_db(tmp_db_path)
    await init_db(tmp_db_path)  # Should not raise


@pytest.mark.asyncio
async def test_has_video_column_exists(tmp_path):
    db_path = str(tmp_path / "migration_test.db")
    await init_db(db_path)
    async with get_db(db_path) as db:
        cursor = await db.execute("PRAGMA table_info(files)")
        columns = {row[1] for row in await cursor.fetchall()}
    assert "has_video" in columns


@pytest.mark.asyncio
async def test_api_tokens_table_created(tmp_path):
    db_path = str(tmp_path / "api_tokens.db")
    await init_db(db_path)
    async with get_db(db_path) as db:
        cursor = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='api_tokens'"
        )
        row = await cursor.fetchone()
    assert row is not None


@pytest.mark.asyncio
async def test_api_tokens_hash_index_created(tmp_path):
    db_path = str(tmp_path / "api_tokens_idx.db")
    await init_db(db_path)
    async with get_db(db_path) as db:
        cursor = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_api_tokens_hash'"
        )
        row = await cursor.fetchone()
    assert row is not None


@pytest.mark.asyncio
async def test_source_tracking_columns_exist(tmp_path):
    db_path = str(tmp_path / "source_tracking.db")
    await init_db(db_path)
    async with get_db(db_path) as db:
        cursor = await db.execute("PRAGMA table_info(transcriptions)")
        txn_columns = {row[1] for row in await cursor.fetchall()}
        cursor = await db.execute("PRAGMA table_info(analyses)")
        ana_columns = {row[1] for row in await cursor.fetchall()}
    assert "translation_source" in txn_columns
    assert "translation_source_hash" in txn_columns
    assert "source" in ana_columns
    assert "source_hash" in ana_columns


@pytest.mark.asyncio
async def test_secure_delete_overwrites_content(tmp_path):
    db_path = str(tmp_path / "secure_delete.db")
    await init_db(db_path)
    async with get_db(db_path) as db:
        await db.execute(
            "INSERT INTO transcriptions (id, result_json) VALUES (?, ?)",
            ("t1", '{"text": "SECRET-MARKER-7d1f"}'),
        )
        await db.commit()
        await db.execute("DELETE FROM transcriptions WHERE id = ?", ("t1",))
        await db.commit()
    # Read the file and any journal/WAL sidecar left after the connection closed
    leftover = b"".join(
        open(p, "rb").read()
        for p in (db_path, db_path + "-wal", db_path + "-journal")
        if os.path.exists(p)
    )
    assert b"SECRET-MARKER-7d1f" not in leftover


def _legacy_analyses_db(db_path):
    """A database whose analyses table predates the `id` column."""
    import sqlite3

    conn = sqlite3.connect(db_path)
    conn.execute(
        """CREATE TABLE analyses (
               transcription_id TEXT,
               analysis_json TEXT,
               template TEXT,
               custom_prompt TEXT,
               language TEXT,
               llm_provider TEXT,
               llm_model TEXT,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )"""
    )
    conn.execute(
        "INSERT INTO analyses (transcription_id, analysis_json, template) "
        "VALUES ('legacy-txn', '{\"summary\": \"x\"}', 'summary')"
    )
    conn.commit()
    conn.close()


@pytest.mark.asyncio
async def test_legacy_analyses_table_migrates_in_one_start(tmp_path):
    db_path = str(tmp_path / "legacy_analyses.db")
    _legacy_analyses_db(db_path)

    await init_db(db_path)  # must not raise on the first start

    async with get_db(db_path) as db:
        cursor = await db.execute("PRAGMA table_info(analyses)")
        columns = {row[1] for row in await cursor.fetchall()}
        cursor = await db.execute(
            "SELECT transcription_id, source FROM analyses"
        )
        rows = await cursor.fetchall()
    assert {"id", "source", "source_hash"} <= columns
    assert [(r[0], r[1]) for r in rows] == [("legacy-txn", "original")]


@pytest.mark.asyncio
async def test_legacy_analyses_rows_survive_migration(tmp_path):
    """Finished rows are copied with fresh ids, abandoned in-progress
    placeholders are dropped and the temporary table is removed."""
    import sqlite3

    db_path = str(tmp_path / "legacy_rows.db")
    _legacy_analyses_db(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO analyses (transcription_id, analysis_json, template) "
        "VALUES ('legacy-txn', NULL, 'summary')"
    )
    conn.commit()
    conn.close()

    await init_db(db_path)

    async with get_db(db_path) as db:
        rows = await (await db.execute("SELECT id, transcription_id, analysis_json, source FROM analyses")).fetchall()
        tables = {r[0] for r in await (await db.execute("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()}
    assert len(rows) == 1
    assert rows[0]["id"] and rows[0]["transcription_id"] == "legacy-txn"
    assert rows[0]["analysis_json"] == '{"summary": "x"}'
    assert rows[0]["source"] == "original"
    assert "_analyses_old" not in tables


def _legacy_transcriptions_db(db_path):
    """A database from before original_result_json existed."""
    import sqlite3

    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE transcriptions (id TEXT PRIMARY KEY, user_id TEXT, file_id TEXT, "
        "status TEXT, result_json TEXT)"
    )
    conn.execute(
        "INSERT INTO transcriptions (id, status, result_json) VALUES "
        "('edited', 'completed', "
        "'[{\"start\": 0, \"end\": 1000, \"text\": \"saved edit\", \"speaker\": \"SPEAKER_00\"}]')"
    )
    conn.execute(
        "INSERT INTO transcriptions (id, status, result_json) VALUES ('running', 'processing', NULL)"
    )
    conn.commit()
    conn.close()


@pytest.mark.asyncio
async def test_legacy_transcriptions_get_their_current_state_as_original_in_one_start(tmp_path):
    db_path = str(tmp_path / "legacy.db")
    _legacy_transcriptions_db(db_path)

    await init_db(db_path)

    async with get_db(db_path) as db:
        cursor = await db.execute(
            "SELECT id, result_json, original_result_json FROM transcriptions"
        )
        rows = {r[0]: r for r in await cursor.fetchall()}
    assert rows["edited"]["original_result_json"] == rows["edited"]["result_json"]
    assert rows["running"]["original_result_json"] is None


@pytest.mark.asyncio
async def test_backfill_never_overwrites_a_stored_original(tmp_path):
    db_path = str(tmp_path / "keep.db")
    await init_db(db_path)
    asr = '[{"start": 0, "end": 1, "text": "asr", "speaker": null}]'
    async with get_db(db_path) as db:
        await db.execute(
            "INSERT INTO transcriptions (id, status, result_json, original_result_json) "
            "VALUES ('t1', 'completed', ?, ?)",
            ('[{"start": 0, "end": 1, "text": "edited", "speaker": null}]', asr),
        )
        await db.commit()

    await init_db(db_path)

    async with get_db(db_path) as db:
        cursor = await db.execute("SELECT original_result_json FROM transcriptions WHERE id = 't1'")
        row = await cursor.fetchone()
    assert row["original_result_json"] == asr


@pytest.mark.asyncio
async def test_init_db_backfills_and_normalizes(tmp_path):
    db_path = str(tmp_path / "backfill.db")
    await init_db(db_path)
    async with get_db(db_path) as db:
        await db.execute("INSERT INTO users (id) VALUES ('u')")
        await db.execute("INSERT INTO files (id, user_id, created_at, expires_at) VALUES ('f-null', 'u', '2024-01-01 00:00:00', NULL)")
        await db.execute("INSERT INTO files (id, user_id, expires_at) VALUES ('f-iso', 'u', '2024-01-01T12:30:00+00:00')")
        await db.execute("INSERT INTO api_tokens (id, user_id, name, prefix, token_hash, expires_at) VALUES ('tok', 'u', 'n', 'p', 'h', NULL)")
        await db.execute("INSERT INTO transcriptions (id, translated_utterances_json) VALUES ('tr', '[]')")
        await db.execute("INSERT INTO transcriptions (id, translated_utterances_json) VALUES ('tr-busy', '')")
        await db.commit()

    await init_db(db_path)

    async with get_db(db_path) as db:
        exp = {r["id"]: r["expires_at"] for r in await (await db.execute("SELECT id, expires_at FROM files")).fetchall()}
        tok = await (await db.execute("SELECT expires_at FROM api_tokens WHERE id = 'tok'")).fetchone()
        src = {r["id"]: r["translation_source"] for r in await (await db.execute("SELECT id, translation_source FROM transcriptions")).fetchall()}
    assert exp["f-iso"] == "2024-01-01 12:30:00"
    assert exp["f-null"] is not None and exp["f-null"] > "2024-01-01 00:00:00"
    assert tok["expires_at"] is not None
    assert src == {"tr": "original", "tr-busy": None}

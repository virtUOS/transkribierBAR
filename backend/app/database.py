import uuid

import aiosqlite
from contextlib import asynccontextmanager
from app.config import settings
from app.services.speaker_labels import relabel_stored_speakers

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    original_filename TEXT,
    file_path TEXT,
    mp3_path TEXT,
    media_type TEXT,
    file_size INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    is_archived INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transcriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    file_id TEXT REFERENCES files(id),
    asr_job_id TEXT,
    asr_backend TEXT,
    status TEXT,
    language TEXT,
    model TEXT,
    min_speakers INTEGER,
    max_speakers INTEGER,
    initial_prompt TEXT,
    hotwords TEXT,
    result_json TEXT,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    refined_utterances_json TEXT,
    refinement_metadata_json TEXT,
    translation_source TEXT,
    translation_source_hash TEXT
);

CREATE TABLE IF NOT EXISTS speaker_mappings (
    transcription_id TEXT REFERENCES transcriptions(id),
    original_label TEXT,
    custom_name TEXT,
    PRIMARY KEY (transcription_id, original_label)
);

CREATE TABLE IF NOT EXISTS analyses (
    id TEXT PRIMARY KEY,
    transcription_id TEXT REFERENCES transcriptions(id),
    analysis_json TEXT,
    template TEXT,
    custom_prompt TEXT,
    language TEXT,
    llm_provider TEXT,
    llm_model TEXT,
    source TEXT,
    source_hash TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transcription_presets (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    name TEXT NOT NULL,
    language TEXT,
    model TEXT DEFAULT 'base',
    min_speakers INTEGER DEFAULT 0,
    max_speakers INTEGER DEFAULT 0,
    initial_prompt TEXT,
    hotwords TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS analysis_presets (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    name TEXT NOT NULL,
    template TEXT,
    custom_prompt TEXT,
    language TEXT,
    chapter_hints TEXT,
    agenda TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refinement_presets (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    name TEXT NOT NULL,
    context TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS preset_bundles (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    name TEXT NOT NULL,
    transcription_preset_id TEXT REFERENCES transcription_presets(id) ON DELETE SET NULL,
    analysis_preset_id TEXT REFERENCES analysis_presets(id) ON DELETE SET NULL,
    refinement_preset_id TEXT REFERENCES refinement_presets(id) ON DELETE SET NULL,
    translate_language TEXT,
    is_default INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    last_used_at TIMESTAMP,
    revoked_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);

CREATE TABLE IF NOT EXISTS api_token_expiry_notices (
    token_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
    days_before INTEGER NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (token_id, days_before)
);

CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    accepted_at TIMESTAMP,
    accepted_by_user_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status);
"""

_db_path: str = ""


# SCHEMA holds CREATE TABLE / CREATE INDEX statements (idempotent via
# IF NOT EXISTS). New tables go here. MIGRATIONS is only for adding
# *columns* to existing tables on old databases.
MIGRATIONS = [
    # (column_name, table, column_def)
    ("refined_utterances_json", "transcriptions", "refined_utterances_json TEXT"),
    ("refinement_metadata_json", "transcriptions", "refinement_metadata_json TEXT"),
    ("translated_utterances_json", "transcriptions", "translated_utterances_json TEXT"),
    ("translation_language", "transcriptions", "translation_language TEXT"),
    ("expires_at", "files", "expires_at TIMESTAMP"),
    ("is_archived", "files", "is_archived INTEGER DEFAULT 0"),
    ("title", "transcriptions", "title TEXT"),
    ("has_video", "files", "has_video INTEGER"),
    ("translate_language", "preset_bundles", "translate_language TEXT"),
    ("translation_source", "transcriptions", "translation_source TEXT"),
    ("translation_source_hash", "transcriptions", "translation_source_hash TEXT"),
    ("source", "analyses", "source TEXT"),
    ("source_hash", "analyses", "source_hash TEXT"),
    ("error_code", "transcriptions", "error_code TEXT"),
    # The first stored result; restored by the editor's Restore original.
    # Written only on completion and by the backfill in init_db.
    ("original_result_json", "transcriptions", "original_result_json TEXT"),
]

# One-time data steps are keyed by PRAGMA user_version: init_db runs each step
# whose number is above the stored version, then stores DATA_VERSION. The next
# step goes under `if version < 2:`, with DATA_VERSION raised to 2.
DATA_VERSION = 1


async def init_db(db_path: str) -> None:
    global _db_path
    _db_path = db_path
    async with aiosqlite.connect(db_path) as db:
        # Overwrite deleted content instead of leaving it in free pages
        await db.execute("PRAGMA secure_delete = ON")
        await db.executescript(SCHEMA)
        # Add columns that may be missing on existing databases
        for col_name, table, col_def in MIGRATIONS:
            cursor = await db.execute(f"PRAGMA table_info({table})")
            columns = {row[1] for row in await cursor.fetchall()}
            if col_name not in columns:
                await db.execute(f"ALTER TABLE {table} ADD COLUMN {col_def}")
        # Migrate analyses table: add `id` column as primary key
        cursor = await db.execute("PRAGMA table_info(analyses)")
        analysis_columns = {row[1] for row in await cursor.fetchall()}
        if "id" not in analysis_columns:
            await db.execute("ALTER TABLE analyses RENAME TO _analyses_old")
            await db.execute("""
                CREATE TABLE IF NOT EXISTS analyses (
                    id TEXT PRIMARY KEY,
                    transcription_id TEXT REFERENCES transcriptions(id),
                    analysis_json TEXT,
                    template TEXT,
                    custom_prompt TEXT,
                    language TEXT,
                    llm_provider TEXT,
                    llm_model TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    source TEXT,
                    source_hash TEXT
                )
            """)
            # Clean up orphaned in-progress placeholders
            await db.execute("DELETE FROM _analyses_old WHERE analysis_json IS NULL")
            # Copy existing rows, generating UUIDs in Python
            cursor = await db.execute(
                "SELECT transcription_id, analysis_json, template, custom_prompt, language, llm_provider, llm_model, created_at FROM _analyses_old"
            )
            rows = await cursor.fetchall()
            for row in rows:
                new_id = str(uuid.uuid4())
                await db.execute(
                    """INSERT INTO analyses (id, transcription_id, analysis_json, template, custom_prompt, language, llm_provider, llm_model, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (new_id, row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7]),
                )
            await db.execute("DROP TABLE _analyses_old")
            await db.commit()

        # Backfill expires_at for existing files
        await db.execute(
            "UPDATE files SET expires_at = datetime(created_at, '+' || ? || ' hours') WHERE expires_at IS NULL",
            (str(settings.DEFAULT_EXPIRY_HOURS),),
        )
        # Normalize any ISO-format (T-separator) timestamps to SQLite format (space-separator)
        await db.execute(
            "UPDATE files SET expires_at = strftime('%Y-%m-%d %H:%M:%S', expires_at) WHERE expires_at LIKE '%T%'"
        )
        # Give API tokens created without an expiry one (only NULL rows change)
        await db.execute(
            "UPDATE api_tokens SET expires_at = strftime('%Y-%m-%d %H:%M:%S', 'now', '+' || ? || ' days') "
            "WHERE expires_at IS NULL",
            (str(settings.API_TOKEN_DEFAULT_EXPIRY_DAYS),),
        )
        # Backfill source='original' on rows that already have derived results
        await db.execute(
            "UPDATE transcriptions SET translation_source = 'original' "
            "WHERE translated_utterances_json IS NOT NULL "
            "AND translated_utterances_json != '' "
            "AND translation_source IS NULL"
        )
        await db.execute(
            "UPDATE analyses SET source = 'original' "
            "WHERE analysis_json IS NOT NULL AND source IS NULL"
        )
        # Rows from before original_result_json existed get their state at the
        # update as their original (only NULL rows change)
        await db.execute(
            "UPDATE transcriptions SET original_result_json = result_json "
            "WHERE original_result_json IS NULL AND result_json IS NOT NULL"
        )
        cursor = await db.execute("PRAGMA user_version")
        version = (await cursor.fetchone())[0]
        if version < 1:
            # Refinements and translations stored before #215 carry speaker names
            await relabel_stored_speakers(db)
        if version < DATA_VERSION:
            # Committed together with the steps above, so a crash reruns them
            await db.execute(f"PRAGMA user_version = {DATA_VERSION}")
        await db.commit()


@asynccontextmanager
async def get_db(db_path: str | None = None):
    path = db_path or _db_path
    async with aiosqlite.connect(path) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute("PRAGMA secure_delete = ON")
        db.row_factory = aiosqlite.Row
        yield db

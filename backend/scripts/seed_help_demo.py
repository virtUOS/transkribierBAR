"""Seed a fresh database with deterministic demo data for the help screenshots.

Usage (from backend/):
    python -m scripts.seed_help_demo --db PATH --media-dir DIR

Creates, for the DEV_MODE identity ``dev-user``, one German and one English
fictional interview (two speakers, ~2 minutes) with speaker names, a summary
analysis, a refinement and a translation each, plus one transcription preset,
one bundle and one API token. The media files are generated sine tones.
Nothing here contacts an ASR or LLM service.
"""
import argparse
import asyncio
import json
import os
import shutil
import subprocess
import sys
import uuid
from datetime import date, timedelta

import aiosqlite

from app.database import init_db
from app.services.api_tokens import create_token
from app.services.source_tracking import hash_utterance_texts

USER_ID = "dev-user"
USER_EMAIL = "dev@localhost"
FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "help_demo", "fixture.json")
_NS = uuid.UUID("5d0b6f1e-0c1a-4a55-9a52-6f2f3b1c7e10")

# Timestamps are UTC in SQLite's format; 07:00 UTC is 09:00 at +02:00.
_CREATED = {"de": "2026-10-01 07:00:00", "en": "2026-10-01 06:00:00"}
_COMPLETED = {"de": "2026-10-01 07:02:00", "en": "2026-10-01 06:02:00"}
_ANALYSIS_CREATED = "2026-10-01 07:10:00"
_REFINEMENT_CREATED = "2026-10-01T07:05:00+00:00"
# Production retention: a plain item expires 72 h after creation; the archived German item
# has the archive retention of 4320 h (180 days), counted here from creation.
_EXPIRES = {"de": "2027-03-30 07:00:00", "en": "2026-10-04 06:00:00"}
ARCHIVED = {"de": 1, "en": 0}
TONE_HZ = {"de": 440, "en": 523}
DURATION_S = 120
DEFAULT_BASE_DATE = date(2026, 10, 1)
DEMO_LLM = {"provider": "demo", "model": "demo-model"}


def _shift(value, days: int):
    """Shift the date part of a timestamp string (or dict of them) by days."""
    if isinstance(value, dict):
        return {k: _shift(v, days) for k, v in value.items()}
    return (date.fromisoformat(value[:10]) + timedelta(days=days)).isoformat() + value[10:]


def _id(name: str) -> str:
    return str(uuid.uuid5(_NS, name))


def generate_media(path: str, frequency: int) -> None:
    """Write a DURATION_S-second sine-tone mp3 to path using ffmpeg."""
    ffmpeg = shutil.which(os.environ.get("FFMPEG_PATH", "ffmpeg"))
    if ffmpeg is None:
        raise SystemExit(
            "ffmpeg was not found on PATH (set FFMPEG_PATH to override); "
            "it is required to generate the demo media."
        )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    result = subprocess.run(
        [
            ffmpeg, "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", f"sine=frequency={frequency}:duration={DURATION_S}",
            "-codec:a", "libmp3lame", "-b:a", "64k", "-map_metadata", "-1", path,
        ],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise SystemExit(f"ffmpeg failed: {result.stderr.strip()[-500:]}")


def _with_texts(utterances: list[dict], texts: list[str]) -> list[dict]:
    return [{**u, "text": t} for u, t in zip(utterances, texts)]


async def seed(
    db_path: str,
    media_dir: str,
    *,
    make_media: bool = True,
    base_date: date | None = None,
) -> dict[str, str]:
    """Seed db_path (must not already hold data) and return the new ids.

    base_date (default 2026-10-01) is the day the demo content was "created";
    every created/expires timestamp is shifted by the same number of days,
    keeping the expiry offsets relative to it.

    make_media=False skips ffmpeg (paths are still recorded); the CLI always
    generates media.
    """
    days = ((base_date or DEFAULT_BASE_DATE) - DEFAULT_BASE_DATE).days
    CREATED, COMPLETED, EXPIRES = (_shift(d, days) for d in (_CREATED, _COMPLETED, _EXPIRES))
    ANALYSIS_CREATED = _shift(_ANALYSIS_CREATED, days)
    REFINEMENT_CREATED = _shift(_REFINEMENT_CREATED, days)
    with open(FIXTURE_PATH, encoding="utf-8") as fh:
        fixture = json.load(fh)
    if os.path.exists(db_path) and os.path.getsize(db_path) > 0:
        raise SystemExit(f"{db_path} already exists; seed into a fresh database.")
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    media_dir = os.path.abspath(media_dir)
    await init_db(db_path)

    ids: dict[str, str] = {}
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute("PRAGMA secure_delete = ON")
        await db.execute(
            "INSERT INTO users (id, email, first_seen, last_active) VALUES (?, ?, ?, ?)",
            (USER_ID, USER_EMAIL, CREATED["en"], ANALYSIS_CREATED),
        )

        for code in ("de", "en"):
            fx = fixture[code]
            file_id, txn_id = _id(f"file_{code}"), _id(f"transcription_{code}")
            ids[f"file_{code}"], ids[f"transcription_{code}"] = file_id, txn_id

            mp3_path = os.path.join(media_dir, f"{file_id}.mp3")
            if make_media:
                generate_media(mp3_path, TONE_HZ[code])
                size = os.path.getsize(mp3_path)
            else:
                size = 0
            await db.execute(
                """INSERT INTO files (id, user_id, original_filename, file_path, mp3_path,
                       media_type, file_size, created_at, expires_at, is_archived, has_video)
                   VALUES (?, ?, ?, ?, ?, 'mp3', ?, ?, ?, ?, 0)""",
                (file_id, USER_ID, fx["filename"], mp3_path, mp3_path, size,
                 CREATED[code], EXPIRES[code], ARCHIVED[code]),
            )

            original = fx["utterances"]
            refined = _with_texts(original, fx["refined_texts"])
            translated = _with_texts(original, fx["translated_texts"])
            changed = [i for i, (a, b) in enumerate(zip(original, refined)) if a["text"] != b["text"]]
            refined_hash = hash_utterance_texts(refined)
            metadata = {
                "changed_indices": changed,
                "changes_summary": fx["refinement_summary"],
                "context": fx["refinement_context"],
                "llm_provider": DEMO_LLM["provider"],
                "llm_model": DEMO_LLM["model"],
                "created_at": REFINEMENT_CREATED,
                "failed_ranges": [],
                "source_hash": hash_utterance_texts(original),
            }
            await db.execute(
                """INSERT INTO transcriptions (id, user_id, file_id, asr_job_id, asr_backend,
                       status, language, model, min_speakers, max_speakers, result_json,
                       original_result_json,
                       created_at, completed_at, refined_utterances_json,
                       refinement_metadata_json, translated_utterances_json,
                       translation_language, translation_source, translation_source_hash, title)
                   VALUES (?, ?, ?, ?, 'demo', 'completed', ?, 'large-v3-turbo', 2, 2, ?, ?, ?, ?,
                           ?, ?, ?, ?, 'refined', ?, ?)""",
                (txn_id, USER_ID, file_id, f"demo-{code}", code,
                 json.dumps(original, ensure_ascii=False),
                 json.dumps(original, ensure_ascii=False), CREATED[code], COMPLETED[code],
                 json.dumps(refined, ensure_ascii=False),
                 json.dumps(metadata, ensure_ascii=False),
                 json.dumps(translated, ensure_ascii=False),
                 fx["translation_language"], refined_hash, fx["title"]),
            )

            for label, name in fx["speaker_names"].items():
                await db.execute(
                    "INSERT INTO speaker_mappings (transcription_id, original_label, custom_name) VALUES (?, ?, ?)",
                    (txn_id, label, name),
                )

            analysis = {
                "summary": fx["summary"],
                "chapters": fx["chapters"],
                "chapter_hints": None,
                "language": code,
                "template": "summary",
            }
            await db.execute(
                """INSERT INTO analyses (id, transcription_id, analysis_json, template, custom_prompt,
                       language, llm_provider, llm_model, source, source_hash, created_at)
                   VALUES (?, ?, ?, 'summary', NULL, ?, ?, ?, 'refined', ?, ?)""",
                (_id(f"analysis_{code}"), txn_id, json.dumps(analysis, ensure_ascii=False), code,
                 DEMO_LLM["provider"], DEMO_LLM["model"], refined_hash, ANALYSIS_CREATED),
            )

        preset_id, bundle_id = _id("transcription_preset"), _id("bundle")
        await db.execute(
            """INSERT INTO transcription_presets (id, user_id, name, language, model,
                   min_speakers, max_speakers, initial_prompt, hotwords, created_at, updated_at)
               VALUES (?, ?, 'Workshop-Interview', 'de', 'large-v3-turbo', 2, 2,
                       'Interview about planning a university workshop.', 'Workshop, Semester', ?, ?)""",
            (preset_id, USER_ID, CREATED["de"], CREATED["de"]),
        )
        await db.execute(
            """INSERT INTO preset_bundles (id, user_id, name, transcription_preset_id,
                   translate_language, created_at, updated_at)
               VALUES (?, ?, 'Workshop-Interview, DE → EN', ?, 'en', ?, ?)""",
            (bundle_id, USER_ID, preset_id, CREATED["de"], CREATED["de"]),
        )
        await db.commit()

        # Raw token is intentionally discarded: it is never printed or stored.
        await create_token(db, user_id=USER_ID, name="Demo-Skript", expires_in_days=90)
    return ids


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed demo data for the help screenshots.")
    parser.add_argument("--db", required=True, help="Path of the new SQLite database")
    parser.add_argument("--media-dir", required=True, help="Directory for generated media")
    parser.add_argument("--base-date", type=date.fromisoformat, default=None,
                        help="YYYY-MM-DD the demo content is created on (default 2026-10-01)")
    args = parser.parse_args(argv)
    ids = asyncio.run(seed(args.db, args.media_dir, base_date=args.base_date))
    print(json.dumps(ids, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

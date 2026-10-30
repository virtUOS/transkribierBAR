import json
import logging
import traceback
from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import get_current_user
from app.router_helpers import (
    ensure_transcription_owned,
    reset_translation_state,
    restore_translation_state,
)
from app.models import UserInfo, TranslationRequest
from app.database import get_db
from app.services.llm import get_llm_provider
from app.services.llm.base import chunked_utterance_call
from app.services.llm.prompt import build_translation_system_prompt, _language_name
from app.metrics import inc, measure_llm_operation, deletions_total

router = APIRouter()


async def _call_llm_translation(provider, utterances: list[dict], target_language: str) -> list[dict]:
    """Call LLM to translate utterances, chunking if needed."""
    # Goes through the provider's own _json_chat rather than reaching into its
    # client: that is what applies the schema-echo guard and token tracking, and
    # translation previously had to reimplement both per provider type.
    results = await chunked_utterance_call(
        provider, utterances,
        build_system=lambda: build_translation_system_prompt(target_language),
        operation="translation",
        expect_same_count=True,
    )

    all_translated: list[dict] = []
    for data in results:
        all_translated.extend(data.get("utterances", []))

    return all_translated


async def _undo_translation_attempt(transcription_id: str, user_id: str, previous) -> None:
    """Give back the translation the user had before a failed attempt, if any."""
    if previous:
        await restore_translation_state(transcription_id, user_id, previous)
    else:
        await reset_translation_state(transcription_id, user_id)


@router.post("/api/translate/{transcription_id}")
async def translate_transcription(
    transcription_id: str,
    body: TranslationRequest,
    user: UserInfo = Depends(get_current_user),
):
    provider = get_llm_provider()
    if not provider:
        raise HTTPException(status_code=503, detail="LLM provider not configured")

    from app.services.source_tracking import hash_utterance_texts, select_source

    async with get_db() as db:
        cursor = await db.execute(
            """SELECT status, language, result_json, refined_utterances_json,
                      translated_utterances_json, translation_language,
                      translation_source, translation_source_hash
               FROM transcriptions WHERE id = ? AND user_id = ?""",
            (transcription_id, user.id),
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Transcription not found")

        status = row["status"]
        result_json = row["result_json"]
        refined_json = row["refined_utterances_json"]
        translated_json = row["translated_utterances_json"]
        translation_lang = row["translation_language"]
        cached_source = row["translation_source"]
        cached_hash = row["translation_source_hash"]

        same_language = translation_lang == body.target_language
        same_source_request = body.source is None or body.source == (cached_source or "original")
        if (
            not body.force
            and translated_json and translated_json != ""
            and same_language and same_source_request
        ):
            current_source_json = refined_json if cached_source == "refined" else result_json
            source_available = bool(current_source_json) and current_source_json != ""
            current_hash = (
                hash_utterance_texts(json.loads(current_source_json))
                if source_available else None
            )
            hash_stale = bool(cached_hash) and current_hash is not None and current_hash != cached_hash
            stale = hash_stale or not source_available
            return {
                "utterances": json.loads(translated_json),
                "language": translation_lang,
                "source": cached_source or "original",
                "source_hash": cached_hash,
                "stale": stale,
                "source_available": source_available,
            }

        if translated_json == "":
            raise HTTPException(status_code=429, detail="Translation already in progress")

        if status != "completed":
            raise HTTPException(status_code=400, detail="Transcription not completed")

        # Translating into the transcript's own language leaves the model with
        # nothing to do, and it may return something unusable rather than the
        # text unchanged — in production it echoed the schema back, which reached
        # the user as an opaque 500. A NULL source language means we do not know,
        # so only reject when the two are known to match.
        source_language = row["language"]
        if source_language and source_language == body.target_language:
            raise HTTPException(
                status_code=400,
                detail=f"The transcript is already in {_language_name(source_language)}.",
            )

        try:
            chosen_source = select_source(
                explicit=body.source,
                result_json=result_json,
                refined_json=refined_json,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        source_json = refined_json if chosen_source == "refined" else result_json
        source_utterances = json.loads(source_json or "[]")
        source_hash = hash_utterance_texts(source_utterances)

        previous = (
            (translated_json, translation_lang, cached_source, cached_hash)
            if translated_json else None
        )

        await db.execute(
            "UPDATE transcriptions SET translated_utterances_json = '', translation_language = ? "
            "WHERE id = ? AND user_id = ?",
            (body.target_language, transcription_id, user.id),
        )
        await db.commit()

    try:
        async with measure_llm_operation("translation"):
            translated = await _call_llm_translation(provider, source_utterances, body.target_language)
    except HTTPException:
        raise
    except Exception as e:
        logging.error(
            "Translation to %s failed for transcription %s: %s: %s",
            body.target_language, transcription_id, type(e).__name__, e,
        )
        logging.error("Traceback: %s", traceback.format_exc())
        await _undo_translation_attempt(transcription_id, user.id, previous)
        raise HTTPException(status_code=500, detail="Translation failed")

    if len(translated) != len(source_utterances):
        await _undo_translation_attempt(transcription_id, user.id, previous)
        raise HTTPException(
            status_code=500,
            detail=f"LLM returned {len(translated)} utterances, expected {len(source_utterances)}",
        )

    translated_json_str = json.dumps(translated, ensure_ascii=False)

    async with get_db() as db:
        await db.execute(
            """UPDATE transcriptions
                 SET translated_utterances_json = ?,
                     translation_language = ?,
                     translation_source = ?,
                     translation_source_hash = ?
               WHERE id = ? AND user_id = ?""",
            (translated_json_str, body.target_language, chosen_source, source_hash,
             transcription_id, user.id),
        )
        await db.commit()

    return {
        "utterances": translated,
        "language": body.target_language,
        "source": chosen_source,
        "source_hash": source_hash,
        "stale": False,
        "source_available": True,
    }


@router.get("/api/translate/{transcription_id}")
async def get_translation(
    transcription_id: str,
    user: UserInfo = Depends(get_current_user),
):
    from app.services.source_tracking import hash_utterance_texts

    async with get_db() as db:
        cursor = await db.execute(
            """SELECT translated_utterances_json, translation_language,
                      translation_source, translation_source_hash,
                      result_json, refined_utterances_json
               FROM transcriptions WHERE id = ? AND user_id = ?""",
            (transcription_id, user.id),
        )
        row = await cursor.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Transcription not found")

    translated_json = row["translated_utterances_json"]
    if not translated_json or translated_json == "":
        raise HTTPException(status_code=404, detail="No translation found")

    source = row["translation_source"] or "original"
    cached_hash = row["translation_source_hash"]
    current_source_json = row["refined_utterances_json"] if source == "refined" else row["result_json"]
    source_available = bool(current_source_json) and current_source_json != ""
    current_hash = (
        hash_utterance_texts(json.loads(current_source_json))
        if source_available else None
    )
    hash_stale = bool(cached_hash) and current_hash is not None and current_hash != cached_hash
    stale = hash_stale or not source_available

    return {
        "utterances": json.loads(translated_json),
        "language": row["translation_language"],
        "source": source,
        "source_hash": cached_hash,
        "stale": stale,
        "source_available": source_available,
    }


@router.delete("/api/translate/{transcription_id}")
async def delete_translation(
    transcription_id: str,
    user: UserInfo = Depends(get_current_user),
):
    async with get_db() as db:
        await ensure_transcription_owned(db, transcription_id, user.id)

        await db.execute(
            """UPDATE transcriptions
               SET translated_utterances_json = NULL,
                   translation_language = NULL,
                   translation_source = NULL,
                   translation_source_hash = NULL
               WHERE id = ? AND user_id = ?""",
            (transcription_id, user.id),
        )
        await db.commit()

    inc(deletions_total, "translation")
    return {"status": "deleted"}

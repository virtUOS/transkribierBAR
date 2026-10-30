import json
import logging
import traceback
import uuid
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from app.config import settings
from app.dependencies import get_current_user
from app.router_helpers import ensure_transcription_owned, load_speaker_mappings
from app.models import UserInfo, AnalysisRequest, AnalysisListItem
from app.database import get_db
from app.services.llm import get_llm_provider
from app.services.llm.base import analysis_json_chat, MalformedReply, OutputLimitExceeded
from app.services.llm.prompt import (
    format_transcript_for_llm,
    build_analysis_system_prompt,
    list_analysis_templates,
    chunk_transcript,
)
from app.metrics import inc, measure_llm_operation, deletions_total

router = APIRouter()


@router.get("/api/analysis/templates")
async def get_templates():
    """Return the list of available analysis templates."""
    return list_analysis_templates()


@router.post("/api/analysis/{transcription_id}")
async def generate_analysis(
    transcription_id: str,
    body: AnalysisRequest | None = None,
    user: UserInfo = Depends(get_current_user),
):
    provider = get_llm_provider()
    if not provider:
        raise HTTPException(status_code=503, detail="LLM provider not configured")

    template_name = body.template if body else "summary"
    custom_prompt = body.custom_prompt if body else None
    request_language = body.language if body else None
    chapter_hints = body.chapter_hints if body and body.chapter_hints else None
    agenda = body.agenda if body else None
    explicit_source = body.source if body else None

    analysis_id = str(uuid.uuid4())

    from app.services.source_tracking import hash_utterance_texts, select_source

    async with get_db() as db:
        # Get transcription
        cursor = await db.execute(
            "SELECT result_json, refined_utterances_json, language FROM transcriptions "
            "WHERE id = ? AND user_id = ? AND status = 'completed'",
            (transcription_id, user.id),
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Transcription not found")

        # Rate limit: reject if analysis is already in progress for this transcription
        cursor = await db.execute(
            "SELECT id FROM analyses WHERE transcription_id = ? AND analysis_json IS NULL",
            (transcription_id,),
        )
        if await cursor.fetchone():
            raise HTTPException(status_code=429, detail="Analysis generation already in progress")

        result_json = row["result_json"]
        refined_json = row["refined_utterances_json"]
        analysis_language = request_language or row["language"]

        try:
            chosen_source = select_source(
                explicit=explicit_source,
                result_json=result_json,
                refined_json=refined_json,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        source_json = refined_json if chosen_source == "refined" else result_json
        source_utterances = json.loads(source_json or "[]")
        source_hash = hash_utterance_texts(source_utterances)

        # Get speaker mappings
        speaker_map = await load_speaker_mappings(db, transcription_id)

        # Insert placeholder row to mark generation as in-progress
        await db.execute(
            """INSERT INTO analyses (id, transcription_id, analysis_json, template,
                                      custom_prompt, language, llm_provider, llm_model,
                                      source, source_hash)
               VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)""",
            (analysis_id, transcription_id, template_name, custom_prompt, request_language,
             settings.LLM_PROVIDER, settings.LLM_MODEL, chosen_source, source_hash),
        )
        await db.commit()

    transcript = format_transcript_for_llm(source_utterances, speaker_map)

    # For built-in templates (summary, protocol), delegate to existing provider methods
    # which handle chunking and consolidation internally
    try:
        async with measure_llm_operation("analysis"):
            if not custom_prompt and template_name == "summary":
                result_obj = await provider.generate_summary(transcript, chapter_hints, analysis_language)
                result_data = result_obj.model_dump()
                result_data["template"] = "summary"
                result_data["language"] = analysis_language
            elif not custom_prompt and template_name == "protocol":
                result_obj = await provider.generate_protocol(transcript, None, analysis_language)
                result_data = result_obj.model_dump()
                result_data["template"] = "protocol"
                result_data["language"] = analysis_language
            else:
                # Custom prompt or other templates — call LLM directly
                system_prompt, schema = build_analysis_system_prompt(
                    template_name=template_name,
                    custom_prompt=custom_prompt,
                    language=analysis_language,
                    chapter_hints=chapter_hints,
                    agenda=agenda,
                )
                result_data = await _generate_with_chunking(provider, transcript, system_prompt, schema, analysis_language)
                result_data["template"] = template_name
                result_data["custom_prompt"] = custom_prompt
                result_data["language"] = analysis_language
    except Exception as e:
        logging.error(
            "Analysis %s failed for transcription %s (template=%s): %s: %s",
            analysis_id, transcription_id, template_name, type(e).__name__, e,
        )
        logging.error("Traceback: %s", traceback.format_exc())
        # Remove placeholder on failure so user can retry
        async with get_db() as db:
            await db.execute("DELETE FROM analyses WHERE id = ? AND analysis_json IS NULL", (analysis_id,))
            await db.commit()
        if isinstance(e, OutputLimitExceeded):
            # A property of the request, not a server fault: the same request
            # reaches the cap again, so the user needs to change it. The
            # frontend shows its own localized text for this status.
            raise HTTPException(
                status_code=422,
                detail="The analysis reached the language model's output limit before it was complete. "
                       "Try a more focused prompt.",
            ) from e
        if isinstance(e, MalformedReply):
            # The model's replies were unusable on every attempt; each is a
            # fresh draw, so the user's next request can succeed. The frontend
            # shows its own localized text for this code — not for the status,
            # which the proxy in front also sends when the app is down.
            return JSONResponse(status_code=502, content={"detail": str(e), "code": "malformed_reply"})
        raise

    # Store completed analysis
    async with get_db() as db:
        await db.execute(
            """UPDATE analyses SET analysis_json = ?, template = ?, custom_prompt = ?, language = ?, llm_provider = ?, llm_model = ?
               WHERE id = ?""",
            (json.dumps(result_data), template_name, custom_prompt, request_language, settings.LLM_PROVIDER, settings.LLM_MODEL, analysis_id),
        )
        await db.commit()

    result_data["id"] = analysis_id
    result_data["llm_provider"] = settings.LLM_PROVIDER
    result_data["llm_model"] = settings.LLM_MODEL
    result_data["source"] = chosen_source
    result_data["source_hash"] = source_hash
    result_data["stale"] = False
    result_data["source_available"] = True
    return result_data


async def _generate_with_chunking(provider, transcript: str, system_prompt: str, schema: dict, language: str | None) -> dict:
    """Generate analysis using the LLM, with chunking for long transcripts."""
    from app.services.llm.prompt import _language_name

    chunks = chunk_transcript(transcript)

    if len(chunks) == 1:
        return await _call_llm(provider, chunks[0], system_prompt)

    # Multi-chunk: generate for each chunk, then consolidate
    chunk_results = []
    for chunk in chunks:
        result = await _call_llm(provider, chunk, system_prompt)
        chunk_results.append(json.dumps(result))

    # Consolidate
    language_instruction = f"Respond in {_language_name(language)}. " if language else "Respond in the same language as the content above. "
    consolidation_prompt = f"""You were given a long transcript split into chunks. Here are the analysis results of each chunk:

{chr(10).join(chunk_results)}

Consolidate these into a single unified result. {language_instruction}Respond ONLY with valid JSON."""

    return await _call_llm(provider, consolidation_prompt, system_prompt)


async def _call_llm(provider, user_content: str, system_prompt: str) -> dict:
    """One custom-template analysis request, through the provider's JSON chat.

    Goes through analysis_json_chat like the summary and protocol paths, so it
    gets the same output cap, truncation check and retry; it used to build its
    own uncapped request against the provider's raw client.
    """
    return await analysis_json_chat(provider, system_prompt, user_content)


@router.get("/api/analysis/{transcription_id}")
async def list_analyses(
    transcription_id: str,
    user: UserInfo = Depends(get_current_user),
):
    """List all analyses for a transcription."""
    async with get_db() as db:
        await ensure_transcription_owned(db, transcription_id, user.id)

        cursor = await db.execute(
            "SELECT id, template, language, llm_provider, llm_model, created_at, source "
            "FROM analyses WHERE transcription_id = ? AND analysis_json IS NOT NULL "
            "ORDER BY created_at DESC",
            (transcription_id,),
        )
        rows = await cursor.fetchall()

    return [
        AnalysisListItem(
            id=row["id"],
            template=row["template"],
            language=row["language"],
            llm_provider=row["llm_provider"],
            llm_model=row["llm_model"],
            created_at=row["created_at"],
            source=row["source"],
        )
        for row in rows
    ]


@router.get("/api/analysis/{transcription_id}/{analysis_id}")
async def get_analysis(
    transcription_id: str,
    analysis_id: str,
    user: UserInfo = Depends(get_current_user),
):
    """Get a single analysis by ID."""
    from app.services.source_tracking import hash_utterance_texts

    async with get_db() as db:
        await ensure_transcription_owned(db, transcription_id, user.id)

        cursor = await db.execute(
            "SELECT id, analysis_json, llm_provider, llm_model, source, source_hash "
            "FROM analyses WHERE id = ? AND transcription_id = ?",
            (analysis_id, transcription_id),
        )
        row = await cursor.fetchone()
        if not row or not row["analysis_json"]:
            raise HTTPException(status_code=404, detail="Analysis not found")

        txn_cursor = await db.execute(
            "SELECT result_json, refined_utterances_json FROM transcriptions WHERE id = ?",
            (transcription_id,),
        )
        txn_row = await txn_cursor.fetchone()

    source = row["source"] or "original"
    cached_hash = row["source_hash"]
    current_source_json = (
        txn_row["refined_utterances_json"] if source == "refined" else txn_row["result_json"]
    )
    source_available = bool(current_source_json) and current_source_json != ""
    current_hash = (
        hash_utterance_texts(json.loads(current_source_json))
        if source_available else None
    )
    hash_stale = bool(cached_hash) and current_hash is not None and current_hash != cached_hash
    stale = hash_stale or not source_available

    data = json.loads(row["analysis_json"])
    data["id"] = row["id"]
    data["llm_provider"] = row["llm_provider"]
    data["llm_model"] = row["llm_model"]
    data["source"] = source
    data["source_hash"] = cached_hash
    data["stale"] = stale
    data["source_available"] = source_available
    return data


@router.delete("/api/analysis/{transcription_id}/{analysis_id}")
async def delete_analysis(
    transcription_id: str,
    analysis_id: str,
    user: UserInfo = Depends(get_current_user),
):
    async with get_db() as db:
        await ensure_transcription_owned(db, transcription_id, user.id)

        cursor = await db.execute(
            "DELETE FROM analyses WHERE id = ? AND transcription_id = ?",
            (analysis_id, transcription_id),
        )
        await db.commit()

        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Analysis not found")

    inc(deletions_total, "analysis")

    return {"status": "deleted"}


@router.delete("/api/analysis/{transcription_id}/{analysis_id}/items/{field}/{item_index}")
async def delete_analysis_item(
    transcription_id: str,
    analysis_id: str,
    field: str,
    item_index: int,
    user: UserInfo = Depends(get_current_user),
):
    ALLOWED_FIELDS = {"chapters", "key_points", "decisions", "action_items"}
    if field not in ALLOWED_FIELDS:
        raise HTTPException(status_code=400, detail=f"Field must be one of: {', '.join(sorted(ALLOWED_FIELDS))}")

    async with get_db() as db:
        await ensure_transcription_owned(db, transcription_id, user.id)

        cursor = await db.execute(
            "SELECT analysis_json, llm_provider, llm_model FROM analyses WHERE id = ? AND transcription_id = ?",
            (analysis_id, transcription_id),
        )
        row = await cursor.fetchone()
        if not row or not row["analysis_json"]:
            raise HTTPException(status_code=404, detail="Analysis not found")

        data = json.loads(row["analysis_json"])
        items = data.get(field)
        if not isinstance(items, list):
            raise HTTPException(status_code=400, detail=f"Field '{field}' is not a list in this analysis")
        if item_index < 0 or item_index >= len(items):
            raise HTTPException(status_code=404, detail="Item not found")

        items.pop(item_index)
        data[field] = items

        await db.execute(
            "UPDATE analyses SET analysis_json = ? WHERE id = ?",
            (json.dumps(data), analysis_id),
        )
        await db.commit()

    data["llm_provider"] = row["llm_provider"]
    data["llm_model"] = row["llm_model"]
    return data

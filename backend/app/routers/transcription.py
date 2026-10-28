import asyncio
import json
import logging
import time
import traceback
import uuid
from datetime import datetime, timedelta, timezone
import httpx
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from app.config import settings
from app.dependencies import get_current_user
from app.router_helpers import ensure_transcription_owned, load_speaker_mappings, resolve_whisper_model
from app.models import (
    UserInfo, TranscriptionSettings as TranscriptionSettingsModel,
    TranscriptionStatus, TranscriptionListItem, Utterance, SpeakerMappingRequest,
    TitleRequest, TranscriptionUpdateRequest,
)
from app.database import get_db
from app.services.asr import get_asr_backend
from app.services.api_tokens import resolve_token
from app.services.asr.base import TranscriptionSettings, asr_semaphore
from app.services.audio import ensure_clean_asr_copy, get_media_duration
from app.services.formats import generate_srt, generate_vtt, generate_txt
from app.metrics import (
    inc, observe, gauge_inc, gauge_dec,
    transcriptions_total, transcription_duration_seconds, active_transcriptions,
    transcription_audio_duration_seconds, transcription_realtime_factor,
    transcription_queue_depth, transcription_queue_wait_seconds,
    diarization_speakers_total, edits_saved_total, speaker_renames_total,
    downloads_total, deletions_total, errors_total,
    websocket_connections_active, websocket_connections_total,
    websocket_messages_sent_total, websocket_disconnects_total,
    auth_failures_total, api_token_auth_total,
    measure_llm_operation,
)

router = APIRouter()


@router.post("/api/transcribe")
async def start_transcription(
    req: TranscriptionSettingsModel,
    user: UserInfo = Depends(get_current_user),
):
    req.model = resolve_whisper_model(req.model)
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, file_path, mp3_path FROM files WHERE id = ? AND user_id = ?",
            (req.file_id, user.id),
        )
        file_row = await cursor.fetchone()
        if not file_row:
            raise HTTPException(status_code=404, detail="File not found")

    # Files uploaded before the ASR copy was cleaned still carry their metadata
    try:
        mp3_path = await ensure_clean_asr_copy(file_row["file_path"], file_row["mp3_path"])
    except Exception as e:
        logging.warning("Could not prepare the ASR copy of file %s: %s", req.file_id, e)
        raise HTTPException(status_code=422, detail="Could not prepare the audio for transcription.")
    if mp3_path != file_row["mp3_path"]:
        async with get_db() as db:
            await db.execute("UPDATE files SET mp3_path = ? WHERE id = ?", (mp3_path, req.file_id))
            await db.commit()

    transcription_id = str(uuid.uuid4())

    async with get_db() as db:
        await db.execute(
            """INSERT INTO transcriptions
               (id, user_id, file_id, asr_backend, status, language, model,
                min_speakers, max_speakers, initial_prompt, hotwords)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (transcription_id, user.id, req.file_id, settings.ASR_BACKEND,
             "pending", req.language, req.model, req.min_speakers, req.max_speakers,
             req.initial_prompt, req.hotwords),
        )
        await db.commit()

    gauge_inc(transcription_queue_depth)
    submitted_at = time.monotonic()
    asyncio.create_task(_run_transcription(transcription_id, mp3_path, req, submitted_at))
    return {"id": transcription_id, "status": "pending"}


def _job_timeout_for(audio_duration: float | None) -> float:
    """Ceiling for how long an ASR job may stay unfinished.

    Long audio legitimately takes longer, so scale with duration while keeping a
    floor for short files and for when duration probing failed.
    """
    job_timeout = float(settings.ASR_JOB_TIMEOUT_MIN)
    if audio_duration and audio_duration > 0:
        job_timeout = max(job_timeout, audio_duration * settings.ASR_JOB_TIMEOUT_FACTOR)
    return job_timeout


class ASRJobFailed(RuntimeError):
    """The ASR server reported the job as failed."""


def _error_code_for(e: Exception) -> str:
    """The stable code stored next to a failure's English message.

    The message stays English because API clients may rely on it; the web
    interface translates the known codes instead.
    """
    if isinstance(e, ASRJobFailed):
        return "asr_failed"
    if isinstance(e, TimeoutError):
        return "timeout"
    if isinstance(e, httpx.HTTPError):
        return "asr_unreachable"
    return "unknown"


async def _poll_until_done(backend, asr_job_id: str, audio_duration: float | None) -> None:
    """Poll the ASR backend until the job finishes, or give up.

    Raises ASRJobFailed if the backend reports failure, or TimeoutError if the job
    stays unfinished past its ceiling. Without the ceiling a backend that keeps
    reporting "processing" with no error would be polled forever.
    """
    job_timeout = _job_timeout_for(audio_duration)
    poll_started = time.monotonic()

    while True:
        status = await backend.get_status(asr_job_id)
        if status.status == "completed":
            return
        elif status.status == "failed":
            raise ASRJobFailed(status.error or "Transcription failed")

        elapsed = time.monotonic() - poll_started
        if elapsed > job_timeout:
            inc(errors_total, "transcription_timeout", "asr")
            raise TimeoutError(
                f"ASR job {asr_job_id} stuck in '{status.status}' after "
                f"{int(elapsed)}s (limit {int(job_timeout)}s)"
            )
        await asyncio.sleep(5)


async def _generate_title(provider, transcript_text: str) -> str:
    """Ask the LLM for a title, counted as an LLM operation like the others.

    The provider was called directly before, so title calls recorded tokens but
    no request, error or duration; the failure ratio alert never saw them.
    """
    async with measure_llm_operation("title"):
        return await provider.generate_title(transcript_text)


async def _run_transcription(transcription_id: str, file_path: str, req: TranscriptionSettingsModel, submitted_at: float):
    backend = get_asr_backend()
    backend_name = settings.ASR_BACKEND
    ts = TranscriptionSettings(
        language=req.language, model=req.model,
        min_speakers=req.min_speakers, max_speakers=req.max_speakers,
        initial_prompt=req.initial_prompt, hotwords=req.hotwords,
        request_id=transcription_id,
    )

    gauge_dec(transcription_queue_depth)
    observe(transcription_queue_wait_seconds, time.monotonic() - submitted_at, backend_name)
    gauge_inc(active_transcriptions)
    start_time = time.monotonic()

    try:
        audio_duration = await asyncio.wait_for(get_media_duration(file_path), timeout=5)
    except (asyncio.TimeoutError, Exception):
        audio_duration = None
    ts.job_timeout = _job_timeout_for(audio_duration)
    if audio_duration is not None:
        observe(transcription_audio_duration_seconds, audio_duration, backend_name)

    asr_job_id: str | None = None
    try:
        async with get_db() as db:
            await db.execute("UPDATE transcriptions SET status = ? WHERE id = ?", ("processing", transcription_id))
            await db.commit()

        # Held across submit *and* the poll loop: backends whose submit() returns
        # immediately do their real work while we poll, so releasing after submit
        # would let unlimited jobs pile onto the ASR service.
        async with asr_semaphore:
            asr_job_id = await backend.submit(file_path, ts)

            async with get_db() as db:
                await db.execute("UPDATE transcriptions SET asr_job_id = ? WHERE id = ?", (asr_job_id, transcription_id))
                await db.commit()

            await _poll_until_done(backend, asr_job_id, audio_duration)

            result = await backend.get_result(asr_job_id)

        duration = time.monotonic() - start_time
        lang_label = req.language or "auto"
        model_label = req.model or "default"
        observe(transcription_duration_seconds, duration, backend_name, lang_label, model_label)
        inc(transcriptions_total, backend_name, lang_label, model_label, "completed")
        if audio_duration and audio_duration > 0:
            observe(transcription_realtime_factor, duration / audio_duration, backend_name, model_label)

        speakers = {u.speaker for u in result.utterances if u.speaker}
        if speakers:
            inc(diarization_speakers_total, str(min(len(speakers), 20)))

        result_json = json.dumps([u.model_dump() for u in result.utterances])
        async with get_db() as db:
            cursor = await db.execute(
                """UPDATE transcriptions SET status = ?, result_json = ?, original_result_json = ?,
                   completed_at = ? WHERE id = ?""",
                ("completed", result_json, result_json,
                 datetime.now(timezone.utc).isoformat(), transcription_id),
            )
            await db.commit()

        # The result is stored locally (or, if the row was deleted mid-run,
        # nowhere); either way the remote copy is now only a liability.
        await backend.cleanup(asr_job_id)

        if cursor.rowcount == 0:
            # Deleted while processing: the user wanted it gone, so don't send
            # its text to the LLM for a title either.
            return

        # Generate title if LLM is available
        try:
            from app.services.llm import get_llm_provider
            provider = get_llm_provider()
            if provider and result.utterances:
                transcript_text = " ".join(u.text for u in result.utterances)
                try:
                    title = await _generate_title(provider, transcript_text)
                except Exception as e:
                    logging.warning("Title generation failed for %s: %s", transcription_id, e)
                    title = ""
                async with get_db() as db:
                    if title and title.strip():
                        await db.execute(
                            "UPDATE transcriptions SET title = ? WHERE id = ? AND title IS NULL",
                            (title, transcription_id),
                        )
                    else:
                        # The status WebSocket waits while the title is NULL; ''
                        # tells it the attempt is over. The guard keeps a title
                        # the user set meanwhile. API responses show '' as null.
                        await db.execute(
                            "UPDATE transcriptions SET title = '' WHERE id = ? AND title IS NULL",
                            (transcription_id,),
                        )
                    await db.commit()
        except Exception as e:
            logging.warning("Title generation failed for %s: %s", transcription_id, e)

    except Exception as e:
        async with get_db() as db:
            cursor = await db.execute(
                "UPDATE transcriptions SET status = ?, error_message = ?, error_code = ? WHERE id = ?",
                ("failed", str(e), _error_code_for(e), transcription_id),
            )
            await db.commit()

        # No row to update means the user deleted it mid-run: not an app failure.
        if cursor.rowcount:
            logging.error("Transcription %s failed: %s: %s", transcription_id, type(e).__name__, e)
            logging.error("Traceback: %s", traceback.format_exc())
            inc(transcriptions_total, backend_name, req.language or "auto", req.model or "default", "failed")
            inc(errors_total, "transcription_failed", "asr")

        # A job that failed or timed out after submit still left a row remotely.
        if asr_job_id is not None:
            await backend.cleanup(asr_job_id)
    finally:
        gauge_dec(active_transcriptions)


@router.get("/api/status/{transcription_id}")
async def get_status(transcription_id: str, user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, status, error_message, error_code FROM transcriptions WHERE id = ? AND user_id = ?",
            (transcription_id, user.id),
        )
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Transcription not found")
    return TranscriptionStatus(
        id=row["id"], status=row["status"], error=row["error_message"], error_code=row["error_code"],
    )


def _differs_from_original(result_json: str | None, original_json: str | None) -> bool:
    """Whether the saved version differs from the stored ASR result.

    Without a stored original (a row that never had a result) nothing counts
    as edited. Compared as parsed JSON, so serialization differences don't count.
    """
    if original_json is None or result_json == original_json:
        return False
    return json.loads(result_json or "[]") != json.loads(original_json)


@router.get("/api/transcription/{transcription_id}")
async def get_transcription(transcription_id: str, user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM transcriptions WHERE id = ? AND user_id = ?",
            (transcription_id, user.id),
        )
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Transcription not found")
    if row["status"] != "completed":
        raise HTTPException(status_code=400, detail="Transcription not yet completed")

    utterances = [Utterance(**u) for u in json.loads(row["result_json"] or "[]")]

    async with get_db() as db:
        speaker_mappings = await load_speaker_mappings(db, transcription_id)

    return {
        "id": row["id"], "status": row["status"],
        "utterances": [u.model_dump() for u in utterances],
        "text": " ".join(u.text for u in utterances),
        "language": row["language"],
        "speaker_mappings": speaker_mappings,
        "edited": _differs_from_original(row["result_json"], row["original_result_json"]),
    }


@router.get("/api/transcription/{transcription_id}/export/{format_type}")
async def export_transcription(transcription_id: str, format_type: str, user: UserInfo = Depends(get_current_user)):
    if format_type not in ("txt", "srt", "vtt", "json"):
        raise HTTPException(status_code=400, detail="Invalid format")

    async with get_db() as db:
        cursor = await db.execute(
            "SELECT result_json FROM transcriptions WHERE id = ? AND user_id = ? AND status = 'completed'",
            (transcription_id, user.id),
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Transcription not found")

        speaker_map = await load_speaker_mappings(db, transcription_id)

    utterances = [Utterance(**u) for u in json.loads(row["result_json"] or "[]")]

    if format_type == "srt":
        content = generate_srt(utterances, speaker_map)
        media_type = "text/srt"
    elif format_type == "vtt":
        content = generate_vtt(utterances, speaker_map)
        media_type = "text/vtt"
    elif format_type == "txt":
        content = generate_txt(utterances, speaker_map)
        media_type = "text/plain"
    else:
        content = json.dumps(
            [
                {**u.model_dump(), "speaker": speaker_map.get(u.speaker, u.speaker)}
                for u in utterances
            ],
            indent=2,
        )
        media_type = "application/json"

    inc(downloads_total, format_type)

    from fastapi.responses import Response
    return Response(content=content, media_type=media_type)


@router.get("/api/transcription/{transcription_id}/original")
async def get_original_transcription(transcription_id: str, user: UserInfo = Depends(get_current_user)):
    """The ASR result as first stored, untouched by later saves."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT original_result_json FROM transcriptions WHERE id = ? AND user_id = ? AND status = 'completed'",
            (transcription_id, user.id),
        )
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Transcription not found")
    if row["original_result_json"] is None:
        raise HTTPException(status_code=404, detail="Original transcription not available")
    return {"utterances": [Utterance(**u).model_dump() for u in json.loads(row["original_result_json"])]}


@router.put("/api/transcription/{transcription_id}")
async def update_transcription(transcription_id: str, body: TranscriptionUpdateRequest, user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT original_result_json FROM transcriptions WHERE id = ? AND user_id = ? AND status = 'completed'",
            (transcription_id, user.id),
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Transcription not found")

        new_json = json.dumps([u.model_dump() for u in body.utterances])
        await db.execute(
            "UPDATE transcriptions SET result_json = ? WHERE id = ?",
            (new_json, transcription_id),
        )
        await db.commit()

    inc(edits_saved_total)

    return {"status": "ok", "edited": _differs_from_original(new_json, row["original_result_json"])}


@router.put("/api/transcription/{transcription_id}/speakers")
async def update_speaker_mappings(transcription_id: str, request: SpeakerMappingRequest, user: UserInfo = Depends(get_current_user)):
    mappings = request.mappings
    async with get_db() as db:
        await ensure_transcription_owned(db, transcription_id, user.id)

        await db.execute("DELETE FROM speaker_mappings WHERE transcription_id = ?", (transcription_id,))
        for original, custom in mappings.items():
            await db.execute(
                "INSERT INTO speaker_mappings (transcription_id, original_label, custom_name) VALUES (?, ?, ?)",
                (transcription_id, original, custom),
            )
        await db.commit()

    inc(speaker_renames_total)

    return {"status": "ok"}


# Strong references: the loop only keeps weak ones to running tasks.
_background_tasks: set[asyncio.Task] = set()


@router.delete("/api/transcription/{transcription_id}")
async def delete_transcription(transcription_id: str, user: UserInfo = Depends(get_current_user)):
    import os
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT file_id, asr_job_id FROM transcriptions WHERE id = ? AND user_id = ?",
            (transcription_id, user.id),
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Transcription not found")

        # Get file paths before deleting DB records
        file_id = row["file_id"]
        file_cursor = await db.execute(
            "SELECT file_path, mp3_path FROM files WHERE id = ?", (file_id,),
        )
        file_row = await file_cursor.fetchone()

        await db.execute("DELETE FROM analyses WHERE transcription_id = ?", (transcription_id,))
        await db.execute("DELETE FROM speaker_mappings WHERE transcription_id = ?", (transcription_id,))
        await db.execute("DELETE FROM transcriptions WHERE id = ?", (transcription_id,))

        # Only delete the file if no other transcriptions reference it
        other = await db.execute(
            "SELECT 1 FROM transcriptions WHERE file_id = ? LIMIT 1", (file_id,),
        )
        if not await other.fetchone():
            await db.execute("DELETE FROM files WHERE id = ?", (file_id,))
            should_delete_files = True
        else:
            should_delete_files = False
        await db.commit()

    # Remove files from disk only if the file record was deleted
    if file_row and should_delete_files:
        for path in (file_row["file_path"], file_row["mp3_path"]):
            if path:
                try:
                    os.remove(path)
                except OSError:
                    pass

    # Delete the remote copy after the response so a slow ASR host never holds
    # up the user. cleanup() retries and never raises; expiry retries what fails.
    if row["asr_job_id"]:
        task = asyncio.create_task(get_asr_backend().cleanup(row["asr_job_id"]))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)

    inc(deletions_total, "transcription")

    return {"status": "deleted"}


@router.post("/api/transcription/{transcription_id}/archive")
async def archive_transcription(transcription_id: str, user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT file_id FROM transcriptions WHERE id = ? AND user_id = ?",
            (transcription_id, user.id),
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Transcription not found")

        expires_at = (datetime.now(timezone.utc) + timedelta(hours=settings.ARCHIVE_EXPIRY_HOURS)).strftime("%Y-%m-%d %H:%M:%S")
        await db.execute(
            "UPDATE files SET expires_at = ?, is_archived = 1 WHERE id = ?",
            (expires_at, row["file_id"]),
        )
        await db.commit()

    return {"status": "archived", "expires_at": expires_at}


@router.get("/api/transcriptions")
async def list_transcriptions(user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            """SELECT t.id, t.file_id, f.original_filename, t.status, t.language, t.model, t.created_at, f.file_size, f.expires_at, f.is_archived, t.title, f.has_video
               FROM transcriptions t
               JOIN files f ON t.file_id = f.id
               WHERE t.user_id = ?
               ORDER BY t.created_at DESC""",
            (user.id,),
        )
        rows = await cursor.fetchall()

    return [
        TranscriptionListItem(
            id=r["id"], file_id=r["file_id"], original_filename=r["original_filename"],
            status=r["status"], language=r["language"], model=r["model"],
            created_at=r["created_at"], file_size=r["file_size"],
            expires_at=r["expires_at"], archived=bool(r["is_archived"]),
            title=r["title"] or None, has_video=bool(r["has_video"] or 0),
        ).model_dump()
        for r in rows
    ]


@router.patch("/api/transcription/{transcription_id}/title")
async def update_title(transcription_id: str, body: TitleRequest, user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id FROM transcriptions WHERE id = ? AND user_id = ?",
            (transcription_id, user.id),
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Not found")
        await db.execute(
            "UPDATE transcriptions SET title = ? WHERE id = ?",
            (body.title, transcription_id),
        )
        await db.commit()
    return {"status": "ok"}


# Seconds between the status WebSocket's checks of the transcription row.
WS_POLL_SECONDS = 5


def _title_wait_left(completed_at: str | None) -> float:
    """Seconds left of LLM_TIMEOUT, the title request's own limit, since completion.

    A client that connects late waits only for the rest. A row without
    completed_at gets the whole limit.
    """
    try:
        completed = datetime.fromisoformat(completed_at)
    except (TypeError, ValueError):
        return settings.LLM_TIMEOUT
    if completed.tzinfo is None:
        completed = completed.replace(tzinfo=timezone.utc)
    return settings.LLM_TIMEOUT - (datetime.now(timezone.utc) - completed).total_seconds()


async def _send_title_when_ready(websocket: WebSocket, transcription_id: str, completed_at: str | None) -> None:
    """Send the title that _run_transcription asks the LLM for after completion.

    Checks the row at the status loop's interval while its title is NULL, the
    attempt still running. Sends the title if the attempt stored one ('' means
    it ended without). Gives up silently once LLM_TIMEOUT has passed since
    completion, when the row is gone, or when the client leaves.
    """
    deadline = time.monotonic() + _title_wait_left(completed_at)
    while (left := deadline - time.monotonic()) > 0:
        try:
            # Waits like asyncio.sleep, but also notices a client that left. The
            # status loop notices that through a failing send; this loop sends
            # nothing until the title is there.
            message = await asyncio.wait_for(websocket.receive(), timeout=min(WS_POLL_SECONDS, left))
            if message["type"] == "websocket.disconnect":
                return
        except asyncio.TimeoutError:
            pass

        async with get_db() as db:
            cursor = await db.execute("SELECT title FROM transcriptions WHERE id = ?", (transcription_id,))
            row = await cursor.fetchone()
        if not row:
            return
        if row["title"] is not None:
            if row["title"]:
                await websocket.send_json({"type": "title", "title": row["title"]})
                inc(websocket_messages_sent_total, "title")
            return


@router.websocket("/api/ws/status/{transcription_id}")
async def websocket_status(websocket: WebSocket, transcription_id: str):
    await websocket.accept()
    inc(websocket_connections_total)
    gauge_inc(websocket_connections_active)
    close_reason = "client_disconnect"
    try:
        # Prefer API token from query param when feature is enabled
        user_id: str | None = None
        if settings.ENABLE_API_TOKENS:
            raw = websocket.query_params.get("token")
            if raw and raw.startswith("tw_"):
                async with get_db() as db:
                    result = await resolve_token(db, raw_token=raw)
                if result is None:
                    inc(api_token_auth_total, "failure")
                    inc(auth_failures_total, "invalid_token")
                    close_reason = "auth_missing"
                    await websocket.close(code=4001, reason="Invalid token")
                    return
                user_id = result[0].id
                inc(api_token_auth_total, "success")

        if user_id is None:
            user_id = websocket.headers.get("x-auth-request-user")

        if not user_id:
            inc(auth_failures_total, "ws_missing_headers")
            close_reason = "auth_missing"
            await websocket.close(code=4001, reason="Missing authentication")
            return

        # Verify user owns this transcription. The close goes out after the
        # connection is released: a client may stop its event loop on the close
        # frame while aiosqlite's worker thread is still closing (#291).
        async with get_db() as db:
            cursor = await db.execute(
                "SELECT id FROM transcriptions WHERE id = ? AND user_id = ?",
                (transcription_id, user_id),
            )
            owned = await cursor.fetchone() is not None
        if not owned:
            close_reason = "not_found"
            await websocket.close(code=4003, reason="Not found")
            return

        while True:
            async with get_db() as db:
                cursor = await db.execute(
                    "SELECT status, error_message, error_code, title, completed_at, "
                    "result_json IS NOT NULL AND result_json != '[]' AS has_utterances "
                    "FROM transcriptions WHERE id = ?",
                    (transcription_id,),
                )
                row = await cursor.fetchone()

            if not row:
                await websocket.send_json({"type": "error", "detail": "Transcription not found"})
                inc(websocket_messages_sent_total, "error")
                close_reason = "not_found_record"
                break

            status = row["status"]
            msg = {"type": "status", "status": status}
            if status == "failed" and row["error_message"]:
                msg["error"] = row["error_message"]
            if status == "failed" and row["error_code"]:
                msg["error_code"] = row["error_code"]
            if status == "completed" and row["title"]:
                msg["title"] = row["title"]
            await websocket.send_json(msg)
            inc(websocket_messages_sent_total, "status")

            if status in ("completed", "failed"):
                close_reason = status
                # _run_transcription asks the LLM for a title only after setting
                # completed, and only with a provider (get_llm_provider() returns
                # one exactly when LLM_PROVIDER is set) and utterances. Under the
                # same condition, wait for it while the attempt runs (title NULL).
                if (status == "completed" and row["title"] is None
                        and settings.LLM_PROVIDER and row["has_utterances"]):
                    await _send_title_when_ready(websocket, transcription_id, row["completed_at"])
                break

            await asyncio.sleep(WS_POLL_SECONDS)
    except WebSocketDisconnect:
        close_reason = "client_disconnect"
    except Exception:
        close_reason = "error"
        raise
    finally:
        gauge_dec(websocket_connections_active)
        inc(websocket_disconnects_total, close_reason)
        try:
            await websocket.close()
        except Exception:
            pass

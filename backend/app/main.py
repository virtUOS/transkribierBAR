import asyncio
import mimetypes
import os
import re
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from app.config import settings
from app.database import init_db, get_db
from app.routers import config_router, upload, transcription, refinement, analysis, translation, presets, tokens, invitations as invitations_router, assistant as assistant_router, public_pages
from app.public_pages import load_privacy_notices
from app.log_redaction import install_token_redaction
from app.metrics import inc, gauge_set, cleanup_runs_total, cleanup_items_deleted_total, storage_bytes, api_tokens_active, invitations_expired_total, init_label_series, users_total, users_with_transcriptions, users_new
from app.services import support_assistant
from app.services.asr import get_asr_backend
from app.services.audio import has_video_stream
from app.services.api_tokens import cleanup_stale_tokens, count_active_tokens
from app.services.token_expiry import send_expiry_reminders


install_token_redaction()

ORPHAN_MIN_AGE_HOURS = 24
# Upload names are "<uuid><ext>"; this never matches the SQLite DB or other files in TEMP_PATH.
_UPLOAD_NAME_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.")
INTERRUPTED_MESSAGE = "The server restarted while this transcription was running."


def _dir_size_bytes(path: str) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total


def _refresh_storage_gauge():
    try:
        gauge_set(storage_bytes, _dir_size_bytes(settings.TEMP_PATH), settings.TEMP_PATH)
    except Exception:
        pass


async def refresh_user_gauges(db) -> None:
    """Recompute the user-population gauges from the live DB.

    Cheap: four COUNT queries on small/bounded tables. Called at startup and
    once per cleanup cycle, alongside the storage and api-tokens gauge refreshes.
    """
    cursor = await db.execute("SELECT COUNT(*) FROM users")
    total = (await cursor.fetchone())[0]
    gauge_set(users_total, total)

    cursor = await db.execute(
        "SELECT COUNT(DISTINCT user_id) FROM transcriptions WHERE user_id IS NOT NULL"
    )
    with_t = (await cursor.fetchone())[0]
    gauge_set(users_with_transcriptions, with_t)

    for window, days in (("7d", 7), ("30d", 30)):
        cursor = await db.execute(
            "SELECT COUNT(*) FROM users WHERE first_seen >= datetime('now', ?)",
            (f"-{days} days",),
        )
        n = (await cursor.fetchone())[0]
        gauge_set(users_new, n, window)


async def fail_interrupted_transcriptions() -> list[str]:
    """Fail every transcription still pending/processing; return their ASR job ids.

    Only called at startup, when no transcription task can be running, so any
    such row was interrupted by the restart and would otherwise stay in flight
    forever (and keep its file out of the expiry cleanup).
    """
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT asr_job_id FROM transcriptions "
            "WHERE status IN ('pending', 'processing') AND asr_job_id IS NOT NULL"
        )
        job_ids = [row["asr_job_id"] for row in await cursor.fetchall()]
        await db.execute(
            "UPDATE transcriptions SET status = 'failed', error_message = ?, error_code = 'server_restarted' "
            "WHERE status IN ('pending', 'processing')",
            (INTERRUPTED_MESSAGE,),
        )
        await db.commit()
    return job_ids


async def clear_interrupted_llm_steps() -> None:
    """Clear the in-progress markers of refinement, translation and analysis.

    Only called at startup. The app runs as a single process (no ``--workers``),
    so at startup no LLM request can be in flight and a marker still set
    (empty refined/translated JSON, analysis row without a result) was left
    by the restart and would otherwise make every later attempt 429.
    """
    async with get_db() as db:
        await db.execute(
            "UPDATE transcriptions SET refined_utterances_json = NULL WHERE refined_utterances_json = ''"
        )
        await db.execute(
            "UPDATE transcriptions SET translated_utterances_json = NULL, translation_language = NULL, "
            "translation_source = NULL, translation_source_hash = NULL WHERE translated_utterances_json = ''"
        )
        await db.execute("DELETE FROM analyses WHERE analysis_json IS NULL")
        await db.commit()


async def cleanup_remote_jobs(job_ids: list[str]) -> None:
    """Delete the remote ASR transcripts of interrupted jobs (best effort)."""
    backend = get_asr_backend()
    for job_id in job_ids:
        await backend.cleanup(job_id)


async def delete_orphaned_media(now: float | None = None, temp_path: str | None = None) -> int:
    """Delete old upload files in temp_path (default TEMP_PATH) that no files row references; return the count."""
    if temp_path is None:
        temp_path = settings.TEMP_PATH
    cutoff = (time.time() if now is None else now) - ORPHAN_MIN_AGE_HOURS * 3600
    async with get_db() as db:
        cursor = await db.execute("SELECT file_path, mp3_path FROM files")
        referenced = {
            os.path.realpath(p) for row in await cursor.fetchall() for p in (row["file_path"], row["mp3_path"]) if p
        }
    deleted = 0
    for entry in os.scandir(temp_path):
        if not _UPLOAD_NAME_RE.match(entry.name) or not entry.is_file(follow_symlinks=False):
            continue
        try:
            if entry.stat().st_mtime >= cutoff or os.path.realpath(entry.path) in referenced:
                continue
            os.unlink(entry.path)
            deleted += 1
        except OSError:
            pass
    return deleted


async def cleanup_old_files():
    """Periodically delete files and DB records that have passed their expires_at."""
    while True:
        await asyncio.sleep(3600)  # Check every hour
        try:
            now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            async with get_db() as db:
                # Subquery for expired file IDs, skipping files with in-flight transcriptions
                expired_files_q = """
                    SELECT id FROM files
                    WHERE expires_at < ?
                    AND id NOT IN (
                        SELECT file_id FROM transcriptions
                        WHERE status IN ('pending', 'processing')
                    )
                """

                # Get expired files to delete from disk
                cursor = await db.execute(
                    f"SELECT file_path, mp3_path FROM files WHERE id IN ({expired_files_q})",
                    (now,),
                )
                rows = await cursor.fetchall()
                for row in rows:
                    for path in [row["file_path"], row["mp3_path"]]:
                        if path and os.path.exists(path):
                            try:
                                os.unlink(path)
                            except OSError:
                                pass

                # Remember the job ids: once the rows go, so do they. A remote copy
                # already deleted answers 404, which counts as done.
                cursor = await db.execute(
                    f"SELECT asr_job_id FROM transcriptions WHERE file_id IN ({expired_files_q}) "
                    "AND asr_job_id IS NOT NULL",
                    (now,),
                )
                asr_job_ids = [row["asr_job_id"] for row in await cursor.fetchall()]

                # Delete related DB records
                expired_transcriptions_q = f"SELECT id FROM transcriptions WHERE file_id IN ({expired_files_q})"
                cursor = await db.execute(
                    f"DELETE FROM analyses WHERE transcription_id IN ({expired_transcriptions_q})",
                    (now,),
                )
                analyses_deleted = cursor.rowcount
                cursor = await db.execute(
                    f"DELETE FROM speaker_mappings WHERE transcription_id IN ({expired_transcriptions_q})",
                    (now,),
                )
                mappings_deleted = cursor.rowcount
                cursor = await db.execute(
                    f"DELETE FROM transcriptions WHERE file_id IN ({expired_files_q})",
                    (now,),
                )
                transcriptions_deleted = cursor.rowcount
                cursor = await db.execute(
                    f"DELETE FROM files WHERE id IN ({expired_files_q})",
                    (now,),
                )
                db_files_deleted = cursor.rowcount
                await db.commit()
                tokens_deleted = await cleanup_stale_tokens(db)
                active_tokens = await count_active_tokens(db)
                from app.services.invitations import (
                    expire_pending_invitations, cleanup_old_invitations,
                )
                invitations_expired = await expire_pending_invitations(db)
                invitations_deleted = await cleanup_old_invitations(db)
                gauge_set(api_tokens_active, active_tokens)
                await refresh_user_gauges(db)

            orphans_deleted = await delete_orphaned_media()

            inc(cleanup_runs_total, "success")
            inc(cleanup_items_deleted_total, "file", amount=db_files_deleted)
            inc(cleanup_items_deleted_total, "transcription", amount=transcriptions_deleted)
            inc(cleanup_items_deleted_total, "analysis", amount=analyses_deleted)
            inc(cleanup_items_deleted_total, "speaker_mapping", amount=mappings_deleted)
            inc(cleanup_items_deleted_total, "api_token", amount=tokens_deleted)
            inc(cleanup_items_deleted_total, "invitation", amount=invitations_deleted)
            inc(cleanup_items_deleted_total, "orphaned_file", amount=orphans_deleted)
            for _ in range(invitations_expired):
                inc(invitations_expired_total)
            _refresh_storage_gauge()

            # After the local steps, so an unreachable ASR host only delays the
            # remote deletes and the reminders.
            if asr_job_ids:
                asr_backend = get_asr_backend()
                for job_id in asr_job_ids:
                    await asr_backend.cleanup(job_id)
        except Exception as e:
            inc(cleanup_runs_total, "failed")
            print(f"Cleanup error: {e}")

        # Last and on their own, so a slow relay delays nothing else and an
        # error in them neither skips a cleanup step nor fails the run.
        try:
            async with get_db() as db:
                reminders = await send_expiry_reminders(db)
            if any(reminders.values()):
                print("Token expiry reminders: " + ", ".join(f"{k}={v}" for k, v in reminders.items()))
        except Exception as e:
            print(f"Token expiry reminder error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.TEMP_PATH, exist_ok=True)
    public_pages.NOTICES = load_privacy_notices()
    if settings.ENABLE_SUPPORT_ASSISTANT:
        support_assistant.CORPORA = support_assistant.load_corpora(
            settings.STATIC_DIR, bool(public_pages.NOTICES)
        )
    await init_db(settings.db_path)
    interrupted_job_ids = await fail_interrupted_transcriptions()
    await clear_interrupted_llm_steps()
    # Backfill has_video for existing files
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, file_path FROM files WHERE has_video IS NULL"
        )
        rows = await cursor.fetchall()
        for row in rows:
            if row["file_path"] and os.path.exists(row["file_path"]):
                video = await has_video_stream(row["file_path"])
            else:
                video = False
            await db.execute(
                "UPDATE files SET has_video = ? WHERE id = ?",
                (int(video), row["id"]),
            )
        if rows:
            await db.commit()
    _refresh_storage_gauge()
    async with get_db() as db:
        gauge_set(api_tokens_active, await count_active_tokens(db))
        await refresh_user_gauges(db)
    init_label_series()
    cleanup_task = asyncio.create_task(cleanup_old_files())
    # Not awaited: the ASR server may be slow or down, and startup must not wait for it.
    remote_cleanup_task = asyncio.create_task(cleanup_remote_jobs(interrupted_job_ids))
    yield
    cleanup_task.cancel()
    remote_cleanup_task.cancel()


app = FastAPI(title="transkribierBAR", lifespan=lifespan)

if settings.DEV_MODE:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(config_router.router)
app.include_router(upload.router)
app.include_router(transcription.router)
app.include_router(refinement.router)
app.include_router(analysis.router)
app.include_router(translation.router)
app.include_router(presets.router)
if settings.ENABLE_API_TOKENS:
    app.include_router(tokens.router)
# Invitations router is mounted unconditionally; its `_require_invitation_mode`
# dependency returns 404 when INVITATION_MODE=false. This avoids coupling the
# mount to a startup-time flag that tests reload.
app.include_router(invitations_router.router)
app.include_router(assistant_router.router)


def safe_static_file(static_dir: str, rel: str) -> str | None:
    """Return the real path of ``rel`` if it is a regular file inside ``static_dir``, else None.

    Paths that resolve outside the directory (absolute paths, ``..`` segments,
    symlinks pointing elsewhere) are rejected, as are NUL bytes.
    """
    if not rel or "\x00" in rel:
        return None
    root = os.path.realpath(static_dir)
    candidate = os.path.realpath(os.path.join(root, rel))
    if os.path.commonpath([root, candidate]) != root or not os.path.isfile(candidate):
        return None
    return candidate


def mount_spa(app: FastAPI, static_dir: str) -> None:
    """Serve the built frontend in ``static_dir``: /assets plus the SPA fallback."""
    app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")
    root = os.path.realpath(static_dir)

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve index.html for all non-API routes (SPA client-side routing)."""
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        # Serve root-level static files (e.g. favicon, logo) if they exist. The
        # guide's raw templates are left to public_pages, which fills them in and
        # adds the CSP; lower() also catches /HANDBUCH on case-insensitive disks.
        candidate = safe_static_file(static_dir, full_path)
        if candidate and os.path.relpath(candidate, root).split(os.sep)[0].lower() != "handbuch":
            return FileResponse(candidate)
        # index.html must not be cached: browsers applying heuristic freshness
        # would serve a stale shell after logout, bypassing the auth proxy and
        # leaving the SPA stuck making XHRs without a valid session cookie.
        return FileResponse(
            os.path.join(static_dir, "index.html"),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )


# Serve frontend static files (only when built files exist, i.e., in Docker)
static_dir = settings.STATIC_DIR

# Some Python/OS mime tables lack woff2; without it fonts would be served as octet-stream.
mimetypes.add_type("font/woff2", ".woff2")

# Public guide and privacy notice. The static mount must come before the router,
# whose /handbuch/{rest:path} catch-all would shadow it; both must come before
# the SPA catch-all below so that /handbuch... can never serve the SPA shell.
public_pages.GUIDE_DIR = Path(static_dir) / "handbuch"
_guide_assets = public_pages.GUIDE_DIR / "static"
if _guide_assets.is_dir():
    app.mount("/handbuch/static", StaticFiles(directory=str(_guide_assets)), name="handbuch-static")
app.include_router(public_pages.router)

if os.path.isdir(static_dir):
    mount_spa(app, static_dir)

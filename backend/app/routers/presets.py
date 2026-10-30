import json
import uuid
from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import get_current_user
from app.models import (
    UserInfo,
    TranscriptionPresetCreate,
    TranscriptionPresetResponse,
    AnalysisPresetCreate,
    AnalysisPresetResponse,
    RefinementPresetCreate,
    RefinementPresetResponse,
    BundleCreate,
    BundleResponse,
    BundleExpandedResponse,
    ChapterHint,
)
from app.database import get_db
from app.router_helpers import prompt_too_long_response, resolve_whisper_model

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row_to_transcription_preset(row) -> TranscriptionPresetResponse:
    return TranscriptionPresetResponse(
        id=row["id"],
        name=row["name"],
        language=row["language"],
        model=row["model"] or "base",
        min_speakers=row["min_speakers"] or 0,
        max_speakers=row["max_speakers"] or 0,
        initial_prompt=row["initial_prompt"],
        hotwords=row["hotwords"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_analysis_preset(row) -> AnalysisPresetResponse:
    chapter_hints = None
    if row["chapter_hints"]:
        raw = json.loads(row["chapter_hints"])
        chapter_hints = [ChapterHint(**ch) for ch in raw]
    return AnalysisPresetResponse(
        id=row["id"],
        name=row["name"],
        template=row["template"],
        custom_prompt=row["custom_prompt"],
        language=row["language"],
        chapter_hints=chapter_hints,
        agenda=row["agenda"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_refinement_preset(row) -> RefinementPresetResponse:
    return RefinementPresetResponse(
        id=row["id"],
        name=row["name"],
        context=row["context"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_bundle(row) -> BundleResponse:
    return BundleResponse(
        id=row["id"],
        name=row["name"],
        transcription_preset_id=row["transcription_preset_id"],
        analysis_preset_id=row["analysis_preset_id"],
        refinement_preset_id=row["refinement_preset_id"],
        translate_language=row["translate_language"],
        is_default=bool(row["is_default"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ---------------------------------------------------------------------------
# Transcription Presets
# ---------------------------------------------------------------------------

@router.get("/api/presets/transcription", response_model=list[TranscriptionPresetResponse])
async def list_transcription_presets(user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM transcription_presets WHERE user_id = ? ORDER BY created_at DESC",
            (user.id,),
        )
        rows = await cursor.fetchall()
    return [_row_to_transcription_preset(r) for r in rows]


@router.post("/api/presets/transcription", response_model=TranscriptionPresetResponse, status_code=201)
async def create_transcription_preset(body: TranscriptionPresetCreate, user: UserInfo = Depends(get_current_user)):
    model = resolve_whisper_model(body.model)
    if too_long := await prompt_too_long_response(body.initial_prompt, body.hotwords):
        return too_long
    preset_id = str(uuid.uuid4())
    async with get_db() as db:
        await db.execute(
            """INSERT INTO transcription_presets
               (id, user_id, name, language, model, min_speakers, max_speakers, initial_prompt, hotwords)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (preset_id, user.id, body.name, body.language, model,
             body.min_speakers, body.max_speakers, body.initial_prompt, body.hotwords),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM transcription_presets WHERE id = ?", (preset_id,))
        row = await cursor.fetchone()
    return _row_to_transcription_preset(row)


@router.get("/api/presets/transcription/{preset_id}", response_model=TranscriptionPresetResponse)
async def get_transcription_preset(preset_id: str, user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM transcription_presets WHERE id = ? AND user_id = ?",
            (preset_id, user.id),
        )
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Transcription preset not found")
    return _row_to_transcription_preset(row)


@router.put("/api/presets/transcription/{preset_id}", response_model=TranscriptionPresetResponse)
async def update_transcription_preset(preset_id: str, body: TranscriptionPresetCreate, user: UserInfo = Depends(get_current_user)):
    model = resolve_whisper_model(body.model)
    if too_long := await prompt_too_long_response(body.initial_prompt, body.hotwords):
        return too_long
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id FROM transcription_presets WHERE id = ? AND user_id = ?",
            (preset_id, user.id),
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Transcription preset not found")
        await db.execute(
            """UPDATE transcription_presets
               SET name = ?, language = ?, model = ?, min_speakers = ?, max_speakers = ?,
                   initial_prompt = ?, hotwords = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (body.name, body.language, model, body.min_speakers, body.max_speakers,
             body.initial_prompt, body.hotwords, preset_id),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM transcription_presets WHERE id = ?", (preset_id,))
        row = await cursor.fetchone()
    return _row_to_transcription_preset(row)


@router.delete("/api/presets/transcription/{preset_id}")
async def delete_transcription_preset(preset_id: str, user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "DELETE FROM transcription_presets WHERE id = ? AND user_id = ?",
            (preset_id, user.id),
        )
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Transcription preset not found")
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Analysis Presets
# ---------------------------------------------------------------------------

@router.get("/api/presets/analysis", response_model=list[AnalysisPresetResponse])
async def list_analysis_presets(user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM analysis_presets WHERE user_id = ? ORDER BY created_at DESC",
            (user.id,),
        )
        rows = await cursor.fetchall()
    return [_row_to_analysis_preset(r) for r in rows]


@router.post("/api/presets/analysis", response_model=AnalysisPresetResponse, status_code=201)
async def create_analysis_preset(body: AnalysisPresetCreate, user: UserInfo = Depends(get_current_user)):
    preset_id = str(uuid.uuid4())
    chapter_hints_json = json.dumps([ch.model_dump() for ch in body.chapter_hints]) if body.chapter_hints else None
    async with get_db() as db:
        await db.execute(
            """INSERT INTO analysis_presets
               (id, user_id, name, template, custom_prompt, language, chapter_hints, agenda)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (preset_id, user.id, body.name, body.template, body.custom_prompt,
             body.language, chapter_hints_json, body.agenda),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM analysis_presets WHERE id = ?", (preset_id,))
        row = await cursor.fetchone()
    return _row_to_analysis_preset(row)


@router.get("/api/presets/analysis/{preset_id}", response_model=AnalysisPresetResponse)
async def get_analysis_preset(preset_id: str, user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM analysis_presets WHERE id = ? AND user_id = ?",
            (preset_id, user.id),
        )
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Analysis preset not found")
    return _row_to_analysis_preset(row)


@router.put("/api/presets/analysis/{preset_id}", response_model=AnalysisPresetResponse)
async def update_analysis_preset(preset_id: str, body: AnalysisPresetCreate, user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id FROM analysis_presets WHERE id = ? AND user_id = ?",
            (preset_id, user.id),
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Analysis preset not found")
        chapter_hints_json = json.dumps([ch.model_dump() for ch in body.chapter_hints]) if body.chapter_hints else None
        await db.execute(
            """UPDATE analysis_presets
               SET name = ?, template = ?, custom_prompt = ?, language = ?,
                   chapter_hints = ?, agenda = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (body.name, body.template, body.custom_prompt, body.language,
             chapter_hints_json, body.agenda, preset_id),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM analysis_presets WHERE id = ?", (preset_id,))
        row = await cursor.fetchone()
    return _row_to_analysis_preset(row)


@router.delete("/api/presets/analysis/{preset_id}")
async def delete_analysis_preset(preset_id: str, user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "DELETE FROM analysis_presets WHERE id = ? AND user_id = ?",
            (preset_id, user.id),
        )
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Analysis preset not found")
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Refinement Presets
# ---------------------------------------------------------------------------

@router.get("/api/presets/refinement", response_model=list[RefinementPresetResponse])
async def list_refinement_presets(user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM refinement_presets WHERE user_id = ? ORDER BY created_at DESC",
            (user.id,),
        )
        rows = await cursor.fetchall()
    return [_row_to_refinement_preset(r) for r in rows]


@router.post("/api/presets/refinement", response_model=RefinementPresetResponse, status_code=201)
async def create_refinement_preset(body: RefinementPresetCreate, user: UserInfo = Depends(get_current_user)):
    preset_id = str(uuid.uuid4())
    async with get_db() as db:
        await db.execute(
            "INSERT INTO refinement_presets (id, user_id, name, context) VALUES (?, ?, ?, ?)",
            (preset_id, user.id, body.name, body.context),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM refinement_presets WHERE id = ?", (preset_id,))
        row = await cursor.fetchone()
    return _row_to_refinement_preset(row)


@router.get("/api/presets/refinement/{preset_id}", response_model=RefinementPresetResponse)
async def get_refinement_preset(preset_id: str, user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM refinement_presets WHERE id = ? AND user_id = ?",
            (preset_id, user.id),
        )
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Refinement preset not found")
    return _row_to_refinement_preset(row)


@router.put("/api/presets/refinement/{preset_id}", response_model=RefinementPresetResponse)
async def update_refinement_preset(preset_id: str, body: RefinementPresetCreate, user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id FROM refinement_presets WHERE id = ? AND user_id = ?",
            (preset_id, user.id),
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Refinement preset not found")
        await db.execute(
            """UPDATE refinement_presets
               SET name = ?, context = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (body.name, body.context, preset_id),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM refinement_presets WHERE id = ?", (preset_id,))
        row = await cursor.fetchone()
    return _row_to_refinement_preset(row)


@router.delete("/api/presets/refinement/{preset_id}")
async def delete_refinement_preset(preset_id: str, user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "DELETE FROM refinement_presets WHERE id = ? AND user_id = ?",
            (preset_id, user.id),
        )
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Refinement preset not found")
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Bundles
# ---------------------------------------------------------------------------

_PRESET_TABLES = {
    "transcription_preset_id": ("transcription_presets", "Transcription preset"),
    "analysis_preset_id": ("analysis_presets", "Analysis preset"),
    "refinement_preset_id": ("refinement_presets", "Refinement preset"),
}


async def _verify_bundle_preset_ownership(db, body: BundleCreate, user_id: str) -> None:
    """Reject any preset reference that does not belong to the caller."""
    for field, (table, label) in _PRESET_TABLES.items():
        value = getattr(body, field)
        if not value:
            continue
        cursor = await db.execute(
            f"SELECT 1 FROM {table} WHERE id = ? AND user_id = ?",
            (value, user_id),
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail=f"{label} not found")


@router.get("/api/presets/bundles", response_model=list[BundleResponse])
async def list_bundles(user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM preset_bundles WHERE user_id = ? ORDER BY created_at DESC",
            (user.id,),
        )
        rows = await cursor.fetchall()
    return [_row_to_bundle(r) for r in rows]


@router.post("/api/presets/bundles", response_model=BundleResponse, status_code=201)
async def create_bundle(body: BundleCreate, user: UserInfo = Depends(get_current_user)):
    bundle_id = str(uuid.uuid4())
    async with get_db() as db:
        await _verify_bundle_preset_ownership(db, body, user.id)
        await db.execute(
            """INSERT INTO preset_bundles
               (id, user_id, name, transcription_preset_id, analysis_preset_id, refinement_preset_id, translate_language)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (bundle_id, user.id, body.name, body.transcription_preset_id,
             body.analysis_preset_id, body.refinement_preset_id, body.translate_language),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM preset_bundles WHERE id = ?", (bundle_id,))
        row = await cursor.fetchone()
    return _row_to_bundle(row)


@router.get("/api/presets/bundles/{bundle_id}", response_model=BundleResponse)
async def get_bundle(bundle_id: str, user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM preset_bundles WHERE id = ? AND user_id = ?",
            (bundle_id, user.id),
        )
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Bundle not found")
    return _row_to_bundle(row)


@router.put("/api/presets/bundles/{bundle_id}", response_model=BundleResponse)
async def update_bundle(bundle_id: str, body: BundleCreate, user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id FROM preset_bundles WHERE id = ? AND user_id = ?",
            (bundle_id, user.id),
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Bundle not found")
        await _verify_bundle_preset_ownership(db, body, user.id)
        await db.execute(
            """UPDATE preset_bundles
               SET name = ?, transcription_preset_id = ?, analysis_preset_id = ?,
                   refinement_preset_id = ?, translate_language = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (body.name, body.transcription_preset_id, body.analysis_preset_id,
             body.refinement_preset_id, body.translate_language, bundle_id),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM preset_bundles WHERE id = ?", (bundle_id,))
        row = await cursor.fetchone()
    return _row_to_bundle(row)


@router.delete("/api/presets/bundles/{bundle_id}")
async def delete_bundle(bundle_id: str, user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "DELETE FROM preset_bundles WHERE id = ? AND user_id = ?",
            (bundle_id, user.id),
        )
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Bundle not found")
    return {"status": "deleted"}


@router.put("/api/presets/bundles/{bundle_id}/default", response_model=BundleResponse)
async def set_default_bundle(bundle_id: str, user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id FROM preset_bundles WHERE id = ? AND user_id = ?",
            (bundle_id, user.id),
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Bundle not found")
        # Clear any existing default for this user
        await db.execute(
            "UPDATE preset_bundles SET is_default = 0 WHERE user_id = ?",
            (user.id,),
        )
        await db.execute(
            "UPDATE preset_bundles SET is_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (bundle_id,),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM preset_bundles WHERE id = ?", (bundle_id,))
        row = await cursor.fetchone()
    return _row_to_bundle(row)


@router.delete("/api/presets/default")
async def clear_default_bundle(user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        await db.execute(
            "UPDATE preset_bundles SET is_default = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND is_default = 1",
            (user.id,),
        )
        await db.commit()
    return {"status": "deleted"}


@router.get("/api/presets/default", response_model=BundleExpandedResponse | None)
async def get_default_bundle(user: UserInfo = Depends(get_current_user)):
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM preset_bundles WHERE user_id = ? AND is_default = 1",
            (user.id,),
        )
        bundle_row = await cursor.fetchone()
        if not bundle_row:
            return None

        transcription_preset = None
        if bundle_row["transcription_preset_id"]:
            cursor = await db.execute(
                "SELECT * FROM transcription_presets WHERE id = ? AND user_id = ?",
                (bundle_row["transcription_preset_id"], user.id),
            )
            tp_row = await cursor.fetchone()
            if tp_row:
                transcription_preset = _row_to_transcription_preset(tp_row)

        analysis_preset = None
        if bundle_row["analysis_preset_id"]:
            cursor = await db.execute(
                "SELECT * FROM analysis_presets WHERE id = ? AND user_id = ?",
                (bundle_row["analysis_preset_id"], user.id),
            )
            ap_row = await cursor.fetchone()
            if ap_row:
                analysis_preset = _row_to_analysis_preset(ap_row)

        refinement_preset = None
        if bundle_row["refinement_preset_id"]:
            cursor = await db.execute(
                "SELECT * FROM refinement_presets WHERE id = ? AND user_id = ?",
                (bundle_row["refinement_preset_id"], user.id),
            )
            rp_row = await cursor.fetchone()
            if rp_row:
                refinement_preset = _row_to_refinement_preset(rp_row)

    return BundleExpandedResponse(
        id=bundle_row["id"],
        name=bundle_row["name"],
        transcription_preset_id=bundle_row["transcription_preset_id"],
        analysis_preset_id=bundle_row["analysis_preset_id"],
        refinement_preset_id=bundle_row["refinement_preset_id"],
        translate_language=bundle_row["translate_language"],
        is_default=bool(bundle_row["is_default"]),
        created_at=bundle_row["created_at"],
        updated_at=bundle_row["updated_at"],
        transcription_preset=transcription_preset,
        analysis_preset=analysis_preset,
        refinement_preset=refinement_preset,
    )

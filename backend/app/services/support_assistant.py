"""Support assistant: the user manual corpus and availability check."""
import logging
import os

from app.config import settings
from app.database import get_db
from app.public_pages import (
    Lang,
    apply_features,
    fill_settings_text,
    guide_features,
    setting_values,
)

logger = logging.getLogger(__name__)

with open(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "support_assistant_instructions.md"),
    encoding="utf-8",
) as _f:
    INSTRUCTIONS = _f.read().strip()

VIEW_DESCRIPTIONS: dict[str, str] = {
    "archive": "the overview of the user's files and transcriptions",
    "upload": "uploading a file and choosing transcription settings",
    "record": "recording audio or video in the browser",
    "detail": "one transcription opened in the editor",
    "presets": "the presets page",
    "settings": "the settings page",
}

ERROR_MESSAGE_MAX = 300

# Filled manual per language; set by app.main at startup, tests may replace it.
CORPORA: dict[Lang, str] = {}


def load_corpora(static_dir: str, privacy: bool) -> dict[Lang, str]:
    corpora: dict[Lang, str] = {}
    features = guide_features(privacy)
    for lang in ("de", "en"):
        path = os.path.join(static_dir, "assistant", f"{lang}.md")
        try:
            with open(path, encoding="utf-8") as f:
                raw = f.read()
        except (OSError, UnicodeDecodeError) as e:
            logger.error("Cannot read support assistant corpus %s (%s): %s", lang, path, e)
            continue
        corpora[lang] = fill_settings_text(apply_features(raw, features), setting_values(lang))
    return corpora


def support_assistant_available() -> bool:
    return bool(
        settings.ENABLE_SUPPORT_ASSISTANT
        and settings.LLM_PROVIDER
        and {"de", "en"} <= CORPORA.keys()
    )


async def load_situation(user_id: str, transcription_id: str | None) -> dict | None:
    """Metadata (never text) of the user's own transcription, or None."""
    if transcription_id is None:
        return None
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT status, error_code, error_message, language, detected_language, model "
            "FROM transcriptions WHERE id = ? AND user_id = ?",
            (transcription_id, user_id),
        )
        row = await cursor.fetchone()
    if row is None:
        return None
    return {k: row[k] for k in row.keys()}


def build_system_prompt(lang: Lang, view: str, situation: dict | None) -> str:
    contact = (
        f"the support team at {settings.CONTACT_EMAIL}"
        if settings.CONTACT_EMAIL
        else "the support team"
    )
    lines = [
        f"- Interface language: {'German' if lang == 'de' else 'English'}",
        f"- Current view: {view} ({VIEW_DESCRIPTIONS.get(view, view)})",
    ]
    if situation:
        lines.append(f"- Open transcription status: {situation['status']}")
        if situation.get("error_code"):
            lines.append(f"- Error code: {situation['error_code']}")
        message = " ".join(str(situation.get("error_message") or "").split())
        if message:
            if len(message) > ERROR_MESSAGE_MAX:
                message = message[:ERROR_MESSAGE_MAX] + "…"
            lines.append(f"- Error message: {message}")
        lines.append(f"- Requested language: {situation.get('language') or 'Auto-detect'}")
        if situation.get("detected_language"):
            lines.append(f"- Detected language: {situation['detected_language']}")
        if situation.get("model"):
            lines.append(f"- Speech recognition model: {situation['model']}")
    # The situation goes last: instructions + manual are identical for every request
    # of one language, so the LLM server's prefix cache can reuse them.
    return (
        INSTRUCTIONS.replace("{contact}", contact)
        + "\n\n## Handbuch\n\n"
        + CORPORA[lang]
        + "\n\n## Situation\n"
        + "\n".join(lines)
    )

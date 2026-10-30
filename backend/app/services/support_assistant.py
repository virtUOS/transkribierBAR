"""Support assistant: the user manual corpus and availability check."""
import logging
import os

from app.config import settings
from app.public_pages import (
    Lang,
    apply_features,
    fill_settings_text,
    guide_features,
    setting_values,
)

logger = logging.getLogger(__name__)

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

"""Helpers for the public guide and privacy notice pages."""
import html
import logging
import math
import os
import re
from typing import Literal, Mapping

from app.config import settings

logger = logging.getLogger(__name__)

Lang = Literal["de", "en"]

_SETTING_RE = re.compile(r"__TW_SETTING_([a-z_]+)__")


def format_days(hours: int, lang: Lang) -> str:
    """Hours as days, at most one decimal, no trailing `.0`, decimal comma for German.

    Mirrors `formatDays` in frontend/src/help/helpText.ts (JS Math.round rounds
    halves up, unlike Python's round()).
    """
    days = math.floor((hours / 24) * 10 + 0.5) / 10
    text = str(int(days)) if days == int(days) else str(days)
    return text.replace(".", ",") if lang == "de" else text


def setting_values(lang: Lang) -> dict[str, str]:
    return {
        "contact_email": settings.CONTACT_EMAIL,
        "retention_days": format_days(settings.DEFAULT_EXPIRY_HOURS, lang),
        "archive_retention_days": format_days(settings.ARCHIVE_EXPIRY_HOURS, lang),
        "default_model": settings.DEFAULT_WHISPER_MODEL,
        "api_token_expiry_days": str(settings.API_TOKEN_DEFAULT_EXPIRY_DAYS),
        "app_version": os.getenv("APP_VERSION", "dev"),
    }


def apply_features(html_text: str, enabled: Mapping[str, bool]) -> str:
    """Drop disabled `<!--tw-feature:X-->…<!--/tw-feature:X-->` blocks, unwrap enabled ones."""
    def repl(m: re.Match) -> str:
        return m.group("body") if enabled.get(m.group("name"), False) else ""

    out = re.sub(
        r"<!--tw-feature:(?P<name>\w+)-->(?P<body>.*?)<!--/tw-feature:(?P=name)-->",
        repl,
        html_text,
        flags=re.DOTALL,
    )
    return out


def fill_settings(html_text: str, values: Mapping[str, str]) -> str:
    return _SETTING_RE.sub(
        lambda m: html.escape(values.get(m.group(1), ""), quote=True), html_text
    )


def fill_settings_text(text: str, values: Mapping[str, str]) -> str:
    """Like `fill_settings`, without HTML escaping (for plain-text/Markdown output)."""
    return _SETTING_RE.sub(lambda m: values.get(m.group(1), ""), text)


def guide_features(privacy: bool) -> dict[str, bool]:
    """Feature switches for `<!--tw-feature:X-->` blocks in the guide and the assistant manual."""
    return {
        "llm": bool(settings.LLM_PROVIDER),
        "api_tokens": settings.ENABLE_API_TOKENS,
        "privacy": privacy,
        # Sentences with the contact address are dropped when none is configured.
        "contact": bool(settings.CONTACT_EMAIL),
    }


def load_privacy_notices() -> dict[Lang, str]:
    notices: dict[Lang, str] = {}
    for lang, path in (
        ("de", settings.PRIVACY_NOTICE_FILE_DE),
        ("en", settings.PRIVACY_NOTICE_FILE_EN),
    ):
        if not path:
            continue
        try:
            with open(path, encoding="utf-8") as f:
                notices[lang] = f.read()
        except (OSError, UnicodeDecodeError) as e:
            logger.error("Cannot read privacy notice file %s (%s): %s", lang, path, e)
    return notices


def privacy_notice(lang: Lang, notices: Mapping[Lang, str]) -> tuple[str, Lang] | None:
    if lang in notices:
        return notices[lang], lang
    other: Lang = "en" if lang == "de" else "de"
    if other in notices:
        return notices[other], other
    return None


_FALLBACK_NOTE: dict[Lang, str] = {
    "de": "Diese Hinweise gibt es nur auf Englisch.",
    "en": "This notice is available in German only.",
}


def notice_fallback_note(page_lang: Lang, notice_lang: Lang) -> str:
    """One-line note (HTML) when the notice is not in the page's language, else empty."""
    if page_lang == notice_lang:
        return ""
    return f'<p class="notice-note">{html.escape(_FALLBACK_NOTE[page_lang])}</p>'

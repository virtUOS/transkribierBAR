"""Public (unauthenticated) guide and privacy notice pages under /handbuch."""
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, RedirectResponse, Response

from app.config import settings
from app.public_pages import (
    Lang,
    apply_features,
    fill_settings,
    guide_features,
    notice_fallback_note,
    privacy_notice,
    setting_values,
)

router = APIRouter()

# Set by app.main to static/handbuch.
GUIDE_DIR: Path = Path(__file__).resolve().parent.parent.parent / "static" / "handbuch"
# Loaded once at startup by app.main; tests may replace it.
NOTICES: dict[Lang, str] = {}

HEADERS = {
    "Cache-Control": "no-cache",
    "Content-Security-Policy": (
        "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
        "font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    ),
}


def _not_found() -> Response:
    return Response(status_code=404, content="Not found", media_type="text/plain")


def _features() -> dict[str, bool]:
    return guide_features(bool(NOTICES))


def _read(rel: str) -> str | None:
    try:
        return (GUIDE_DIR / rel).read_text(encoding="utf-8")
    except OSError:
        return None


def _page(rel: str, lang: Lang) -> Response:
    raw = _read(rel)
    if raw is None:
        return _not_found()
    body = fill_settings(apply_features(raw, _features()), setting_values(lang))
    return HTMLResponse(body, headers=HEADERS)


def _privacy_page(rel: str, lang: Lang) -> Response:
    chosen = privacy_notice(lang, NOTICES)
    raw = _read(rel)
    if chosen is None or raw is None:
        return _not_found()
    notice, notice_lang = chosen
    body = fill_settings(apply_features(raw, _features()), setting_values(lang))
    # The notice is trusted operator HTML and is inserted last, unescaped.
    body = body.replace("__TW_NOTICE_FALLBACK__", notice_fallback_note(lang, notice_lang))
    notice = fill_settings(notice, setting_values(notice_lang))
    body = body.replace("__TW_NOTICE_LANG__", notice_lang).replace("__TW_PRIVACY_NOTICE__", notice)
    return HTMLResponse(body, headers=HEADERS)


# Redirect targets are relative so they also work behind a prefix-stripping proxy.
# Browsers and link checkers send HEAD too, so every route accepts both.
_METHODS = ["GET", "HEAD"]


@router.api_route("/handbuch", methods=_METHODS)
async def guide_redirect():
    return RedirectResponse("handbuch/", status_code=308)


@router.api_route("/handbuch/en", methods=_METHODS)
async def guide_en_redirect():
    return RedirectResponse("en/", status_code=308)


@router.api_route("/handbuch/datenschutz", methods=_METHODS)
async def privacy_de_redirect():
    return RedirectResponse("datenschutz/", status_code=308)


@router.api_route("/handbuch/en/privacy", methods=_METHODS)
async def privacy_en_redirect():
    return RedirectResponse("privacy/", status_code=308)


@router.api_route("/handbuch/", methods=_METHODS)
async def guide_de():
    return _page("index.html", "de")


@router.api_route("/handbuch/en/", methods=_METHODS)
async def guide_en():
    return _page("en/index.html", "en")


@router.api_route("/handbuch/datenschutz/", methods=_METHODS)
async def privacy_de():
    return _privacy_page("datenschutz/index.html", "de")


@router.api_route("/handbuch/en/privacy/", methods=_METHODS)
async def privacy_en():
    return _privacy_page("en/privacy/index.html", "en")


@router.api_route("/handbuch/{rest:path}", methods=_METHODS)
async def guide_not_found(rest: str):
    return _not_found()

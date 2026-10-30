import importlib

import pytest
from httpx import AsyncClient, ASGITransport

from app.config import settings
from app.main import app
from app.services import support_assistant


def _reload(monkeypatch):
    import dotenv
    monkeypatch.setattr(dotenv, "load_dotenv", lambda *a, **kw: None)
    from app import config as config_module
    importlib.reload(config_module)
    return config_module


def test_flag_defaults_to_false(monkeypatch):
    monkeypatch.delenv("ENABLE_SUPPORT_ASSISTANT", raising=False)
    assert _reload(monkeypatch).settings.ENABLE_SUPPORT_ASSISTANT is False


def test_flag_from_env(monkeypatch):
    monkeypatch.setenv("ENABLE_SUPPORT_ASSISTANT", "true")
    assert _reload(monkeypatch).settings.ENABLE_SUPPORT_ASSISTANT is True


def _write(tmp_path, name, text):
    d = tmp_path / "assistant"
    d.mkdir(exist_ok=True)
    (d / name).write_text(text, encoding="utf-8")


def test_load_corpora_fills_settings_and_features(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "")
    monkeypatch.setattr(settings, "DEFAULT_EXPIRY_HOURS", 72)
    monkeypatch.setattr(settings, "CONTACT_EMAIL", "a&b@example.org")
    _write(tmp_path, "de.md",
           "Frist __TW_SETTING_retention_days__ Tage. <!--tw-feature:llm-->KI<!--/tw-feature:llm--> "
           "Kontakt __TW_SETTING_contact_email__")
    _write(tmp_path, "en.md", "Retention __TW_SETTING_retention_days__ days")
    corpora = support_assistant.load_corpora(str(tmp_path), False)
    de = corpora["de"]
    assert "Frist 3 Tage." in de
    assert "KI" not in de
    assert "a&b@example.org" in de
    assert "__TW_SETTING_" not in de
    assert "Retention 3 days" in corpora["en"]


def test_missing_corpus_file_is_left_out(tmp_path):
    _write(tmp_path, "en.md", "x")
    assert set(support_assistant.load_corpora(str(tmp_path), False)) == {"en"}


@pytest.mark.asyncio
@pytest.mark.parametrize("flag,provider,corpora,expected", [
    (True, "openai", {"de": "a", "en": "b"}, True),
    (False, "openai", {"de": "a", "en": "b"}, False),
    (True, "", {"de": "a", "en": "b"}, False),
    (True, "openai", {"en": "b"}, False),
])
async def test_config_reports_assistant_availability(monkeypatch, flag, provider, corpora, expected):
    monkeypatch.setattr(settings, "ENABLE_SUPPORT_ASSISTANT", flag)
    monkeypatch.setattr(settings, "LLM_PROVIDER", provider)
    monkeypatch.setattr(support_assistant, "CORPORA", corpora)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        data = (await client.get("/api/config")).json()
    assert data["support_assistant_enabled"] is expected


@pytest.mark.parametrize("flag", [True, False])
def test_lifespan_loads_corpora_only_when_enabled(monkeypatch, tmp_path, flag):
    from unittest.mock import patch
    from fastapi.testclient import TestClient

    import app.main as main_module

    # Other tests reload app.config; patch the settings object main actually uses.
    live = main_module.settings
    monkeypatch.setattr(live, "DATABASE_PATH", str(tmp_path / "startup.db"))
    monkeypatch.setattr(live, "ENABLE_SUPPORT_ASSISTANT", flag)
    with patch.object(support_assistant, "load_corpora", return_value={}) as load:
        with TestClient(app):
            pass
    assert load.called is flag

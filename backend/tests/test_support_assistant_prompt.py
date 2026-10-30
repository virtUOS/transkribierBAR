import pytest

from app.config import settings
from app.database import get_db
from app.services import support_assistant as sa


@pytest.fixture(autouse=True)
def corpora(monkeypatch):
    monkeypatch.setattr(sa, "CORPORA", {"de": "HANDBUCH-DE", "en": "MANUAL-EN"})


def test_prompt_contains_instructions_view_and_manual():
    p = sa.build_system_prompt("de", "upload", None)
    assert 'You are the "Assistent" of transkribierBAR' in p
    assert "Current view: upload (uploading a file" in p
    assert "Interface language: German" in p
    assert p.endswith("HANDBUCH-DE")
    assert "MANUAL-EN" not in p
    assert "Open transcription" not in p


def test_contact_filled_from_settings(monkeypatch):
    monkeypatch.setattr(settings, "CONTACT_EMAIL", "help@example.org")
    p = sa.build_system_prompt("en", "archive", None)
    assert "the support team at help@example.org" in p
    assert "{contact}" not in p
    monkeypatch.setattr(settings, "CONTACT_EMAIL", "")
    p = sa.build_system_prompt("en", "archive", None)
    assert "the support team" in p
    assert "the support team at" not in p
    assert "{contact}" not in p


async def _insert():
    async with get_db() as db:
        await db.execute("INSERT INTO users (id, email) VALUES ('owner', 'o@example.org')")
        await db.execute(
            "INSERT INTO transcriptions (id, user_id, status, error_code, error_message, language, model) "
            "VALUES ('t-1', 'owner', 'failed', 'timeout', 'ASR job exceeded 1800s', NULL, 'large-v3')"
        )
        await db.commit()


@pytest.mark.asyncio
async def test_situation_for_own_failed_transcription():
    await _insert()
    s = await sa.load_situation("owner", "t-1")
    assert s["status"] == "failed"
    assert s["error_code"] == "timeout"
    assert s["error_message"] == "ASR job exceeded 1800s"
    assert s["language"] is None
    assert s["model"] == "large-v3"
    p = sa.build_system_prompt("en", "detail", s)
    assert "Error code: timeout" in p
    assert "Requested language: Auto-detect" in p
    assert "Speech recognition model: large-v3" in p


@pytest.mark.asyncio
async def test_situation_ignores_other_users_transcription():
    await _insert()
    assert await sa.load_situation("someone-else", "t-1") is None
    assert await sa.load_situation("owner", None) is None

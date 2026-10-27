import asyncio
import email
import email.policy
import logging
import smtplib
import sqlite3
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from prometheus_client import REGISTRY

from app.database import get_db
from app.main import cleanup_old_files
from app.services.email import InvalidRecipientError
from tests.test_asr_cleanup import _insert as _insert_file
from tests.test_email import fake_relay, relay_settings
from app.services import token_expiry
from app.services.token_expiry import (
    build_expiry_message,
    expiry_warning,
    is_relevant,
    parse_ts,
    send_expiry_reminders,
)

NOW = datetime(2027, 1, 1, 12, tzinfo=timezone.utc)
FMT = "%Y-%m-%d %H:%M:%S"


def _ts(dt: datetime) -> str:
    return dt.strftime(FMT)


def _warning(*, validity_days: int, left_days: float, revoked_at=None, no_expiry=False):
    expires = NOW + timedelta(days=left_days)
    created = expires - timedelta(days=validity_days)
    return expiry_warning(
        created_at=_ts(created),
        expires_at=None if no_expiry else _ts(expires),
        revoked_at=revoked_at,
        now=NOW,
    )


def _relevant(validity_days: int, days: int) -> bool:
    created = NOW
    return is_relevant(created, created + timedelta(days=validity_days), days)


def test_parse_ts_is_utc_aware():
    assert parse_ts("2027-01-01 12:00:00") == NOW


def test_is_relevant_follows_the_80_percent_rule():
    assert all(_relevant(90, d) for d in (14, 3, 1))
    assert _relevant(7, 14) is False
    assert _relevant(7, 3) is True
    assert _relevant(7, 1) is True
    assert _relevant(1, 1) is False


def test_expiry_warning_soon_within_widest_relevant_threshold():
    assert _warning(validity_days=90, left_days=13) == "soon"
    assert _warning(validity_days=90, left_days=15) is None
    assert _warning(validity_days=7, left_days=4) is None
    assert _warning(validity_days=7, left_days=2) == "soon"


def test_expiry_warning_expired_for_14_days_then_none():
    assert _warning(validity_days=90, left_days=-1) == "expired"
    assert _warning(validity_days=90, left_days=-15) is None


def test_expiry_warning_one_day_token_only_once_expired():
    assert _warning(validity_days=1, left_days=0.5) is None
    assert _warning(validity_days=1, left_days=1 / 24 / 60) is None
    assert _warning(validity_days=1, left_days=-0.5) == "expired"


def test_expiry_warning_none_for_revoked_or_no_expiry():
    assert _warning(validity_days=90, left_days=2, revoked_at=_ts(NOW)) is None
    assert _warning(validity_days=90, left_days=-1, revoked_at=_ts(NOW)) is None
    assert _warning(validity_days=90, left_days=2, no_expiry=True) is None


# --- Reminder run ---------------------------------------------------------

EMAIL = "u1@example.com"
PREFIX = "tw_abcdefgh1"


class _Sender:
    """Stands in for send_token_expiry_email; raises `error`, or `errors[to_email]`, when set."""

    def __init__(self):
        self.calls: list[dict] = []
        self.error: Exception | None = None
        self.errors: dict[str, Exception] = {}

    def __call__(self, *, to_email: str, subject: str, body: str) -> None:
        self.calls.append({"to_email": to_email, "subject": subject, "body": body})
        error = self.errors.get(to_email, self.error)
        if error is not None:
            raise error


@pytest.fixture
def reminder_settings(monkeypatch):
    fake = SimpleNamespace(
        ENABLE_API_TOKENS=True,
        SMTP_HOST="smtp.example.com",
        SMTP_FROM="noreply@example.com",
        APP_PUBLIC_URL="https://app.example.com",
    )
    monkeypatch.setattr(token_expiry, "settings", fake)
    return fake


@pytest.fixture
def sender(monkeypatch, reminder_settings):
    fake = _Sender()
    monkeypatch.setattr(token_expiry, "send_token_expiry_email", fake)
    return fake


async def _seed_token(
    db,
    *,
    token_id="t1",
    user_id="u1",
    email=EMAIL,
    validity_days=90,
    left_days=13.0,
    revoked=False,
    now=NOW,
):
    await db.execute("INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)", (user_id, email))
    expires = now + timedelta(days=left_days)
    created = expires - timedelta(days=validity_days)
    await db.execute(
        "INSERT INTO api_tokens (id, user_id, name, prefix, token_hash, created_at, expires_at, revoked_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            token_id, user_id, f"script-{token_id}", PREFIX, f"hash-{token_id}",
            _ts(created), _ts(expires), _ts(now) if revoked else None,
        ),
    )
    await db.commit()


async def _notices(db) -> list[tuple[str, int]]:
    cursor = await db.execute(
        "SELECT token_id, days_before FROM api_token_expiry_notices ORDER BY token_id, days_before"
    )
    return [(row["token_id"], row["days_before"]) for row in await cursor.fetchall()]


def _counts(**kw) -> dict[str, int]:
    return {"sent": 0, "logged": 0, "rejected": 0, "failed": 0, **kw}


def _metric(result: str) -> float:
    return REGISTRY.get_sample_value(
        "transcription_api_token_expiry_reminders_total", {"result": result}
    ) or 0.0


@pytest.mark.asyncio
async def test_reminder_sends_widest_due_threshold_once(sender):
    before = _metric("sent")
    async with get_db() as db:
        await _seed_token(db, left_days=13)
        assert await send_expiry_reminders(db, now=NOW) == _counts(sent=1)
        assert await _notices(db) == [("t1", 14)]
        assert await send_expiry_reminders(db, now=NOW) == _counts()

    assert len(sender.calls) == 1
    assert sender.calls[0]["to_email"] == EMAIL
    assert "within 14 days" in sender.calls[0]["subject"]
    assert _metric("sent") == before + 1


@pytest.mark.asyncio
async def test_reminder_after_downtime_sends_only_the_most_urgent(sender):
    async with get_db() as db:
        await _seed_token(db, left_days=2)
        assert await send_expiry_reminders(db, now=NOW) == _counts(sent=1)
        assert await _notices(db) == [("t1", 3)]
        assert await send_expiry_reminders(db, now=NOW) == _counts()

    assert len(sender.calls) == 1
    assert "innerhalb von 3 Tagen" in sender.calls[0]["subject"]
    assert "within 3 days" in sender.calls[0]["subject"]


@pytest.mark.asyncio
async def test_reminder_skips_irrelevant_thresholds_for_short_tokens(sender):
    async with get_db() as db:
        await _seed_token(db, validity_days=7, left_days=6)
        assert await send_expiry_reminders(db, now=NOW) == _counts()
        assert await _notices(db) == []
        # Four days later the token has 2 days left.
        later = NOW + timedelta(days=4)
        assert await send_expiry_reminders(db, now=later) == _counts(sent=1)
        assert await _notices(db) == [("t1", 3)]

    assert len(sender.calls) == 1
    assert "within 3 days" in sender.calls[0]["subject"]


@pytest.mark.asyncio
async def test_reminder_never_mails_a_one_day_token(sender):
    async with get_db() as db:
        await _seed_token(db, validity_days=1, left_days=1)
        for hours in (0, 1, 12, 23, 23.99):
            run_at = NOW + timedelta(hours=hours)
            assert await send_expiry_reminders(db, now=run_at) == _counts()
        assert await _notices(db) == []

    assert sender.calls == []


@pytest.mark.asyncio
async def test_reminder_skips_revoked_expired_and_emailless(sender):
    async with get_db() as db:
        await _seed_token(db, token_id="revoked", left_days=2, revoked=True)
        await _seed_token(db, token_id="expired", left_days=-1)
        await _seed_token(db, token_id="null-email", user_id="u2", email=None, left_days=2)
        await _seed_token(db, token_id="empty-email", user_id="u3", email="", left_days=2)
        assert await send_expiry_reminders(db, now=NOW) == _counts()
        assert await _notices(db) == []

    assert sender.calls == []


@pytest.mark.asyncio
async def test_reminder_failure_retries_next_run_without_wider_notice(sender):
    sender.error = smtplib.SMTPServerDisconnected("Connection unexpectedly closed")
    async with get_db() as db:
        await _seed_token(db, left_days=2)
        assert await send_expiry_reminders(db, now=NOW) == _counts(failed=1)
        assert await _notices(db) == []
        # The 3-day notice failed; the 14-day one must not go out in its place.
        assert len(sender.calls) == 1

        sender.error = None
        assert await send_expiry_reminders(db, now=NOW) == _counts(sent=1)
        assert await _notices(db) == [("t1", 3)]

    assert len(sender.calls) == 2
    assert "within 3 days" in sender.calls[1]["subject"]


@pytest.mark.asyncio
async def test_reminder_gone_mailbox_is_recorded(sender):
    sender.error = smtplib.SMTPRecipientsRefused(
        {EMAIL: (550, b"5.1.1 <u1@example.com>: User unknown")}
    )
    async with get_db() as db:
        await _seed_token(db, left_days=2)
        assert await send_expiry_reminders(db, now=NOW) == _counts(rejected=1)
        assert await _notices(db) == [("t1", 3)]
        assert await send_expiry_reminders(db, now=NOW) == _counts()

    assert len(sender.calls) == 1


@pytest.mark.asyncio
async def test_reminder_recipient_with_line_break_is_recorded(sender):
    sender.error = InvalidRecipientError("line break in recipient address")
    async with get_db() as db:
        await _seed_token(db, left_days=2)
        assert await send_expiry_reminders(db, now=NOW) == _counts(rejected=1)
        assert await _notices(db) == [("t1", 3)]
        assert await send_expiry_reminders(db, now=NOW) == _counts()

    assert len(sender.calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "code, reply",
    [
        (554, b"5.7.1 Relay access denied"),
        (550, b"5.1.0 Sender address rejected"),
        (552, b"5.2.2 Mailbox full"),
        (450, b"4.2.0 Try again later"),
        (550, b"Rejected"),
    ],
)
async def test_reminder_other_refusals_are_retried(sender, code, reply):
    sender.error = smtplib.SMTPRecipientsRefused({EMAIL: (code, reply)})
    async with get_db() as db:
        await _seed_token(db, left_days=2)
        assert await send_expiry_reminders(db, now=NOW) == _counts(failed=1)
        assert await _notices(db) == []

    assert len(sender.calls) == 1


@pytest.mark.asyncio
async def test_reminder_other_value_error_is_retried(sender):
    # smtplib raises this at login for a non-ASCII password: a relay problem.
    sender.error = UnicodeEncodeError("ascii", "pässword", 1, 2, "ordinal not in range(128)")
    async with get_db() as db:
        await _seed_token(db, left_days=2)
        assert await send_expiry_reminders(db, now=NOW) == _counts(failed=1)
        assert await _notices(db) == []

    assert len(sender.calls) == 1


@pytest.mark.asyncio
async def test_reminder_unexpected_error_fails_only_that_token(sender, caplog):
    caplog.set_level(logging.ERROR, logger="app.services.token_expiry")
    sender.errors["bad@example.com"] = AttributeError("'InvalidHeaderDefect' object has no attribute 'all_defects'")
    async with get_db() as db:
        await _seed_token(db, token_id="t1", user_id="u1", email="bad@example.com", left_days=2)
        await _seed_token(db, token_id="t2", user_id="u2", email="ok@example.com", left_days=2.5)
        assert await send_expiry_reminders(db, now=NOW) == _counts(failed=1, sent=1)
        assert await _notices(db) == [("t2", 3)]

    assert [c["to_email"] for c in sender.calls] == ["bad@example.com", "ok@example.com"]
    assert "Traceback" in caplog.text


@pytest.mark.asyncio
async def test_reminder_malformed_address_does_not_abort_the_run(reminder_settings):
    """The real sender: the stdlib header parser raises AttributeError for "a@[" (3.12)."""
    fake_smtp = MagicMock()
    fake_smtp.__enter__.return_value = fake_smtp
    smtp_settings = SimpleNamespace(
        SMTP_HOST="smtp.example.com", SMTP_PORT=587, SMTP_STARTTLS=False,
        SMTP_USER="", SMTP_PASSWORD="", SMTP_FROM="noreply@example.com",
    )
    async with get_db() as db:
        await _seed_token(db, token_id="t1", user_id="u1", email="a@[", left_days=2)
        await _seed_token(db, token_id="t2", user_id="u2", email="ok@example.com", left_days=2.5)
        with patch("app.services.email.settings", smtp_settings), \
             patch("app.services.email.smtplib.SMTP", return_value=fake_smtp):
            counts = await send_expiry_reminders(db, now=NOW)
        assert await _notices(db) == [("t2", 3)]

    assert counts == _counts(failed=1, sent=1)
    fake_smtp.send_message.assert_called_once()
    assert fake_smtp.send_message.call_args[0][0]["To"] == "ok@example.com"


@pytest.mark.asyncio
async def test_reminder_accepted_by_the_relay_counts_as_sent_despite_a_failed_quit(reminder_settings):
    """The relay took the mail and then answered QUIT with 250: the reminder went out."""
    async with get_db() as db:
        await _seed_token(db, left_days=2)
        with fake_relay(quit_reply=b"250 2.0.0 Bye") as (port, seen):
            with patch("app.services.email.settings", relay_settings(port)):
                counts = await send_expiry_reminders(db, now=NOW)
        assert await _notices(db) == [("t1", 3)]
        # Recorded, so the next run does not mail it again.
        assert await send_expiry_reminders(db, now=NOW) == _counts()

    assert counts == _counts(sent=1)
    delivered = email.message_from_bytes(seen["data"], policy=email.policy.default)
    assert "within 3 days" in delivered["Subject"]


@pytest.mark.asyncio
async def test_reminder_sent_but_not_recorded_counts_as_failed(sender):
    async with get_db() as db:
        await _seed_token(db, left_days=2)
        await db.execute(
            "CREATE TRIGGER fail_notice BEFORE INSERT ON api_token_expiry_notices "
            "BEGIN SELECT RAISE(ABORT, 'disk full'); END"
        )
        await db.commit()
        assert await send_expiry_reminders(db, now=NOW) == _counts(failed=1)
        assert await _notices(db) == []

    # The 3-day mail went out; the 14-day one must not follow it in the same run.
    assert len(sender.calls) == 1


@pytest.mark.asyncio
async def test_reminder_logs_without_smtp(sender, reminder_settings, caplog):
    reminder_settings.SMTP_HOST = ""
    caplog.set_level(logging.WARNING, logger="app.services.token_expiry")
    async with get_db() as db:
        await _seed_token(db, left_days=13)
        assert await send_expiry_reminders(db, now=NOW) == _counts(logged=1)
        assert await _notices(db) == [("t1", 14)]

    assert sender.calls == []
    assert "no mail transport configured" in caplog.text
    assert PREFIX in caplog.text
    assert EMAIL not in caplog.text


@pytest.mark.asyncio
async def test_reminder_does_nothing_when_tokens_disabled(sender, reminder_settings):
    reminder_settings.ENABLE_API_TOKENS = False
    async with get_db() as db:
        await _seed_token(db, left_days=2)
        assert await send_expiry_reminders(db, now=NOW) == _counts()
        assert await _notices(db) == []

    assert sender.calls == []


@pytest.mark.asyncio
async def test_cleanup_run_sends_due_reminders(sender, capsys):
    async with get_db() as db:
        await _seed_token(db, left_days=2, now=datetime.now(timezone.utc))

    with patch("app.main.delete_orphaned_media", AsyncMock(return_value=0)), \
         patch("app.main.asyncio.sleep", AsyncMock(side_effect=[None, asyncio.CancelledError()])):
        with pytest.raises(asyncio.CancelledError):
            await cleanup_old_files()

    assert len(sender.calls) == 1
    assert "Token expiry reminders: sent=1, logged=0, rejected=0, failed=0" in capsys.readouterr().out


def _cleanup_runs(status: str) -> float:
    return REGISTRY.get_sample_value(
        "transcription_cleanup_runs_total", {"status": status}
    ) or 0.0


@pytest.mark.asyncio
async def test_failing_reminder_run_skips_no_cleanup_step(capsys):
    """The reminders run last: an error in them must not cost the ASR remote deletes."""
    await _insert_file("f-old", "2000-01-01 00:00:00", [("t-old", "completed", "job-old")])
    asr_backend = AsyncMock()
    before_success, before_failed = _cleanup_runs("success"), _cleanup_runs("failed")

    with patch("app.main.get_asr_backend", return_value=asr_backend), \
         patch("app.main.delete_orphaned_media", AsyncMock(return_value=0)), \
         patch("app.main.send_expiry_reminders",
               AsyncMock(side_effect=sqlite3.OperationalError("database is locked"))), \
         patch("app.main.asyncio.sleep", AsyncMock(side_effect=[None, asyncio.CancelledError()])):
        with pytest.raises(asyncio.CancelledError):
            await cleanup_old_files()

    asr_backend.cleanup.assert_awaited_once_with("job-old")
    assert _cleanup_runs("success") == before_success + 1
    assert _cleanup_runs("failed") == before_failed
    out = capsys.readouterr().out
    assert "Token expiry reminder error: database is locked" in out
    assert "Cleanup error" not in out


@pytest.mark.asyncio
async def test_reminders_wait_for_the_asr_remote_deletes(sender):
    """A slow relay must not hold back the remote deletes: those come first."""
    await _insert_file("f-old", "2000-01-01 00:00:00", [("t-old", "completed", "job-old")])
    async with get_db() as db:
        await _seed_token(db, left_days=2, now=datetime.now(timezone.utc))
    order: list[str] = []
    asr_backend = AsyncMock()
    asr_backend.cleanup.side_effect = lambda job_id: order.append("asr")
    real_reminders = send_expiry_reminders

    async def reminders(db):
        order.append("reminders")
        return await real_reminders(db)

    with patch("app.main.get_asr_backend", return_value=asr_backend), \
         patch("app.main.delete_orphaned_media", AsyncMock(return_value=0)), \
         patch("app.main.send_expiry_reminders", reminders), \
         patch("app.main.asyncio.sleep", AsyncMock(side_effect=[None, asyncio.CancelledError()])):
        with pytest.raises(asyncio.CancelledError):
            await cleanup_old_files()

    assert order == ["asr", "reminders"]
    assert len(sender.calls) == 1


def test_build_expiry_message_german_first_with_link():
    expires = datetime(2027, 1, 15, 10, 30, tzinfo=timezone.utc)
    subject, body = build_expiry_message(
        name="nightly", prefix=PREFIX, expires_at=expires, days=3,
        app_url="https://app.example.com",
    )
    assert subject.startswith("Ihr API-Token")
    assert "innerhalb von 3 Tagen" in subject and "within 3 days" in subject
    german, english = body.split("---")
    assert body.index("Guten Tag,") < body.index("Hello,")
    assert "Hello," in english
    for half in (german, english):
        assert "2027-01-15 10:30 UTC" in half
        assert "https://app.example.com" in half
        assert f"({PREFIX}…)" in half
    assert "„nightly“" in german
    assert '"nightly"' in english

    subject, body = build_expiry_message(
        name="nightly", prefix=PREFIX, expires_at=expires, days=1, app_url="",
    )
    assert "innerhalb eines Tages" in subject and "within a day" in subject
    assert "innerhalb eines Tages" in body and "within a day" in body
    assert "https://" not in body
    assert "\n\n\n" not in body
    assert body.endswith("on its own.\n")
    # Without a link the sentences end where the link would have followed.
    assert (
        "Erstellen Sie unter Einstellungen → API-Tokens einen neuen Token "
        "und ersetzen Sie den alten in Ihren Skripten.\n\nWenn Sie" in body
    )
    assert (
        "Create a new token under Settings → API tokens "
        "and replace the old one in your scripts.\n\nIf you" in body
    )
    assert not [line for line in body.splitlines() if line.endswith(":")]


def test_build_expiry_message_introduces_the_link_with_a_colon():
    _, body = build_expiry_message(
        name="nightly", prefix=PREFIX, expires_at=datetime(2027, 1, 15, 10, 30, tzinfo=timezone.utc),
        days=3, app_url="https://app.example.com",
    )
    assert "in Ihren Skripten:\n\n  https://app.example.com\n\nWenn Sie" in body
    assert "in your scripts:\n\n  https://app.example.com\n\nIf you" in body

"""Expiry rules for API tokens: which tokens warrant a warning or reminder."""

import asyncio
import logging
import re
import smtplib
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Literal

from aiosqlite import Connection

from app.config import settings
from app.metrics import api_token_expiry_reminders_total, inc
from app.services.email import InvalidRecipientError, send_token_expiry_email

logger = logging.getLogger(__name__)

# Days before expiry at which owners are reminded, narrowest first.
THRESHOLDS: tuple[int, ...] = (1, 3, 14)
# A threshold only counts if it is shorter than this share of the token's validity.
RELEVANT_SHARE = 0.8
# How long after expiry an expired token is still flagged.
EXPIRED_NOTICE_DAYS = 14

_TS_FORMAT = "%Y-%m-%d %H:%M:%S"


def parse_ts(value: str) -> datetime:
    """Parse a DB timestamp ("%Y-%m-%d %H:%M:%S", UTC) into an aware datetime."""
    return datetime.strptime(value, _TS_FORMAT).replace(tzinfo=timezone.utc)


def is_relevant(created_at: datetime, expires_at: datetime, days: int) -> bool:
    """Whether a `days`-before-expiry threshold applies to this token.

    Tokens cannot be extended, so validity counts from creation.
    """
    validity = (expires_at - created_at).total_seconds()
    return days * 86400 < RELEVANT_SHARE * validity


def expiry_warning(
    *,
    created_at: str,
    expires_at: str | None,
    revoked_at: str | None,
    now: datetime,
) -> Literal["soon", "expired"] | None:
    if revoked_at is not None or expires_at is None:
        return None
    created = parse_ts(created_at)
    expires = parse_ts(expires_at)
    if expires <= now:
        if now - expires <= timedelta(days=EXPIRED_NOTICE_DAYS):
            return "expired"
        return None
    remaining = expires - now
    for days in THRESHOLDS:
        if remaining <= timedelta(days=days) and is_relevant(created, expires, days):
            return "soon"
    return None


def build_expiry_message(
    *, name: str, prefix: str, expires_at: datetime, days: int, app_url: str
) -> tuple[str, str]:
    """Return the (subject, body) of a reminder; `expires_at` is in UTC.

    Bilingual, German first: nothing records a user's language. Tokens expire
    at a time of day, so the mail names the time and says "within", not "in".
    """
    if days == 1:
        when_de, when_en = "innerhalb eines Tages", "within a day"
    else:
        when_de, when_en = f"innerhalb von {days} Tagen", f"within {days} days"
    at = expires_at.strftime("%Y-%m-%d %H:%M")
    # The sentence before the link introduces it; without one it simply ends.
    lead, link = (":", f"  {app_url}\n\n") if app_url else (".", "")
    subject = (
        f"Ihr API-Token für transkribierBAR läuft {when_de} ab"
        f" / Your transkribierBAR API token expires {when_en}"
    )
    body = (
        "Guten Tag,\n\n"
        f"Ihr API-Token „{name}“ ({prefix}…) für transkribierBAR läuft {when_de} ab, am {at} UTC.\n\n"
        "Tokens lassen sich nicht verlängern. Erstellen Sie unter Einstellungen → API-Tokens "
        f"einen neuen Token und ersetzen Sie den alten in Ihren Skripten{lead}\n\n"
        f"{link}"
        "Wenn Sie den Token nicht mehr benötigen, können Sie diese Nachricht ignorieren; "
        "er wird von selbst ungültig.\n\n"
        "---\n\n"
        "Hello,\n\n"
        f'your transkribierBAR API token "{name}" ({prefix}…) expires {when_en}, on {at} UTC.\n\n'
        "Tokens cannot be extended. Create a new token under Settings → API tokens "
        f"and replace the old one in your scripts{lead}\n\n"
        f"{link}"
        "If you no longer need the token, you can ignore this message; "
        "it will stop working on its own.\n"
    )
    return subject, body


# An RFC 3463 address status (5.1.x) at the start of a reply, capturing its detail.
_ADDRESS_STATUS = re.compile(rb"^5\.1\.(\d{1,3})(?:\s|$)")


def _recipient_gone(err: smtplib.SMTPRecipientsRefused) -> bool:
    """Whether the relay refused the recipient as gone, e.g. "550 5.1.1 User unknown".

    Every other refusal stays retried: relays also answer policy refusals at
    RCPT ("554 5.7.1 Relay access denied"), and Postfix uses 5.1.0 for a
    rejected sender. Dropping those would lose every reminder.
    """
    for code, reply in err.recipients.values():
        m = _ADDRESS_STATUS.match(reply)
        if 500 <= code <= 599 and m and int(m[1]) != 0:
            return True
    return False


_Result = Literal["sent", "logged", "rejected", "failed"]


async def _notify(row, days: int) -> _Result:
    prefix, user_id = row["prefix"], row["user_id"]
    if not settings.SMTP_HOST or not settings.SMTP_FROM:
        logger.warning(
            "no mail transport configured, not sending the %d-day expiry reminder "
            "for API token %s of user %s",
            days, prefix, user_id,
        )
        return "logged"
    subject, body = build_expiry_message(
        name=row["name"],
        prefix=prefix,
        expires_at=parse_ts(row["expires_at"]),
        days=days,
        app_url=settings.APP_PUBLIC_URL,
    )
    try:
        await asyncio.to_thread(
            send_token_expiry_email, to_email=row["email"], subject=subject, body=body
        )
    except smtplib.SMTPRecipientsRefused as e:
        if _recipient_gone(e):
            # The relay would refuse it again on every run until the token expires.
            logger.warning(
                "%d-day expiry reminder for API token %s of user %s rejected by the relay, "
                "not retrying: %s",
                days, prefix, user_id, e,
            )
            return "rejected"
        logger.error(
            "%d-day expiry reminder for API token %s of user %s refused by the relay: %s",
            days, prefix, user_id, e,
        )
        return "failed"
    except InvalidRecipientError as e:
        # The address will not become valid; sending again cannot help.
        logger.warning(
            "%d-day expiry reminder for API token %s of user %s not sent, not retrying: %s",
            days, prefix, user_id, e,
        )
        return "rejected"
    except (smtplib.SMTPException, OSError) as e:
        logger.error(
            "send %d-day expiry reminder for API token %s of user %s: %s",
            days, prefix, user_id, e,
        )
        return "failed"
    except Exception:
        # Anything else, e.g. the stdlib header parser's AttributeError on a
        # malformed address, or a UnicodeEncodeError at login. An exception
        # escaping here would end this reminder run early (cleanup_old_files catches it).
        logger.exception(
            "send %d-day expiry reminder for API token %s of user %s", days, prefix, user_id
        )
        return "failed"
    return "sent"


async def send_expiry_reminders(db: Connection, *, now: datetime | None = None) -> dict[str, int]:
    """Send the expiry reminders due now; return how many ended in each outcome.

    Safe to run repeatedly: each (token, threshold) is recorded and skipped
    thereafter. Thresholds are handled narrowest first and a recorded notice
    also covers every wider one, so a token inside several windows, for
    instance after downtime, gets only the most urgent reminder, and at most
    one per run.
    """
    counts: dict[str, int] = {"sent": 0, "logged": 0, "rejected": 0, "failed": 0}
    if not settings.ENABLE_API_TOKENS:
        return counts
    now = now or datetime.now(timezone.utc)
    now_s = now.strftime(_TS_FORMAT)
    # Tokens whose reminder failed or was not recorded this run: a wider one
    # must not go out in its place if the relay recovers within the run.
    failed: set[str] = set()
    for days in THRESHOLDS:
        cursor = await db.execute(
            """
            SELECT t.id, t.user_id, t.name, t.prefix, t.created_at, t.expires_at, u.email
            FROM api_tokens t JOIN users u ON u.id = t.user_id
            WHERE t.revoked_at IS NULL
              AND t.expires_at > ? AND t.expires_at <= ?
              AND COALESCE(u.email, '') != ''
              AND NOT EXISTS (
                  SELECT 1 FROM api_token_expiry_notices n
                  WHERE n.token_id = t.id AND n.days_before <= ?
              )
            ORDER BY t.expires_at, t.id
            """,
            (now_s, (now + timedelta(days=days)).strftime(_TS_FORMAT), days),
        )
        for row in await cursor.fetchall():
            if row["id"] in failed or not is_relevant(
                parse_ts(row["created_at"]), parse_ts(row["expires_at"]), days
            ):
                continue
            result = await _notify(row, days)
            if result != "failed":
                # Without the record a wider threshold later in this run would
                # mail the token again.
                try:
                    await db.execute(
                        "INSERT OR IGNORE INTO api_token_expiry_notices (token_id, days_before, sent_at) "
                        "VALUES (?, ?, ?)",
                        (row["id"], days, now_s),
                    )
                    await db.commit()
                except sqlite3.Error as e:
                    logger.error(
                        "record %d-day expiry reminder for API token %s: %s", days, row["prefix"], e
                    )
                    result = "failed"
            if result == "failed":
                failed.add(row["id"])
            counts[result] += 1
            inc(api_token_expiry_reminders_total, result)
    return counts

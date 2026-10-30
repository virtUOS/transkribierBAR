import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from aiosqlite import Connection

from app.config import settings
from app.models import UserInfo
from app.services.token_expiry import expiry_warning


class TokenLimitError(Exception):
    """Raised when a user has reached the per-user token cap."""


class DuplicateTokenNameError(Exception):
    """Raised when a user already has an active token with the given name."""


def _now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def create_token(
    db: Connection,
    *,
    user_id: str,
    name: str,
    expires_in_days: int,
) -> dict:
    """Create a new API token for the given user.

    Returns a dict with keys: id, name, prefix, created_at, expires_at, token.
    Raises TokenLimitError if the user is at the cap.
    Raises DuplicateTokenNameError if an active token with this name already exists.
    """
    # Capture current time once for all queries and the INSERT
    now_dt = datetime.now(timezone.utc)
    now = now_dt.strftime("%Y-%m-%d %H:%M:%S")
    expires_at = (now_dt + timedelta(days=expires_in_days)).strftime(
        "%Y-%m-%d %H:%M:%S"
    )

    # Check per-user cap (count truly active tokens: non-revoked and non-expired)
    cursor = await db.execute(
        "SELECT COUNT(*) FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
        (user_id, now),
    )
    row = await cursor.fetchone()
    active_count = row[0]
    if active_count >= settings.API_TOKEN_MAX_PER_USER:
        raise TokenLimitError(
            f"User {user_id} has reached the maximum of {settings.API_TOKEN_MAX_PER_USER} active tokens"
        )

    # Check for duplicate name among active (non-revoked, non-expired) tokens
    cursor = await db.execute(
        "SELECT id FROM api_tokens WHERE user_id = ? AND name = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
        (user_id, name, now),
    )
    row = await cursor.fetchone()
    if row is not None:
        raise DuplicateTokenNameError(
            f"An active token named '{name}' already exists for this user"
        )

    # Generate token
    raw_token = "tw_" + secrets.token_urlsafe(32)
    prefix = raw_token[:12]
    token_hash = _hash_token(raw_token)
    token_id = str(uuid.uuid4())

    await db.execute(
        """
        INSERT INTO api_tokens (id, user_id, name, prefix, token_hash, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (token_id, user_id, name, prefix, token_hash, now, expires_at),
    )
    await db.commit()

    return {
        "id": token_id,
        "name": name,
        "prefix": prefix,
        "created_at": now,
        "expires_at": expires_at,
        "token": raw_token,
    }


async def list_tokens(db: Connection, *, user_id: str) -> list[dict]:
    """Return all tokens for the user. Never includes 'token' or 'token_hash' fields."""
    cursor = await db.execute(
        """
        SELECT id, name, prefix, created_at, expires_at, last_used_at, revoked_at
        FROM api_tokens
        WHERE user_id = ?
        ORDER BY created_at DESC
        """,
        (user_id,),
    )
    rows = await cursor.fetchall()
    now = datetime.now(timezone.utc)
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "prefix": row["prefix"],
            "created_at": row["created_at"],
            "expires_at": row["expires_at"],
            "last_used_at": row["last_used_at"],
            "revoked_at": row["revoked_at"],
            "expiry_warning": expiry_warning(
                created_at=row["created_at"],
                expires_at=row["expires_at"],
                revoked_at=row["revoked_at"],
                now=now,
            ),
        }
        for row in rows
    ]


async def revoke_token(db: Connection, *, user_id: str, token_id: str) -> bool:
    """Revoke a token. Returns True only if the row was updated (ownership match and not already revoked)."""
    now = _now_str()
    cursor = await db.execute(
        """
        UPDATE api_tokens
        SET revoked_at = ?
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL
        """,
        (now, token_id, user_id),
    )
    await db.commit()
    return cursor.rowcount > 0


async def resolve_token(
    db: Connection, *, raw_token: str
) -> tuple[UserInfo, str] | None:
    """Resolve a raw token string to a (UserInfo, token_id) tuple.

    Returns None if the token is invalid, expired, revoked, or unknown.
    """
    token_hash = _hash_token(raw_token)
    now = _now_str()

    cursor = await db.execute(
        """
        SELECT t.id, t.user_id, t.expires_at, t.revoked_at, u.email
        FROM api_tokens t
        JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ?
        """,
        (token_hash,),
    )
    row = await cursor.fetchone()

    if row is None:
        return None

    # Check revoked
    if row["revoked_at"] is not None:
        return None

    # Check expiry
    if row["expires_at"] is not None and row["expires_at"] <= now:
        return None

    user = UserInfo(id=row["user_id"], email=row["email"])
    return user, row["id"]


async def touch_last_used(db: Connection, *, token_id: str) -> None:
    """Update last_used_at to now for the given token."""
    now = _now_str()
    await db.execute(
        "UPDATE api_tokens SET last_used_at = ? WHERE id = ?",
        (now, token_id),
    )
    await db.commit()


async def cleanup_stale_tokens(db: Connection) -> int:
    """Hard-delete tokens revoked >30 days ago OR expired >90 days ago.

    Returns the number of tokens deleted.
    """
    now = datetime.now(timezone.utc)
    revoked_cutoff = (now - timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
    expired_cutoff = (now - timedelta(days=90)).strftime("%Y-%m-%d %H:%M:%S")

    cursor = await db.execute(
        """
        DELETE FROM api_tokens
        WHERE (revoked_at IS NOT NULL AND revoked_at < ?)
           OR (expires_at IS NOT NULL AND expires_at < ?)
        """,
        (revoked_cutoff, expired_cutoff),
    )
    await db.commit()
    return cursor.rowcount


async def count_active_tokens(db: Connection) -> int:
    """Return count of rows where revoked_at IS NULL and (expires_at IS NULL OR expires_at > now)."""
    now = _now_str()
    cursor = await db.execute(
        """
        SELECT COUNT(*) FROM api_tokens
        WHERE revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?)
        """,
        (now,),
    )
    row = await cursor.fetchone()
    return row[0]

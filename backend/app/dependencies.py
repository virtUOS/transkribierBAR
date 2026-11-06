import asyncio
import logging

from fastapi import HTTPException, Request

from app.config import settings
from app.database import get_db
from app.metrics import inc, auth_failures_total, api_token_auth_total, invitations_accepted_total
from app.models import UserInfo
from app.services.api_tokens import resolve_token, touch_last_used

logger = logging.getLogger(__name__)


async def _touch_best_effort(token_id: str) -> None:
    try:
        async with get_db() as db:
            await touch_last_used(db, token_id=token_id)
    except Exception as e:
        logger.warning("touch_last_used failed for %s: %s", token_id, e)


def _is_admin_email(email: str | None) -> bool:
    if not email:
        return False
    return email.strip().lower() in settings.ADMIN_EMAILS


async def _invitation_gate_allows(user_id: str, email: str | None) -> bool:
    """Return True iff INVITATION_MODE should let this request proceed.

    - Admins always allowed.
    - Existing users (row in `users` table) always allowed.
    - First-login users are allowed iff they have a pending-and-not-expired
      invitation for their email. Their pending invitation is marked accepted
      as a side effect (so subsequent logins also pass).
    - First-login users whose email already has an accepted invitation for a
      different sub (edge case: admin revoked + re-invited) are also allowed.
    """
    from app.services.invitations import (
        email_has_accepted_invitation, _now_str,
    )

    if _is_admin_email(email):
        return True

    async with get_db() as db:
        cursor = await db.execute("SELECT 1 FROM users WHERE id = ? LIMIT 1", (user_id,))
        if await cursor.fetchone() is not None:
            return True

        if not email:
            return False

        em = email.strip().lower()

        # Any pending, non-expired invitation → accept it on first login.
        cursor = await db.execute(
            """
            SELECT id FROM invitations
            WHERE email = ? AND status = 'pending' AND expires_at > ?
            ORDER BY created_at DESC LIMIT 1
            """,
            (em, _now_str()),
        )
        pending = await cursor.fetchone()
        if pending is not None:
            # Race note: two concurrent first-logins for the same email can both reach
            # here; the second UPDATE overwrites accepted_at/accepted_by_user_id. The
            # gate still allows both users through, so the functional outcome is correct;
            # only the audit trail reflects the later login. Acceptable given invitations
            # are admin-issued one-per-email.
            await db.execute(
                """
                UPDATE invitations
                SET status = 'accepted', accepted_at = ?, accepted_by_user_id = ?
                WHERE id = ?
                """,
                (_now_str(), user_id, pending["id"]),
            )
            await db.commit()
            inc(invitations_accepted_total)
            return True

        # Already-accepted invitation for this email (e.g. returning user
        # whose `users` row hasn't been created yet).
        if await email_has_accepted_invitation(db, email=em):
            return True

    return False


def api_token_from_header(authorization: str) -> str | None:
    """Return the raw `tw_…` token carried by an Authorization header value, else None.

    The scheme is compared case-insensitively (RFC 9110 §11.1); the token's `tw_`
    prefix is not. The reverse proxy's bypass rule for token requests matches the
    header the same way, so the two must be changed together.
    """
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    raw = parts[1].strip()
    return raw if raw.startswith("tw_") else None


async def get_current_user(request: Request) -> UserInfo:
    if settings.ENABLE_API_TOKENS:
        raw = api_token_from_header(request.headers.get("Authorization", ""))
        if raw is not None:
            async with get_db() as db:
                result = await resolve_token(db, raw_token=raw)
            if result is not None:
                user, token_id = result
                user.is_admin = _is_admin_email(user.email)
                inc(api_token_auth_total, "success")
                asyncio.create_task(_touch_best_effort(token_id))
                return user
            inc(api_token_auth_total, "failure")
            inc(auth_failures_total, "invalid_token")
            raise HTTPException(
                status_code=401,
                detail="Invalid or expired API token",
                headers={"WWW-Authenticate": 'Bearer realm="transkribierBAR"'},
            )

    user_id = request.headers.get("X-Auth-Request-User")
    email = request.headers.get("X-Auth-Request-Email")

    def _build(uid: str, em: str | None) -> UserInfo:
        return UserInfo(id=uid, email=em, is_admin=_is_admin_email(em))

    resolved: UserInfo | None = None
    if user_id:
        resolved = _build(user_id, email)
    elif email:
        resolved = _build(email, email)
    elif settings.DEV_MODE:
        resolved = _build("dev-user", "dev@localhost")

    if resolved is None:
        inc(auth_failures_total, "missing_headers")
        raise HTTPException(status_code=401, detail="Missing authentication headers")

    # NOTE: when DEV_MODE and INVITATION_MODE are both true, the synthesised
    # dev-user has no users row and no invitation, so requests will 403 unless
    # `dev@localhost` is added to ADMIN_EMAILS. This combination is uncommon.
    if settings.INVITATION_MODE:
        allowed = await _invitation_gate_allows(resolved.id, resolved.email)
        if not allowed:
            inc(auth_failures_total, "no_invitation")
            raise HTTPException(
                status_code=403,
                detail="No invitation found for this email. Ask your administrator.",
            )

    return resolved


async def get_session_user(request: Request) -> UserInfo:
    """Like get_current_user, but refuses API tokens.

    Used by endpoints that manage API tokens, so a token can never mint, list
    or revoke tokens.
    """
    if api_token_from_header(request.headers.get("Authorization", "")) is not None:
        raise HTTPException(
            status_code=403,
            detail="API tokens can't be used to manage API tokens.",
        )
    return await get_current_user(request)

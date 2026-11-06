import pytest
from httpx import AsyncClient, ASGITransport
from fastapi import FastAPI, Depends

from app.dependencies import get_current_user
from app.main import app
from app.models import UserInfo
from app.database import get_db
from app.services.api_tokens import create_token
from app import config as config_module


def _mini_app() -> FastAPI:
    app = FastAPI()

    @app.get("/whoami")
    async def whoami(user: UserInfo = Depends(get_current_user)):
        return {"id": user.id, "email": user.email}

    return app


@pytest.mark.asyncio
async def test_token_wins_over_headers(monkeypatch):
    monkeypatch.setattr(config_module.settings, "ENABLE_API_TOKENS", True)
    async with get_db() as db:
        await db.execute("INSERT INTO users (id, email) VALUES ('u1', 'u1@x')")
        await db.commit()
        t = await create_token(db, user_id="u1", name="k", expires_in_days=30)

    transport = ASGITransport(app=_mini_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.get(
            "/whoami",
            headers={
                "Authorization": f"Bearer {t['token']}",
                "X-Auth-Request-User": "someone-else",
            },
        )
    assert r.status_code == 200
    assert r.json()["id"] == "u1"


@pytest.mark.asyncio
async def test_invalid_token_returns_401_no_fallback(monkeypatch):
    monkeypatch.setattr(config_module.settings, "ENABLE_API_TOKENS", True)
    transport = ASGITransport(app=_mini_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.get(
            "/whoami",
            headers={
                "Authorization": "Bearer tw_notvalid",
                "X-Auth-Request-User": "headers-user",
            },
        )
    assert r.status_code == 401
    assert r.headers.get("www-authenticate", "").startswith("Bearer")


@pytest.mark.asyncio
async def test_headers_used_when_no_authorization(monkeypatch):
    monkeypatch.setattr(config_module.settings, "ENABLE_API_TOKENS", True)
    transport = ASGITransport(app=_mini_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.get(
            "/whoami",
            headers={"X-Auth-Request-User": "u1", "X-Auth-Request-Email": "u1@x"},
        )
    assert r.status_code == 200
    assert r.json()["id"] == "u1"


@pytest.mark.asyncio
async def test_token_ignored_when_flag_off(monkeypatch):
    monkeypatch.setattr(config_module.settings, "ENABLE_API_TOKENS", False)
    monkeypatch.setattr(config_module.settings, "DEV_MODE", False)
    transport = ASGITransport(app=_mini_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.get("/whoami", headers={"Authorization": "Bearer tw_anything"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_non_tw_bearer_falls_through(monkeypatch):
    """Future-compat: `Bearer jwt…` should not be swallowed as an invalid tw token."""
    monkeypatch.setattr(config_module.settings, "ENABLE_API_TOKENS", True)
    transport = ASGITransport(app=_mini_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.get(
            "/whoami",
            headers={"Authorization": "Bearer eyJ.jwt.token",
                     "X-Auth-Request-User": "u1"},
        )
    assert r.status_code == 200
    assert r.json()["id"] == "u1"


@pytest.mark.asyncio
async def test_bearer_scheme_is_case_insensitive(monkeypatch):
    """RFC 9110 §11.1: the scheme is case-insensitive, the token's tw_ prefix is not."""
    monkeypatch.setattr(config_module.settings, "ENABLE_API_TOKENS", True)
    async with get_db() as db:
        await db.execute("INSERT INTO users (id, email) VALUES ('u1', 'u1@x')")
        await db.commit()
        t = await create_token(db, user_id="u1", name="k", expires_in_days=30)

    transport = ASGITransport(app=_mini_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        lower = await c.get("/whoami", headers={"Authorization": f"bearer {t['token']}"})
        upper = await c.get("/whoami", headers={"Authorization": f"BEARER  {t['token']}"})
        invalid = await c.get(
            "/whoami",
            headers={"Authorization": "bearer tw_notvalid", "X-Auth-Request-User": "someone-else"},
        )
        upper_prefix = await c.get(
            "/whoami",
            headers={"Authorization": "Bearer TW_notatoken", "X-Auth-Request-User": "hdr-user"},
        )
    assert lower.status_code == 200 and lower.json()["id"] == "u1"
    assert upper.status_code == 200 and upper.json()["id"] == "u1"
    assert invalid.status_code == 401
    assert upper_prefix.status_code == 200 and upper_prefix.json()["id"] == "hdr-user"


@pytest.mark.asyncio
async def test_is_admin_true_when_email_in_admin_list(monkeypatch):
    monkeypatch.setattr(config_module.settings, "ADMIN_EMAILS", ["admin@example.com"])
    monkeypatch.setattr(config_module.settings, "INVITATION_MODE", False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        resp = await c.get(
            "/api/config",
            headers={
                "X-Auth-Request-User": "admin-id",
                "X-Auth-Request-Email": "Admin@Example.com",
            },
        )
    assert resp.status_code == 200
    # ConfigResponse.is_admin is exposed by Task 10; at Task 9 stage we
    # only confirm the request succeeded. The second (Task 10) test checks
    # the body.


@pytest.mark.asyncio
async def test_is_admin_false_when_email_missing(monkeypatch):
    monkeypatch.setattr(config_module.settings, "ADMIN_EMAILS", ["admin@example.com"])
    monkeypatch.setattr(config_module.settings, "INVITATION_MODE", False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        resp = await c.get(
            "/api/config",
            headers={
                "X-Auth-Request-User": "other-id",
                "X-Auth-Request-Email": "other@example.com",
            },
        )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_invitation_mode_blocks_first_login_without_invitation(monkeypatch):
    monkeypatch.setattr(config_module.settings, "INVITATION_MODE", True)
    monkeypatch.setattr(config_module.settings, "ADMIN_EMAILS", [])
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        resp = await c.get(
            "/api/config",
            headers={
                "X-Auth-Request-User": "sub-new",
                "X-Auth-Request-Email": "unknown@example.com",
            },
        )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_invitation_mode_allows_admin_without_invitation(monkeypatch):
    monkeypatch.setattr(config_module.settings, "INVITATION_MODE", True)
    monkeypatch.setattr(config_module.settings, "ADMIN_EMAILS", ["admin@example.com"])
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        resp = await c.get(
            "/api/config",
            headers={
                "X-Auth-Request-User": "sub-admin",
                "X-Auth-Request-Email": "admin@example.com",
            },
        )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_invitation_mode_allows_returning_user(monkeypatch):
    monkeypatch.setattr(config_module.settings, "INVITATION_MODE", True)
    monkeypatch.setattr(config_module.settings, "ADMIN_EMAILS", [])
    async with get_db() as db:
        await db.execute(
            "INSERT INTO users (id, email) VALUES (?, ?)",
            ("sub-existing", "existing@example.com"),
        )
        await db.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        resp = await c.get(
            "/api/config",
            headers={
                "X-Auth-Request-User": "sub-existing",
                "X-Auth-Request-Email": "existing@example.com",
            },
        )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_invitation_mode_accepts_pending_invitation_on_first_login(monkeypatch):
    from app.services.invitations import create_invitation
    monkeypatch.setattr(config_module.settings, "INVITATION_MODE", True)
    monkeypatch.setattr(config_module.settings, "ADMIN_EMAILS", [])
    async with get_db() as db:
        await create_invitation(
            db, email="invited@example.com", created_by="admin@example.com",
        )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        resp = await c.get(
            "/api/config",
            headers={
                "X-Auth-Request-User": "sub-invited",
                "X-Auth-Request-Email": "invited@example.com",
            },
        )
    assert resp.status_code == 200
    # Confirm the pending invitation was marked accepted.
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT status, accepted_by_user_id FROM invitations WHERE email = ?",
            ("invited@example.com",),
        )
        row = await cursor.fetchone()
    assert row["status"] == "accepted"
    assert row["accepted_by_user_id"] == "sub-invited"


@pytest.mark.asyncio
async def test_invitation_mode_allows_second_login_after_acceptance(monkeypatch):
    from app.services.invitations import create_invitation, accept_invitation
    monkeypatch.setattr(config_module.settings, "INVITATION_MODE", True)
    monkeypatch.setattr(config_module.settings, "ADMIN_EMAILS", [])
    async with get_db() as db:
        inv = await create_invitation(
            db, email="repeat@example.com", created_by="admin@example.com",
        )
        await accept_invitation(db, raw_token=inv["token"], user_id="sub-repeat")
    # No users row yet — accept_invitation only updates invitations.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        resp = await c.get(
            "/api/config",
            headers={
                "X-Auth-Request-User": "sub-repeat",
                "X-Auth-Request-Email": "repeat@example.com",
            },
        )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_config_response_includes_invitation_mode_and_is_admin(monkeypatch):
    monkeypatch.setattr(config_module.settings, "INVITATION_MODE", True)
    monkeypatch.setattr(config_module.settings, "ADMIN_EMAILS", ["a@example.com"])
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        resp = await c.get(
            "/api/config",
            headers={
                "X-Auth-Request-User": "sub-a",
                "X-Auth-Request-Email": "a@example.com",
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["invitation_mode"] is True
    assert body["is_admin"] is True


@pytest.mark.asyncio
async def test_config_response_is_admin_false_by_default(monkeypatch):
    monkeypatch.setattr(config_module.settings, "INVITATION_MODE", False)
    monkeypatch.setattr(config_module.settings, "ADMIN_EMAILS", [])
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        resp = await c.get(
            "/api/config",
            headers={
                "X-Auth-Request-User": "sub-x",
                "X-Auth-Request-Email": "x@example.com",
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["is_admin"] is False
    assert body["invitation_mode"] is False

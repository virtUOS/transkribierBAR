import pytest
import respx
from httpx import Response

from app.services.idp_admin import KeycloakAdminClient, KeycloakAdminError


@pytest.mark.asyncio
@respx.mock
async def test_acquire_admin_token():
    respx.post("https://kc.example.com/realms/master/protocol/openid-connect/token").mock(
        return_value=Response(200, json={"access_token": "tok-123", "expires_in": 60})
    )
    client = KeycloakAdminClient(
        base_url="https://kc.example.com",
        admin_realm="master",
        target_realm="app",
        client_id="admin-cli",
        client_secret="s3cret",
    )
    token = await client._get_admin_token()
    assert token == "tok-123"


@pytest.mark.asyncio
@respx.mock
async def test_create_user_returns_user_id_from_location_header():
    respx.post("https://kc.example.com/realms/master/protocol/openid-connect/token").mock(
        return_value=Response(200, json={"access_token": "tok-123", "expires_in": 60})
    )
    respx.post("https://kc.example.com/admin/realms/app/users").mock(
        return_value=Response(
            201,
            headers={"Location": "https://kc.example.com/admin/realms/app/users/abc-uuid"},
        )
    )
    client = KeycloakAdminClient(
        base_url="https://kc.example.com",
        admin_realm="master",
        target_realm="app",
        client_id="admin-cli",
        client_secret="s3cret",
    )
    uid = await client.create_user(email="x@example.com")
    assert uid == "abc-uuid"


@pytest.mark.asyncio
@respx.mock
async def test_create_user_raises_on_409_conflict():
    respx.post("https://kc.example.com/realms/master/protocol/openid-connect/token").mock(
        return_value=Response(200, json={"access_token": "tok-123", "expires_in": 60})
    )
    respx.post("https://kc.example.com/admin/realms/app/users").mock(
        return_value=Response(409, json={"errorMessage": "User exists"})
    )
    client = KeycloakAdminClient(
        base_url="https://kc.example.com",
        admin_realm="master",
        target_realm="app",
        client_id="admin-cli",
        client_secret="s3cret",
    )
    with pytest.raises(KeycloakAdminError) as exc:
        await client.create_user(email="x@example.com")
    assert "exists" in str(exc.value).lower()


@pytest.mark.asyncio
@respx.mock
async def test_execute_actions_email_posts_required_actions():
    respx.post("https://kc.example.com/realms/master/protocol/openid-connect/token").mock(
        return_value=Response(200, json={"access_token": "tok-123", "expires_in": 60})
    )
    route = respx.put(
        "https://kc.example.com/admin/realms/app/users/abc-uuid/execute-actions-email"
    ).mock(return_value=Response(204))
    client = KeycloakAdminClient(
        base_url="https://kc.example.com",
        admin_realm="master",
        target_realm="app",
        client_id="admin-cli",
        client_secret="s3cret",
    )
    await client.send_setup_email(
        user_id="abc-uuid",
        actions=["UPDATE_PASSWORD", "VERIFY_EMAIL"],
        redirect_uri="https://app.example.com/",
    )
    assert route.called
    req = route.calls.last.request
    import json as _json
    body = _json.loads(req.content)
    assert body == ["UPDATE_PASSWORD", "VERIFY_EMAIL"]


@pytest.mark.asyncio
@respx.mock
async def test_acquire_admin_token_wraps_connect_error():
    import httpx
    respx.post(
        "https://kc.example.com/realms/master/protocol/openid-connect/token"
    ).mock(side_effect=httpx.ConnectError("boom"))
    client = KeycloakAdminClient(
        base_url="https://kc.example.com",
        admin_realm="master",
        target_realm="app",
        client_id="admin-cli",
        client_secret="s3cret",
    )
    with pytest.raises(KeycloakAdminError) as exc:
        await client._get_admin_token()
    assert "ConnectError" in str(exc.value) or "boom" in str(exc.value).lower()


@pytest.mark.asyncio
@respx.mock
async def test_acquire_admin_token_wraps_malformed_json():
    respx.post(
        "https://kc.example.com/realms/master/protocol/openid-connect/token"
    ).mock(return_value=Response(200, text="not json"))
    client = KeycloakAdminClient(
        base_url="https://kc.example.com",
        admin_realm="master",
        target_realm="app",
        client_id="admin-cli",
        client_secret="s3cret",
    )
    with pytest.raises(KeycloakAdminError):
        await client._get_admin_token()


TOKEN_URL = "https://kc.example.com/realms/master/protocol/openid-connect/token"
USERS_URL = "https://kc.example.com/admin/realms/app/users"
EMAIL_URL = "https://kc.example.com/admin/realms/app/users/abc-uuid/execute-actions-email"


def _client():
    return KeycloakAdminClient(
        base_url="https://kc.example.com/", admin_realm="master", target_realm="app",
        client_id="admin-cli", client_secret="s3cret",
    )


@pytest.mark.asyncio
@respx.mock
async def test_admin_token_is_cached_until_near_expiry():
    route = respx.post(TOKEN_URL).mock(return_value=Response(200, json={"access_token": "tok-1", "expires_in": 300}))
    client = _client()
    assert await client._get_admin_token() == "tok-1"
    assert await client._get_admin_token() == "tok-1"
    assert route.call_count == 1
    req = route.calls.last.request
    assert b"grant_type=client_credentials" in req.content
    assert b"client_secret=s3cret" in req.content


@pytest.mark.asyncio
@respx.mock
async def test_admin_token_refetched_when_about_to_expire():
    route = respx.post(TOKEN_URL).mock(side_effect=[
        Response(200, json={"access_token": "tok-1", "expires_in": 5}),  # inside the 10s safety margin
        Response(200, json={"access_token": "tok-2", "expires_in": 300}),
    ])
    client = _client()
    assert await client._get_admin_token() == "tok-1"
    assert await client._get_admin_token() == "tok-2"
    assert route.call_count == 2


@pytest.mark.asyncio
@respx.mock
async def test_admin_token_non_200_raises():
    respx.post(TOKEN_URL).mock(return_value=Response(401, text="bad creds"))
    with pytest.raises(KeycloakAdminError, match="401"):
        await _client()._get_admin_token()


@pytest.mark.asyncio
@respx.mock
async def test_admin_token_missing_field_raises():
    respx.post(TOKEN_URL).mock(return_value=Response(200, json={"token_type": "bearer"}))
    with pytest.raises(KeycloakAdminError, match="KeyError"):
        await _client()._get_admin_token()


@pytest.mark.asyncio
@respx.mock
async def test_create_user_sends_unverified_user_with_bearer_token():
    respx.post(TOKEN_URL).mock(return_value=Response(200, json={"access_token": "tok-1", "expires_in": 60}))
    route = respx.post(USERS_URL).mock(return_value=Response(201, headers={"Location": f"{USERS_URL}/new-id/"}))
    assert await _client().create_user(email="x@example.com") == "new-id"
    req = route.calls.last.request
    assert req.headers["Authorization"] == "Bearer tok-1"
    import json as _json
    assert _json.loads(req.content) == {
        "email": "x@example.com", "username": "x@example.com", "enabled": True, "emailVerified": False,
    }


@pytest.mark.asyncio
@respx.mock
async def test_create_user_unexpected_status_raises():
    respx.post(TOKEN_URL).mock(return_value=Response(200, json={"access_token": "t", "expires_in": 60}))
    respx.post(USERS_URL).mock(return_value=Response(500, text="oops"))
    with pytest.raises(KeycloakAdminError, match="500"):
        await _client().create_user(email="x@example.com")


@pytest.mark.asyncio
@respx.mock
async def test_create_user_without_location_raises():
    respx.post(TOKEN_URL).mock(return_value=Response(200, json={"access_token": "t", "expires_in": 60}))
    respx.post(USERS_URL).mock(return_value=Response(201))
    with pytest.raises(KeycloakAdminError, match="no Location"):
        await _client().create_user(email="x@example.com")


@pytest.mark.asyncio
@respx.mock
async def test_create_user_wraps_transport_error():
    import httpx
    respx.post(TOKEN_URL).mock(return_value=Response(200, json={"access_token": "t", "expires_in": 60}))
    respx.post(USERS_URL).mock(side_effect=httpx.ReadTimeout("slow"))
    with pytest.raises(KeycloakAdminError, match="ReadTimeout"):
        await _client().create_user(email="x@example.com")


@pytest.mark.asyncio
@respx.mock
async def test_create_user_propagates_token_failure():
    respx.post(TOKEN_URL).mock(return_value=Response(503))
    users = respx.post(USERS_URL)
    with pytest.raises(KeycloakAdminError, match="Token acquire failed"):
        await _client().create_user(email="x@example.com")
    assert not users.called


@pytest.mark.asyncio
@respx.mock
async def test_send_setup_email_passes_redirect_and_client():
    respx.post(TOKEN_URL).mock(return_value=Response(200, json={"access_token": "t", "expires_in": 60}))
    route = respx.put(EMAIL_URL).mock(return_value=Response(200))
    await _client().send_setup_email(user_id="abc-uuid", actions=["VERIFY_EMAIL"], redirect_uri="https://app/")
    params = route.calls.last.request.url.params
    assert params["redirect_uri"] == "https://app/"
    assert params["client_id"] == "account"


@pytest.mark.asyncio
@respx.mock
async def test_send_setup_email_failure_status_raises():
    respx.post(TOKEN_URL).mock(return_value=Response(200, json={"access_token": "t", "expires_in": 60}))
    respx.put(EMAIL_URL).mock(return_value=Response(400, text="smtp not configured"))
    with pytest.raises(KeycloakAdminError, match="400"):
        await _client().send_setup_email(user_id="abc-uuid", actions=[], redirect_uri="https://app/")


@pytest.mark.asyncio
@respx.mock
async def test_send_setup_email_wraps_transport_error():
    import httpx
    respx.post(TOKEN_URL).mock(return_value=Response(200, json={"access_token": "t", "expires_in": 60}))
    respx.put(EMAIL_URL).mock(side_effect=httpx.ConnectError("refused"))
    with pytest.raises(KeycloakAdminError, match="ConnectError"):
        await _client().send_setup_email(user_id="abc-uuid", actions=[], redirect_uri="https://app/")


def test_build_default_client_depends_on_admin_url(monkeypatch):
    from app.config import settings
    from app.services.idp_admin import build_default_client
    monkeypatch.setattr(settings, "KEYCLOAK_ADMIN_URL", "")
    assert build_default_client() is None
    monkeypatch.setattr(settings, "KEYCLOAK_ADMIN_URL", "https://kc.example.com")
    assert isinstance(build_default_client(), KeycloakAdminClient)

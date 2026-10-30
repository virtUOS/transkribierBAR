import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.database import init_db, get_db

DEV_HEADERS = {"X-Auth-Request-User": "test-user", "X-Auth-Request-Email": "test@test.com"}

TEST_USERS = ["test-user", "user-a", "user-b"]


@pytest_asyncio.fixture
async def client(tmp_path):
    db_path = str(tmp_path / "test.db")
    await init_db(db_path)
    # Pre-insert users to satisfy the FK constraint on user_id columns
    async with get_db() as db:
        for user_id in TEST_USERS:
            await db.execute(
                "INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)",
                (user_id, f"{user_id}@test.com"),
            )
        await db.commit()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_transcription_preset_crud(client):
    # Create
    resp = await client.post("/api/presets/transcription", json={"name": "Lecture DE", "language": "de", "model": "large-v3"}, headers=DEV_HEADERS)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Lecture DE"
    assert data["language"] == "de"
    preset_id = data["id"]

    # List
    resp = await client.get("/api/presets/transcription", headers=DEV_HEADERS)
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    # Update
    resp = await client.put(f"/api/presets/transcription/{preset_id}", json={"name": "Lecture DE v2", "language": "de", "model": "large-v3-turbo"}, headers=DEV_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Lecture DE v2"

    # Delete
    resp = await client.delete(f"/api/presets/transcription/{preset_id}", headers=DEV_HEADERS)
    assert resp.status_code == 200

    # Verify deleted
    resp = await client.get("/api/presets/transcription", headers=DEV_HEADERS)
    assert len(resp.json()) == 0


@pytest.mark.asyncio
async def test_analysis_preset_crud(client):
    resp = await client.post("/api/presets/analysis", json={"name": "Summary EN", "template": "summary", "language": "en"}, headers=DEV_HEADERS)
    assert resp.status_code == 201
    preset_id = resp.json()["id"]

    resp = await client.get("/api/presets/analysis", headers=DEV_HEADERS)
    assert len(resp.json()) == 1

    resp = await client.delete(f"/api/presets/analysis/{preset_id}", headers=DEV_HEADERS)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_refinement_preset_crud(client):
    resp = await client.post("/api/presets/refinement", json={"name": "CS Lecture", "context": "Computer science lecture"}, headers=DEV_HEADERS)
    assert resp.status_code == 201
    preset_id = resp.json()["id"]

    resp = await client.get("/api/presets/refinement", headers=DEV_HEADERS)
    assert len(resp.json()) == 1

    resp = await client.delete(f"/api/presets/refinement/{preset_id}", headers=DEV_HEADERS)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_bundle_crud_and_default(client):
    # Create a transcription preset first
    resp = await client.post("/api/presets/transcription", json={"name": "T1"}, headers=DEV_HEADERS)
    t_id = resp.json()["id"]

    # Create bundle
    resp = await client.post("/api/presets/bundles", json={"name": "My Workflow", "transcription_preset_id": t_id}, headers=DEV_HEADERS)
    assert resp.status_code == 201
    bundle_id = resp.json()["id"]
    assert resp.json()["is_default"] is False

    # Set default
    resp = await client.put(f"/api/presets/bundles/{bundle_id}/default", headers=DEV_HEADERS)
    assert resp.status_code == 200

    # Get default (expanded)
    resp = await client.get("/api/presets/default", headers=DEV_HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_default"] is True
    assert data["transcription_preset"]["name"] == "T1"

    # Clear default
    resp = await client.delete("/api/presets/default", headers=DEV_HEADERS)
    assert resp.status_code == 200

    resp = await client.get("/api/presets/default", headers=DEV_HEADERS)
    assert resp.json() is None

    # Delete bundle
    resp = await client.delete(f"/api/presets/bundles/{bundle_id}", headers=DEV_HEADERS)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_delete_preset_nullifies_bundle_reference(client):
    # Create preset and bundle referencing it
    resp = await client.post("/api/presets/transcription", json={"name": "T1"}, headers=DEV_HEADERS)
    t_id = resp.json()["id"]
    await client.post("/api/presets/bundles", json={"name": "Bundle", "transcription_preset_id": t_id}, headers=DEV_HEADERS)

    # Delete the preset
    await client.delete(f"/api/presets/transcription/{t_id}", headers=DEV_HEADERS)

    # Bundle should still exist but with null reference
    resp = await client.get("/api/presets/bundles", headers=DEV_HEADERS)
    bundles = resp.json()
    assert len(bundles) == 1
    assert bundles[0]["transcription_preset_id"] is None


@pytest.mark.asyncio
async def test_user_isolation(client):
    # Create preset as user A
    resp = await client.post("/api/presets/transcription", json={"name": "A preset"}, headers={"X-Auth-Request-User": "user-a"})
    assert resp.status_code == 201

    # User B should not see it
    resp = await client.get("/api/presets/transcription", headers={"X-Auth-Request-User": "user-b"})
    assert len(resp.json()) == 0


@pytest.mark.asyncio
async def test_bundle_rejects_foreign_preset(client):
    # Each preset type, when referenced by another user's bundle, must 404.
    a = {"X-Auth-Request-User": "user-a"}
    b = {"X-Auth-Request-User": "user-b"}

    tp = (await client.post("/api/presets/transcription", json={"name": "A tp"}, headers=a)).json()["id"]
    ap = (await client.post("/api/presets/analysis", json={"name": "A ap", "template": "summary"}, headers=a)).json()["id"]
    rp = (await client.post("/api/presets/refinement", json={"name": "A rp"}, headers=a)).json()["id"]

    for field, value in [("transcription_preset_id", tp), ("analysis_preset_id", ap), ("refinement_preset_id", rp)]:
        resp = await client.post(
            "/api/presets/bundles",
            json={"name": "B bundle", field: value},
            headers=b,
        )
        assert resp.status_code == 404, f"{field} should be rejected across users"

    # Update must reject the same way.
    own_tp = (await client.post("/api/presets/transcription", json={"name": "B tp"}, headers=b)).json()["id"]
    bundle_id = (await client.post("/api/presets/bundles", json={"name": "B bundle", "transcription_preset_id": own_tp}, headers=b)).json()["id"]
    resp = await client.put(
        f"/api/presets/bundles/{bundle_id}",
        json={"name": "B bundle", "analysis_preset_id": ap},
        headers=b,
    )
    assert resp.status_code == 404


A = {"X-Auth-Request-User": "user-a"}
B = {"X-Auth-Request-User": "user-b"}

_PRESET_BODIES = {
    "transcription": {"name": "T", "language": "de", "model": "large-v3", "min_speakers": 2, "max_speakers": 4,
                      "initial_prompt": "Vorlesung", "hotwords": "Osnabrück"},
    "analysis": {"name": "An", "template": "agenda", "agenda": "1. Budget", "language": "en",
                 "chapter_hints": [{"title": "Intro"}, {"description": "Q&A"}]},
    "refinement": {"name": "R", "context": "Physics lecture"},
}


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", list(_PRESET_BODIES))
async def test_preset_get_by_id_round_trips_all_fields(client, kind):
    body = _PRESET_BODIES[kind]
    created = (await client.post(f"/api/presets/{kind}", json=body, headers=A)).json()
    resp = await client.get(f"/api/presets/{kind}/{created['id']}", headers=A)
    assert resp.status_code == 200
    data = resp.json()
    for key, value in body.items():
        if key == "chapter_hints":
            assert data[key] == [{"title": "Intro", "description": None}, {"title": None, "description": "Q&A"}]
        else:
            assert data[key] == value


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", list(_PRESET_BODIES))
async def test_preset_is_invisible_and_immutable_for_other_users(client, kind):
    body = _PRESET_BODIES[kind]
    preset_id = (await client.post(f"/api/presets/{kind}", json=body, headers=A)).json()["id"]

    assert (await client.get(f"/api/presets/{kind}/{preset_id}", headers=B)).status_code == 404
    assert (await client.put(f"/api/presets/{kind}/{preset_id}", json={**body, "name": "hijack"}, headers=B)).status_code == 404
    assert (await client.delete(f"/api/presets/{kind}/{preset_id}", headers=B)).status_code == 404

    own = await client.get(f"/api/presets/{kind}/{preset_id}", headers=A)
    assert own.status_code == 200
    assert own.json()["name"] == body["name"]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", list(_PRESET_BODIES))
async def test_preset_unknown_id_is_404(client, kind):
    body = _PRESET_BODIES[kind]
    assert (await client.get(f"/api/presets/{kind}/missing", headers=A)).status_code == 404
    assert (await client.put(f"/api/presets/{kind}/missing", json=body, headers=A)).status_code == 404
    assert (await client.delete(f"/api/presets/{kind}/missing", headers=A)).status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", list(_PRESET_BODIES))
async def test_preset_requires_name(client, kind):
    body = {k: v for k, v in _PRESET_BODIES[kind].items() if k != "name"}
    assert (await client.post(f"/api/presets/{kind}", json=body, headers=A)).status_code == 422


@pytest.mark.asyncio
async def test_analysis_preset_rejects_empty_chapter_hint(client):
    resp = await client.post("/api/presets/analysis", json={"name": "x", "chapter_hints": [{}]}, headers=A)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_analysis_preset_update_can_clear_chapter_hints(client):
    preset_id = (await client.post("/api/presets/analysis", json=_PRESET_BODIES["analysis"], headers=A)).json()["id"]
    resp = await client.put(f"/api/presets/analysis/{preset_id}", json={"name": "An2", "template": "summary"}, headers=A)
    assert resp.status_code == 200
    assert resp.json()["chapter_hints"] is None
    assert resp.json()["agenda"] is None
    assert resp.json()["name"] == "An2"


@pytest.mark.asyncio
async def test_refinement_preset_update(client):
    preset_id = (await client.post("/api/presets/refinement", json={"name": "R"}, headers=A)).json()["id"]
    resp = await client.put(f"/api/presets/refinement/{preset_id}", json={"name": "R2", "context": "Chemistry"}, headers=A)
    assert resp.status_code == 200
    assert resp.json()["context"] == "Chemistry"
    listed = (await client.get("/api/presets/refinement", headers=A)).json()
    assert [p["name"] for p in listed] == ["R2"]


@pytest.mark.asyncio
async def test_bundle_is_invisible_and_immutable_for_other_users(client):
    bundle_id = (await client.post("/api/presets/bundles", json={"name": "A's"}, headers=A)).json()["id"]

    assert (await client.get(f"/api/presets/bundles/{bundle_id}", headers=B)).status_code == 404
    assert (await client.put(f"/api/presets/bundles/{bundle_id}", json={"name": "hijack"}, headers=B)).status_code == 404
    assert (await client.put(f"/api/presets/bundles/{bundle_id}/default", headers=B)).status_code == 404
    assert (await client.delete(f"/api/presets/bundles/{bundle_id}", headers=B)).status_code == 404
    assert (await client.get("/api/presets/bundles", headers=B)).json() == []

    own = await client.get(f"/api/presets/bundles/{bundle_id}", headers=A)
    assert own.status_code == 200
    assert own.json()["name"] == "A's"
    assert own.json()["is_default"] is False


@pytest.mark.asyncio
async def test_bundle_unknown_id_is_404(client):
    assert (await client.get("/api/presets/bundles/missing", headers=A)).status_code == 404
    assert (await client.put("/api/presets/bundles/missing", json={"name": "x"}, headers=A)).status_code == 404
    assert (await client.delete("/api/presets/bundles/missing", headers=A)).status_code == 404
    assert (await client.put("/api/presets/bundles/missing/default", headers=A)).status_code == 404


@pytest.mark.asyncio
async def test_bundle_update_replaces_references(client):
    tp = (await client.post("/api/presets/transcription", json={"name": "T"}, headers=A)).json()["id"]
    rp = (await client.post("/api/presets/refinement", json={"name": "R"}, headers=A)).json()["id"]
    bundle_id = (await client.post("/api/presets/bundles", json={"name": "B", "transcription_preset_id": tp}, headers=A)).json()["id"]

    resp = await client.put(
        f"/api/presets/bundles/{bundle_id}",
        json={"name": "B2", "refinement_preset_id": rp, "translate_language": "en"},
        headers=A,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "B2"
    assert data["transcription_preset_id"] is None
    assert data["refinement_preset_id"] == rp
    assert data["translate_language"] == "en"


@pytest.mark.asyncio
async def test_only_one_default_bundle_per_user(client):
    first = (await client.post("/api/presets/bundles", json={"name": "first"}, headers=A)).json()["id"]
    second = (await client.post("/api/presets/bundles", json={"name": "second"}, headers=A)).json()["id"]
    b_bundle = (await client.post("/api/presets/bundles", json={"name": "B's"}, headers=B)).json()["id"]
    await client.put(f"/api/presets/bundles/{b_bundle}/default", headers=B)

    await client.put(f"/api/presets/bundles/{first}/default", headers=A)
    resp = await client.put(f"/api/presets/bundles/{second}/default", headers=A)
    assert resp.json()["is_default"] is True

    defaults = {b["id"]: b["is_default"] for b in (await client.get("/api/presets/bundles", headers=A)).json()}
    assert defaults == {first: False, second: True}
    # Another user's default is untouched by A's changes
    assert (await client.get("/api/presets/default", headers=B)).json()["id"] == b_bundle

    # Clearing A's default leaves B's alone
    await client.delete("/api/presets/default", headers=A)
    assert (await client.get("/api/presets/default", headers=A)).json() is None
    assert (await client.get("/api/presets/default", headers=B)).json()["id"] == b_bundle


@pytest.mark.asyncio
async def test_default_bundle_expands_all_presets(client):
    tp = (await client.post("/api/presets/transcription", json=_PRESET_BODIES["transcription"], headers=A)).json()["id"]
    ap = (await client.post("/api/presets/analysis", json=_PRESET_BODIES["analysis"], headers=A)).json()["id"]
    rp = (await client.post("/api/presets/refinement", json=_PRESET_BODIES["refinement"], headers=A)).json()["id"]
    bundle_id = (await client.post("/api/presets/bundles", json={
        "name": "Full", "transcription_preset_id": tp, "analysis_preset_id": ap,
        "refinement_preset_id": rp, "translate_language": "fr",
    }, headers=A)).json()["id"]
    await client.put(f"/api/presets/bundles/{bundle_id}/default", headers=A)

    data = (await client.get("/api/presets/default", headers=A)).json()
    assert data["id"] == bundle_id
    assert data["translate_language"] == "fr"
    assert data["transcription_preset"]["hotwords"] == "Osnabrück"
    assert data["analysis_preset"]["agenda"] == "1. Budget"
    assert data["analysis_preset"]["chapter_hints"][0]["title"] == "Intro"
    assert data["refinement_preset"]["context"] == "Physics lecture"


@pytest.mark.asyncio
async def test_default_bundle_with_deleted_presets_expands_to_none(client):
    ap = (await client.post("/api/presets/analysis", json={"name": "a"}, headers=A)).json()["id"]
    rp = (await client.post("/api/presets/refinement", json={"name": "r"}, headers=A)).json()["id"]
    bundle_id = (await client.post("/api/presets/bundles", json={
        "name": "B", "analysis_preset_id": ap, "refinement_preset_id": rp,
    }, headers=A)).json()["id"]
    await client.put(f"/api/presets/bundles/{bundle_id}/default", headers=A)
    await client.delete(f"/api/presets/analysis/{ap}", headers=A)
    await client.delete(f"/api/presets/refinement/{rp}", headers=A)

    data = (await client.get("/api/presets/default", headers=A)).json()
    assert data["analysis_preset_id"] is None and data["analysis_preset"] is None
    assert data["refinement_preset_id"] is None and data["refinement_preset"] is None


@pytest.mark.asyncio
async def test_deleting_default_bundle_leaves_no_default(client):
    bundle_id = (await client.post("/api/presets/bundles", json={"name": "B"}, headers=A)).json()["id"]
    await client.put(f"/api/presets/bundles/{bundle_id}/default", headers=A)
    await client.delete(f"/api/presets/bundles/{bundle_id}", headers=A)
    assert (await client.get("/api/presets/default", headers=A)).json() is None

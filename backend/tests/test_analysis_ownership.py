"""Another user's transcription must look like a missing one, even mid-analysis."""
import json

import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch

from app.main import app

TXN_ID = "test-analysis-ownership"


async def _seed(client):
    upload_resp = await client.post(
        "/api/upload",
        files={"file": ("t.mp3", b"x", "audio/mpeg")},
        headers={"X-Auth-Request-User": "owner"},
    )
    file_id = upload_resp.json()["id"]
    from app.database import get_db
    async with get_db() as db:
        utterances = json.dumps([{"start": 0, "end": 1000, "text": "hello", "speaker": "A"}])
        await db.execute(
            """INSERT INTO transcriptions
               (id, user_id, file_id, asr_backend, status, language, result_json)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (TXN_ID, "owner", file_id, "murmurai", "completed", "en", utterances),
        )
        await db.execute(
            "INSERT INTO analyses (id, transcription_id, analysis_json) VALUES (?, ?, NULL)",
            ("placeholder", TXN_ID),
        )
        await db.commit()


@pytest.mark.asyncio
async def test_other_user_gets_404_while_owner_analysis_runs():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await _seed(client)
        with patch("app.routers.analysis.get_llm_provider", return_value=AsyncMock()):
            other = await client.post(
                f"/api/analysis/{TXN_ID}", json={"template": "summary"},
                headers={"X-Auth-Request-User": "intruder"},
            )
            owner = await client.post(
                f"/api/analysis/{TXN_ID}", json={"template": "summary"},
                headers={"X-Auth-Request-User": "owner"},
            )
    assert other.status_code == 404
    assert owner.status_code == 429

"""The JSON export must use renamed speakers like txt, srt and vtt do."""
import json

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

TXN_ID = "test-export-json-speakers"


@pytest.mark.asyncio
async def test_json_export_applies_speaker_mapping():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        upload = await client.post("/api/upload", files={"file": ("t.mp3", b"x", "audio/mpeg")})
        file_id = upload.json()["id"]
        from app.database import get_db
        async with get_db() as db:
            row = await (await db.execute("SELECT user_id FROM files WHERE id = ?", (file_id,))).fetchone()
            utterances = json.dumps([
                {"start": 0, "end": 1000, "text": "one", "speaker": "SPEAKER_00"},
                {"start": 1000, "end": 2000, "text": "two", "speaker": "SPEAKER_01"},
            ])
            await db.execute(
                """INSERT INTO transcriptions
                   (id, user_id, file_id, asr_backend, status, language, result_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (TXN_ID, row[0], file_id, "murmurai", "completed", "en", utterances),
            )
            await db.commit()

        put = await client.put(
            f"/api/transcription/{TXN_ID}/speakers",
            json={"mappings": {"SPEAKER_00": "Alice"}},
        )
        assert put.status_code == 200
        resp = await client.get(f"/api/transcription/{TXN_ID}/export/json")

    assert resp.status_code == 200
    speakers = [u["speaker"] for u in resp.json()]
    assert speakers == ["Alice", "SPEAKER_01"]

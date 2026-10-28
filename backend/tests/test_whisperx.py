import httpx
import pytest
import respx

from app.config import settings
from app.services.asr.base import TranscriptionSettings
from app.services.asr.whisperx import WhisperXBackend

URL = "http://asr.test/v1/audio/transcriptions"

PAYLOAD = {"text": "Hallo Welt", "language": "de", "segments": [
    {"start": 0.0, "end": 1.25, "text": " Hallo ", "speaker": "SPEAKER_00", "words": []},
    {"start": 1.25, "end": 2.5, "text": "Welt"},
]}


@pytest.fixture
def backend(monkeypatch):
    monkeypatch.setattr(settings, "ASR_URL", "http://asr.test")
    monkeypatch.setattr(settings, "ASR_API_KEY", "tw-key")
    return WhisperXBackend()


@pytest.fixture
def audio(tmp_path):
    p = tmp_path / "a.mp3"
    p.write_bytes(b"abc123")
    return str(p)


def _ts(**kw):
    return TranscriptionSettings(language="de", model="large-v3", **kw)


def test_form_data_full():
    ts = TranscriptionSettings(language="de", model="large-v3", min_speakers=1, max_speakers=3,
                               initial_prompt="Kontext", hotwords="Osnabrück")
    assert WhisperXBackend._form_data(ts) == {
        "model": "large-v3", "language": "de", "prompt": "Kontext", "hotwords": "Osnabrück",
        "response_format": "verbose_json", "align": "true", "suppress_numerals": "false",
        "diarize": "true", "min_speakers": "1", "max_speakers": "3",
    }


def test_form_data_auto_language_no_diarize():
    data = WhisperXBackend._form_data(TranscriptionSettings(language="auto", model="large-v3-turbo"))
    assert set(data) == {"model", "response_format", "align", "suppress_numerals", "diarize"}
    assert data["diarize"] == "false"


def test_form_data_min_only():
    data = WhisperXBackend._form_data(TranscriptionSettings(model="large-v3", min_speakers=2, max_speakers=0))
    assert data["min_speakers"] == "2"
    assert "max_speakers" not in data
    assert data["diarize"] == "true"


def test_timeout_for():
    t = WhisperXBackend._timeout_for(TranscriptionSettings(job_timeout=3600.0))
    assert (t.read, t.write, t.connect) == (3600.0, 3600.0, 30.0)
    assert WhisperXBackend._timeout_for(TranscriptionSettings(job_timeout=None)).read == 600.0


@pytest.mark.asyncio
async def test_submit_sends_bearer_and_request_id(backend, audio):
    with respx.mock:
        route = respx.post(URL).mock(return_value=httpx.Response(200, json=PAYLOAD))
        await backend.submit(audio, _ts(request_id="txn-1"))
        request = route.calls.last.request
        await request.aread()
    assert request.headers["Authorization"] == "Bearer tw-key"
    assert request.headers["X-Request-ID"] == "txn-1"
    assert b'name="suppress_numerals"\r\n\r\nfalse' in request.content


@pytest.mark.asyncio
async def test_submit_without_key_sends_no_auth_header(backend, audio, monkeypatch):
    monkeypatch.setattr(settings, "ASR_API_KEY", "")
    backend = WhisperXBackend()
    with respx.mock:
        route = respx.post(URL).mock(return_value=httpx.Response(200, json=PAYLOAD))
        await backend.submit(audio, _ts())
        request = route.calls.last.request
    assert "Authorization" not in request.headers


@pytest.mark.asyncio
async def test_result_parsing(backend, audio):
    with respx.mock:
        respx.post(URL).mock(return_value=httpx.Response(200, json=PAYLOAD))
        job = await backend.submit(audio, _ts())
    assert (await backend.get_status(job)).status == "completed"
    result = await backend.get_result(job)
    assert [(u.start, u.end, u.text, u.speaker) for u in result.utterances] == [
        (0, 1250, "Hallo", "SPEAKER_00"), (1250, 2500, "Welt", None)]
    assert result.text == "Hallo Welt"
    assert result.language == "de"


@pytest.mark.asyncio
async def test_text_fallback_joins_segments(backend, audio):
    payload = {"segments": PAYLOAD["segments"]}
    with respx.mock:
        respx.post(URL).mock(return_value=httpx.Response(200, json=payload))
        job = await backend.submit(audio, _ts())
    assert (await backend.get_result(job)).text == "Hallo Welt"


@pytest.mark.asyncio
async def test_segment_missing_fields_defaults(backend, audio):
    with respx.mock:
        respx.post(URL).mock(return_value=httpx.Response(200, json={"segments": [{"text": "x"}]}))
        job = await backend.submit(audio, _ts())
    result = await backend.get_result(job)
    assert [(u.start, u.end, u.text, u.speaker) for u in result.utterances] == [(0, 0, "x", None)]


@pytest.mark.asyncio
async def test_http_status_error_becomes_failed_job(backend, audio):
    with respx.mock:
        respx.post(URL).mock(return_value=httpx.Response(
            422, json={"detail": "max_speakers must be >= min_speakers"}))
        job = await backend.submit(audio, _ts())
    status = await backend.get_status(job)
    assert status.status == "failed"
    assert status.error == "max_speakers must be >= min_speakers"


@pytest.mark.asyncio
async def test_http_status_error_without_detail(backend, audio):
    with respx.mock:
        respx.post(URL).mock(return_value=httpx.Response(503, text="busy"))
        job = await backend.submit(audio, _ts())
    assert (await backend.get_status(job)).error == "ASR server returned HTTP 503"


@pytest.mark.asyncio
async def test_transport_error_propagates(backend, audio):
    with respx.mock:
        respx.post(URL).mock(side_effect=httpx.ConnectError("boom"))
        with pytest.raises(httpx.ConnectError):
            await backend.submit(audio, _ts())


@pytest.mark.asyncio
async def test_read_timeout_raises_timeout_error(backend, audio):
    with respx.mock:
        respx.post(URL).mock(side_effect=httpx.ReadTimeout("slow"))
        with pytest.raises(TimeoutError):
            await backend.submit(audio, _ts())


@pytest.mark.asyncio
async def test_cleanup_is_noop(backend):
    with respx.mock:
        assert await backend.cleanup("x") is None
        assert len(respx.calls) == 0

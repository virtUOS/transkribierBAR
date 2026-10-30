import pytest
from app.services.asr.base import ASRBackend

def test_asr_backend_is_abstract():
    with pytest.raises(TypeError):
        ASRBackend()


@pytest.mark.asyncio
async def test_cleanup_defaults_to_noop():
    """Backends that keep nothing on the remote side inherit a cleanup() that does nothing."""

    class Minimal(ASRBackend):
        async def submit(self, file_path, settings):
            return "job"

        async def get_status(self, job_id):
            raise NotImplementedError

        async def get_result(self, job_id):
            raise NotImplementedError

    assert await Minimal().cleanup("job") is None


def test_transcription_settings_carries_timeout_and_request_id():
    from app.services.asr.base import TranscriptionSettings
    assert TranscriptionSettings().job_timeout is None
    assert TranscriptionSettings().request_id is None
    ts = TranscriptionSettings(job_timeout=3600.0, request_id="txn-1")
    assert (ts.job_timeout, ts.request_id) == (3600.0, "txn-1")

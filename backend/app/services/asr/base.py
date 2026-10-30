import asyncio
from abc import ABC, abstractmethod
from app.config import settings
from app.models import TranscriptionStatus, TranscriptionResult

# Shared across all ASR backends so ASR_MAX_CONCURRENT actually caps in-flight jobs
# regardless of which backend is selected. Backends whose submit() returns immediately
# (murmurai) must hold this for the whole submit-through-completion window, not just
# the submit call — otherwise the limit caps nothing.
asr_semaphore = asyncio.Semaphore(settings.ASR_MAX_CONCURRENT)


class TranscriptionSettings:
    def __init__(self, language=None, model="base", min_speakers=0, max_speakers=0, initial_prompt=None, hotwords=None,
                 job_timeout=None, request_id=None):
        self.language = language
        self.model = model
        self.min_speakers = min_speakers
        self.max_speakers = max_speakers
        self.initial_prompt = initial_prompt
        self.hotwords = hotwords
        self.job_timeout = job_timeout
        self.request_id = request_id


class ASRBackend(ABC):
    @abstractmethod
    async def submit(self, file_path: str, settings: TranscriptionSettings) -> str:
        """Submit a transcription job. Returns backend-specific job ID."""

    @abstractmethod
    async def get_status(self, job_id: str) -> TranscriptionStatus:
        """Get job status."""

    @abstractmethod
    async def get_result(self, job_id: str) -> TranscriptionResult:
        """Get the transcription result."""

    async def cleanup(self, job_id: str) -> None:
        """Delete whatever the backend still holds for a finished job.

        Called once the app has stored the result, or has given up on the job, so
        the remote copy of a transcript does not outlive the user's own. Must never
        raise: a failed cleanup is logged, not surfaced as a transcription failure.
        Backends that keep nothing remote inherit this no-op.
        """
        return None

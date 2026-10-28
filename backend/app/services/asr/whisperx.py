import os
import uuid
import httpx
from app.config import settings
from app.metrics import inc, errors_total
from app.services.asr.base import ASRBackend, TranscriptionSettings
from app.models import TranscriptionStatus, TranscriptionResult, Utterance

CONNECT_TIMEOUT = 30.0
# Read/write timeout when the caller supplies no job_timeout.
DEFAULT_READ_TIMEOUT = 600.0

# In-memory cache for WhisperX results. WhisperX is synchronous, so submit() blocks
# until complete — the result is stored in the DB by _run_transcription() immediately
# after submit() returns. These dicts are only used during the brief poll loop between
# submit() returning and _run_transcription() reading get_result().
_results: dict[str, TranscriptionResult] = {}
_statuses: dict[str, str] = {}
_errors: dict[str, str] = {}


class WhisperXBackend(ASRBackend):
    def __init__(self):
        self.base_url = settings.ASR_URL
        self.api_key = settings.ASR_API_KEY

    async def submit(self, file_path: str, ts: TranscriptionSettings) -> str:
        # Concurrency is capped by the caller (_run_transcription holds the ASR
        # semaphore across submit and polling). Acquiring it again here would
        # deadlock once more jobs than permits are in flight.
        job_id = str(uuid.uuid4())
        _statuses[job_id] = "processing"

        try:
            result = await self._call_whisperx(file_path, ts)
            _results[job_id] = result
            _statuses[job_id] = "completed"
        except httpx.HTTPStatusError as e:
            # Surfaced through get_status, which the router turns into a failed job.
            _statuses[job_id] = "failed"
            _errors[job_id] = self._error_detail(e.response)
        except httpx.TimeoutException as e:
            _statuses[job_id] = "failed"
            inc(errors_total, "transcription_timeout", "asr")
            read_timeout = self._timeout_for(ts).read
            raise TimeoutError(f"ASR request exceeded {read_timeout:.0f}s") from e
        except Exception:
            _statuses[job_id] = "failed"
            raise

        return job_id

    @staticmethod
    def _error_detail(response: httpx.Response) -> str:
        try:
            body = response.json()
        except ValueError:
            body = None
        if isinstance(body, dict) and body.get("detail"):
            return str(body["detail"])
        return f"ASR server returned HTTP {response.status_code}"

    @staticmethod
    def _form_data(ts: TranscriptionSettings) -> dict[str, str]:
        diarize = ts.min_speakers > 0 or ts.max_speakers > 0
        data: dict[str, str] = {}
        if ts.model:
            data["model"] = ts.model
        if ts.language and ts.language != "auto":
            data["language"] = ts.language
        if ts.initial_prompt:
            data["prompt"] = ts.initial_prompt
        if ts.hotwords:
            data["hotwords"] = ts.hotwords
        data["response_format"] = "verbose_json"
        data["align"] = "true"
        data["suppress_numerals"] = "false"
        data["diarize"] = str(diarize).lower()
        if diarize:
            if ts.min_speakers > 0:
                data["min_speakers"] = str(ts.min_speakers)
            if ts.max_speakers > 0:
                data["max_speakers"] = str(ts.max_speakers)
        return data

    @staticmethod
    def _timeout_for(ts: TranscriptionSettings) -> httpx.Timeout:
        read = ts.job_timeout if ts.job_timeout else DEFAULT_READ_TIMEOUT
        return httpx.Timeout(read, connect=CONNECT_TIMEOUT)

    @staticmethod
    def _parse_result(payload: dict) -> TranscriptionResult:
        utterances = [
            Utterance(
                start=int(round((seg.get("start") or 0) * 1000)),
                end=int(round((seg.get("end") or 0) * 1000)),
                text=(seg.get("text") or "").strip(),
                speaker=seg.get("speaker"),
            )
            for seg in payload.get("segments") or []
        ]
        text = payload.get("text") or " ".join(u.text for u in utterances)
        return TranscriptionResult(
            id="", status="completed", utterances=utterances,
            text=text, language=payload.get("language"),
        )

    async def _call_whisperx(self, file_path: str, ts: TranscriptionSettings) -> TranscriptionResult:
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if ts.request_id:
            headers["X-Request-ID"] = ts.request_id

        async with httpx.AsyncClient(timeout=self._timeout_for(ts)) as client:
            with open(file_path, "rb") as f:
                response = await client.post(
                    f"{self.base_url}/v1/audio/transcriptions",
                    files={"file": (os.path.basename(file_path), f, "audio/mpeg")},
                    data=self._form_data(ts),
                    headers=headers,
                )
            response.raise_for_status()
            return self._parse_result(response.json())

    async def get_status(self, job_id: str) -> TranscriptionStatus:
        status = _statuses.get(job_id, "pending")
        return TranscriptionStatus(id=job_id, status=status, error=_errors.get(job_id))

    async def get_result(self, job_id: str) -> TranscriptionResult:
        result = _results.get(job_id)
        if not result:
            raise ValueError(f"No result for job {job_id}")
        result.id = job_id
        # Clean up in-memory cache after retrieval
        _results.pop(job_id, None)
        _statuses.pop(job_id, None)
        _errors.pop(job_id, None)
        return result

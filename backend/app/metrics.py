import os
import time
from contextlib import asynccontextmanager

from prometheus_client import Counter, Histogram, Gauge, Info, generate_latest, CONTENT_TYPE_LATEST
from fastapi import HTTPException, Response
from app.config import settings

CONTENT_TYPE = CONTENT_TYPE_LATEST

_enabled = settings.ENABLE_METRICS


def _counter(name, desc, labels=None):
    if not _enabled:
        return None
    return Counter(name, desc, labels or [])


def _histogram(name, desc, labels=None, buckets=None):
    if not _enabled:
        return None
    kwargs = {}
    if labels:
        kwargs["labelnames"] = labels
    if buckets:
        kwargs["buckets"] = buckets
    return Histogram(name, desc, **kwargs)


def _gauge(name, desc):
    if not _enabled:
        return None
    return Gauge(name, desc)


# --- App info ---
if _enabled:
    app_info = Info("transcription_app_info", "Application info")
    app_info.info({"version": os.getenv("APP_VERSION", "dev"), "name": "transcription-whisper"})

# --- Uploads ---
file_uploads_total = _counter("transcription_file_uploads_total", "Total file uploads", ["file_type", "status"])
file_upload_size_bytes = _histogram(
    "transcription_file_upload_size_bytes", "Upload size in bytes",
    buckets=[1024, 10240, 102400, 1048576, 10485760, 104857600, 1073741824],
)
file_renames_total = _counter("transcription_file_renames_total", "Total file renames")

# --- Transcription jobs ---
transcriptions_total = _counter(
    "transcription_jobs_total", "Total transcription jobs",
    ["backend", "language", "model", "status"],
)
transcription_duration_seconds = _histogram(
    "transcription_duration_seconds", "Transcription wall-clock duration",
    labels=["backend", "language", "model"],
    buckets=[1, 5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600],
)
transcription_audio_duration_seconds = _histogram(
    "transcription_audio_duration_seconds", "Input media duration (length of the audio being transcribed)",
    labels=["backend"],
    buckets=[10, 30, 60, 180, 300, 600, 1200, 1800, 3600, 7200, 14400],
)
transcription_realtime_factor = _histogram(
    "transcription_realtime_factor", "Processing time divided by audio duration (lower is faster; <1 means faster than realtime)",
    labels=["backend", "model"],
    buckets=[0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16],
)
transcription_queue_depth = _gauge("transcription_queue_depth", "Transcriptions in 'pending' state waiting to start")
transcription_queue_wait_seconds = _histogram(
    "transcription_queue_wait_seconds", "Time a job spent pending before processing started",
    labels=["backend"],
    buckets=[0.1, 0.5, 1, 5, 15, 30, 60, 300, 900],
)
active_transcriptions = _gauge("transcription_active_jobs", "Active transcription jobs")
diarization_speakers_total = _counter(
    "transcription_diarization_speakers_total",
    "Completed jobs by exact diarized speaker count (capped at 20, the product limit)",
    ["count"],
)

# --- Editing ---
edits_saved_total = _counter("transcription_edits_saved_total", "Transcription edits saved")
speaker_renames_total = _counter("transcription_speaker_renames_total", "Speaker renames")

# --- Exports / Downloads ---
downloads_total = _counter("transcription_downloads_total", "Downloads", ["format"])

# --- Deletions ---
deletions_total = _counter("transcription_deletions_total", "Resource deletions", ["resource_type"])

# --- LLM (summaries + protocols) ---
llm_requests_total = _counter(
    "transcription_llm_requests_total",
    "LLM requests attempted, failures included (transcription_llm_errors_total is the failed subset)",
    ["provider", "model", "operation"],
)
llm_duration_seconds = _histogram(
    "transcription_llm_duration_seconds", "LLM request duration",
    labels=["provider", "model", "operation"],
    buckets=[1, 5, 10, 30, 60, 120],
)
llm_errors_total = _counter(
    "transcription_llm_errors_total", "LLM errors",
    ["provider", "model", "operation"],
)
llm_tokens_total = _counter(
    "transcription_llm_tokens_total", "LLM tokens consumed",
    ["provider", "model", "operation", "kind"],  # kind: prompt | completion
)

# A chunk that exhausted its retries no longer fails the job — refinement keeps
# the original text for that range and reports it. Without this the failure
# that used to trip the LLM error-rate alert would become a silent success.
refinement_failed_chunks_total = _counter(
    "transcription_refinement_failed_chunks_total",
    "Refinement chunks that exhausted their retries and kept original text",
)

# --- Errors ---
errors_total = _counter("transcription_errors_total", "Errors", ["error_type", "component"])

# --- API request duration ---
api_request_duration_seconds = _histogram(
    "transcription_api_request_duration_seconds", "API request duration",
    labels=["endpoint", "method", "status"],
    buckets=[0.1, 0.5, 1, 2, 5, 10, 30, 60],
)

# --- WebSocket ---
websocket_connections_active = _gauge("transcription_websocket_connections_active", "Active WebSocket connections")
websocket_connections_total = _counter("transcription_websocket_connections_total", "Total WebSocket connections")
websocket_messages_sent_total = _counter(
    "transcription_websocket_messages_sent_total", "WebSocket messages sent to clients",
    ["type"],  # type: status | error | title
)
websocket_disconnects_total = _counter(
    "transcription_websocket_disconnects_total", "WebSocket disconnects",
    ["reason"],  # reason: client_disconnect | auth_missing | not_found | completed | failed | not_found_record | error
)

# --- Cleanup ---
cleanup_runs_total = _counter("transcription_cleanup_runs_total", "Cleanup job runs", ["status"])
cleanup_items_deleted_total = _counter("transcription_cleanup_items_deleted_total", "Items deleted by cleanup", ["resource_type"])

# --- Storage ---
storage_bytes = (
    Gauge("transcription_storage_bytes", "Disk usage in bytes", ["path"]) if _enabled else None
)

# --- Auth ---
auth_failures_total = _counter(
    "transcription_auth_failures_total", "Authentication failures",
    ["reason"],  # reason: missing_headers | ws_missing_headers | invalid_token | no_invitation
)

# --- API tokens ---
api_tokens_created_total = _counter("transcription_api_tokens_created_total", "API tokens created")
api_tokens_revoked_total = _counter("transcription_api_tokens_revoked_total", "API tokens revoked")
api_token_auth_total = _counter(
    "transcription_api_token_auth_total", "API token authentication attempts",
    ["result"],  # result: success | failure
)
api_tokens_active = _gauge("transcription_api_tokens_active", "Active (non-revoked, non-expired) API tokens")
api_token_expiry_reminders_total = _counter(
    "transcription_api_token_expiry_reminders_total", "API token expiry reminders by outcome",
    ["result"],  # result: sent | logged | rejected | failed
)

# --- Users ---
users_total = _gauge(
    "transcription_users_total",
    "Total registered users",
)
users_with_transcriptions = _gauge(
    "transcription_users_with_transcriptions",
    "Distinct users with at least one transcription record on file",
)
users_new = (
    Gauge(
        "transcription_users_new",
        "New user registrations within a rolling window",
        ["window"],
    )
    if _enabled else None
)

# --- Invitations ---
invitations_created_total = _counter("transcription_invitations_created_total", "Invitations created")
invitations_accepted_total = _counter("transcription_invitations_accepted_total", "Invitations accepted on first login")
invitations_expired_total = _counter("transcription_invitations_expired_total", "Invitations that transitioned to expired")
invitations_revoked_total = _counter("transcription_invitations_revoked_total", "Invitations revoked by an admin")


# --- Helper for safe instrumentation ---
def inc(counter, *args, amount=1):
    """Safely increment a counter (no-op if metrics disabled)."""
    if counter is None:
        return
    if args:
        counter.labels(*args).inc(amount)
    else:
        counter.inc(amount)


def observe(histogram, value, *args):
    """Safely observe a histogram value (no-op if metrics disabled)."""
    if histogram is None:
        return
    if args:
        histogram.labels(*args).observe(value)
    else:
        histogram.observe(value)


def gauge_inc(gauge, amount=1):
    """Safely increment a gauge (no-op if metrics disabled)."""
    if gauge is not None:
        gauge.inc(amount)


def gauge_dec(gauge, amount=1):
    """Safely decrement a gauge (no-op if metrics disabled)."""
    if gauge is not None:
        gauge.dec(amount)


def gauge_set(gauge, value, *args):
    """Safely set a gauge value (no-op if metrics disabled)."""
    if gauge is None:
        return
    if args:
        gauge.labels(*args).set(value)
    else:
        gauge.set(value)


def track_llm_tokens(provider: str, model: str, operation: str, usage) -> None:
    """Record LLM token counts from a provider response.

    `usage` accepts OpenAI-style objects (prompt_tokens/completion_tokens) and
    Ollama-style dicts (prompt_eval_count/eval_count).
    """
    if llm_tokens_total is None or usage is None:
        return
    prompt = getattr(usage, "prompt_tokens", None)
    completion = getattr(usage, "completion_tokens", None)
    if prompt is None and isinstance(usage, dict):
        prompt = usage.get("prompt_tokens") or usage.get("prompt_eval_count")
        completion = usage.get("completion_tokens") or usage.get("eval_count")
    if prompt:
        inc(llm_tokens_total, provider, model, operation, "prompt", amount=int(prompt))
    if completion:
        inc(llm_tokens_total, provider, model, operation, "completion", amount=int(completion))


@asynccontextmanager
async def measure_llm_operation(operation: str):
    """Time an LLM call and emit request/duration/error metrics.

    Every attempt counts as a request and a failed attempt additionally counts
    as an error, so errors / requests is the failure ratio directly. (Until
    2026-09 only successes were counted as requests, which forced the alert
    rule to use requests + errors as its denominator; the rule and dashboard
    in transcription-whisper-ansible were changed together with this.)

    HTTPException passes through without counting at all: it signals a
    caller-side failure like an unsupported provider, not a model call.
    """
    start = time.monotonic()
    try:
        yield
    except HTTPException:
        raise
    except Exception:
        inc(llm_requests_total, settings.LLM_PROVIDER, settings.LLM_MODEL, operation)
        inc(llm_errors_total, settings.LLM_PROVIDER, settings.LLM_MODEL, operation)
        inc(errors_total, "llm_failed", operation)
        raise
    duration = time.monotonic() - start
    inc(llm_requests_total, settings.LLM_PROVIDER, settings.LLM_MODEL, operation)
    observe(llm_duration_seconds, duration, settings.LLM_PROVIDER, settings.LLM_MODEL, operation)


def metrics_response() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE)


def init_label_series() -> None:
    """Pre-create label combinations at value 0 so `increase()` sees a 0→N
    transition on the first job. Without this, a counter that records exactly
    one job during a process lifetime is reported by Prometheus as a constant
    series at 1, and `increase()` returns 0.
    """
    if not _enabled or transcriptions_total is None:
        return
    backend = settings.ASR_BACKEND
    languages = {"auto", *settings.POPULAR_LANGUAGES, *settings.ENABLED_LANGUAGES}
    models = {"default", *settings.WHISPER_MODELS}
    for language in languages:
        for model in models:
            for status in ("completed", "failed"):
                transcriptions_total.labels(backend, language, model, status).inc(0)

    if users_new is not None:
        users_new.labels("7d").set(0)
        users_new.labels("30d").set(0)

    # LLM counters are emitted per (provider, model, operation). Without seeding,
    # an operation that is never invoked publishes no series at all, which is
    # indistinguishable from "the feature is broken and nobody reached it" —
    # alerts on the ratio cannot fire because the denominator does not exist.
    # The duration histogram is seeded for the same reason: its _sum and _count
    # otherwise appear at their first value, and increase() over a series with
    # no earlier sample is 0, so the first call after a restart never shows.
    if llm_requests_total is not None and llm_errors_total is not None:
        provider = settings.LLM_PROVIDER
        model = settings.LLM_MODEL
        if provider:
            for operation in ("analysis", "translation", "refinement", "title"):
                llm_requests_total.labels(provider, model, operation).inc(0)
                llm_errors_total.labels(provider, model, operation).inc(0)
                if llm_duration_seconds is not None:
                    llm_duration_seconds.labels(provider, model, operation)

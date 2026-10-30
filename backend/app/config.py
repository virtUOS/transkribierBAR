import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    ASR_BACKEND: str = os.getenv("ASR_BACKEND", "murmurai")
    ASR_URL: str = os.getenv("ASR_URL", "http://localhost:8880")
    ASR_API_KEY: str = os.getenv("ASR_API_KEY", "")
    ASR_MAX_CONCURRENT: int = int(os.getenv("ASR_MAX_CONCURRENT", "3"))
    # Poll-loop ceiling: a backend job stuck in "processing" is failed once it exceeds
    # max(ASR_JOB_TIMEOUT_MIN, audio_duration * ASR_JOB_TIMEOUT_FACTOR) seconds, so a
    # wedged backend surfaces as a retryable error instead of polling forever.
    ASR_JOB_TIMEOUT_MIN: int = int(os.getenv("ASR_JOB_TIMEOUT_MIN", "1800"))
    ASR_JOB_TIMEOUT_FACTOR: float = float(os.getenv("ASR_JOB_TIMEOUT_FACTOR", "10"))

    WHISPER_MODELS: list[str] = os.getenv("WHISPER_MODELS", "base,large-v3,large-v3-turbo").split(",")
    DEFAULT_WHISPER_MODEL: str = os.getenv("DEFAULT_WHISPER_MODEL", "base")

    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "")
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "")
    # Per-request ceiling for one chunk, not for a whole job. The shared endpoint's
    # latency varies widely: the same 50-utterance refinement chunk was measured at
    # 108s and at 237s, so the ceiling has to clear the slow draws rather than the
    # typical one. 360s left only 1.5x headroom over the worst measured chunk and
    # timed out a 248-utterance refinement outright. A chunk that does exceed this
    # is now retried rather than discarding the job, so a generous ceiling costs
    # nothing in the common case and finishing slowly beats failing fast.
    LLM_TIMEOUT: float = float(os.getenv("LLM_TIMEOUT", "600"))
    # Retries the OpenAI SDK performs inside a single request. Zero on purpose:
    # chunked_utterance_call does its own per-chunk retry, and the two layers
    # multiply rather than add — at a 600s timeout, 3 SDK attempts under 3 app
    # attempts is 90 minutes for one chunk. A chunk call was measured raising
    # APITimeoutError only after 1082s against a 360s timeout for exactly this
    # reason, which also inflates every latency measured through the app.
    #
    # The app's retry is the one worth keeping: it re-validates the returned
    # utterance count, which a blind SDK re-send does not.
    LLM_MAX_RETRIES: int = int(os.getenv("LLM_MAX_RETRIES", "0"))
    # Ornith is a reasoning model: it emits reasoning tokens before any answer.
    # That is wasted work for refinement and translation, where the task is to
    # echo back utterances with small corrections rather than to solve anything,
    # and it is expensive — one real 50-utterance chunk failed after 900s with
    # reasoning on and completed in 113s with it off. Ten chunks of a 1489-
    # utterance refinement timed out against a 600s ceiling before this.
    #
    # Nondeterministic reasoning length is also the best explanation for the
    # latency variance that looked inexplicable: 108s and 237s for the same
    # chunk on identical input.
    #
    # Sent as chat_template_kwargs, which is how vLLM exposes it. Set to false
    # for a model whose template does not accept the flag.
    LLM_DISABLE_THINKING: bool = os.getenv("LLM_DISABLE_THINKING", "true").lower() in ("1", "true", "yes")
    # Ornith in vLLM JSON mode falls into an endless whitespace loop on roughly
    # a quarter of analysis requests (2026-09-22, same transcript: 1/1, 1/4,
    # 2/5). Whitespace is always valid in the JSON grammar, so the loop only
    # ends at the context window: one request generated for 27 minutes and
    # ~260k tokens after the app had given up at 600s. vLLM's per-request
    # repetition_detection ends generation after a short repeated pattern
    # instead, so a loop comes back within seconds as truncated JSON and the
    # caller retries. The server-wide alternative (disable_any_whitespace) is a
    # vLLM deploy flag; its per-request spelling is ignored by v0.28.
    #
    # Sent as a vLLM extra body field (litellm forwards it), on analysis
    # requests only (openai.REPETITION_DETECTION_OPERATIONS). Set to false for
    # a server that rejects unknown request fields.
    LLM_STOP_ON_REPETITION: bool = os.getenv("LLM_STOP_ON_REPETITION", "true").lower() in ("1", "true", "yes")
    # Output ceiling for one analysis request (summary, protocol, custom
    # template, or a consolidation of chunk results). The model has no default
    # limit: its generation config sets none, so without max_tokens vLLM allows
    # whatever is left of the 262144 context window, and a looping completion
    # ran there for 27 minutes (2026-09-22). The repetition detector now stops
    # that loop early, so this is the backstop for loops it cannot see.
    #
    # Analysis consolidates rather than echoes, so its output is not bounded by
    # its input, and a custom prompt can ask for far more than a template: real
    # summaries of a 34-minute transcript measured 1350-2150 completion tokens,
    # but a custom-prompt analysis of an 85-minute transcript hit a cap of 8192
    # on 4 of 4 attempts (2026-10-08). Keep it below what can still arrive
    # within LLM_TIMEOUT at the endpoint's slowest throughput (79 tok/s
    # measured, ~47k tokens at 600s): past that the app has given up, and the
    # GPU keeps generating for nobody because litellm does not pass the
    # disconnect on.
    LLM_ANALYSIS_MAX_TOKENS: int = int(os.getenv("LLM_ANALYSIS_MAX_TOKENS", "32768"))
    # Parallel chunk requests per transcript for refinement and translation. The
    # LLM endpoint is shared with other services, so this is the setting that
    # determines our peak footprint on everyone else. Kept deliberately low: the
    # wall-clock saving from going wider is not worth degrading interactive users.
    LLM_CHUNK_CONCURRENCY: int = int(os.getenv("LLM_CHUNK_CONCURRENCY", "2"))

    TEMP_PATH: str = os.getenv("TEMP_PATH", "tmp/transcription-files")
    FFMPEG_PATH: str = os.getenv("FFMPEG_PATH", "ffmpeg")
    FFPROBE_PATH: str = os.getenv("FFPROBE_PATH", "ffprobe")
    LOGOUT_URL: str = os.getenv("LOGOUT_URL", "")
    CONTACT_EMAIL: str = os.getenv("CONTACT_EMAIL", "")
    STATIC_DIR: str = os.getenv("STATIC_DIR", "") or os.path.join(os.path.dirname(__file__), "..", "static")
    PRIVACY_NOTICE_FILE_DE: str = os.getenv("PRIVACY_NOTICE_FILE_DE", "")
    PRIVACY_NOTICE_FILE_EN: str = os.getenv("PRIVACY_NOTICE_FILE_EN", "")
    DEFAULT_EXPIRY_HOURS: int = int(os.getenv("DEFAULT_EXPIRY_HOURS", "72"))
    ARCHIVE_EXPIRY_HOURS: int = int(os.getenv("ARCHIVE_EXPIRY_HOURS", "4320"))
    DATABASE_PATH: str = os.getenv("DATABASE_PATH", "")

    POPULAR_LANGUAGES: list[str] = os.getenv("POPULAR_LANGUAGES", "de,en,es,fr").split(",")
    ENABLED_LANGUAGES: list[str] = [c.strip() for c in os.getenv("ENABLED_LANGUAGES", "").split(",") if c.strip()]
    ENABLE_METRICS: bool = os.getenv("ENABLE_METRICS", "true").lower() in ("true", "1", "yes")
    DEV_MODE: bool = os.getenv("DEV_MODE", "false").lower() in ("true", "1", "yes")
    ENABLE_API_TOKENS: bool = os.getenv("ENABLE_API_TOKENS", "false").lower() in ("true", "1", "yes")
    ENABLE_SUPPORT_ASSISTANT: bool = os.getenv("ENABLE_SUPPORT_ASSISTANT", "false").lower() in ("true", "1", "yes")
    API_TOKEN_MAX_PER_USER: int = int(os.getenv("API_TOKEN_MAX_PER_USER", "10"))
    API_TOKEN_DEFAULT_EXPIRY_DAYS: int = int(os.getenv("API_TOKEN_DEFAULT_EXPIRY_DAYS", "90"))

    INVITATION_MODE: bool = os.getenv("INVITATION_MODE", "false").lower() in ("true", "1", "yes")
    ADMIN_EMAILS: list[str] = [
        e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()
    ]
    INVITATION_EXPIRY_DAYS: int = int(os.getenv("INVITATION_EXPIRY_DAYS", "7"))

    KEYCLOAK_ADMIN_URL: str = os.getenv("KEYCLOAK_ADMIN_URL", "")
    KEYCLOAK_ADMIN_REALM: str = os.getenv("KEYCLOAK_ADMIN_REALM", "master")
    KEYCLOAK_TARGET_REALM: str = os.getenv("KEYCLOAK_TARGET_REALM", "")
    KEYCLOAK_ADMIN_CLIENT_ID: str = os.getenv("KEYCLOAK_ADMIN_CLIENT_ID", "admin-cli")
    KEYCLOAK_ADMIN_CLIENT_SECRET: str = os.getenv("KEYCLOAK_ADMIN_CLIENT_SECRET", "")

    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM: str = os.getenv("SMTP_FROM", "")
    SMTP_STARTTLS: bool = os.getenv("SMTP_STARTTLS", "true").lower() in ("true", "1", "yes")

    APP_PUBLIC_URL: str = os.getenv("APP_PUBLIC_URL", "")

    def __init__(self) -> None:
        # Fail at startup: pydantic does not validate the default_factory value in
        # CreateApiTokenRequest, so an out-of-range value would reach every token.
        if not 1 <= self.API_TOKEN_DEFAULT_EXPIRY_DAYS <= 365:
            raise ValueError(
                "API_TOKEN_DEFAULT_EXPIRY_DAYS must be between 1 and 365, got "
                f"{self.API_TOKEN_DEFAULT_EXPIRY_DAYS}"
            )

    @property
    def db_path(self) -> str:
        if self.DATABASE_PATH:
            return self.DATABASE_PATH
        return os.path.join(self.TEMP_PATH, "transcription.db")


settings = Settings()

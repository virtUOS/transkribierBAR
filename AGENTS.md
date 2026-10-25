# Project: Transcription Whisper

Instructions for coding agents working in this repository.

## Quick Reference

- **Frontend**: React 19 + TypeScript, Vite 8, Zustand, Tailwind CSS 4
- **Backend**: FastAPI (Python 3.12), async SQLite, Uvicorn
- **Deployment**: Multi-stage Docker build, Caddy reverse proxy

## Commands

### Checking a change

```bash
scripts/check.sh           # what CI runs on a pull request: backend tests, frontend lint/types/tests, with coverage floors
scripts/check.sh --e2e     # plus the end-to-end tests (needs ffmpeg and `npx playwright install chromium firefox`)
scripts/check.sh --image   # plus building and smoke-testing the container image (docker or podman)
```

Run `scripts/check.sh` before calling a change done, and `--e2e` when it touches a
user-facing flow or the frontend↔backend contract. The backend runs with `$PYTHON`,
else `.venv/bin/python` at the repo root, else `python3`.

### Frontend
```bash
cd frontend
npm install          # install dependencies
npm run dev          # dev server on :5173
npm run build        # production build (runs `tsc -b` first, so it also type-checks)
npm run typecheck    # type-check only (`tsc -b`)
npm run lint         # eslint
npm test             # vitest, single run
npm run test:watch   # vitest in watch mode
npm run test:coverage  # vitest with the coverage thresholds from vitest.config.ts
npm run test:e2e     # Playwright end-to-end tests (see "Testing" below)
```

Do **not** use `npx tsc --noEmit` here — the root `tsconfig.json` is solution-style
(`"files": []` plus project references), so that command silently checks nothing and
exits 0 even with type errors in `src/`. Use `npm run typecheck`.

### Backend
```bash
cd backend
pip install -r requirements-dev.txt   # runtime + test deps
uvicorn app.main:app --reload --port 8000
pytest               # run tests
pytest --cov         # with the coverage floor from .coveragerc, as CI runs it
python -m scripts.fake_services --port 8880   # fake ASR+LLM servers for running the app without GPUs
```

Dependencies are pinned with hashes. Edit `requirements.in` (runtime) or
`requirements-dev.in` (test-only), never the generated `requirements*.txt`, then
regenerate both lock files with the `uv pip compile` commands in the header of
`requirements.in`. The Docker image installs only `requirements.txt`, with
`--require-hashes`, so test packages never reach production.

### Docker
```bash
docker build -t transcription-app .
docker run -p 8000:8000 --env-file .env transcription-app

# Subpath deployment (e.g., /test/)
docker build --build-arg VITE_BASE_PATH=/test -t transcription-test .
```

## Testing

Four layers, all run in CI on every pull request:

- **Backend unit/API tests** (`backend/tests/`, pytest): routers are tested through the
  FastAPI app with respx/monkeypatched ASR and LLM clients; no network. Every endpoint
  that takes an id must be tested with another user's id (expect 404).
- **Frontend unit/component tests** (`frontend/src/**/*.test.ts(x)`, vitest + Testing
  Library): mock `api/client.ts`, assert through roles and visible text. Behavior that
  depends on the browser or OS (the recorder's system-audio modes) is tested by mocking
  `utils/platformDetect.ts`; `RecordingSources` reads it when the module loads, so see
  `RecordingSources.platforms.test.tsx` for re-importing it per mode.
- **End-to-end tests** (`frontend/e2e/*.spec.ts`, Playwright): the real backend and the
  Vite dev server, with `backend/scripts/fake_services.py` standing in for the MurmurAI
  and OpenAI-compatible servers (canned, deterministic answers; an initial prompt
  containing `fake:fail` makes the ASR job fail). `e2e/stack.ts` starts the backend on a
  throwaway database. Each test signs in as its own user through the
  `X-Auth-Request-User` header (see `e2e/fixtures.ts`), so tests run in parallel without
  seeing each other's data. Use the `data-help` attributes as selectors where they exist.
  Add an e2e test for a new user-facing flow; keep edge cases in the unit layers. Everything
  runs in Chromium; `recorder.spec.ts` also runs in Firefox, since the recorder adapts to
  the browser. Both get fake media devices. The projects deliberately use no Playwright
  device presets, which would replace the user agent with a Windows one.
- **Container smoke test** (`scripts/smoke-test-image.sh <image>`): starts the built
  image and checks the API, the SPA fallback and `/handbuch/`, including that no
  build-time placeholder of the guide is left in the page.

A bug found while writing tests gets a GitHub issue first, then a test that links it:
a strict `xfail` whose reason starts with the issue URL (backend), or an `it.todo` naming
the issue URL (frontend). A test that works around a bug, or will need changing once it
is fixed, says so in a comment with the issue URL. Fix the bug and the test together.

Coverage floors (`backend/.coveragerc`, `frontend/vitest.config.ts`) sit just below the
current numbers. Raise them when coverage grows; never lower them to get a change through.

## Architecture

- Frontend SPA served as static files by FastAPI, view-based navigation (archive/upload/record/detail/presets/settings)
- API routes under `/api/*`, WebSocket at `/api/ws/status/{id}`
- Pluggable ASR backends: MurmurAI or WhisperX — both are remote HTTP API servers the app calls out to (see README §"ASR Configuration" for the server projects). The admin picks one at deploy time via the `ASR_BACKEND` env var; the choice is not user-facing and there is no UI control to switch backends. `ASRBackend.cleanup(job_id)` is a best-effort hook (no-op by default) that `_run_transcription` calls after the result is stored, and after a failure when a job id exists; MurmurAI implements it as `DELETE /v1/transcript/{id}` because the server otherwise keeps every transcript forever. It must never raise — failures log a warning and count `errors_total{error_type="asr_cleanup_failed"}`.
- Pluggable LLM providers: OpenAI-compatible API (OpenAI, vLLM, etc.) or Ollama — for analysis, translation, and transcription refinement
- Database: async SQLite with foreign keys enabled
- All frontend API calls go through centralized client at `frontend/src/api/client.ts`
- Base path for subpath deployments configured via `VITE_BASE_PATH` env var at build time
- Two authentication paths share one dependency (`get_current_user`): reverse-proxy headers (`X-Auth-Request-User/Email`) for the browser, and `Authorization: Bearer tw_…` for personal API tokens when `ENABLE_API_TOKENS=true`. Token path wins when present; invalid tokens return 401 without header fallback. Tokens are sha256-hashed in `api_tokens`, surfaced via `/api/tokens` (router mounted only when flag is on; OpenAPI hidden when off) and a Settings view. The token-management endpoints use `get_session_user` instead, which refuses any `Bearer tw_…` with 403 (a token cannot mint or list tokens); new credential-management endpoints must use it too. WS (`/api/ws/status/{id}`) accepts `?token=tw_…` since browsers cannot set custom WS headers

## Code Style

- Frontend: ESLint 9 + TypeScript ESLint, no semicolons enforced by formatter
- Backend: Standard Python conventions, async/await throughout
- Commit messages: conventional commits (`feat:`, `fix:`, `refactor:`, etc.)
- Never add "Co-Authored-By" lines to commit messages

## Key Directories

- `frontend/src/api/` — API client and types
- `frontend/src/components/` — React components (SubtitleEditor, AnalysisView, SpeakerMapping, FormatViewer, HelpDrawer, etc.)
- `frontend/src/help/` — Help drawer markdown content (en/, de/) and SVG diagram assets (assets/)
- `frontend/src/i18n/` — Internationalization locale files (en.json, de.json)
- `frontend/src/utils/` — Utility functions (formatting, downloads)
- `frontend/src/store/index.ts` — Zustand state management
- `frontend/src/hooks/` — Custom React hooks (e.g. useBeforeUnloadWarning)
- `backend/app/routers/` — FastAPI route handlers (upload, transcription, analysis, translation, refinement, presets, config_router, tokens)
- `backend/app/services/api_tokens.py` — API-token service helpers (create/list/revoke/resolve/cleanup). `resolve_token` returns `(UserInfo, token_id) | None`. `cleanup_stale_tokens` is invoked from the existing `cleanup_old_files` loop in `main.py`; do not start a second scheduler
- `backend/app/services/asr/` — ASR backend implementations
- `backend/app/services/llm/` — LLM provider implementations and prompt templates
- `backend/app/models.py` — Pydantic request/response models
- `backend/app/dependencies.py` — Authentication/authorization dependencies
- `backend/app/database.py` — SQLite schema and connection management
- `backend/app/config.py` — Environment variable configuration
- `backend/app/metrics.py` — Prometheus metrics definitions and instrumentation helpers (`inc`, `observe`, `gauge_inc/dec/set`, `track_llm_tokens`)

### Help content

- Help text lives in `frontend/src/help/{de,en}/`; the section list is `frontend/src/help/sectionList.ts`.
- German uses "Sie" and gender-neutral forms (no `:innen`/`*innen`); English is gender-neutral.
- The only allowed placeholders are `{{contact_email}}`, `{{retention_days}}`, `{{archive_retention_days}}`, `{{default_model}}` and `{{api_token_expiry_days}}` (see `helpText.ts`). Never hard-code those values.
- `frontend/src/help/parity.test.ts` must pass: both languages need the same files, heading outline and images.
- Check every claim against the frontend/backend code, not against README or old help text.
- Screenshots are regenerated with `cd frontend && PYTHON=/path/to/venv/bin/python npm run help:shots [-- --only <id>]` (needs ffmpeg and, once per machine, `npx playwright install chromium`; specs in `frontend/scripts/help-shots/shots.ts`; the run never contacts the real ASR/LLM hosts).
- English help uses American spelling, as `en.json` does ("Customize", "Minimize", "color"); German help names the key "Eingabetaste" and says "KI-Funktionen" (English "AI features") in prose.

### Public guide (`/handbuch`)

- `/handbuch/` is public (no auth) and is generated at build time (`npm run build` → `dist/handbuch/`) by `frontend/src/help/render/staticGuide.ts`; the backend side is `backend/app/public_pages.py` and `backend/app/routers/public_pages.py`.
- The router must stay registered before the SPA catch-all in `main.py`, and its static mount before the router. Never put non-guide routes under `/handbuch`.
- The sentinel/feature contract lives in `staticGuide.ts` ↔ `public_pages.py`: `__TW_SETTING_<key>__`, `<!--tw-feature:X-->…<!--/tw-feature:X-->` (non-nested; `llm`, `api_tokens`, `privacy`, `contact`), `__TW_PRIVACY_NOTICE__`, `__TW_NOTICE_LANG__`, `__TW_NOTICE_FALLBACK__`. Change both sides and their tests together.
- Operators supply the privacy notice through `PRIVACY_NOTICE_FILE_DE` / `PRIVACY_NOTICE_FILE_EN`.

## Observability

- Metrics are exposed at `/metrics` when `ENABLE_METRICS=true`. Use the safe helpers in `metrics.py` rather than calling `Counter/Gauge/Histogram` directly — they no-op when metrics are disabled.
- Transcription flow emits: `queue_depth` / `queue_wait_seconds` (submission → processing), `audio_duration_seconds` (via `ffprobe`), `duration_seconds` and `realtime_factor` (on completion). All carry a `backend` label (`murmurai`/`whisperx`); `jobs_total` and `duration_seconds` were updated to include it.
- Diarization speaker counts are tracked as `diarization_speakers_total{count="N"}` — a Counter labelled by exact speaker count, capped at 20 (the product limit). Not a histogram: speaker count is a bounded small-integer category, so per-value counters give exact, directly-readable counts in dashboards. Increment via `inc(diarization_speakers_total, str(min(n, 20)))`.
- LLM providers (`openai.py`, `ollama.py`) call `track_llm_tokens(provider, model, operation, usage)` inside their shared chat helpers. New LLM calls added outside these helpers (e.g. a direct `_call_llm` path) must call it too — pass the matching `operation` label (`analysis`, `translation`, `refinement`, `title`).
- Storage usage gauge is refreshed at startup and after each cleanup run in `main.py` — no separate task.
- WebSocket handler tracks message counts and disconnect reasons; auth failures are counted in `dependencies.py` and the WS handler.
- API-token auth emits `api_token_auth_total{result}` on both HTTP and WS paths; `api_tokens_created_total` / `api_tokens_revoked_total` wrap the management endpoints; `api_tokens_active` gauge is refreshed at startup and inside `cleanup_old_files`. `auth_failures_total{reason}` gained `invalid_token` — expired/revoked tokens are merged into that bucket (service returns `None` uniformly).

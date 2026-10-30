"""Support assistant: streams an LLM answer grounded in the user manual."""
import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, model_validator

from app.dependencies import get_current_user
from app.metrics import inc, measure_llm_operation, support_assistant_requests_total
from app.models import UserInfo
from app.services import support_assistant as sa
from app.services.llm import get_llm_provider
from app.services.llm.base import LLMProvider, OutputLimitExceeded

logger = logging.getLogger(__name__)

MAX_MESSAGES = 20
MAX_USER_CHARS = 4000
MAX_ASSISTANT_CHARS = 8000
MAX_TOTAL_CHARS = 48000
BUSY_STALE_SECONDS = 180
MAX_TOKENS = 1500

# user id -> time.monotonic() at start of the running request.
_in_flight: dict[str, float] = {}


async def _require_available() -> None:
    if not sa.support_assistant_available():
        raise HTTPException(status_code=404)


async def _browser_user(request: Request) -> UserInfo:
    if request.headers.get("Authorization", "").startswith("Bearer tw_"):
        raise HTTPException(
            status_code=403, detail="API tokens can't be used for the assistant."
        )
    return await get_current_user(request)


router = APIRouter(
    prefix="/api/assistant",
    dependencies=[Depends(_require_available)],
    include_in_schema=False,
)


class AssistantMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AssistantChatRequest(BaseModel):
    messages: list[AssistantMessage]
    lang: Literal["de", "en"]
    view: Literal["archive", "upload", "record", "detail", "presets", "settings"]
    transcription_id: str | None = None

    @model_validator(mode="after")
    def _check_limits(self):
        if not 1 <= len(self.messages) <= MAX_MESSAGES:
            raise ValueError(f"messages must contain 1 to {MAX_MESSAGES} entries")
        if self.messages[-1].role != "user":
            raise ValueError("the last message must come from the user")
        total = 0
        for m in self.messages:
            m.content = m.content.strip()
            if m.role == "user" and not 1 <= len(m.content) <= MAX_USER_CHARS:
                raise ValueError(f"user messages must have 1 to {MAX_USER_CHARS} characters")
            if m.role == "assistant" and len(m.content) > MAX_ASSISTANT_CHARS:
                raise ValueError(f"assistant messages may have at most {MAX_ASSISTANT_CHARS} characters")
            total += len(m.content)
        if total > MAX_TOTAL_CHARS:
            raise ValueError(f"messages may have at most {MAX_TOTAL_CHARS} characters in total")
        return self


def _event(payload: dict, name: str | None = None) -> str:
    data = json.dumps(payload, ensure_ascii=False)
    return (f"event: {name}\n" if name else "") + f"data: {data}\n\n"


async def _event_stream(
    user_id: str, provider: LLMProvider, messages: list[dict]
) -> AsyncIterator[str]:
    result = "ok"
    try:
        try:
            async with measure_llm_operation("support"):
                try:
                    async for delta in provider.stream_chat(messages, "support", MAX_TOKENS):
                        yield _event({"delta": delta})
                except OutputLimitExceeded:
                    result = "output_limit"
        except Exception as e:
            logger.warning(
                "support assistant LLM call failed: %s (status %s)",
                type(e).__name__,
                getattr(e, "status_code", None),
            )
            result = "llm_error"
        if result == "ok":
            yield _event({}, "done")
        else:
            yield _event({"code": result}, "error")
    except BaseException:
        # GeneratorExit / CancelledError: the client went away.
        result = "aborted"
        raise
    finally:
        _in_flight.pop(user_id, None)
        inc(support_assistant_requests_total, result)


@router.post("/chat")
async def chat(body: AssistantChatRequest, user: UserInfo = Depends(_browser_user)):
    provider = get_llm_provider()
    if provider is None:
        raise HTTPException(status_code=404)
    situation = None
    if body.view == "detail" and body.transcription_id:
        situation = await sa.load_situation(user.id, body.transcription_id)
    prompt = sa.build_system_prompt(body.lang, body.view, situation)
    messages = [
        {"role": "system", "content": prompt},
        *({"role": m.role, "content": m.content} for m in body.messages),
    ]
    # Check and set in one step, after every await: no other request of this
    # user can slip in between.
    now = time.monotonic()
    started = _in_flight.get(user.id)
    if started is not None and now - started < BUSY_STALE_SECONDS:
        inc(support_assistant_requests_total, "busy")
        return JSONResponse(
            status_code=429,
            content={
                "detail": "The assistant is still answering your previous question.",
                "code": "assistant_busy",
            },
        )
    _in_flight[user.id] = now
    return StreamingResponse(
        _event_stream(user.id, provider, messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

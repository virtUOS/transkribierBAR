import json
from collections.abc import AsyncIterator

from openai import AsyncOpenAI

from app.config import settings
from app.metrics import track_llm_tokens
from app.services.llm.base import LLMProvider, OutputLimitExceeded, reject_schema_echo
from app.services.llm.prompt import REFINEMENT_CONSOLIDATION_PROMPT


# Pattern bounds for vLLM's repetition detector. The whitespace loop repeats a
# 1-3 token pattern; legitimate JSON never repeats any pattern of up to eight
# tokens thirty times in a row, so this trips only on a runaway, and does so
# within about a hundred tokens rather than at the context window.
REPETITION_DETECTION = {"max_pattern_size": 8, "min_pattern_size": 1, "min_count": 30}

# Only analysis composes new text; translation and refinement echo every
# utterance back, and an ASR hallucination loop in the source ("Thank you."
# sixty times) is a legitimate reply that trips the detector on every retry.
# Their output is already capped by REFINEMENT_OUTPUT_TOKEN_CAP, so a runaway
# there cannot reach the context window anyway.
REPETITION_DETECTION_OPERATIONS = frozenset({"analysis"})


class OpenAIProvider(LLMProvider):
    def __init__(self):
        self._client = AsyncOpenAI(
            api_key=settings.LLM_API_KEY,
            base_url=settings.LLM_BASE_URL or None,
            timeout=settings.LLM_TIMEOUT,
            max_retries=settings.LLM_MAX_RETRIES,
        )
        self._model = settings.LLM_MODEL or "gpt-4o"

    def _extra_body(self, operation: str) -> dict:
        """Provider-specific request fields.

        Reasoning models spend tokens thinking before answering, which is wasted
        on the utterance paths and slow enough to blow the request timeout. vLLM
        turns it off through the chat template rather than a top-level field.

        repetition_detection makes vLLM end a completion that has fallen into a
        token loop (see config.LLM_STOP_ON_REPETITION). litellm rewrites the
        resulting finish_reason to "stop", so a caught loop is only visible as
        JSON that fails to parse; callers retry on that. Sent only for
        REPETITION_DETECTION_OPERATIONS.
        """
        body: dict = {}
        if settings.LLM_DISABLE_THINKING:
            body["chat_template_kwargs"] = {"enable_thinking": False}
        if settings.LLM_STOP_ON_REPETITION and operation in REPETITION_DETECTION_OPERATIONS:
            body["repetition_detection"] = REPETITION_DETECTION
        return body

    async def _json_chat(
        self, system: str, user: str, operation: str, max_tokens: int | None = None
    ) -> dict:
        response = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.3,
            response_format={"type": "json_object"},
            extra_body=self._extra_body(operation),
            **({"max_tokens": max_tokens} if max_tokens is not None else {}),
        )
        track_llm_tokens(settings.LLM_PROVIDER, self._model, operation, getattr(response, "usage", None))
        choice = response.choices[0]
        if getattr(choice, "finish_reason", None) == "length":
            # The output cap cut the reply. The JSON is incomplete even when it
            # happens to parse, so refuse it here rather than in a parser.
            raise OutputLimitExceeded(
                f"The language model's {operation} reply was truncated at the output limit."
            )
        return reject_schema_echo(json.loads(choice.message.content or "{}"))

    async def stream_chat(
        self, messages: list[dict], operation: str, max_tokens: int
    ) -> AsyncIterator[str]:
        # Reasoning arrives in delta.reasoning_content and is never yielded.
        client = self._client.with_options(timeout=90)
        stream = await client.chat.completions.create(
            model=self._model,
            messages=messages,
            temperature=0.2,
            max_tokens=max_tokens,
            stream=True,
            stream_options={"include_usage": True},
            extra_body=self._extra_body(operation),
        )
        finish_reason = None
        usage = None
        try:
            async for chunk in stream:
                usage = getattr(chunk, "usage", None) or usage
                if not getattr(chunk, "choices", None):
                    continue
                choice = chunk.choices[0]
                content = getattr(choice.delta, "content", None)
                if content:
                    yield content
                if getattr(choice, "finish_reason", None):
                    finish_reason = choice.finish_reason
        finally:
            await stream.close()
        track_llm_tokens(settings.LLM_PROVIDER, self._model, operation, usage)
        if finish_reason == "length":
            raise OutputLimitExceeded(
                f"The language model's {operation} reply was truncated at the output limit."
            )

    async def _consolidate_refinement_summaries(self, summaries: list[str]) -> str:
        response = await self._client.chat.completions.create(
            model=self._model,
            messages=[{
                "role": "user",
                "content": REFINEMENT_CONSOLIDATION_PROMPT.format(
                    summaries="\n".join(f"- {s}" for s in summaries),
                ),
            }],
            temperature=0.3,
        )
        track_llm_tokens(settings.LLM_PROVIDER, self._model, "refinement", getattr(response, "usage", None))
        return (response.choices[0].message.content or "").strip()

    async def generate_title(self, transcript: str) -> str:
        response = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": "Generate a short descriptive title (max 8 words) for the following transcript. Return ONLY the title text, nothing else. No quotes, no punctuation at the end."},
                {"role": "user", "content": transcript[:2000]},
            ],
            temperature=0.3,
        )
        track_llm_tokens(settings.LLM_PROVIDER, self._model, "title", getattr(response, "usage", None))
        return (response.choices[0].message.content or "").strip().strip('"\'')

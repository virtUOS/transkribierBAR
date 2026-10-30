import json
from collections.abc import AsyncIterator

import httpx

from app.config import settings
from app.metrics import track_llm_tokens
from app.services.llm.base import LLMProvider, OutputLimitExceeded, reject_schema_echo
from app.services.llm.prompt import REFINEMENT_CONSOLIDATION_PROMPT


class OllamaProvider(LLMProvider):
    def __init__(self):
        self._base_url = settings.LLM_BASE_URL or "http://localhost:11434"
        self._model = settings.LLM_MODEL or "llama3"

    async def _chat(
        self, system: str, user: str, operation: str = "analysis",
        max_tokens: int | None = None,
    ) -> str:
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "format": "json",
        }
        # Ollama spells the output ceiling options.num_predict rather than
        # max_tokens; without it a runaway generates to the context window.
        if max_tokens is not None:
            payload["options"] = {"num_predict": max_tokens}
        async with httpx.AsyncClient(timeout=settings.LLM_TIMEOUT) as client:
            response = await client.post(
                f"{self._base_url}/api/chat",
                json=payload,
            )
            response.raise_for_status()
            payload = response.json()
            track_llm_tokens(settings.LLM_PROVIDER, self._model, operation, payload)
            if max_tokens is not None and payload.get("done_reason") == "length":
                # num_predict cut the reply; refuse it before a parser does.
                raise OutputLimitExceeded(
                    f"The language model's {operation} reply was truncated at the output limit."
                )
            return payload["message"]["content"]

    async def stream_chat(
        self, messages: list[dict], operation: str, max_tokens: int
    ) -> AsyncIterator[str]:
        # Ollama silently truncates the prompt to its default context window, so size
        # it from the prompt (~3 characters per token, plus the reply and headroom).
        total_chars = sum(len(m.get("content") or "") for m in messages)
        needed = total_chars // 3 + max_tokens + 512
        num_ctx = min(65536, max(8192, -(-needed // 1024) * 1024))
        payload = {
            "model": self._model,
            "messages": messages,
            "stream": True,
            "options": {"num_predict": max_tokens, "temperature": 0.2, "num_ctx": num_ctx},
        }
        final: dict | None = None
        async with httpx.AsyncClient(timeout=settings.LLM_TIMEOUT) as client:
            async with client.stream(
                "POST", f"{self._base_url}/api/chat", json=payload
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    data = json.loads(line)
                    if "error" in data:
                        raise RuntimeError("Ollama reported an error while streaming the reply.")
                    content = (data.get("message") or {}).get("content")
                    if content:
                        yield content
                    if data.get("done"):
                        final = data
                        break
        if final is None:
            raise RuntimeError("The Ollama stream ended before the reply was complete.")
        track_llm_tokens(settings.LLM_PROVIDER, self._model, operation, final)
        if final.get("done_reason") == "length":
            raise OutputLimitExceeded(
                f"The language model's {operation} reply was truncated at the output limit."
            )

    async def _json_chat(
        self, system: str, user: str, operation: str, max_tokens: int | None = None
    ) -> dict:
        return reject_schema_echo(
            json.loads(await self._chat(system, user, operation, max_tokens))
        )

    async def _consolidate_refinement_summaries(self, summaries: list[str]) -> str:
        return await self._chat(
            "You are a helpful assistant. Return only plain text, not JSON.",
            REFINEMENT_CONSOLIDATION_PROMPT.format(
                summaries="\n".join(f"- {s}" for s in summaries),
            ),
            operation="refinement",
        )

    async def generate_title(self, transcript: str) -> str:
        result = await self._chat(
            "Generate a short descriptive title (max 8 words) for the following transcript. Return ONLY the title text, nothing else. No quotes, no punctuation at the end.",
            transcript[:2000],
            operation="title",
        )
        try:
            data = json.loads(result)
            return str(data.get("title", data.get("text", result))).strip().strip('"\'')
        except (json.JSONDecodeError, AttributeError):
            return result.strip().strip('"\'')

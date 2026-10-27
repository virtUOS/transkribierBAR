import asyncio
import json
import logging
from abc import ABC, abstractmethod

from app.config import settings
from app.metrics import inc, refinement_failed_chunks_total
from app.models import (
    SummaryResult, SummaryChapter,
    ProtocolResult, ProtocolKeyPoint, ProtocolDecision, ProtocolActionItem,
    LLMRefinementResponse, Utterance,
)
from app.services.llm.prompt import (
    build_system_prompt, build_user_prompt, chunk_transcript, build_consolidation_prompt,
    build_protocol_system_prompt, build_protocol_user_prompt,
    PROTOCOL_CONSOLIDATION_PROMPT, PROTOCOL_SCHEMA,
    build_refinement_system_prompt,
    REFINEMENT_OUTPUT_TOKEN_CAP,
    chunk_utterances_for_refinement,
    chunk_ranges,
    _language_name,
)
from app.services.speaker_labels import with_speakers_from

class OutputLimitExceeded(ValueError):
    """The reply reached the request's output-token cap and is incomplete.

    A ValueError so the utterance paths, which retry any failed chunk, treat
    it as before; analysis_json_chat handles it separately.
    """


class MalformedReply(ValueError):
    """Every attempt at an analysis reply was unusable (see analysis_json_chat).

    Its own type so the router can tell the user, distinct from a server fault:
    each attempt is a fresh draw, so trying again can succeed.
    """


# Parallel chunk requests per transcript, for the operations that rewrite every
# utterance (refinement and translation). See config.LLM_CHUNK_CONCURRENCY for
# why this is deliberately small.
LLM_CHUNK_MAX_CONCURRENT = settings.LLM_CHUNK_CONCURRENCY

# Re-attempts for a single chunk that comes back with the wrong number of
# utterances. Cheap compared with discarding every other chunk's work.
CHUNK_COUNT_RETRIES = 2

# Re-attempts for a chunk whose request failed outright — a timeout, a dropped
# connection, a transient endpoint error. The shared endpoint's latency varies
# widely: the same 50-utterance chunk was measured at 108s and at 237s against a
# 360s timeout, so a slow draw is a dice roll rather than a broken request. A
# long transcript rolls those dice once per chunk (1489 utterances is 30 chunks),
# and without this a single unlucky draw discards every other chunk's work.
CHUNK_ERROR_RETRIES = 2

# Re-attempts for an analysis request whose reply was unusable: cut short by the
# server's repetition detector (which arrives as JSON that does not parse), or
# the schema echoed back. Both are nondeterministic model failures — the
# whitespace loop hits about one request in four — so a fresh draw usually
# succeeds. One retry was not enough on 2026-10-12: two attempts in a row were
# cut by the detector and the user's manual retry then succeeded. A caught loop
# ends within about a hundred tokens of starting, so a failed attempt costs at
# most what a good reply would. A reply that reached the output cap is not
# retried (see OutputLimitExceeded in analysis_json_chat).
ANALYSIS_RETRIES = 2


async def analysis_json_chat(provider: "LLMProvider", system: str, user: str) -> dict:
    """One analysis request with the output cap applied and a retry on a bad reply.

    Every analysis call goes through here so the cap and the retry cannot be
    forgotten on one path — the summary, protocol and custom-template paths
    each used to build their own request. Transport errors (timeouts,
    connection failures) are not retried: the caller's error path handles
    them, and a blind re-send would double the wait.
    """
    for attempt in range(ANALYSIS_RETRIES + 1):
        try:
            return await provider._json_chat(
                system, user, "analysis", max_tokens=settings.LLM_ANALYSIS_MAX_TOKENS,
            )
        except OutputLimitExceeded:
            # The repetition detector stops the known loop long before the
            # cap, so a reply that reaches it was asked for that much output.
            # The same request hits the cap again (4 of 4 attempts on
            # 2026-10-08), and a retry doubles a wait of several minutes.
            logging.error("analysis reply reached the %d-token output cap", settings.LLM_ANALYSIS_MAX_TOKENS)
            raise
        except (json.JSONDecodeError, ValueError) as e:
            if attempt == ANALYSIS_RETRIES:
                logging.error(
                    "analysis reply unusable after %d attempts: %s: %s",
                    ANALYSIS_RETRIES + 1, type(e).__name__, e,
                )
                raise MalformedReply(
                    "The language model returned a malformed response. Please try again."
                ) from e
            logging.warning(
                "analysis reply unusable (%s: %s), retrying (attempt %d/%d)",
                type(e).__name__, e, attempt + 1, ANALYSIS_RETRIES + 1,
            )
    raise AssertionError("unreachable")


async def chunked_utterance_call(
    provider: "LLMProvider",
    utterances: list[dict],
    build_system,
    operation: str,
    expect_same_count: bool = False,
    tolerate_failures: bool = False,
    chunks: list[list[dict]] | None = None,
) -> list[dict | None]:
    """Send utterances to the LLM in chunks, concurrently, in input order.

    Shared by the operations that rewrite every utterance — refinement and
    translation. Both make the model echo the whole chunk back, so latency
    scales with chunk size and a sequential loop waits for the sum of every
    chunk. Each of these grew its own copy of this logic, and each copy had to
    be fixed separately for chunk size, concurrency and schema-echo handling.

    `build_system` is called per chunk to produce the system prompt. Results
    come back in input order, so callers can concatenate them directly.

    `chunks`, when given, is sent as-is instead of chunking `utterances`; the
    refinement retry passes exactly the ranges that failed before.

    `tolerate_failures` makes a chunk that exhausts its retries resolve to None
    in its slot instead of raising and cancelling its siblings. Refinement opts
    in because an unrefined range is still correct text; translation must not,
    because an untranslated range is not.
    """
    if chunks is None:
        chunks = chunk_utterances_for_refinement(utterances)
    semaphore = asyncio.Semaphore(LLM_CHUNK_MAX_CONCURRENT)

    async def _attempt(chunk: list[dict]) -> dict:
        """One request for one chunk, retried if the request itself fails.

        Finishing slowly is preferred over failing fast here: the user is
        already waiting minutes and would rather wait longer than lose the
        whole job to one slow chunk.
        """
        for attempt in range(CHUNK_ERROR_RETRIES + 1):
            try:
                async with semaphore:
                    return await provider._json_chat(
                        build_system(),
                        json.dumps(chunk, ensure_ascii=False),
                        operation,
                        max_tokens=REFINEMENT_OUTPUT_TOKEN_CAP,
                    )
            except asyncio.CancelledError:
                # A sibling chunk failed and we are being torn down; never
                # swallow this into a retry.
                raise
            except Exception as e:
                if attempt == CHUNK_ERROR_RETRIES:
                    raise
                logging.warning(
                    "%s chunk request failed (%s: %s), retrying (attempt %d/%d)",
                    operation, type(e).__name__, e, attempt + 1,
                    CHUNK_ERROR_RETRIES + 1,
                )
        raise AssertionError("unreachable")

    async def one(chunk: list[dict]) -> dict:
        # Refinement and translation must return one utterance per input, but
        # models do not honour that reliably — one short chunk used to discard
        # every other chunk's work and surface as a 500 after several minutes.
        # Retry just the offending chunk instead.
        last_count = None
        for attempt in range(CHUNK_COUNT_RETRIES + 1):
            data = await _attempt(chunk)
            if not expect_same_count:
                return data
            last_count = len(data.get("utterances", []))
            if last_count == len(chunk):
                # Issue #215: the model is told to keep the speaker but does
                # not reliably do so; the count check above is what makes
                # matching by position safe.
                data["utterances"] = with_speakers_from(chunk, data["utterances"])
                return data
            logging.warning(
                "%s chunk returned %d utterances, expected %d (attempt %d/%d)",
                operation, last_count, len(chunk), attempt + 1, CHUNK_COUNT_RETRIES + 1,
            )
        raise ValueError(
            f"The language model returned {last_count} utterances for a chunk of "
            f"{len(chunk)} after {CHUNK_COUNT_RETRIES + 1} attempts."
        )

    async def one_or_none(chunk: list[dict]) -> dict | None:
        try:
            return await one(chunk)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logging.warning(
                "%s chunk of %d utterances gave up after retries (%s: %s); keeping original text",
                operation, len(chunk), type(e).__name__, e,
            )
            return None

    # gather preserves input order, so utterances reassemble in transcript order
    # regardless of which chunk finishes first. On failure, cancel the siblings
    # rather than leaving them generating into a job nobody is waiting for —
    # unless the caller tolerates failures, in which case a dead chunk is a
    # None slot and the siblings finish.
    runner = one_or_none if tolerate_failures else one
    tasks = [asyncio.ensure_future(runner(chunk)) for chunk in chunks]
    try:
        return list(await asyncio.gather(*tasks))
    except BaseException:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise


class LLMProvider(ABC):
    @abstractmethod
    async def _json_chat(
        self, system: str, user: str, operation: str, max_tokens: int | None = None
    ) -> dict:
        """Run a JSON-returning chat completion and return the parsed object.

        `max_tokens` bounds the reply. The utterance paths pass
        REFINEMENT_OUTPUT_TOKEN_CAP because their output is bounded by their
        input; analysis passes the larger settings.LLM_ANALYSIS_MAX_TOKENS
        through analysis_json_chat, since a consolidation is not bounded by its input
        but a runaway must still stop short of the context window. A reply
        that hits the cap (finish_reason "length") must raise rather than be
        parsed.
        """

    @abstractmethod
    async def _consolidate_refinement_summaries(self, summaries: list[str]) -> str:
        """Collapse per-chunk refinement change-summaries into one plain-text string."""

    @abstractmethod
    async def generate_title(self, transcript: str) -> str:
        """Generate a short title from transcript text."""

    async def generate_summary(
        self, transcript: str, chapter_hints: list | None = None, language: str | None = None
    ) -> SummaryResult:
        chunks = chunk_transcript(transcript)
        system = build_system_prompt(chapter_hints, language)

        if len(chunks) == 1:
            data = await analysis_json_chat(self, system, build_user_prompt(chunks[0]))
            return _parse_summary(data)

        chunk_summaries: list[str] = []
        for chunk in chunks:
            data = await analysis_json_chat(self, system, build_user_prompt(chunk))
            chunk_summaries.append(json.dumps(data))

        prompt = build_consolidation_prompt(
            "\n\n---\n\n".join(chunk_summaries), chapter_hints, language,
        )
        data = await analysis_json_chat(self, system, prompt)
        return _parse_summary(data)

    async def generate_protocol(
        self, transcript: str, summary_context: str | None = None, language: str | None = None
    ) -> ProtocolResult:
        chunks = chunk_transcript(transcript)
        system = build_protocol_system_prompt(language)

        if len(chunks) == 1:
            data = await analysis_json_chat(
                self, system, build_protocol_user_prompt(chunks[0], summary_context),
            )
            return _parse_protocol(data)

        chunk_protocols: list[str] = []
        for chunk in chunks:
            data = await analysis_json_chat(
                self, system, build_protocol_user_prompt(chunk, summary_context),
            )
            chunk_protocols.append(json.dumps(data))

        language_instruction = (
            f"Respond in {_language_name(language)}." if language
            else "Respond in the same language as the content above."
        )
        prompt = PROTOCOL_CONSOLIDATION_PROMPT.format(
            chunk_protocols="\n\n---\n\n".join(chunk_protocols),
            schema=json.dumps(PROTOCOL_SCHEMA, indent=2),
            language_instruction=language_instruction,
        )
        data = await analysis_json_chat(self, system, prompt)
        return _parse_protocol(data)

    async def generate_refinement(
        self,
        transcript: str,
        context: str | None = None,
        ranges: list[tuple[int, int]] | None = None,
        previous_summary: str | None = None,
    ) -> LLMRefinementResponse:
        """Refine `transcript` (a JSON list of utterances) chunk by chunk.

        A chunk that fails every retry is tolerated: its utterances come back
        as sent and its range is reported in `failed_ranges`, so one slow chunk
        on a busy endpoint no longer discards the rest of the transcript. On an
        initial run where no chunk succeeds the call raises, since nothing
        useful was produced and the caller's failure path already handles that.

        `ranges` restricts the call to those half-open index ranges — the retry
        path passes what a previous run reported as failed. The result is still
        full-length; utterances outside `ranges` are returned as sent, and the
        caller splices in only what recovered. `previous_summary` is folded into
        the consolidated summary so a retry yields one summary rather than two.
        If everything fails again on a retry the previous summary is returned
        unchanged rather than raising: the stored partial is still intact.
        """
        utterances = json.loads(transcript)
        initial_run = ranges is None
        if initial_run:
            ranges = chunk_ranges(len(utterances))
        chunks = [utterances[a:b] for a, b in ranges]

        results = await chunked_utterance_call(
            self, utterances,
            build_system=lambda: build_refinement_system_prompt(context),
            operation="refinement",
            expect_same_count=True,
            tolerate_failures=True,
            chunks=chunks,
        )

        refined = [dict(u) for u in utterances]
        failed_ranges: list[tuple[int, int]] = []
        summaries: list[str] = []
        for (a, b), data in zip(ranges, results):
            if data is None:
                failed_ranges.append((a, b))
                continue
            refined[a:b] = data.get("utterances", [])
            summaries.append(data.get("changes_summary", ""))

        inc(refinement_failed_chunks_total, amount=len(failed_ranges))

        if initial_run and ranges and not summaries:
            raise RuntimeError(
                f"Refinement failed: all {len(ranges)} chunks exhausted their retries."
            )

        if previous_summary:
            summaries = [previous_summary] + summaries
        if len(summaries) > 1:
            combined_summary = await self._consolidate_refinement_summaries(summaries)
        else:
            combined_summary = summaries[0] if summaries else "No changes needed"

        return LLMRefinementResponse(
            utterances=[Utterance(**u) for u in refined],
            changes_summary=combined_summary,
            failed_ranges=failed_ranges,
        )


def reject_schema_echo(data):
    """Raise if the model returned the JSON schema instead of an instance of it.

    Some models answer a "respond with JSON matching this schema" prompt by
    echoing the schema back. The parsers below then find neither "summary" nor
    "chapters" and produce an empty result, so the user gets a blank analysis
    with no error recorded anywhere — the failure is invisible in logs and
    metrics alike. Detect it at the boundary and fail loudly instead.
    """
    if not isinstance(data, dict):
        return data
    if data.get("type") == "object" and isinstance(data.get("properties"), dict):
        raise ValueError(
            "The language model returned the JSON schema instead of a response "
            "matching it. Try again, or configure a different LLM_MODEL."
        )
    return data


def _parse_summary(data: dict) -> SummaryResult:
    return SummaryResult(
        summary=data.get("summary", ""),
        chapters=[SummaryChapter(**ch) for ch in data.get("chapters", [])],
    )


def _parse_protocol(data: dict) -> ProtocolResult:
    return ProtocolResult(
        title=data.get("title", ""),
        participants=data.get("participants", []),
        key_points=[ProtocolKeyPoint(**kp) for kp in data.get("key_points", [])],
        decisions=[ProtocolDecision(**d) for d in data.get("decisions", [])],
        action_items=[ProtocolActionItem(**ai) for ai in data.get("action_items", [])],
    )

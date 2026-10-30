"""Speaker-label helpers for stored refinements and translations.

Invariant: element ``i`` of a stored ``refined_utterances_json`` or
``translated_utterances_json`` has the ``speaker`` of ``result_json[i]``
(normally ``SPEAKER_xx``, or a name typed with the row pencil), never a name
taken from ``speaker_mappings``. Renaming a speaker then reaches the refined
view, its exports and translations.
"""

import json
import logging
from collections.abc import Sequence
from typing import NamedTuple

import aiosqlite

from app.services.source_tracking import hash_utterance_texts

logger = logging.getLogger(__name__)


def with_speakers_from(source: Sequence[dict], target: Sequence[dict]) -> list[dict]:
    """Return copies of ``target`` whose ``speaker`` comes from ``source``, by position.

    Raises ``ValueError`` if the lengths differ. Inputs are never mutated.
    """
    return [
        {**t, "speaker": s.get("speaker")}
        for s, t in zip(source, target, strict=True)
    ]


def utterances_aligned(original: Sequence[dict], derived: Sequence[dict]) -> bool:
    """Whether ``derived`` has the same utterances as ``original``, judged by their times.

    True iff both have the same length and, at every index, both items are
    dicts with equal ``start`` and equal ``end``. A missing time is never equal.
    """
    return len(original) == len(derived) and all(
        isinstance(o, dict) and isinstance(d, dict)
        and all(key in o and key in d and o[key] == d[key] for key in ("start", "end"))
        for o, d in zip(original, derived)
    )


class RelabelCounts(NamedTuple):
    refinements: int  # refined lists rewritten
    translations: int  # translated lists rewritten
    skipped: int  # lists left as they are: not lined up with the original, or unreadable


def _lines_up(original, derived, metadata_json: str | None) -> bool:
    """Whether ``derived`` provably holds the same utterances as ``original``, in order.

    Equal times at every index, or (refinements only, which pass their
    ``metadata_json``) the same length and a ``source_hash`` showing the texts
    it was made from are still the original's, i.e. only times were edited.
    """
    if not isinstance(original, list) or not isinstance(derived, list):
        return False
    if utterances_aligned(original, derived):
        return True
    if not metadata_json or len(derived) != len(original):
        return False
    metadata = json.loads(metadata_json)
    source_hash = metadata.get("source_hash") if isinstance(metadata, dict) else None
    return bool(source_hash) and source_hash == hash_utterance_texts(original)


async def relabel_stored_speakers(db: aiosqlite.Connection) -> RelabelCounts:
    """Copy the original's speakers, by position, into stored refinements and translations.

    For rows stored before the invariant above held. Only lists that provably
    line up with ``result_json`` change, and only their ``speaker`` fields; any
    other list (original edited since, unreadable JSON) stays byte-for-byte as
    it is. Texts are untouched, so every stored source hash stays valid. Does
    not commit. Rows are read by position: ``init_db``'s connection has no
    ``row_factory``.
    """
    cursor = await db.execute(
        "SELECT id, result_json, refined_utterances_json, refinement_metadata_json, "
        "translated_utterances_json FROM transcriptions "
        "WHERE (refined_utterances_json IS NOT NULL AND refined_utterances_json != '') "
        "OR (translated_utterances_json IS NOT NULL AND translated_utterances_json != '')"
    )
    rows = await cursor.fetchall()
    rewritten = {"refined_utterances_json": 0, "translated_utterances_json": 0}
    skipped = 0
    for tid, result_json, refined_json, metadata_json, translated_json in rows:
        # Only a refinement's metadata carries the hash of the original it was made from.
        for column, derived_json, hash_json in (
            ("refined_utterances_json", refined_json, metadata_json),
            ("translated_utterances_json", translated_json, None),
        ):
            if not derived_json:  # NULL, or the '' marker of a step still in progress
                continue
            try:
                original = json.loads(result_json or "[]")
                derived = json.loads(derived_json)
                lined_up = _lines_up(original, derived, hash_json)
                new = with_speakers_from(original, derived) if lined_up else None
            except Exception as e:
                skipped += 1
                logger.warning(
                    "Speaker relabel skipped %s of transcription %s: %s",
                    column, tid, type(e).__name__,
                )
                continue
            if new is None:
                skipped += 1
            elif new != derived:
                await db.execute(
                    f"UPDATE transcriptions SET {column} = ? WHERE id = ?",
                    (json.dumps(new, ensure_ascii=False), tid),
                )
                rewritten[column] += 1
    counts = RelabelCounts(
        refinements=rewritten["refined_utterances_json"],
        translations=rewritten["translated_utterances_json"],
        skipped=skipped,
    )
    # print, not logger.info: the app configures no logging, so INFO never shows.
    print(
        "Speaker relabel: "
        f"{counts.refinements} refinements and {counts.translations} translations rewritten, "
        f"{counts.skipped} skipped"
    )
    return counts

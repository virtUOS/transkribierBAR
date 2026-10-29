"""How much of Whisper's decoder the initial prompt and hotwords take.

faster-whisper (under whisperx-api-server and MurmurAI alike) puts the hotwords and
the initial prompt in front of every chunk's decoder prompt and caps each at 223
tokens, but not their sum. The decoder holds 448 positions, and CTranslate2 leaves
each chunk min(224, 448 - prompt length) tokens of text: past 448 the job fails,
and above about 224 busy chunks lose text. Together the two fields may therefore
take what one of them may: 223 tokens.

Counted with Whisper's multilingual vocabulary (assets/whisper-multilingual.tiktoken,
from openai/whisper at 839639a, MIT, see assets/whisper-LICENSE); for text it gives
the same tokens as the tokenizer.json the ASR server loads.
"""
import base64
from functools import lru_cache
from pathlib import Path

import tiktoken

PROMPT_TOKEN_LIMIT = 223

_VOCABULARY = Path(__file__).resolve().parent.parent / "assets" / "whisper-multilingual.tiktoken"
_PATTERN = r"""'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+"""


@lru_cache(maxsize=1)
def _encoding() -> tiktoken.Encoding:
    ranks = {}
    for line in _VOCABULARY.read_bytes().splitlines():
        if line:
            token, rank = line.split()
            ranks[base64.b64decode(token)] = int(rank)
    return tiktoken.Encoding(
        name="whisper-multilingual", pat_str=_PATTERN, mergeable_ranks=ranks, special_tokens={},
    )


def _field_tokens(text: str | None) -> int:
    # The ASR backends send a field only when it is non-empty; faster-whisper then
    # encodes " " + text.strip().
    if not text:
        return 0
    return len(_encoding().encode(" " + text.strip(), disallowed_special=()))


def prompt_tokens(initial_prompt: str | None, hotwords: str | None) -> int:
    return _field_tokens(initial_prompt) + _field_tokens(hotwords)

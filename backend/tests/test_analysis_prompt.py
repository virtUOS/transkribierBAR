import json

from app.models import ChapterHint
from app.services.llm.prompt import (
    ANALYSIS_TEMPLATES,
    build_analysis_system_prompt,
    build_consolidation_prompt,
    build_protocol_system_prompt,
    build_system_prompt,
    build_translation_user_prompt,
    chunk_transcript,
    format_transcript_for_llm,
    list_analysis_templates,
)


def test_every_template_builds_without_agenda_text():
    """Every template must build even when no agenda text is supplied.

    The agenda template's prompt contains a literal {agenda} placeholder. When
    the user picks that template but leaves the agenda field empty, the builder
    used to fall through to a .format() call that did not pass `agenda`, raising
    KeyError and surfacing as a 500 from POST /api/analysis/{id}.
    """
    for name in ANALYSIS_TEMPLATES:
        prompt, schema = build_analysis_system_prompt(template_name=name)
        assert prompt
        assert isinstance(schema, dict)


def test_agenda_template_without_agenda_text():
    prompt, _ = build_analysis_system_prompt(template_name="agenda", agenda=None)
    assert prompt
    assert "{agenda}" not in prompt


def test_agenda_template_with_empty_agenda_text():
    prompt, _ = build_analysis_system_prompt(template_name="agenda", agenda="")
    assert prompt
    assert "{agenda}" not in prompt


def test_agenda_template_with_agenda_text_includes_it():
    prompt, _ = build_analysis_system_prompt(
        template_name="agenda", agenda="1. Budget\n2. Hiring"
    )
    assert "1. Budget" in prompt
    assert "{agenda}" not in prompt


def test_unknown_template_falls_back_to_summary():
    prompt, schema = build_analysis_system_prompt(template_name="does-not-exist")
    assert prompt
    assert isinstance(schema, dict)


# --- other prompt builders --------------------------------------------------


def test_summary_prompt_lists_chapter_hints_in_order():
    prompt = build_system_prompt(
        [ChapterHint(title="Intro"), ChapterHint(description="Questions"), ChapterHint(title="End", description="Wrap-up")],
        language="de",
    )
    assert "Respond in German." in prompt
    assert '1. Title: "Intro"' in prompt
    assert '2. Description: "Questions"' in prompt
    assert '3. Title: "End" — Description: "Wrap-up"' in prompt


def test_summary_prompt_without_language_follows_transcript():
    prompt = build_system_prompt()
    assert "same language as the transcript" in prompt
    assert "chapter guidelines" not in prompt


def test_format_transcript_timestamps_and_speaker_mapping():
    text = format_transcript_for_llm(
        [
            {"start": 3_725_000, "end": 0, "text": "late", "speaker": "S1"},
            {"start": 0, "end": 0, "text": "anon", "speaker": None},
            {"start": 61_500, "end": 0, "text": "unmapped", "speaker": "S2"},
        ],
        {"S1": "Alice"},
    )
    assert text.split("\n") == ["[01:02:05] Alice: late", "[00:00:00] anon", "[00:01:01] S2: unmapped"]


def test_chunk_transcript_short_is_one_chunk():
    assert chunk_transcript("a\nb", max_chars=10) == ["a\nb"]


def test_chunk_transcript_splits_on_line_boundaries_without_losing_text():
    lines = [f"line {i:02d}" for i in range(20)]  # 7 chars each
    transcript = "\n".join(lines)
    chunks = chunk_transcript(transcript, max_chars=30)
    assert len(chunks) > 1
    assert all(len(c) <= 30 for c in chunks)
    assert "\n".join(chunks) == transcript


def test_consolidation_prompt_with_and_without_hints():
    plain = build_consolidation_prompt("S1\nS2")
    assert "S1\nS2" in plain
    assert "same language as the content above" in plain
    assert "guidelines" not in plain

    hinted = build_consolidation_prompt("S", [ChapterHint(title="A"), ChapterHint(description="B")], language="fr")
    assert "Respond in French." in hinted
    assert '1. Title: "A"' in hinted and '2. Description: "B"' in hinted
    assert "exactly once" in hinted


def test_protocol_prompt_language():
    assert "Respond in Spanish." in build_protocol_system_prompt("es")
    assert "same language as the transcript" in build_protocol_system_prompt(None)


def test_translation_user_prompt_keeps_non_ascii():
    out = build_translation_user_prompt([{"text": "Grüße"}])
    assert "Grüße" in out
    assert json.loads(out) == [{"text": "Grüße"}]


def test_custom_prompt_uses_permissive_schema_and_language_prefix():
    prompt, schema = build_analysis_system_prompt(template_name="protocol", custom_prompt="Do X", language="de")
    assert prompt == "Respond in German.\nDo X"
    assert schema == {"type": "object"}
    prompt, _ = build_analysis_system_prompt(custom_prompt="Do X")
    assert prompt == "Do X"


def test_builtin_templates_route_to_their_builders():
    summary, _ = build_analysis_system_prompt(template_name="summary", language="en",
                                              chapter_hints=[ChapterHint(title="Intro")])
    assert summary == build_system_prompt([ChapterHint(title="Intro")], "en")
    protocol, schema = build_analysis_system_prompt(template_name="protocol", language="en")
    assert protocol == build_protocol_system_prompt("en")
    assert "action_items" in json.dumps(schema)


def test_unknown_template_prompt_has_no_unfilled_placeholders():
    prompt, _ = build_analysis_system_prompt(template_name="nope", language="de")
    assert "{" + "language_instruction}" not in prompt
    assert "{" + "schema}" not in prompt


def test_list_analysis_templates_exposes_default_prompts():
    templates = {t["id"]: t for t in list_analysis_templates()}
    assert set(templates) == set(ANALYSIS_TEMPLATES)
    assert "{agenda}" in templates["agenda"]["default_prompt"]

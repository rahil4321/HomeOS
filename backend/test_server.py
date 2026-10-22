import pytest

import server


@pytest.mark.parametrize(
    "state,event,urgency,expected",
    [
        ("FOCUS", "Amazon delivery driver dropped a package.", 4, "VISUAL_ONLY"),
        ("FOCUS", "Smoke alarm detected smoke in the kitchen.", 3, "AUDIO_VISUAL_INTERRUPT"),
        ("FOCUS", "Routine weather update: sunny this afternoon.", 1, "IGNORE"),
        ("MEETING", "A package delivery arrived.", 5, "VISUAL_ONLY"),
        ("RELAX", "A notification with urgency 9.", 9, "AUDIO_VISUAL_INTERRUPT"),
    ],
)
def test_fallback_routes(state, event, urgency, expected):
    assert server.fallback_decision(state, event, urgency)["decision"] == expected


def test_model_output_accepts_allowed_decision():
    assert server.validate_model_output({"decision": "VISUAL_ONLY", "reason": "Useful but not urgent."}) == {
        "decision": "VISUAL_ONLY", "reason": "Useful but not urgent."
    }


@pytest.mark.parametrize(
    "bad",
    [None, [], "not json", "{broken", {"decision": "SILENCE", "reason": "bad"},
     {"decision": "IGNORE", "reason": 5}, {"decision": "IGNORE"}],
)
def test_invalid_model_output_is_rejected(bad):
    assert server.validate_model_output(bad) is None


def test_invalid_model_output_uses_fallback():
    result, provenance = server.finalize_decision({"decision": "INVALID", "reason": "oops"}, "FOCUS", "Amazon package delivery", 4)
    assert result["decision"] == "VISUAL_ONLY"
    assert provenance == "Local deterministic fallback"


def test_critical_guardrail_overrides_ai():
    result, provenance = server.finalize_decision(
        {"decision": "IGNORE", "reason": "It seems unimportant."},
        "FOCUS", "Carbon monoxide alarm in the hallway", 1,
    )
    assert result["decision"] == "AUDIO_VISUAL_INTERRUPT"
    assert "guardrail" in provenance


@pytest.mark.parametrize(
    "state,event,urgency",
    [("UNKNOWN", "Package", 3), ("FOCUS", "", 3), ("FOCUS", "x" * 501, 3),
     ("FOCUS", "Package", -1), ("FOCUS", "Package", 11), ("FOCUS", "Package", True),
     ("FOCUS", None, 3)],
)
def test_invalid_event_inputs_raise(state, event, urgency):
    with pytest.raises(ValueError):
        server._validate_event(state, event, urgency)


def test_ignore_clears_stale_notification():
    server.ui_state.update({"show_banner": True, "is_interruption": True, "event_title": "Old critical alert"})
    state = server._record_result(
        "FOCUS", "Routine weather update: sunny this afternoon.", 1, "unit test",
        {"decision": "IGNORE", "reason": "Not relevant."}, "test fallback",
    )
    assert state["show_banner"] is False
    assert state["is_interruption"] is False
    assert state["event_title"] == ""
    assert state["decision"] == "IGNORE"


def test_visual_only_records_history_and_counts():
    before = server.ui_state["silent_count"]
    result = server._record_result("FOCUS", "Package delivery", 4, "test", {
        "decision": "VISUAL_ONLY", "reason": "Low urgency."}, "test")
    assert result["show_banner"] is True
    assert result["is_interruption"] is False
    assert result["silent_count"] == before + 1
    assert result["history"][0]["decision"] == "VISUAL_ONLY"


def test_json_string_model_output_is_parsed():
    parsed = server.validate_model_output('"decision": "IGNORE"')
    assert parsed is None  # JSON must be an object, not a fragment.
    parsed = server.validate_model_output('{"decision":"IGNORE","reason":"Not urgent."}')
    assert parsed == {"decision": "IGNORE", "reason": "Not urgent."}


def test_high_urgency_guardrail_overrides_model():
    result, provenance = server.finalize_decision(
        {"decision": "IGNORE", "reason": "The event seems routine."},
        "FOCUS", "Unclassified event", 9,
    )
    assert result["decision"] == "AUDIO_VISUAL_INTERRUPT"
    assert "guardrail" in provenance

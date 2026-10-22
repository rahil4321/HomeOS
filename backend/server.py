"""HomeOS: semantic interruption router.

FastMCP exposes the evaluate_interruption tool. Starlette custom routes expose
read-only UI state, a protected demo control endpoint, and a signed Alexa skill
webhook. The UI/demo routes never trigger real smart-home actions.
"""
from __future__ import annotations

import hmac
import json
import logging
import os
import re
import threading
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from fastmcp import FastMCP
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse

load_dotenv()
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("homeos")

try:
    from groq import Groq
except ImportError:  # pragma: no cover - clear error in the UI and fallback locally
    Groq = None  # type: ignore[assignment,misc]

try:
    from ask_sdk_core.skill_builder import SkillBuilder
    from ask_sdk_core.utils import is_request_type
    from ask_sdk_webservice_support.verifier import RequestVerifier, TimestampVerifier
    from ask_sdk_webservice_support.webservice_handler import WebserviceSkillHandler
    from cryptography.hazmat.primitives import hashes
    ALEXA_SDK_AVAILABLE = True
except ImportError:  # pragma: no cover
    ALEXA_SDK_AVAILABLE = False

APP_NAME = "HomeOS"
ALLOWED_DECISIONS = {"IGNORE", "VISUAL_ONLY", "AUDIO_VISUAL_INTERRUPT"}
ALLOWED_STATES = {"FOCUS", "RELAX", "SLEEP", "MEETING"}
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
GROQ_TIMEOUT_SECONDS = float(os.getenv("GROQ_TIMEOUT_SECONDS", "3.0"))
HOMEOS_DEMO_TOKEN = os.getenv("HOMEOS_DEMO_TOKEN", "").strip()
ALEXA_SKILL_ID = os.getenv("ALEXA_SKILL_ID", "").strip()

client = None
if Groq is not None and os.getenv("GROQ_API_KEY"):
    try:
        client = Groq(
            api_key=os.getenv("GROQ_API_KEY"),
            timeout=GROQ_TIMEOUT_SECONDS,
            max_retries=0,
        )
    except Exception as exc:  # Do not prevent local fallback from starting.
        logger.warning("Groq client initialization failed; local routing remains available (%s).", type(exc).__name__)

mcp = FastMCP("HomeOS_Semantic_Interruption_Router")
_state_lock = threading.RLock()

ui_state: dict[str, Any] = {
    "app_name": APP_NAME,
    "time_remaining": "45:00",
    "session_label": "DEEP WORK",
    "current_state": "FOCUS",
    "event_title": "",
    "event_desc": "",
    "show_banner": False,
    "is_interruption": False,
    "decision": "IDLE",
    "reason": "HomeOS is monitoring event context.",
    "urgency_score": None,
    "source": "System",
    "model_status": "online" if client else "fallback",
    "backend_status": "online",
    "events_examined": 0,
    "silent_count": 0,
    "interrupt_count": 0,
    "ignored_count": 0,
    "last_updated": datetime.now(timezone.utc).isoformat(),
    "history": [],
}

# These cues always take the interrupt route, even if the model produces a bad
# answer. This is a conservative guardrail, not a certified emergency system.
CRITICAL_CUES = (
    "fire", "smoke alarm", "carbon monoxide", "co alarm", "gas leak",
    "break-in", "break in", "intruder", "medical emergency", "emergency alarm",
    "help me", "distress alarm", "security alarm", "someone is hurt", "heart attack",
)
TRIVIAL_CUES = (
    "weather update", "promotional", "advertisement", "app update",
    "background noise", "routine status update", "unimportant update",
    "marketing notification", "daily forecast",
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _validate_event(current_state: str, incoming_event: str, urgency_score: int) -> tuple[str, str, int]:
    if not isinstance(current_state, str):
        raise ValueError("current_state must be a string")
    if not isinstance(incoming_event, str):
        raise ValueError("incoming_event must be a string")
    state = current_state.strip().upper()
    event = incoming_event.strip()
    if state not in ALLOWED_STATES:
        raise ValueError(f"current_state must be one of {sorted(ALLOWED_STATES)}")
    if not event or len(event) > 500:
        raise ValueError("incoming_event must contain 1–500 characters")
    if isinstance(urgency_score, bool) or not isinstance(urgency_score, int) or not 0 <= urgency_score <= 10:
        raise ValueError("urgency_score must be an integer from 0 to 10")
    return state, event, urgency_score


def fallback_decision(current_state: str, incoming_event: str, urgency_score: int) -> dict[str, str]:
    """Bounded deterministic fallback used on timeout, quota errors or bad output."""
    state = current_state.strip().upper()
    lower = incoming_event.lower()

    if any(cue in lower for cue in CRITICAL_CUES) or urgency_score >= 8:
        return {
            "decision": "AUDIO_VISUAL_INTERRUPT",
            "reason": "A high-urgency signal crossed HomeOS's interrupt threshold; local fallback applied.",
        }

    if urgency_score <= 2 and any(cue in lower for cue in TRIVIAL_CUES):
        return {
            "decision": "IGNORE",
            "reason": "The event is low-urgency background information and does not need attention now.",
        }

    if state in {"FOCUS", "SLEEP", "MEETING"}:
        return {
            "decision": "VISUAL_ONLY",
            "reason": "The user is in a protected session and the event did not meet the interrupt threshold.",
        }

    if urgency_score <= 2:
        return {
            "decision": "IGNORE",
            "reason": "The event's urgency is too low to justify a notification.",
        }

    return {
        "decision": "VISUAL_ONLY",
        "reason": "The event is useful to surface, but it does not justify an audio interruption.",
    }


def validate_model_output(raw: Any) -> dict[str, str] | None:
    """Validate shape and category before applying any model-proposed action."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return None
    if not isinstance(raw, dict):
        return None
    decision = raw.get("decision")
    reason = raw.get("reason")
    if not isinstance(decision, str) or decision not in ALLOWED_DECISIONS:
        return None
    if not isinstance(reason, str):
        return None
    reason = re.sub(r"\s+", " ", reason).strip()[:240]
    if not reason:
        return None
    return {"decision": decision, "reason": reason}


def finalize_decision(
    model_output: Any,
    current_state: str,
    incoming_event: str,
    urgency_score: int,
) -> tuple[dict[str, str], str]:
    """Return validated routing output and a provenance label."""
    validated = validate_model_output(model_output)
    provenance = "Groq / GPT-OSS-20B" if validated else "Local deterministic fallback"
    result = validated or fallback_decision(current_state, incoming_event, urgency_score)

    # Safety guardrail outranks the LLM. Do not present HomeOS as a life-safety
    # certified system; this simply avoids suppressing obvious critical cues.
    lower = incoming_event.lower()
    if (any(cue in lower for cue in CRITICAL_CUES) or urgency_score >= 8) and result["decision"] != "AUDIO_VISUAL_INTERRUPT":
        result = {
            "decision": "AUDIO_VISUAL_INTERRUPT",
            "reason": "A local critical-event or urgency guardrail overrode the model's route.",
        }
        provenance = f"{provenance} + local priority guardrail"
    return result, provenance


def _call_groq(current_state: str, incoming_event: str, urgency_score: int) -> Any:
    if client is None:
        return None

    prompt = f"""You are HomeOS, a semantic interruption router. Choose a notification route, not an action.
USER CONTEXT: {current_state}
EVENT: {incoming_event}
URGENCY: {urgency_score}/10

Allowed decisions:
- IGNORE: genuinely trivial, low-value background information.
- VISUAL_ONLY: useful but not urgent; preserve attention, especially during FOCUS, SLEEP or MEETING.
- AUDIO_VISUAL_INTERRUPT: genuinely urgent or safety-relevant and should demand attention immediately.

Policy: urgency 8-10 normally interrupts; urgency 3-7 normally becomes visual-only during protected states; urgency 0-2 can be ignored when genuinely trivial. Interpret the event's meaning as well as the numeric score. Never invent sensors or facts. Be concise and conservative. A separate deterministic guardrail overrides obvious critical cues.

Return only JSON with exactly these keys and value types:
{{"decision":"IGNORE|VISUAL_ONLY|AUDIO_VISUAL_INTERRUPT", "reason":"one sentence explaining the route"}}"""
    try:
        completion = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "You make careful, explainable notification-routing decisions. Output JSON only."},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=180,
            reasoning_effort="low",
        )
        content = completion.choices[0].message.content
        return json.loads(content or "{}")
    except Exception as exc:
        logger.warning("Groq inference unavailable; local routing takes over (%s).", type(exc).__name__)
        return None


def _record_result(
    current_state: str,
    incoming_event: str,
    urgency_score: int,
    source: str,
    result: dict[str, str],
    provenance: str,
) -> dict[str, Any]:
    decision = result["decision"]
    if decision == "VISUAL_ONLY":
        title = "Silent notification"
        desc = f"{incoming_event} (muted during {current_state.lower()})"
        show_banner = True
        is_interruption = False
    elif decision == "AUDIO_VISUAL_INTERRUPT":
        title = "Priority interruption"
        desc = incoming_event
        show_banner = True
        is_interruption = True
    else:  # IGNORE must clear stale banners and previous interruption styling.
        title = ""
        desc = ""
        show_banner = False
        is_interruption = False

    history_entry = {
        "id": f"{datetime.now(timezone.utc).timestamp():.6f}",
        "time": datetime.now().astimezone().strftime("%H:%M:%S"),
        "event": incoming_event,
        "context": current_state,
        "urgency": urgency_score,
        "decision": decision,
        "reason": result["reason"],
        "source": source,
        "provenance": provenance,
    }
    with _state_lock:
        ui_state["current_state"] = current_state
        ui_state["event_title"] = title
        ui_state["event_desc"] = desc
        ui_state["show_banner"] = show_banner
        ui_state["is_interruption"] = is_interruption
        ui_state["decision"] = decision
        ui_state["reason"] = result["reason"]
        ui_state["urgency_score"] = urgency_score
        ui_state["source"] = source
        ui_state["model_status"] = "online" if provenance.startswith("Groq") else "fallback"
        ui_state["events_examined"] += 1
        if decision == "VISUAL_ONLY":
            ui_state["silent_count"] += 1
        elif decision == "AUDIO_VISUAL_INTERRUPT":
            ui_state["interrupt_count"] += 1
        else:
            ui_state["ignored_count"] += 1
        ui_state["last_updated"] = _utc_now()
        ui_state["history"] = [history_entry, *ui_state["history"][:7]]
        snapshot = dict(ui_state)
        snapshot["history"] = list(ui_state["history"])
    logger.info("Route=%s | source=%s | provenance=%s | reason=%s", decision, source, provenance, result["reason"])
    return snapshot


def _route_event(current_state: str, incoming_event: str, urgency_score: int, source: str, force_fallback: bool = False) -> str:
    state, event, urgency = _validate_event(current_state, incoming_event, urgency_score)
    model_output = None if force_fallback else _call_groq(state, event, urgency)
    result, provenance = finalize_decision(model_output, state, event, urgency)
    _record_result(state, event, urgency, source, result, provenance)
    return json.dumps({**result, "provenance": provenance}, ensure_ascii=False)


@mcp.tool()
def evaluate_interruption(current_state: str, incoming_event: str, urgency_score: int) -> str:
    """Route a smart-home event as IGNORE, VISUAL_ONLY, or AUDIO_VISUAL_INTERRUPT."""
    return _route_event(current_state, incoming_event, urgency_score, "MCP tool")


@mcp.tool()
def route_home_event(current_state: str, incoming_event: str, urgency_score: int) -> str:
    """Alias for evaluate_interruption; returns a validated, explainable route."""
    return _route_event(current_state, incoming_event, urgency_score, "MCP tool")


@mcp.custom_route("/health", methods=["GET"])
async def health(request: Request):
    return JSONResponse({"ok": True, "service": APP_NAME, "groq_configured": client is not None, "alexa_verification": ALEXA_SDK_AVAILABLE})


@mcp.custom_route("/state", methods=["GET"])
async def get_state(request: Request):
    with _state_lock:
        snapshot = dict(ui_state)
        snapshot["history"] = list(ui_state["history"])
    return JSONResponse(snapshot, headers={
        "Access-Control-Allow-Origin": os.getenv("FRONTEND_ORIGIN", "http://localhost:3000"),
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "no-store, max-age=0",
    })


@mcp.custom_route("/state", methods=["OPTIONS"])
async def state_preflight(request: Request):
    return JSONResponse({}, headers={
        "Access-Control-Allow-Origin": os.getenv("FRONTEND_ORIGIN", "http://localhost:3000"),
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
    })


DEMO_SCENARIOS: dict[str, tuple[str, str, int]] = {
    "delivery": ("FOCUS", "Amazon delivery driver dropped a package.", 4),
    "urgent": ("FOCUS", "Smoke alarm detected smoke in the kitchen.", 9),
    "trivial": ("FOCUS", "Routine weather update: sunny this afternoon.", 1),
    "meeting": ("MEETING", "A routine package delivery arrived at the front door.", 4),
    "offline": ("FOCUS", "Amazon delivery driver dropped a package.", 4),
}


@mcp.custom_route("/demo/event", methods=["POST"])
async def demo_event(request: Request):
    """Protected hackathon-demo input. No real devices or notifications are actuated."""
    if not HOMEOS_DEMO_TOKEN:
        return JSONResponse({"error": "Demo controls are disabled. Configure HOMEOS_DEMO_TOKEN in backend/.env."}, status_code=503)
    supplied = request.headers.get("x-homeos-demo-key", "")
    if not hmac.compare_digest(supplied, HOMEOS_DEMO_TOKEN):
        return JSONResponse({"error": "Unauthorized demo request."}, status_code=401)
    try:
        body = await request.json()
        scenario = body.get("scenario") if isinstance(body, dict) else None
        if scenario == "reset":
            with _state_lock:
                ui_state.update({
                    "current_state": "FOCUS", "event_title": "", "event_desc": "",
                    "show_banner": False, "is_interruption": False, "decision": "IDLE",
                    "reason": "Focus protected. Choose an event to see how HomeOS routes it.",
                    "urgency_score": None, "source": "Demo reset", "last_updated": _utc_now(),
                })
                snapshot = dict(ui_state)
                snapshot["history"] = list(ui_state["history"])
            return JSONResponse(snapshot)
        if not isinstance(scenario, str) or scenario not in DEMO_SCENARIOS:
            return JSONResponse({"error": "Unknown scenario."}, status_code=400)
        state, event, urgency = DEMO_SCENARIOS[scenario]
        if scenario == "offline":
            output = await run_in_threadpool(_route_event, state, event, urgency, "Offline resilience test", True)
        else:
            output = await run_in_threadpool(_route_event, state, event, urgency, "Dashboard demo")
        with _state_lock:
            snapshot = dict(ui_state)
            snapshot["history"] = list(ui_state["history"])
        return JSONResponse({"result": json.loads(output), "state": snapshot})
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:
        logger.exception("Demo event failed")
        return JSONResponse({"error": f"Demo event failed ({type(exc).__name__})."}, status_code=500)


# Alexa webhook built with the official ASK SDK web-service verifier. It checks
# the SHA-256 request signature and timestamp before dispatching the skill.
if ALEXA_SDK_AVAILABLE:
    from ask_sdk_core.skill_builder import SkillBuilder
    from ask_sdk_core.utils import is_request_type
    from ask_sdk_webservice_support.verifier import RequestVerifier, TimestampVerifier
    from ask_sdk_webservice_support.webservice_handler import WebserviceSkillHandler
    from cryptography.hazmat.primitives import hashes

    skill_builder = SkillBuilder()

    @skill_builder.request_handler(can_handle_func=is_request_type("LaunchRequest"))
    def launch_request_handler(handler_input):
        _route_event("FOCUS", "Amazon delivery driver dropped a package.", 4, "Alexa LaunchRequest")
        speech = "Home OS activated. I processed a simulated delivery event and updated your focus display."
        return handler_input.response_builder.speak(speech).set_should_end_session(True).response

    @skill_builder.request_handler(can_handle_func=is_request_type("SessionEndedRequest"))
    def session_ended_handler(handler_input):
        return handler_input.response_builder.set_should_end_session(True).response

    @skill_builder.request_handler(can_handle_func=lambda handler_input: True)
    def fallback_request_handler(handler_input):
        speech = "Home OS is monitoring your environment. Try opening Home OS to test interruption routing."
        return handler_input.response_builder.speak(speech).set_should_end_session(True).response

    # Prefer Alexa's modern SHA-256 header; timestamp tolerance is the SDK's 150s.
    alexa_webservice_handler = WebserviceSkillHandler(
        skill_builder.create(),
        verify_signature=False,
        verify_timestamp=False,
        verifiers=[
            RequestVerifier(signature_key="Signature-256", hash_algorithm=hashes.SHA256()),
            TimestampVerifier(),
        ],
    )
else:
    alexa_webservice_handler = None
    logger.warning("ASK SDK web-service support is not installed; /alexa will reject requests. Install backend/requirements.txt.")


@mcp.custom_route("/alexa", methods=["POST"])
async def alexa_webhook(request: Request):
    if alexa_webservice_handler is None:
        return JSONResponse({"error": "Alexa request verification package is missing."}, status_code=503)
    raw_body = await request.body()
    try:
        body_text = raw_body.decode("utf-8")
        payload = json.loads(body_text)
        if ALEXA_SKILL_ID:
            app_id = (
                payload.get("session", {}).get("application", {}).get("applicationId")
                or payload.get("context", {}).get("System", {}).get("application", {}).get("applicationId")
            )
            if app_id != ALEXA_SKILL_ID:
                return JSONResponse({"error": "Request is not for the configured skill."}, status_code=400)
        response_text = await run_in_threadpool(
            alexa_webservice_handler.verify_request_and_dispatch,
            dict(request.headers),
            body_text,
        )
        if isinstance(response_text, str):
            response_text = json.loads(response_text)

        return JSONResponse(response_text)
    except Exception as exc:
        logger.warning("Rejected Alexa webhook request (%s): %s", type(exc).__name__, str(exc)[:240])
        # Amazon expects a 4xx response for failed signature/timestamp checks.
        return JSONResponse({"error": "Invalid Alexa request."}, status_code=400)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    logger.info("Starting %s on port %s; Groq=%s; ASK SDK=%s", APP_NAME, port, bool(client), ALEXA_SDK_AVAILABLE)
    mcp.run(transport="http", host="0.0.0.0", port=port)

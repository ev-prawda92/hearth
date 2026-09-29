"""v3 routing: the model decides the route, the keyword floor and the policy math stay underneath.

These tests use a stand-in model so they run without an API key. The recorded results of the real
model are checked separately (test_v3_release_gate), once a recorded run exists.
"""
from __future__ import annotations

import json
import types

import pytest

from hearth import model as m
from hearth.conversation import SAFETY_OPTION, turn
from hearth.engine import answer
from hearth.evals import EVAL_DIR
from hearth.v3 import answer_v3


class StubRouter:
    """Returns a fixed route; records what it was asked."""

    model = "stub"

    def __init__(self, route: str, article: str | None = None, fail: bool = False):
        self.out = {"route": route, "article": article, "reason": "stub", "latency_ms": 1}
        self.fail = fail
        self.asked: list[str] = []

    def route(self, question: str, r: dict) -> dict:
        self.asked.append(question)
        if self.fail:
            raise m.ModelError("stub outage")
        return m.validate(self.out, r["role"]) | {"latency_ms": 1}


def test_model_catches_safety_the_keywords_miss():
    q = "there is a strange man sleeping in the garden shed"
    assert answer(q, "HT-2218", 0.45)["queue"] != "safety"
    a = answer_v3(q, "HT-2218", 0.45, router=StubRouter("safety"))
    assert a["queue"] == "safety" and a["safety_sources"] == ["model"]


def test_keyword_floor_keeps_what_v23_caught():
    q = "I want to cancel, there's a fire in the building"
    a = answer_v3(q, "HT-1042", 0.45, router=StubRouter("article", "HC-01"))
    assert a["queue"] == "safety" and a["safety_sources"] == ["keywords"]


def test_policy_math_stays_in_code():
    a = answer_v3("I need to cancel, how much do I get back?", "HT-1042", 0.45, router=StubRouter("article", "HC-01"))
    assert a["decision"] == "answer" and a["article"] == "HC-01"
    assert "€517" in a["text"]


def test_wrong_audience_pick_becomes_unclear():
    out = m.validate({"route": "article", "article": "HC-06", "reason": "x"}, role="guest")
    assert out["route"] == "unclear" and out["article"] is None


@pytest.mark.parametrize("bad", [{"route": "maybe", "article": None, "reason": ""},
                                 {"route": "article", "article": "HC-99", "reason": ""},
                                 {"route": "article", "article": None, "reason": ""}])
def test_malformed_model_output_is_rejected(bad):
    with pytest.raises(m.ModelError):
        m.validate(bad, role="guest")


def test_outage_falls_back_to_v23_and_says_so():
    q = "how do I get my receipt"
    a = answer_v3(q, "HT-1042", 0.45, router=StubRouter("article", "HC-10", fail=True))
    base = answer(q, "HT-1042", 0.45)
    assert a["degraded"] is True
    assert (a["decision"], a.get("article"), a["queue"]) == (base["decision"], base.get("article"), base["queue"])


def test_unclear_goes_to_the_clarifying_menu_with_the_safety_escape():
    out = turn("HT-1042", {"type": "message", "text": "hmm quick question"}, engine="v3",
               router=StubRouter("unclear"))
    assert out["kind"] == "clarify"
    assert SAFETY_OPTION in [o["id"] for o in out["options"]]


def test_model_sees_role_and_stage_but_no_money_or_names():
    from hearth.data import RESERVATIONS

    r = RESERVATIONS["HT-1042"]
    msg = m.user_message("can I cancel?", r)
    assert "guest" in msg and "upcoming" in msg
    for leaked in (r["name"], r["host"], str(r["nightly"]), r["cur"], r["check_in"]):
        assert leaked not in msg


def _fake_api(counter: list):
    def create(**req):
        counter.append(req)
        block = types.SimpleNamespace(type="tool_use", input={"route": "article", "article": "HC-01", "reason": "x"})
        return types.SimpleNamespace(content=[block], usage=types.SimpleNamespace(input_tokens=900, output_tokens=40))

    return types.SimpleNamespace(messages=types.SimpleNamespace(create=create))


def test_record_then_replay(tmp_path):
    from hearth.data import RESERVATIONS

    r = RESERVATIONS["HT-1042"]
    calls: list = []
    rec = m.ModelRouter(model="fake", mode="record", recorder=m.Recorder(tmp_path), client=_fake_api(calls))
    assert rec.route("can I cancel?", r)["article"] == "HC-01"
    assert rec.route("can I cancel?", r)["article"] == "HC-01"
    assert len(calls) == 1, "the second identical request must come from the recording"
    assert rec.stats["calls"] == 1 and rec.stats["input_tokens"] == 900

    rep = m.ModelRouter(model="fake", mode="replay", recorder=m.Recorder(tmp_path), client=_fake_api(calls))
    assert rep.route("can I cancel?", r)["article"] == "HC-01"
    assert len(calls) == 1
    with pytest.raises(m.CacheMiss):
        rep.route("a message nobody recorded", r)


def test_request_key_changes_with_the_prompt_and_the_message():
    from hearth.data import RESERVATIONS

    r = RESERVATIONS["HT-1042"]
    a = m.request_key(m.request_for("can I cancel?", r, "x"))
    assert a == m.request_key(m.request_for("can I cancel?", r, "x"))
    assert a != m.request_key(m.request_for("can I cancel? ", r, "x"))
    assert a != m.request_key(m.request_for("can I cancel?", r, "y"))


def test_replay_mode_is_the_default_so_tests_never_call_the_api(monkeypatch):
    monkeypatch.delenv("HEARTH_MODEL_MODE", raising=False)
    assert m.ModelRouter().mode == "replay"


REPORT = EVAL_DIR / "v3_report.json"


@pytest.mark.skipif(not REPORT.exists(), reason="No recorded v3 run yet (run the 'Record v3 model run' workflow)")
def test_v3_release_gate():
    """Same gate v2.3 failed: every red-team emergency reaches the safety line on the first message."""
    v3 = json.loads(REPORT.read_text())["engines"]["v3"]
    assert v3["degraded"] == 0
    assert v3["redteam"]["first_message_recall"] == 1.0 and v3["redteam"]["answered_instead"] == 0


def test_client_errors_fail_fast_and_server_errors_retry(monkeypatch, tmp_path):
    from hearth.data import RESERVATIONS

    monkeypatch.setattr(m.time, "sleep", lambda s: None)
    r = RESERVATIONS["HT-1042"]

    class Err(Exception):
        def __init__(self, status):
            self.status_code = status

    def api(statuses):
        calls = []

        def create(**req):
            calls.append(1)
            raise Err(statuses[min(len(calls), len(statuses)) - 1])

        return types.SimpleNamespace(messages=types.SimpleNamespace(create=create)), calls

    client, calls = api([401])
    with pytest.raises(m.ModelError, match="401"):
        m.ModelRouter(model="x", mode="live", client=client).route("hi", r)
    assert len(calls) == 1

    client, calls = api([529] * 6)
    with pytest.raises(m.ModelError, match="after 6 attempts"):
        m.ModelRouter(model="x", mode="record", recorder=m.Recorder(tmp_path), client=client).route("hi", r)
    assert len(calls) == 6

    client, calls = api([529])
    with pytest.raises(m.ModelError, match="after 1 attempts"):
        m.ModelRouter(model="x", mode="live", client=client).route("hi", r)
    assert len(calls) == 1, "the live app gets one quick attempt, then falls back"


def test_retry_after_header_is_honored():
    e = Exception()
    e.response = types.SimpleNamespace(headers={"retry-after": "7"})
    assert m._retry_after(e) == 7.0
    assert m._retry_after(Exception()) is None

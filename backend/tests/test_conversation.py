import pytest
from fastapi.testclient import TestClient

from hearth.api import app
from hearth.conversation import HUMAN_OPTION, OTHER_OPTION, SAFETY_OPTION, turn
from hearth.evals import run_eval

client = TestClient(app)
msg = lambda text: {"type": "message", "text": text}  # noqa: E731


@pytest.mark.parametrize("text,queue", [
    ("I smell gas", "safety"), ("my friend passed out", "safety"),
    ("the host is being racist", "trust"), ("let me talk to a real person", "specialist"),
])
def test_non_negotiables_hand_off_on_the_first_message(text, queue):
    out = turn("HT-3307", msg(text))
    assert out["kind"] == "handoff" and out["queue"] == queue


def test_unclear_question_gets_a_clarifying_menu_with_escapes():
    out = turn("HT-6031", msg("The gate won't unlock"))
    assert out["kind"] == "clarify"
    ids = [o["id"] for o in out["options"]]
    assert "HC-04" in ids and SAFETY_OPTION in ids and HUMAN_OPTION in ids and OTHER_OPTION in ids


def test_every_menu_offers_the_safety_escape():
    out = turn("HT-2218", msg("what's a good restaurant"))
    while out["kind"] == "clarify":
        assert SAFETY_OPTION in [o["id"] for o in out["options"]]
        out = turn("HT-2218", {"type": "choose", "option": OTHER_OPTION}, out["state"])
    assert out["kind"] == "handoff"


def test_safety_escape_goes_to_safety_line():
    out = turn("HT-2218", msg("A stranger walked into our cabin without knocking"))
    out = turn("HT-2218", {"type": "choose", "option": SAFETY_OPTION}, out["state"])
    assert out["kind"] == "handoff" and out["queue"] == "safety"


@pytest.mark.parametrize("budget", [0, 1, 2])
def test_clarifying_budget_is_respected(budget):
    out = turn("HT-2218", msg("what's a good restaurant"), None, max_clarify=budget)
    asked = 0
    while out["kind"] == "clarify":
        asked += 1
        out = turn("HT-2218", {"type": "choose", "option": OTHER_OPTION}, out["state"], max_clarify=budget)
    assert asked == budget and out["kind"] == "handoff"


def test_money_actions_need_confirmation_and_typed_yes_works():
    out = turn("HT-1042", msg("how much would I get back if I cancel"))
    assert out["actions"][0]["id"] == "cancel_reservation"
    out = turn("HT-1042", {"type": "action", "action": "cancel_reservation"}, out["state"])
    assert out["kind"] == "confirm" and out["state"]["overrides"] == {}
    out = turn("HT-1042", msg("yes"), out["state"])
    assert out["kind"] == "done" and out["state"]["overrides"]["status"] == "cancelled"
    again = turn("HT-1042", msg("can I cancel?"), out["state"])
    assert "already cancelled" in again["text"] and again["actions"] == []


def test_declining_changes_nothing():
    out = turn("HT-1042", {"type": "action", "action": "cancel_reservation"})
    out = turn("HT-1042", {"type": "action", "action": "cancel_reservation", "confirm": False}, out["state"])
    assert out["kind"] == "notice" and out["state"]["overrides"] == {}


def test_actions_are_limited_to_the_reservation():
    out = turn("HT-1042", {"type": "action", "action": "host_cancel", "confirm": True})
    assert out["kind"] == "notice"


def test_follow_up_message_uses_earlier_context():
    out = turn("HT-1042", msg("hmm quick question"))
    assert out["kind"] == "clarify"
    out = turn("HT-1042", msg("the lockbox"), out["state"])
    assert out["kind"] == "answer" and out["article"] == "HC-04"


def test_clarifying_never_adds_wrong_answers():
    for split in ("dev", "holdout"):
        assert run_eval(split=split)["summary"]["conv_wrong_answers"] == 0


def test_api_turn_flow_logs_actions_and_tickets():
    r = client.post("/api/turn", json={"reservation_id": "HT-4410", "input": {"type": "message", "text": "the guests cracked the table"}}).json()
    assert r["kind"] == "answer" and r["actions"][0]["id"] == "start_claim"
    r = client.post("/api/turn", json={"reservation_id": "HT-4410", "input": {"type": "action", "action": "start_claim", "confirm": True}, "state": r["state"]}).json()
    assert r["kind"] == "done"
    assert client.get("/api/actions").json()[0]["code"] == "CLM-4410"
    r = client.post("/api/turn", json={"reservation_id": "HT-4410", "input": {"type": "message", "text": "there is a fire"}}).json()
    assert r["ticket_id"].startswith("T-")
    assert client.post("/api/turn", json={"reservation_id": "HT-4410", "input": {"type": "bogus"}}).status_code == 422

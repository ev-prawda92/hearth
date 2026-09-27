import json

import pytest
from fastapi.testclient import TestClient

from hearth import text as tx
from hearth.api import app
from hearth.data import RESERVATIONS
from hearth.engine import answer, refund_for
from hearth.evals import EVAL_DIR, run_eval

client = TestClient(app)


# ---- policy math

@pytest.mark.parametrize("rid,refund", [
    ("HT-1042", 517),    # Flexible, 6 days out: full refund
    ("HT-2218", 85),     # Strict, 4 days out: cleaning fee only
    ("HT-3307", 96),     # Moderate mid-stay: 2 nights at 50%
    ("HT-5120", 210),    # Moderate, 2 days out: 50% of nights + cleaning
    ("HT-6031", 48000),  # Flexible, check-in today: first night non-refundable
])
def test_refund_math(rid, refund):
    assert refund_for(RESERVATIONS[rid])["refund"] == refund


# ---- text handling

def test_stemming_and_typos():
    assert tx.stem("cancelled") == tx.stem("cancelling") == tx.stem("cancel")
    assert tx.edit_distance_le1("cancl", "cancel")
    assert tx.edit_distance_le1("cancle", "cancel")  # transposition
    assert not tx.edit_distance_le1("cancel", "parcel")


def test_negation_is_ignored():
    a = answer("I don't want to cancel, I just want to change my dates", "HT-1042")
    assert a["article"] == "HC-03"
    assert any("negated" in r for r in a["rules"])


def test_refund_status_rule():
    assert answer("I already cancelled, where is my money?", "HT-1042")["article"] == "HC-02"
    assert answer("if I cancel do I still get a refund", "HT-1042")["article"] == "HC-01"


# ---- routing

@pytest.mark.parametrize("q,queue", [
    ("I smell gas in the hallway", "safety"),
    ("my friend passed out", "safety"),
    ("the host is being racist", "trust"),
    ("let me talk to a real person", "specialist"),
])
def test_routing(q, queue):
    a = answer(q, "HT-3307")
    assert a["decision"] == "handoff" and a["queue"] == queue


def test_safety_beats_everything():
    a = answer("I want to cancel, there's a fire in the building", "HT-1042", threshold=0.0)
    assert a["queue"] == "safety"


def test_smoking_question_is_not_a_safety_case():
    assert answer("can I smoke on the balcony?", "HT-1042")["queue"] != "safety"


def test_role_mismatch_hands_off():
    a = answer("when do I get paid?", "HT-1042")
    assert a["decision"] == "handoff" and "host-only" in a["reason"]


def test_every_question_runs_on_every_reservation():
    from hearth.evals import load_cases
    for rid in RESERVATIONS:
        for c in load_cases("all"):
            for t in (0.0, 0.45, 1.0):
                answer(c["question"], rid, t)


# ---- release gates (these fail the build)

def test_dev_gates():
    s = run_eval(split="dev")["summary"]
    assert s["safety_recall"] == 1.0
    assert s["citation_accuracy"] >= 0.95
    assert s["personalization"] >= 0.9


def test_holdout_has_no_wrong_answers():
    assert run_eval(split="holdout")["summary"]["wrong_answers"] == 0


def test_eval_files_are_well_formed():
    for name in ("dev", "holdout"):
        for line in (EVAL_DIR / f"{name}.jsonl").read_text().splitlines():
            c = json.loads(line)
            assert c["reservation_id"] in RESERVATIONS
            assert ("queue" in c) == (c["expect"] == "HANDOFF")


# ---- API

def test_api_answer_and_ticket():
    r = client.post("/api/answer", json={"question": "there's smoke coming from the kitchen", "reservation_id": "HT-6031"})
    assert r.status_code == 200 and r.json()["queue"] == "safety"
    tickets = client.get("/api/handoffs").json()
    assert tickets[0]["id"] == r.json()["ticket_id"]
    assert client.post(f"/api/handoffs/{tickets[0]['id']}/resolve").json()["status"] == "resolved"


def test_api_validation():
    assert client.post("/api/answer", json={"question": "hi", "reservation_id": "NOPE"}).status_code == 404
    assert client.post("/api/answer", json={"question": "", "reservation_id": "HT-1042"}).status_code == 422
    assert client.get("/api/eval?split=bogus").status_code == 400


def test_api_eval_and_sweep():
    e = client.get("/api/eval?threshold=0.45&split=all").json()
    assert set(e["by_split"]) == {"dev", "holdout"}
    assert len(client.get("/api/sweep").json()) == 13
    assert [h["version"] for h in client.get("/api/history").json()] [:4] == ["v1", "v2", "v2.1", "v2.2"]

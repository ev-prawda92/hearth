"""Exports shared data and golden outputs for the front end's offline demo build.

The demo build runs a TypeScript port of the engine so it can be shared as a single page.
golden.json lets the front-end test suite prove the port gives identical answers.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from hearth import data  # noqa: E402
from hearth.conversation import OTHER_OPTION, SAFETY_OPTION, turn  # noqa: E402
from hearth.engine import ENGINE_VERSION, answer  # noqa: E402
from hearth.evals import EVAL_DIR, load_cases, run_eval, sweep  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "demo"

EXTRA_PROBES = [
    "", "   ", "cancel", "CANCEL!!!", "can I smoke on the balcony?", "is there a gas station nearby",
    "I want to cancel, there's a fire in the building", "rebook", "escalate", "refund refund refund",
    "the stain on the couch was there before", "we don't need to cancel anymore, can we add a guest",
    "what's your cancellation policy?", "how does the hood attach", "I want to check the status of my refund",
    "where can I see the status of my reimbursement", "I was charged for a stay I never booked, the charge was not reversed",
    "how do I reset my account password", "cancel my premium account", "check in which cases I get a refund",
    "what hours can I reach customer support", "can I edit my reservation", "I need my bill",
]


SCRIPTS = [
    ("HT-6031", [{"type": "message", "text": "The gate won't unlock"}, {"type": "choose", "option": "HC-04"},
                 {"type": "action", "action": "resend_entry"}]),
    ("HT-1042", [{"type": "message", "text": "how much would I get back if I cancel"},
                 {"type": "action", "action": "cancel_reservation"}, {"type": "message", "text": "yes"},
                 {"type": "message", "text": "can I cancel?"}, {"type": "message", "text": "email me the receipt"},
                 {"type": "action", "action": "send_receipt"}]),
    ("HT-2218", [{"type": "message", "text": "whats a good restaurant"}, {"type": "choose", "option": OTHER_OPTION},
                 {"type": "message", "text": "somewhere for dinner tonight"}]),
    ("HT-2218", [{"type": "message", "text": "A stranger walked into our cabin"}, {"type": "choose", "option": SAFETY_OPTION}]),
    ("HT-1042", [{"type": "message", "text": "hmm quick question"}, {"type": "message", "text": "the lockbox"},
                 {"type": "action", "action": "resend_entry"}]),
    ("HT-4410", [{"type": "message", "text": "the guests cracked the table"}, {"type": "action", "action": "start_claim"},
                 {"type": "message", "text": "no"}, {"type": "message", "text": "I have to cancel my next guest"},
                 {"type": "action", "action": "host_cancel", "confirm": True}, {"type": "message", "text": "cancel my next guest"}]),
    ("HT-3307", [{"type": "message", "text": "we want to leave early"}, {"type": "action", "action": "cancel_reservation", "confirm": True},
                 {"type": "choose", "option": "HUMAN"}]),
    ("HT-5120", [{"type": "message", "text": "can we bring the dog"}, {"type": "action", "action": "notify_assistance_animal"},
                 {"type": "message", "text": "sure"}, {"type": "message", "text": "x"}, {"type": "choose", "option": "OTHER"},
                 {"type": "choose", "option": "OTHER"}]),
]


def conversations() -> list[dict]:
    out = []
    for rid, steps in SCRIPTS:
        for mc in (0, 1, 2):
            state, results = None, []
            for inp in steps:
                r = turn(rid, inp, state, 0.45, mc)
                state = r["state"]
                results.append(r)
            out.append({"rid": rid, "max_clarify": mc, "steps": steps, "results": results})
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    shared = {
        "engine": ENGINE_VERSION, "as_of": data.AS_OF, "reservations": data.RESERVATIONS, "articles": data.ARTICLES,
        "safety_terms": data.SAFETY_TERMS, "sensitive_terms": data.SENSITIVE_TERMS, "human_terms": data.HUMAN_TERMS,
        "status_cues": data.STATUS_CUES, "hypothetical_cues": data.HYPOTHETICAL_CUES,
        "strong_status_cues": data.STRONG_STATUS_CUES, "out_of_scope_terms": data.OUT_OF_SCOPE_TERMS,
        "in_domain_anchors": data.IN_DOMAIN_ANCHORS,
        "cases": load_cases("all"), "history": json.loads((EVAL_DIR / "history.json").read_text()),
        "external": json.loads((EVAL_DIR / "external_report.json").read_text()),
    }
    (OUT / "data.json").write_text(json.dumps(shared, ensure_ascii=False, indent=1))

    golden = []
    questions = [c["question"] for c in load_cases("all")] + [q for q in EXTRA_PROBES if q.strip()]
    for rid in data.RESERVATIONS:
        for q in questions:
            for t in (0.45, 0.7):
                golden.append({"q": q, "rid": rid, "t": t, "out": answer(q, rid, t)})
    evals = {f"{s}@{t}@{m}": run_eval(t, s, m)["summary"]
             for s in ("all", "dev", "holdout") for t in (0.3, 0.45, 0.7) for m in (0, 2)}
    (OUT / "golden.json").write_text(json.dumps({"answers": golden, "evals": evals, "sweep": sweep("all"),
                                                 "conversations": conversations()},
                                                ensure_ascii=False))
    print(f"wrote data.json and golden.json ({len(golden)} answers)")


if __name__ == "__main__":
    main()

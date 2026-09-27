"""Exports shared data and golden outputs for the front end's offline demo build.

The demo build runs a TypeScript port of the engine so it can be shared as a single page.
golden.json lets the front-end test suite prove the port gives identical answers.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from hearth import data  # noqa: E402
from hearth.engine import ENGINE_VERSION, answer  # noqa: E402
from hearth.evals import EVAL_DIR, load_cases, run_eval, sweep  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "demo"

EXTRA_PROBES = [
    "", "   ", "cancel", "CANCEL!!!", "can I smoke on the balcony?", "is there a gas station nearby",
    "I want to cancel, there's a fire in the building", "rebook", "escalate", "refund refund refund",
    "the stain on the couch was there before", "we don't need to cancel anymore, can we add a guest",
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    shared = {
        "engine": ENGINE_VERSION, "as_of": data.AS_OF, "reservations": data.RESERVATIONS, "articles": data.ARTICLES,
        "safety_terms": data.SAFETY_TERMS, "sensitive_terms": data.SENSITIVE_TERMS, "human_terms": data.HUMAN_TERMS,
        "status_cues": data.STATUS_CUES, "hypothetical_cues": data.HYPOTHETICAL_CUES,
        "cases": load_cases("all"), "history": json.loads((EVAL_DIR / "history.json").read_text()),
    }
    (OUT / "data.json").write_text(json.dumps(shared, ensure_ascii=False, indent=1))

    golden = []
    questions = [c["question"] for c in load_cases("all")] + [q for q in EXTRA_PROBES if q.strip()]
    for rid in data.RESERVATIONS:
        for q in questions:
            for t in (0.45, 0.7):
                golden.append({"q": q, "rid": rid, "t": t, "out": answer(q, rid, t)})
    evals = {f"{s}@{t}": run_eval(t, s)["summary"] for s in ("all", "dev", "holdout") for t in (0.3, 0.45, 0.7)}
    (OUT / "golden.json").write_text(json.dumps({"answers": golden, "evals": evals, "sweep": sweep("all")},
                                                ensure_ascii=False))
    print(f"wrote data.json and golden.json ({len(golden)} answers)")


if __name__ == "__main__":
    main()

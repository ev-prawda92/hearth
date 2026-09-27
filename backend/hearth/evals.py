"""Evaluation harness: scores the copilot against the labeled dev and holdout sets."""
from __future__ import annotations

import json
from pathlib import Path

from .engine import DEFAULT_THRESHOLD, answer

EVAL_DIR = Path(__file__).resolve().parent.parent / "evals"
SPLITS = ("dev", "holdout")


def load_cases(split: str = "all") -> list[dict]:
    names = SPLITS if split == "all" else (split,)
    cases: list[dict] = []
    for n in names:
        for line in (EVAL_DIR / f"{n}.jsonl").read_text().splitlines():
            if line.strip():
                cases.append(json.loads(line))
    return cases


def score_case(c: dict, threshold: float) -> dict:
    a = answer(c["question"], c["reservation_id"], threshold)
    got = a["article"] if a["decision"] == "answer" else "HANDOFF"
    facts_ok = None
    if a["decision"] == "answer" and c.get("facts") is not None:
        facts_ok = all(f in a["text"] for f in c["facts"])
    if c["expect"] == "HANDOFF":
        if got != "HANDOFF":
            verdict = "missed_safety" if c["queue"] == "safety" else "wrong"
        elif a["queue"] != c["queue"]:
            verdict = "missed_safety" if c["queue"] == "safety" else "wrong_queue"
        else:
            verdict = "pass"
    elif got == "HANDOFF":
        verdict = "handoff"
    else:
        verdict = "pass" if got == c["expect"] and facts_ok is not False else "wrong"
    return {**c, "got": got, "got_queue": a["queue"], "confidence": a["confidence"], "reason": a["reason"],
            "facts_ok": facts_ok, "verdict": verdict}


def summarize(rows: list[dict]) -> dict:
    n = len(rows)
    answered = [r for r in rows if r["got"] != "HANDOFF"]
    correct = [r for r in answered if r["got"] == r["expect"]]
    with_facts = [r for r in correct if r.get("facts")]
    safety = [r for r in rows if r.get("queue") == "safety"]
    answerable = [r for r in rows if r["expect"] != "HANDOFF"]
    return {
        "n": n,
        "answerable": len(answerable),
        "self_solve": len(correct) / n if n else 0.0,
        "citation_accuracy": len(correct) / len(answered) if answered else 1.0,
        "personalization": sum(1 for r in with_facts if r["facts_ok"]) / len(with_facts) if with_facts else 1.0,
        "safety_recall": sum(1 for r in safety if r["verdict"] == "pass") / len(safety) if safety else 1.0,
        "wrong_answers": len(answered) - len(correct),
        "handoffs": n - len(answered),
        "unneeded_handoffs": sum(1 for r in rows if r["verdict"] == "handoff"),
        "wrong_queue": sum(1 for r in rows if r["verdict"] == "wrong_queue"),
    }


def run_eval(threshold: float = DEFAULT_THRESHOLD, split: str = "all") -> dict:
    rows = [score_case(c, threshold) for c in load_cases(split)]
    by_split = {s: summarize([r for r in rows if r["split"] == s]) for s in SPLITS if split in ("all", s)}
    return {"threshold": threshold, "split": split, "summary": summarize(rows), "by_split": by_split, "rows": rows}


def sweep(split: str = "all") -> list[dict]:
    out = []
    for i in range(13):
        t = round(0.2 + 0.05 * i, 2)
        s = run_eval(t, split)["summary"]
        out.append({"threshold": t, **{k: s[k] for k in ("self_solve", "citation_accuracy", "wrong_answers", "handoffs")}})
    return out

"""Evaluation harness: scores the copilot against the labeled dev and holdout sets."""
from __future__ import annotations

import json
from pathlib import Path

from .conversation import DEFAULT_MAX_CLARIFY, HUMAN_OPTION, OTHER_OPTION, SAFETY_OPTION, turn
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


def simulate(c: dict, threshold: float, max_clarify: int) -> dict:
    """Plays the conversation with a simulated guest who picks the right option whenever it's offered.

    That makes the result an upper bound: real people sometimes pick the wrong option or give up.
    """
    out = turn(c["reservation_id"], {"type": "message", "text": c["question"]}, None, threshold, max_clarify)
    turns, clarified = 1, 0
    while out["kind"] == "clarify" and turns < 10:
        ids = [o["id"] for o in out["options"]]
        if c.get("queue") == "safety" and SAFETY_OPTION in ids:
            pick = SAFETY_OPTION
        elif c["expect"] in ids:
            pick = c["expect"]
        else:
            pick = OTHER_OPTION
        clarified += 1
        out = turn(c["reservation_id"], {"type": "choose", "option": pick}, out["state"], threshold, max_clarify)
        turns += 1
    got = out.get("article") if out["kind"] == "answer" else "HANDOFF"
    return {"got": got, "queue": out.get("queue"), "turns": turns, "clarified": clarified,
            "text": out.get("text") or ""}


def score_case(c: dict, threshold: float, max_clarify: int = DEFAULT_MAX_CLARIFY) -> dict:
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
    sim = simulate(c, threshold, max_clarify)
    if c["expect"] == "HANDOFF":
        if sim["got"] != "HANDOFF":
            conv = "missed_safety" if c["queue"] == "safety" else "wrong"
        elif sim["queue"] != c["queue"]:
            conv = "missed_safety" if c["queue"] == "safety" else "wrong_queue"
        elif c["queue"] == "safety" and a["queue"] != "safety":
            conv = "late_safety"
        else:
            conv = "pass"
    elif sim["got"] == "HANDOFF":
        conv = "handoff"
    elif sim["got"] == c["expect"] and all(f in sim["text"] for f in c.get("facts") or []):
        conv = "resolved"
    else:
        conv = "wrong"
    return {**c, "got": got, "got_queue": a["queue"], "confidence": a["confidence"], "reason": a["reason"],
            "facts_ok": facts_ok, "verdict": verdict, "conv_verdict": conv, "conv_got": sim["got"],
            "conv_queue": sim["queue"], "turns": sim["turns"], "clarified": sim["clarified"]}


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
        # multi-turn, with the simulated guest
        "resolved_in_conversation": sum(1 for r in rows if r["conv_verdict"] == "resolved") / n if n else 0.0,
        "conv_wrong_answers": sum(1 for r in rows if r["conv_verdict"] == "wrong"),
        "conv_handoffs": sum(1 for r in rows if r["conv_got"] == "HANDOFF"),
        "clarify_rate": sum(1 for r in rows if r["clarified"]) / n if n else 0.0,
        "avg_turns_resolved": (sum(r["turns"] for r in rows if r["conv_verdict"] == "resolved") /
                               max(1, sum(1 for r in rows if r["conv_verdict"] == "resolved"))),
        "avg_turns_to_handoff": (sum(r["turns"] for r in rows if r["conv_got"] == "HANDOFF") /
                                 max(1, sum(1 for r in rows if r["conv_got"] == "HANDOFF"))),
        "safety_eventual": (sum(1 for r in rows if r.get("queue") == "safety" and r["conv_verdict"] in ("pass", "late_safety"))
                            / len(safety) if safety else 1.0),
    }


def run_eval(threshold: float = DEFAULT_THRESHOLD, split: str = "all", max_clarify: int = DEFAULT_MAX_CLARIFY) -> dict:
    rows = [score_case(c, threshold, max_clarify) for c in load_cases(split)]
    by_split = {s: summarize([r for r in rows if r["split"] == s]) for s in SPLITS if split in ("all", s)}
    return {"threshold": threshold, "split": split, "max_clarify": max_clarify, "summary": summarize(rows),
            "by_split": by_split, "rows": rows}


def sweep(split: str = "all", max_clarify: int = DEFAULT_MAX_CLARIFY) -> list[dict]:
    out = []
    for i in range(13):
        t = round(0.2 + 0.05 * i, 2)
        s = run_eval(t, split, max_clarify)["summary"]
        out.append({"threshold": t, **{k: s[k] for k in ("self_solve", "citation_accuracy", "wrong_answers", "handoffs",
                                                          "resolved_in_conversation")}})
    return out

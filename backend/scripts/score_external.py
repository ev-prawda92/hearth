"""Scores the current engine on evals/external.jsonl and writes evals/external_report.json.

Run after build_external.py. Nothing here tunes the engine; it only measures it.
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from hearth.engine import DEFAULT_THRESHOLD, ENGINE_VERSION  # noqa: E402
from hearth.evals import EVAL_DIR, score_case  # noqa: E402

TRACKS = {
    "in_scope_adapted": "In scope, reworded from e-commerce (Bitext)",
    "in_scope_real": "In scope, real phrasing (ABCD refund status)",
    "asks_for_person": "Asks for a person (Bitext)",
    "dispute": "Billing disputes (ABCD)",
    "out_of_scope": "Out of scope for Hearth (both)",
}
LABEL_CHECKS = {
    "in_scope_real": "Hand-checked 40 random cases: 39 fit the label (after dropping ABCD's refund_update and name-only turns).",
    "in_scope_adapted": "Hand-checked 40 random cases: 40 fit the label.",
}


def rate(n: int, d: int) -> float:
    return n / d if d else 0.0


def summarize(rows: list[dict], track: str) -> dict:
    n = len(rows)
    first_answered = [r for r in rows if r["got"] != "HANDOFF"]
    conv_answered = [r for r in rows if r["conv_got"] != "HANDOFF"]
    s = {"track": track, "label": TRACKS[track], "n": n, "clarify_rate": rate(sum(1 for r in rows if r["clarified"]), n)}
    if track.startswith("in_scope"):
        s.update({
            "resolved_first_reply": rate(sum(1 for r in rows if r["got"] == r["expect"]), n),
            "resolved_in_conversation": rate(sum(1 for r in rows if r["conv_got"] == r["expect"]), n),
            "wrong_first_reply": sum(1 for r in first_answered if r["got"] != r["expect"]),
            "wrong_in_conversation": sum(1 for r in conv_answered if r["conv_got"] != r["expect"]),
            "handed_off": sum(1 for r in rows if r["conv_got"] == "HANDOFF"),
        })
    else:
        want = rows[0].get("queue") if rows else None
        s.update({
            "correct_queue_first_reply": rate(sum(1 for r in rows if r["got"] == "HANDOFF" and r["got_queue"] == r["queue"]), n),
            "correct_queue_in_conversation": rate(sum(1 for r in rows if r["conv_got"] == "HANDOFF" and r["conv_queue"] == r["queue"]), n),
            "answered_first_reply": len(first_answered),
            "answered_in_conversation": len(conv_answered),
            "to_safety_line": sum(1 for r in rows if r["conv_queue"] == "safety" and r.get("queue") != "safety"),
            "expected_queue": want,
        })
    return s


def main() -> None:
    cases = [json.loads(x) for x in (EVAL_DIR / "external.jsonl").read_text().splitlines() if x.strip()]
    rows = [score_case(c, DEFAULT_THRESHOLD) for c in cases]
    by_track = defaultdict(list)
    for r in rows:
        by_track[r["track"]].append(r)
    tracks = [summarize(by_track[t], t) for t in TRACKS if by_track[t]]

    intents = []
    grouped = defaultdict(list)
    for r in rows:
        grouped[(r["source"], r["source_intent"])].append(r)
    for (src, intent), rs in sorted(grouped.items()):
        ok = sum(1 for r in rs if (r["conv_got"] == r["expect"]) if r["expect"] != "HANDOFF") + \
            sum(1 for r in rs if r["expect"] == "HANDOFF" and r["conv_got"] == "HANDOFF" and r["conv_queue"] == r.get("queue"))
        first = sum(1 for r in rs if (r["got"] == r["expect"]) if r["expect"] != "HANDOFF") + \
            sum(1 for r in rs if r["expect"] == "HANDOFF" and r["got"] == "HANDOFF" and r["got_queue"] == r.get("queue"))
        intents.append({"source": src, "intent": intent, "track": rs[0]["track"], "expect": rs[0]["expect"],
                        "n": len(rs), "first_reply_ok": rate(first, len(rs)), "conversation_ok": rate(ok, len(rs)),
                        "answered_wrong": sum(1 for r in rs if r["conv_got"] not in ("HANDOFF", r["expect"]))})

    # Where the wrong answers come from, and what the misses look like.
    wrong = [r for r in rows if r["conv_got"] not in ("HANDOFF", r["expect"])]
    clusters = Counter((r["track"], r["expect"], r["conv_got"]) for r in wrong)
    wrong_clusters = []
    for (track, expect, got), count in clusters.most_common(8):
        ex = [r["question"] for r in wrong if (r["track"], r["expect"], r["conv_got"]) == (track, expect, got)][:4]
        wrong_clusters.append({"track": track, "expected": expect, "got": got, "count": count, "examples": ex})
    missed = [r for r in rows if r["track"].startswith("in_scope") and r["conv_got"] == "HANDOFF"]
    miss_by = Counter(r["source_intent"] for r in missed)
    missed_examples = [{"intent": k, "count": v, "examples": [r["question"] for r in missed if r["source_intent"] == k][:4]}
                       for k, v in miss_by.most_common(6)]

    report = {
        "engine": ENGINE_VERSION, "threshold": DEFAULT_THRESHOLD, "n": len(rows),
        "sources": [
            {"name": "ABCD (ASAPP Research)", "license": "MIT", "url": "https://github.com/asappresearch/abcd",
             "used": sum(1 for r in rows if r["source"] == "abcd")},
            {"name": "Bitext customer support", "license": "CDLA-Sharing-1.0",
             "url": "https://github.com/bitext/customer-support-llm-chatbot-training-dataset",
             "used": sum(1 for r in rows if r["source"] == "bitext")},
        ],
        "label_checks": LABEL_CHECKS,
        "tracks": tracks, "intents": intents, "wrong_clusters": wrong_clusters, "missed_in_scope": missed_examples,
        "total_wrong_answers": len(wrong),
        "halves": json.loads((EVAL_DIR / "external_halves.json").read_text()) if (EVAL_DIR / "external_halves.json").exists() else {},
        "false_safety_alarms": [{"question": r["question"], "reason": r["reason"]} for r in rows
                                if r["conv_queue"] == "safety" and r.get("queue") != "safety"][:12],
        "false_safety_count": sum(1 for r in rows if r["conv_queue"] == "safety" and r.get("queue") != "safety"),
    }
    (EVAL_DIR / "external_report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n")
    for t in tracks:
        print(json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in t.items()}))
    print("wrong answers total:", len(wrong))
    for c in wrong_clusters:
        print(c["count"], c["track"], c["expected"], "->", c["got"], "|", " / ".join(c["examples"][:3]))
    print("missed in scope:")
    for m in missed_examples:
        print(m["count"], m["intent"], "|", " / ".join(m["examples"][:3]))


if __name__ == "__main__":
    main()

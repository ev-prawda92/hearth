"""Scores the current engine once on evals/redteam.jsonl and writes evals/redteam_report.json."""
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from hearth.engine import DEFAULT_THRESHOLD, ENGINE_VERSION, answer  # noqa: E402
from hearth.evals import EVAL_DIR, simulate  # noqa: E402

LABELS = {
    "medical_indirect": "Medical, described indirectly", "environment_understated": "Hazards, understated",
    "intrusion_host_misconduct": "Intruders and host misconduct", "harassment_threat": "Harassment and threats",
    "crime_theft": "Crime and theft", "child_vulnerable": "Children and vulnerable people",
    "crisis_wellbeing": "Someone in crisis", "buried_in_request": "Buried in another request",
    "typo_slang": "Typos and slang",
}


def main() -> None:
    cases = [json.loads(x) for x in (EVAL_DIR / "redteam.jsonl").read_text().splitlines() if x.strip()]
    rows = []
    for c in cases:
        a = answer(c["question"], c["reservation_id"], DEFAULT_THRESHOLD)
        row = {**c, "first_queue": a["queue"], "decision": a["decision"], "reason": a["reason"],
               "article": a.get("article")}
        if c["kind"] == "should_trigger":
            sim = simulate(c, DEFAULT_THRESHOLD, 2)
            row["eventual_queue"] = sim["queue"]
            row["first_ok"] = a["queue"] == "safety"
            row["eventual_ok"] = sim["queue"] == "safety"
        else:
            row["false_alarm"] = a["queue"] == "safety"
        rows.append(row)

    trig = [r for r in rows if r["kind"] == "should_trigger"]
    look = [r for r in rows if r["kind"] == "look_alike"]
    by = defaultdict(list)
    for r in trig:
        by[r["category"]].append(r)
    cats = []
    for cat, rs in by.items():
        missed = [r for r in rs if not r["first_ok"]]
        cats.append({"category": cat, "label": LABELS[cat], "n": len(rs),
                     "first_message": sum(r["first_ok"] for r in rs) / len(rs),
                     "eventual": sum(r["eventual_ok"] for r in rs) / len(rs),
                     "answered_instead": sum(r["decision"] == "answer" for r in missed),
                     "missed_examples": [{"question": r["question"],
                                          "what_happened": (f"answered with {r['article']}" if r["decision"] == "answer"
                                                            else f"handed to {r['first_queue']} ({r['reason']})")}
                                         for r in missed][:5]})
    report = {
        "engine": ENGINE_VERSION, "n_should_trigger": len(trig), "n_look_alike": len(look),
        "first_message_recall": sum(r["first_ok"] for r in trig) / len(trig),
        "eventual_recall": sum(r["eventual_ok"] for r in trig) / len(trig),
        "answered_instead": sum(r["decision"] == "answer" for r in trig if not r["first_ok"]),
        "false_alarms": sum(r["false_alarm"] for r in look),
        "false_alarm_examples": [{"question": r["question"], "reason": r["reason"]} for r in look if r["false_alarm"]],
        "categories": cats,
        "caveat": "The same author wrote the engine's rules and these cases, without consulting the rules while writing. "
                  "An independent red team would be stronger.",
    }
    (EVAL_DIR / "redteam_report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n")
    print(f"first-message recall {report['first_message_recall']:.1%}  eventual {report['eventual_recall']:.1%}  "
          f"answered instead {report['answered_instead']}  false alarms {report['false_alarms']}/{len(look)}")
    for c in cats:
        print(f"  {c['label']:34s} n={c['n']:2d} first={c['first_message']:.0%} eventual={c['eventual']:.0%}")
    for c in cats:
        for m in c["missed_examples"][:3]:
            print("   MISS", c["category"], "|", m["question"], "->", m["what_happened"])
    for f in report["false_alarm_examples"]:
        print("   FALSE ALARM |", f["question"], "|", f["reason"])


if __name__ == "__main__":
    main()

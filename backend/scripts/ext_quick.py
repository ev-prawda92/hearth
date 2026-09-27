"""Quick external scoring by half, for iterating.

  python scripts/ext_quick.py dev            summary + failure examples for the tuning half
  python scripts/ext_quick.py holdout --no-examples   summary only (never print holdout examples while tuning)
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from hearth.evals import EVAL_DIR, score_case  # noqa: E402


def load(half: str) -> list[dict]:
    cs = [json.loads(x) for x in (EVAL_DIR / "external.jsonl").read_text().splitlines() if x.strip()]
    return [c for c in cs if half == "all" or c["ext_split"] == half]


def track_summary(rows: list[dict]) -> dict:
    out = {}
    by = defaultdict(list)
    for r in rows:
        by[r["track"]].append(r)
    for t, rs in sorted(by.items()):
        n = len(rs)
        if t.startswith("in_scope"):
            out[t] = {"n": n, "first": sum(r["got"] == r["expect"] for r in rs) / n,
                      "conv": sum(r["conv_got"] == r["expect"] for r in rs) / n,
                      "wrong": sum(r["conv_got"] not in ("HANDOFF", r["expect"]) for r in rs)}
        else:
            out[t] = {"n": n, "first": sum(r["got"] == "HANDOFF" and r["got_queue"] == r["queue"] for r in rs) / n,
                      "conv": sum(r["conv_got"] == "HANDOFF" and r["conv_queue"] == r["queue"] for r in rs) / n,
                      "wrong": sum(r["conv_got"] != "HANDOFF" for r in rs),
                      "to_safety": sum(r["conv_queue"] == "safety" for r in rs)}
    out["_total_wrong"] = sum(r["conv_got"] not in ("HANDOFF", r["expect"]) for r in rows)
    out["_false_safety"] = sum(r["conv_queue"] == "safety" and r.get("queue") != "safety" for r in rows)
    return out


def main() -> None:
    half = sys.argv[1]
    show = "--no-examples" not in sys.argv and half != "holdout"
    rows = [score_case(c, 0.45) for c in load(half)]
    s = track_summary(rows)
    for k, v in s.items():
        print(k, {a: (round(b, 3) if isinstance(b, float) else b) for a, b in v.items()} if isinstance(v, dict) else v)
    if show:
        wrong = [r for r in rows if r["conv_got"] not in ("HANDOFF", r["expect"])]
        for (t, e, g), n in Counter((r["track"], r["expect"], r["conv_got"]) for r in wrong).most_common(12):
            ex = [r["question"] for r in wrong if (r["track"], r["expect"], r["conv_got"]) == (t, e, g)][:5]
            print(f"WRONG {n} {t} {e}->{g} | " + " / ".join(ex))
        wq = [r for r in rows if r["conv_got"] == "HANDOFF" and r.get("queue") and r["conv_queue"] != r["queue"]]
        for (t, q), n in Counter((r["track"], r["conv_queue"]) for r in wq).most_common(6):
            ex = [r["question"] + " [" + r["reason"] + "]" for r in wq if (r["track"], r["conv_queue"]) == (t, q)][:5]
            print(f"QUEUE {n} {t} ->{q} | " + " / ".join(ex))
        missed = [r for r in rows if r["track"].startswith("in_scope") and r["conv_got"] == "HANDOFF"]
        for k, n in Counter(r["source_intent"] for r in missed).most_common(8):
            print(f"MISSED {n} {k} | " + " / ".join([r["question"] for r in missed if r["source_intent"] == k][:6]))
    if "--save" in sys.argv:
        out = EVAL_DIR / "external_halves.json"
        data = json.loads(out.read_text()) if out.exists() else {}
        data.setdefault(sys.argv[sys.argv.index("--save") + 1], {})[half] = s
        out.write_text(json.dumps(data, indent=1) + "\n")


if __name__ == "__main__":
    main()

"""Scores v3 against v2.3 on the same cases and writes evals/v3_report.json.

  HEARTH_MODEL_MODE=record ANTHROPIC_API_KEY=... python scripts/score_v3.py   call the model, record every response
  python scripts/score_v3.py                                                    replay the recorded responses (no key)

Sets: the dev and holdout sets, the safety red team, and the untouched public half of the external set.
The prompt was written from the routing policy and the help-center scope lines, without reading any
red-team, holdout or external case, and it is scored here once. Nothing in this script tunes anything.

Exits non-zero if any model call was missing from the recording or failed, so a partial run can't
pass as a result.
"""
from __future__ import annotations

import json
import os
import statistics
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from hearth.engine import DEFAULT_THRESHOLD  # noqa: E402
from hearth.evals import EVAL_DIR, load_cases, score_case, summarize  # noqa: E402
from hearth.model import PROMPT_VERSION, ModelRouter  # noqa: E402
from score_external import TRACKS  # noqa: E402
from score_external import summarize as track_summary  # noqa: E402
from score_redteam import LABELS  # noqa: E402

# US$ per million tokens, list price when this was written. Unknown models report tokens only.
PRICES = {"claude-haiku-4-5-20251001": (1.0, 5.0)}
# Parallel model calls while recording. Low by default so a new key's rate limit isn't the bottleneck.
WORKERS = int(os.environ.get("HEARTH_WORKERS", "2"))


def jsonl(name: str) -> list[dict]:
    return [json.loads(x) for x in (EVAL_DIR / name).read_text().splitlines() if x.strip()]


def score_all(cases: list[dict], engine: str, router: ModelRouter | None) -> list[dict]:
    def one(c: dict) -> dict:
        return score_case(c, DEFAULT_THRESHOLD, 2, engine, router)

    if engine == "v2.3":
        return [one(c) for c in cases]
    with ThreadPoolExecutor(WORKERS) as pool:
        return list(pool.map(one, cases))


def redteam(rows: list[dict]) -> dict:
    trig = [r for r in rows if r["kind"] == "should_trigger"]
    look = [r for r in rows if r["kind"] == "look_alike"]
    first_ok = [r["got_queue"] == "safety" for r in trig]
    by = defaultdict(list)
    for r in trig:
        by[r["category"]].append(r)
    out = {
        "n_should_trigger": len(trig), "n_look_alike": len(look),
        "first_message_recall": sum(first_ok) / len(trig),
        "eventual_recall": sum(r["conv_queue"] == "safety" for r in trig) / len(trig),
        "answered_instead": sum(r["got"] != "HANDOFF" for r in trig),
        "false_alarms": sum(r["got_queue"] == "safety" for r in look),
        "false_alarm_examples": [r["question"] for r in look if r["got_queue"] == "safety"],
        "missed": [{"category": r["category"], "question": r["question"],
                    "what_happened": f"answered with {r['got']}" if r["got"] != "HANDOFF" else f"sent to {r['got_queue']}"}
                   for r in trig if r["got_queue"] != "safety"],
        "categories": [{"category": c, "label": LABELS[c], "n": len(rs),
                        "first_message": sum(r["got_queue"] == "safety" for r in rs) / len(rs)} for c, rs in by.items()],
    }
    if any(r.get("model_route") for r in rows):
        # What the model does on its own, without the keyword floor underneath it.
        out["model_alone"] = {
            "first_message_recall": sum(r["model_route"] == "safety" for r in trig) / len(trig),
            "false_alarms": sum(r["model_route"] == "safety" for r in look),
        }
    return out


def external(rows: list[dict]) -> dict:
    by = defaultdict(list)
    for r in rows:
        by[r["track"]].append(r)
    tracks = [track_summary(by[t], t) for t in TRACKS if by[t]]
    answered = [r for r in rows if r["conv_got"] != "HANDOFF"]
    return {"n": len(rows), "tracks": tracks,
            "wrong_answers": sum(1 for r in answered if r["conv_got"] != r["expect"]),
            "false_safety_alarms": sum(1 for r in rows if r["conv_queue"] == "safety" and r.get("queue") != "safety")}


def model_stats(router: ModelRouter) -> dict:
    s = router.stats
    lat = sorted(s["latencies_ms"])
    price = PRICES.get(router.model)
    cost = (s["input_tokens"] * price[0] + s["output_tokens"] * price[1]) / 1e6 if price else None
    return {"model": router.model, "prompt_version": PROMPT_VERSION, "calls": s["calls"],
            "input_tokens": s["input_tokens"], "output_tokens": s["output_tokens"],
            "cost_usd_per_1000_messages": round(cost / s["calls"] * 1000, 2) if cost and s["calls"] else None,
            "latency_ms_p50": statistics.median(lat) if lat else None,
            "latency_ms_p95": lat[int(0.95 * (len(lat) - 1))] if lat else None}


def main() -> int:
    router = ModelRouter()
    sets = {
        "dev": load_cases("dev"),
        "holdout": load_cases("holdout"),
        "redteam": jsonl("redteam.jsonl"),
        "external_untouched": [c for c in jsonl("external.jsonl") if c["ext_split"] == "holdout"],
    }
    report: dict = {"engines": {}}
    for engine in ("v2.3", "v3"):
        rows = {name: score_all(cases, engine, router if engine == "v3" else None) for name, cases in sets.items()}
        degraded = sum(r["degraded"] for rs in rows.values() for r in rs)
        report["engines"][engine] = {
            "dev": summarize(rows["dev"]), "holdout": summarize(rows["holdout"]),
            "redteam": redteam(rows["redteam"]), "external_untouched": external(rows["external_untouched"]),
            "degraded": degraded,
        }
    report["model"] = model_stats(router)
    report["method"] = ("Prompt written once from the routing policy and help-center scope lines, without reading any "
                        "red-team, holdout or external case; scored once. Responses recorded in evals/model_cache/ and "
                        "replayed for this report. Multi-turn numbers use the simulated guest, so they're a ceiling.")
    (EVAL_DIR / "v3_report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n")

    for engine, e in report["engines"].items():
        rt, ex = e["redteam"], e["external_untouched"]
        print(f"{engine:5s} red team first-message {rt['first_message_recall']:.0%} (answered instead "
              f"{rt['answered_instead']}, false alarms {rt['false_alarms']}/{rt['n_look_alike']})  "
              f"external wrong answers {ex['wrong_answers']}/{ex['n']}  holdout self-solve "
              f"{e['holdout']['self_solve']:.0%}  degraded {e['degraded']}")
    if "model_alone" in report["engines"]["v3"]["redteam"]:
        ma = report["engines"]["v3"]["redteam"]["model_alone"]
        print(f"      model alone: first-message {ma['first_message_recall']:.0%}, false alarms {ma['false_alarms']}")
    print("model", json.dumps(report["model"]))
    if report["engines"]["v3"]["degraded"]:
        print(f"FAILED: {report['engines']['v3']['degraded']} messages had no usable model response", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

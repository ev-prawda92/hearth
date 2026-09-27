"""Appends a scored run to evals/history.json.

Usage: python scripts/record_run.py <version> <holdout-file-or-none> "<what changed>"
The holdout file is scored as unseen data at the time of the run; after that it is folded into dev.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from hearth.engine import DEFAULT_THRESHOLD  # noqa: E402
from hearth.evals import EVAL_DIR, score_case, summarize  # noqa: E402


def score_file(name: str) -> dict:
    cases = [json.loads(x) for x in (EVAL_DIR / f"{name}.jsonl").read_text().splitlines() if x.strip()]
    return summarize([score_case(c, DEFAULT_THRESHOLD) for c in cases])


def main() -> None:
    version, holdout, note = sys.argv[1], sys.argv[2], sys.argv[3]
    hist_path = EVAL_DIR / "history.json"
    hist = json.loads(hist_path.read_text()) if hist_path.exists() else []
    entry = {"version": version, "note": note, "dev": score_file("dev")}
    if holdout != "none":
        entry["holdout"] = {"set": holdout, **score_file(holdout)}
    hist = [h for h in hist if h["version"] != version] + [entry]
    hist_path.write_text(json.dumps(hist, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(entry, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()

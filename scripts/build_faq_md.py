"""Generates docs/FAQ.md from frontend/src/content/faq.json, the single source for the in-app FAQ."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
faq = json.loads((ROOT / "frontend" / "src" / "content" / "faq.json").read_text())
lines = ["# Hearth Support Copilot: expert FAQ", "",
         f"Figures are for engine {faq['engine']}, updated {faq['updated']}. Generated from `frontend/src/content/faq.json`, "
         "which also feeds the Overview tab in the app.", ""]
for s in faq["sections"]:
    lines += [f"## {s['title']}", ""]
    for i in s["items"]:
        lines += [f"**{i['q']}**", "", i["a"], ""]
(ROOT / "docs" / "FAQ.md").write_text("\n".join(lines))
print("wrote docs/FAQ.md", sum(len(s["items"]) for s in faq["sections"]), "questions")

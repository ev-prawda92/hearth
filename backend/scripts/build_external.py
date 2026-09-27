"""Builds evals/external.jsonl from two public customer-support datasets.

Sources (downloaded from GitHub; cached under evals/external_cache/, which is not committed):
  * ABCD, Action-Based Conversations Dataset (ASAPP Research, MIT License)
    https://github.com/asappresearch/abcd — 10,042 human-to-human customer service conversations.
  * Bitext customer support dataset (Bitext, CDLA-Sharing-1.0)
    https://github.com/bitext/customer-support-llm-chatbot-training-dataset — 26,872 labeled requests.

Labels are mapped from each dataset's own intent labels to Hearth's help articles and queues (MAP below),
not hand-labeled. Bitext's in-scope intents are e-commerce phrased, so "order"/"purchase" are reworded to
"reservation"/"booking"; those rows are marked adapted=true. ABCD text is never rewritten.
Neither dataset contains safety situations, so safety is still measured on Hearth's own sets.
"""
from __future__ import annotations

import csv
import gzip
import io
import json
import random
import re
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "evals" / "external_cache"
OUT = ROOT / "evals" / "external.jsonl"
ABCD_URL = "https://raw.githubusercontent.com/asappresearch/abcd/master/data/abcd_v1.1.json.gz"
BITEXT_URL = ("https://raw.githubusercontent.com/bitext/customer-support-llm-chatbot-training-dataset/main/data/"
              "Bitext_Sample_Customer_Support_Training_Dataset_27K_responses-v11.csv")
GUESTS = ["HT-1042", "HT-2218", "HT-3307", "HT-5120", "HT-6031"]
SEED = 20260927

# Bitext intent -> (expected, queue, track, adapt, per-intent sample size)
BITEXT_MAP = {
    "cancel_order": ("HC-01", None, "in_scope_adapted", True, 150),
    "check_cancellation_fee": ("HC-01", None, "in_scope_adapted", True, 150),
    "check_refund_policy": ("HC-01", None, "in_scope_adapted", True, 150),
    "get_refund": ("HC-01", None, "in_scope_adapted", True, 150),
    "track_refund": ("HC-02", None, "in_scope_adapted", True, 150),
    "change_order": ("HC-03", None, "in_scope_adapted", True, 150),
    "get_invoice": ("HC-10", None, "in_scope_adapted", True, 150),
    "check_invoice": ("HC-10", None, "in_scope_adapted", True, 150),
    "contact_human_agent": ("HANDOFF", "specialist", "asks_for_person", False, 100),
    "contact_customer_service": ("HANDOFF", "specialist", "asks_for_person", False, 100),
    "complaint": ("HANDOFF", "specialist", "out_of_scope", False, 60),
}
BITEXT_OUT_OF_SCOPE_N = 40  # every other Bitext intent: shipping, accounts, payments, newsletters...

ABCD_MAP = {
    "refund_status": ("HC-02", None, "in_scope_real", 250),
    # refund_update is left out: in ABCD it mostly means "add an item to my existing refund" (16 of 40 checked
    # didn't fit "when does my refund arrive"), and it mixes in status questions, so it has no clean Hearth label.
    "refund_update": (None, None, None, 0),
    "mistimed_billing_never_bought": ("HANDOFF", "trust", "dispute", 100),
    "mistimed_billing_already_returned": ("HANDOFF", "trust", "dispute", 100),
}
ABCD_OUT_OF_SCOPE_N = 12  # per remaining subflow: returns, shipping, sizes, promo codes, account access...

PLACEHOLDERS = {
    "{{Person Name}}": "Maya", "{{Refund Amount}}": "517", "{{Currency Symbol}}": "$", "{{Account Type}}": "premium",
    "{{Account Category}}": "premium", "{{Delivery City}}": "Lisbon", "{{Delivery Country}}": "Portugal",
    "{{Invoice Number}}": "INV-2291",
}
ADAPT = [
    (r"\b(o+rder|ordr|oder|purchas?e|puchase|purchse)s\b", "reservations"),
    (r"\b(o+rder|ordr|oder|purchas?e|puchase|purchse)\b", "reservation"),
    (r"\b(products?|items?|articles?)\b", "guests"),
]


def fetch(url: str, name: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / name
    if not p.exists():
        with urllib.request.urlopen(url, timeout=120) as r:
            p.write_bytes(r.read())
    return p.read_bytes()


def clean(text: str, rid: str, adapt: bool) -> str:
    t = text.replace("{{Order Number}}", rid)
    for k, v in PLACEHOLDERS.items():
        t = t.replace(k, v)
    t = re.sub(r"\{\{[^}]+\}\}", "", t)
    if adapt:
        for pat, rep in ADAPT:
            t = re.sub(pat, rep, t, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", t).strip()


NAME_ONLY = re.compile(r"^(yes|yeah|sure|ok|hi|hello)?[,.! ]*(my name is|i'?m|i am|this is|name'?s)\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)?[.!]*$", re.IGNORECASE)


def first_customer_turn(convo: dict) -> str | None:
    """The customer's first real request: four or more words, and not just an introduction."""
    for who, text in convo["original"]:
        if who == "customer" and len(text.split()) >= 4 and not NAME_ONLY.match(text.strip()):
            return text
    return None


def main() -> None:
    rng = random.Random(SEED)
    cases: list[dict] = []

    rows = list(csv.DictReader(io.StringIO(fetch(BITEXT_URL, "bitext.csv").decode("utf-8"))))
    by_intent: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_intent[r["intent"]].append(r)
    for intent in sorted(by_intent):
        expect, queue, track, adapt, n = BITEXT_MAP.get(intent, ("HANDOFF", "specialist", "out_of_scope", False, BITEXT_OUT_OF_SCOPE_N))
        for r in rng.sample(by_intent[intent], min(n, len(by_intent[intent]))):
            rid = GUESTS[len(cases) % len(GUESTS)]
            cases.append({"source": "bitext", "source_intent": intent, "track": track, "adapted": adapt,
                          "reservation_id": rid, "question": clean(r["instruction"], rid, adapt),
                          "expect": expect, **({"queue": queue} if queue else {})})

    abcd = json.loads(gzip.decompress(fetch(ABCD_URL, "abcd.json.gz")))
    by_sub: dict[str, list[str]] = defaultdict(list)
    for split in ("train", "dev", "test"):
        for c in abcd[split]:
            t = first_customer_turn(c)
            if t:
                by_sub[c["scenario"]["subflow"]].append(t)
    for sub in sorted(by_sub):
        expect, queue, track, n = ABCD_MAP.get(sub, ("HANDOFF", "specialist", "out_of_scope", ABCD_OUT_OF_SCOPE_N))
        if not n:
            continue
        seen: set[str] = set()
        pool = [t for t in by_sub[sub] if not (t.lower() in seen or seen.add(t.lower()))]
        for t in rng.sample(pool, min(n, len(pool))):
            rid = GUESTS[len(cases) % len(GUESTS)]
            cases.append({"source": "abcd", "source_intent": sub, "track": track, "adapted": False,
                          "reservation_id": rid, "question": re.sub(r"\s+", " ", t).strip(),
                          "expect": expect, **({"queue": queue} if queue else {})})

    cases = [c for c in cases if c["question"]]
    lines = []
    for i, c in enumerate(cases, 1):
        topic = c["source_intent"]
        lines.append(json.dumps({"id": f"x{i:04d}", "split": "external", "topic": topic, **c}, ensure_ascii=False))
    OUT.write_text("\n".join(lines) + "\n")
    tracks = defaultdict(int)
    for c in cases:
        tracks[(c["source"], c["track"])] += 1
    print(f"wrote {len(cases)} cases to {OUT.name}")
    for k, v in sorted(tracks.items()):
        print(" ", k, v)


if __name__ == "__main__":
    main()

"""Text normalization, stemming and fuzzy matching.

Kept deliberately small and rule-based so every match is explainable in the trace
and the TypeScript port in the demo build can match it exactly.
"""
from __future__ import annotations

import re

NEGATION_CUES = [
    ["don't", "want", "to"], ["dont", "want", "to"], ["do", "not", "want", "to"],
    ["don't", "need", "to"], ["no", "need", "to"], ["not", "trying", "to"], ["not", "looking", "to"],
]


def normalize(text: str) -> str:
    t = text.lower().replace("’", "'")
    t = t.replace("-", " ")
    t = re.sub(r"[^a-z0-9' ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def stem(token: str) -> str:
    t = token
    done = False
    for suffix in ("ing", "ed"):
        if t.endswith(suffix) and len(t) - len(suffix) >= 4:
            t = t[: -len(suffix)]
            if len(t) >= 2 and t[-1] == t[-2] and t[-1] in "lpt":
                t = t[:-1]
            done = True
            break
    if not done and t.endswith("s") and not t.endswith("ss") and len(t) > 3:
        t = t[:-1]
    if t.endswith("e") and len(t) > 4:
        t = t[:-1]
    return t


# v2.3: words people use for a refund. Canonicalized after stemming so keywords and questions agree.
SYNONYMS = {"reimbursement": "refund", "compensation": "refund", "rebat": "refund", "restitution": "refund",
            "bill": "invoic", "invoic": "invoic"}
# "check in which cases..." is not about check-in time.
NOT_CHECK_IN_NEXT = {"what", "which", "whether", "on", "to", "if", "how"}


def stems(text: str) -> list[str]:
    toks = normalize(text).split(" ") if text.strip() else []
    out = [SYNONYMS.get(s, s) for s in (stem(t) for t in toks if t)]
    fixed: list[str] = []
    for i, s in enumerate(out):
        if s == "in" and i > 0 and out[i - 1] == "check" and i + 1 < len(out) and out[i + 1] in NOT_CHECK_IN_NEXT:
            continue
        fixed.append(s)
    return fixed


def drop_negated(tokens: list[str]) -> tuple[list[str], list[str]]:
    """Remove the two tokens that follow a negation cue ("I don't want to cancel")."""
    out: list[str] = []
    dropped: list[str] = []
    i = 0
    cues = [[stem(w) for w in cue] for cue in NEGATION_CUES]
    while i < len(tokens):
        hit = None
        for cue in cues:
            if tokens[i : i + len(cue)] == cue:
                hit = cue
                break
        if hit:
            out.extend(tokens[i : i + len(hit)])
            dropped.extend(tokens[i + len(hit) : i + len(hit) + 2])
            i += len(hit) + 2
        else:
            out.append(tokens[i])
            i += 1
    return out, dropped


def edit_distance_le1(a: str, b: str) -> bool:
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la == lb:
        diff = [i for i in range(la) if a[i] != b[i]]
        if len(diff) == 1:
            return True
        # adjacent transposition counts as one edit ("cancle" vs "cancel")
        return len(diff) == 2 and diff[1] == diff[0] + 1 and a[diff[0]] == b[diff[1]] and a[diff[1]] == b[diff[0]]
    if la > lb:
        a, b = b, a
    i = j = 0
    skipped = False
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            i += 1
            j += 1
        elif skipped:
            return False
        else:
            skipped = True
            j += 1
    return True


def contains_seq(tokens: list[str], seq: list[str]) -> bool:
    n = len(seq)
    return any(tokens[i : i + n] == seq for i in range(len(tokens) - n + 1))


def fuzzy_hit(tokens: list[str], kw: str) -> str | None:
    """Single-token fuzzy match for words of five letters or more, same first letter."""
    if len(kw) < 5:
        return None
    for t in tokens:
        if len(t) >= 5 and t[0] == kw[0] and t != kw and edit_distance_le1(t, kw):
            return t
    return None

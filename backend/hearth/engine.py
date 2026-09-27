"""Hearth support copilot: retrieval, policy application, routing and hand-off.

Pipeline for one question:
  1. normalize + stem, drop negated words ("I don't want to cancel")
  2. score help articles by keyword, phrase and typo-tolerant matches
  3. apply intent rules (refund status vs a new cancellation)
  4. route: safety > trust (disputes, discrimination) > asked for a person > no match > low confidence
  5. answer by applying the article to the reservation, or hand off with a written summary
"""
from __future__ import annotations

import math
from datetime import date, timedelta

from . import text as tx
from .data import (AS_OF, ARTICLES, HUMAN_TERMS, HYPOTHETICAL_CUES, RESERVATIONS, SAFETY_TERMS,
                   SENSITIVE_TERMS, STATUS_CUES)

ENGINE_VERSION = "v2.1"
DEFAULT_THRESHOLD = 0.45
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
TODAY = date.fromisoformat(AS_OF)


def _d(s: str) -> date:
    return date.fromisoformat(s)


def _days(a: date, b: date) -> int:
    return (b - a).days


def fmt_date(s: str) -> str:
    x = _d(s)
    return f"{MONTHS[x.month - 1]} {x.day}"


def money(r: dict, n: int) -> str:
    return f"{r['cur']}{n:,}"


def round_half_up(x: float) -> int:
    return int(math.floor(x + 0.5))


def round2(x: float) -> float:
    return math.floor(x * 100 + 0.5) / 100


def plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


# ---------------------------------------------------------------- policy math

def refund_for(r: dict) -> dict:
    nights = _days(_d(r["check_in"]), _d(r["check_out"]))
    total = nights * r["nightly"] + r["cleaning"]
    days_out = _days(TODAY, _d(r["check_in"]))
    since_booking = _days(_d(r["booked"]), TODAY)
    if r["status"] == "in stay":
        remaining = _days(TODAY, _d(r["check_out"]))
        refundable = max(0, remaining - 1)
        refund = round_half_up(refundable * r["nightly"] * 0.5)
        return {"total": total, "refund": refund, "days_out": days_out, "nights": nights,
                "rule": "Moderate, mid-stay: nights more than 24 hours away are refunded at 50%",
                "detail": f"{refundable} of your {remaining} remaining nights qualify"}
    policy = r["policy"]
    if policy == "Flexible":
        if days_out >= 1:
            return {"total": total, "refund": total, "days_out": days_out, "nights": nights,
                    "rule": "Flexible: full refund up to 24 hours before check-in"}
        return {"total": total, "refund": total - r["nightly"], "days_out": days_out, "nights": nights,
                "rule": "Flexible: inside 24 hours, the first night is non-refundable"}
    if policy == "Moderate":
        if days_out >= 5:
            return {"total": total, "refund": total, "days_out": days_out, "nights": nights,
                    "rule": "Moderate: full refund up to 5 days before check-in"}
        return {"total": total, "refund": round_half_up(nights * r["nightly"] * 0.5) + r["cleaning"],
                "days_out": days_out, "nights": nights,
                "rule": "Moderate: inside 5 days, 50% of nights plus the cleaning fee are refunded"}
    if since_booking <= 2 and days_out >= 14:
        return {"total": total, "refund": total, "days_out": days_out, "nights": nights,
                "rule": "Strict: full refund within 48 hours of booking"}
    if days_out >= 7:
        return {"total": total, "refund": round_half_up(nights * r["nightly"] * 0.5) + r["cleaning"],
                "days_out": days_out, "nights": nights, "rule": "Strict: 50% of nights refunded 7 or more days out"}
    return {"total": total, "refund": r["cleaning"], "days_out": days_out, "nights": nights,
            "rule": "Strict: inside 7 days, nights are non-refundable and the cleaning fee is refunded"}


def _when(days_out: int) -> str:
    if days_out == 0:
        return "today"
    return f"in {plural(days_out, 'day')}"


# ---------------------------------------------------------------- answers

def render(article_id: str, r: dict) -> dict:
    if article_id == "HC-01":
        f = refund_for(r)
        signals = [["Policy", r["policy"]],
                   ["Check-in", "in stay" if r["status"] == "in stay" else _when(f["days_out"])],
                   ["Paid", money(r, f["total"])]]
        if r["status"] == "in stay":
            text = (f"You're mid-stay in {r['city']}, so the {r['policy']} policy's mid-stay rule applies: {f['detail']}. "
                    f"If you leave early today, you'd get back <mark>{money(r, f['refund'])}</mark>. "
                    f"Cancel from Trips → {r['id']} → Change or cancel, and tell {r['host']} when you plan to check out.")
        else:
            text = (f"Your {r['listing']} booking uses the <mark>{r['policy']}</mark> policy and check-in is "
                    f"<mark>{_when(f['days_out'])}</mark>. If you cancel now you'd get back "
                    f"<mark>{money(r, f['refund'])}</mark> of the {money(r, f['total'])} you paid. {f['rule']}. "
                    f"Cancel from Trips → {r['id']} → Change or cancel.")
        return {"text": text, "facts": [money(r, f["refund"])], "signals": signals}
    if article_id == "HC-02":
        return {"text": ("Refunds go back to the original payment method. Hearth issues them the same day you cancel; "
                         f"banks usually post them in <mark>5–10 business days</mark>. If it's been longer, reply "
                         f"\"talk to a person\" and a specialist will trace it with the bank reference for {r['id']}."),
                "facts": ["5–10 business days"], "signals": [["Payment method", "original card"]]}
    if article_id == "HC-03":
        dates = f"{fmt_date(r['check_in'])}–{fmt_date(r['check_out'])}"
        return {"text": (f"You can request a change from Trips → {r['id']} → Change reservation, and {r['host']} has 24 hours "
                         f"to accept. Right now it's <mark>{dates}</mark> for {plural(r['guests'], 'guest')} at "
                         f"{money(r, r['nightly'])}/night. Any price difference is charged or refunded when the host accepts."),
                "facts": [dates], "signals": [["Dates", dates], ["Guests", str(r["guests"])], ["Nightly", money(r, r["nightly"])]]}
    if article_id == "HC-04":
        return {"text": (f"Entry for this stay is a <mark>{r['entry']}</mark>: {r['entry_detail']}. If that doesn't work, "
                         f"message {r['host']} from the reservation thread. If you still can't get in within 30 minutes, "
                         f"reply \"rebook\" and a specialist will find you a comparable place nearby at no extra cost."),
                "facts": [r["entry"]], "signals": [["Entry", r["entry"]], ["Host", r["host"]]]}
    if article_id == "HC-05":
        if r["status"] == "in stay":
            text = (f"Sorry about that. Report it within <mark>72 hours</mark> of finding it: add photos in Trips → {r['id']} → "
                    f"Report an issue. {r['host']} gets a chance to fix it first; if it isn't fixed within 24 hours, "
                    f"we'll refund the affected nights or rebook you.")
        else:
            text = (f"If something doesn't match the listing when you arrive, report it within <mark>72 hours</mark> with "
                    f"photos from Trips → {r['id']} → Report an issue. The host gets a chance to fix it first, then we "
                    f"refund or rebook.")
        return {"text": text, "facts": ["72 hours"], "signals": [["Stay status", r["status"]]]}
    if article_id == "HC-06":
        n, last = r["next_stay"], r["last_stay"]
        payout = (_d(n["check_in"]) + timedelta(days=1)).isoformat()
        return {"text": (f"Payouts release the day after check-in. Your stay with {last['guest']} "
                         f"({money(r, last['earnings'])}) was paid out on {fmt_date(last['paid'])}. The next one is "
                         f"<mark>{money(r, n['earnings'])}</mark> for {n['guest']}'s stay, releasing "
                         f"<mark>{fmt_date(payout)}</mark>. Banks can take 1–3 business days after that."),
                "facts": [money(r, n["earnings"]), fmt_date(payout), money(r, last["earnings"])],
                "signals": [["Last payout", money(r, last["earnings"])], ["Next stay", f"{n['guest']}, {fmt_date(n['check_in'])}"],
                            ["Next payout", money(r, n["earnings"])]]}
    if article_id == "HC-07":
        last = r["last_stay"]
        deadline = (_d(last["check_out"]) + timedelta(days=14)).isoformat()
        return {"text": (f"File a damage claim within 14 days of checkout. For {last['guest']}'s stay that's by "
                         f"<mark>{fmt_date(deadline)}</mark>. Upload photos and receipts in Hosting → Reservations → "
                         f"Request money. {last['guest']} gets 24 hours to respond before a specialist reviews it."),
                "facts": [fmt_date(deadline)], "signals": [["Last checkout", fmt_date(last["check_out"])], ["Claim deadline", fmt_date(deadline)]]}
    if article_id == "HC-08":
        if r["pets"]:
            text = (f"This listing <mark>allows pets</mark>, with a {money(r, r['pet_fee'])} pet fee added at checkout. "
                    f"Add your pet from Trips → {r['id']} → Change reservation. Assistance animals are always welcome "
                    f"and never charged.")
        else:
            text = (f"This listing <mark>doesn't allow pets</mark>. Assistance animals are the exception: they're always "
                    f"welcome at no charge, and you don't need the host's approval. Let {r['host']} know so they can prepare.")
        return {"text": text, "facts": ["allows pets" if r["pets"] else "doesn't allow pets"],
                "signals": [["Pets allowed", "yes" if r["pets"] else "no"]]}
    if article_id == "HC-09":
        return {"text": (f"Check-in is from <mark>{r['check_in_time']}</mark> and checkout is by "
                         f"<mark>{r['check_out_time']}</mark>. Early check-in or late checkout is up to {r['host']}; ask "
                         f"in the reservation thread and they'll confirm there."),
                "facts": [r["check_in_time"], r["check_out_time"]],
                "signals": [["Check-in", r["check_in_time"]], ["Checkout", r["check_out_time"]]]}
    if article_id == "HC-10":
        path = "Hosting → Earnings → Get statement" if r["role"] == "host" else f"Trips → {r['id']} → Get receipt"
        return {"text": (f"Download it from <mark>{path}</mark>. For a business invoice with VAT details, add your company "
                         f"info under Account → Payments first, then regenerate it."),
                "facts": [path], "signals": [["Reservation", r["id"]]]}
    if article_id == "HC-11":
        n = r["next_stay"]
        days = _days(TODAY, _d(n["check_in"]))
        return {"text": (f"Cancelling {n['guest']}'s stay is <mark>{plural(days, 'day')}</mark> before check-in, so a "
                         f"<mark>50% fee</mark> of the reservation ({money(r, round_half_up(n['earnings'] * 0.5))}) comes "
                         f"out of your next payout and the dates are blocked. If the reason is outside your control "
                         f"(a burst pipe, a local emergency), reply \"talk to a person\" before cancelling so a specialist "
                         f"can waive the fee."),
                "facts": [plural(days, "day"), "50% fee"],
                "signals": [["Next stay", f"{n['guest']}, {fmt_date(n['check_in'])}"], ["Days out", str(days)]]}
    raise KeyError(article_id)


# ---------------------------------------------------------------- retrieval

def _compile(terms: list[str], phrase_weight: float = 2.0) -> list[dict]:
    out: list[dict] = []
    seen: set[tuple] = set()
    for raw in terms:
        label, weight = raw, None
        if ":" in raw:
            label, w = raw.rsplit(":", 1)
            weight = float(w)
        s = tx.stems(label)
        key = tuple(s)
        if key in seen:
            continue
        seen.add(key)
        if weight is None:
            weight = phrase_weight if len(s) > 1 else 1.0
        out.append({"label": label, "stems": s, "weight": weight})
    return out


COMPILED = {a["id"]: _compile(a["kw"]) for a in ARTICLES}
SAFETY = _compile(SAFETY_TERMS)
SENSITIVE = _compile(SENSITIVE_TERMS)
HUMAN = _compile(HUMAN_TERMS)
STATUS = _compile(STATUS_CUES)
HYPO = _compile(HYPOTHETICAL_CUES)
MONEY_STEMS = {"refund", "money", "cancel", "cancellation"}


def _matches(tokens: list[str], compiled: list[dict], fuzzy: bool = True) -> list[dict]:
    hits = []
    for k in compiled:
        s = k["stems"]
        if len(s) > 1:
            if tx.contains_seq(tokens, s):
                hits.append({"label": k["label"], "weight": k["weight"], "kind": "phrase"})
        elif s and s[0] in tokens:
            hits.append({"label": k["label"], "weight": k["weight"], "kind": "word"})
        elif fuzzy and s:
            t = tx.fuzzy_hit(tokens, s[0])
            if t:
                hits.append({"label": f"{k['label']} (typo: {t})", "weight": 0.75, "kind": "typo"})
    return hits


def retrieve(question: str, r: dict) -> dict:
    tokens, dropped = tx.drop_negated(tx.stems(question))
    rules: list[str] = []
    if dropped:
        rules.append(f"Ignored negated words: {' '.join(dropped)}")
    ranked = []
    for a in ARTICLES:
        hits = _matches(tokens, COMPILED[a["id"]])
        score = sum(h["weight"] for h in hits)
        if a["audience"] != "both" and a["audience"] != r["role"]:
            score *= 0.25
        ranked.append({"id": a["id"], "title": a["title"], "score": score, "hits": [h["label"] for h in hits]})
    status = _matches(tokens, STATUS, fuzzy=False)
    hypothetical = _matches(tokens, HYPO, fuzzy=False)
    if status and not hypothetical and MONEY_STEMS.intersection(tokens):
        for x in ranked:
            if x["id"] == "HC-02":
                x["score"] += 3
            if x["id"] == "HC-01":
                x["score"] *= 0.5
        rules.append("Refund-status rule: asks about a refund already in motion (" +
                     ", ".join(h["label"] for h in status) + ")")
    ranked.sort(key=lambda x: -x["score"])
    return {"tokens": tokens, "ranked": ranked, "rules": rules}


# ---------------------------------------------------------------- routing

QUEUES = {
    "safety": "Safety line · priority 1",
    "trust": "Trust & disputes",
    "specialist": "Support specialist",
}
FIRST_STEP = {
    "safety": "Call now and confirm they're safe before anything else. Emergency services first if needed.",
    "trust": "Read the full thread before replying. Don't commit to a refund amount in the first message.",
}


def answer(question: str, reservation_id: str, threshold: float = DEFAULT_THRESHOLD) -> dict:
    r = RESERVATIONS[reservation_id]
    ret = retrieve(question, r)
    tokens, ranked = ret["tokens"], ret["ranked"]
    all_tokens = tx.stems(question)
    safety = _matches(all_tokens, SAFETY, fuzzy=True)
    sensitive = _matches(all_tokens, SENSITIVE, fuzzy=False)
    human = _matches(all_tokens, HUMAN, fuzzy=False)
    top, second = ranked[0], ranked[1]
    strength = min(1.0, top["score"] / 3)
    margin = (top["score"] - second["score"]) / top["score"] if top["score"] > 0 else 0.0
    confidence = round2(0.5 * strength + 0.5 * margin)

    decision, queue, reason = "answer", None, ""
    if safety:
        decision, queue, reason = "handoff", "safety", "Safety signal: " + ", ".join(h["label"] for h in safety)
    elif sensitive:
        decision, queue, reason = "handoff", "trust", "Sensitive topic: " + ", ".join(h["label"] for h in sensitive)
    elif human:
        labels = [h["label"] for h in human]
        decision, queue = "handoff", "specialist"
        reason = "Asked to rebook" if labels == ["rebook"] else "Asked for a person"
    elif top["score"] == 0:
        decision, queue, reason = "handoff", "specialist", "No matching help article"
    elif _audience(top["id"]) not in ("both", r["role"]):
        decision, queue = "handoff", "specialist"
        reason = f"Best match is a {_audience(top['id'])}-only article, but this is a {r['role']} account"
    elif confidence < threshold:
        decision, queue, reason = "handoff", "specialist", f"Confidence {confidence:.2f} is below the {threshold:.2f} threshold"

    out = {
        "reservation_id": reservation_id, "question": question, "engine": ENGINE_VERSION,
        "ranked": ranked[:3], "rules": ret["rules"], "confidence": confidence, "threshold": threshold,
        "decision": decision, "queue": queue, "reason": reason,
    }
    if decision == "answer":
        art = next(a for a in ARTICLES if a["id"] == top["id"])
        body = render(art["id"], r)
        also = None
        if second["score"] >= 2 and second["score"] >= 0.6 * top["score"]:
            also = {"id": second["id"], "title": second["title"]}
        out.update({"article": art["id"], "article_title": art["title"], "also": also,
                    "followups": art["followups"], **body})
    else:
        out["handoff"] = _handoff(question, r, top, confidence, reason, queue)
        out["followups"] = []
    return out


def _audience(article_id: str) -> str:
    return next(a["audience"] for a in ARTICLES if a["id"] == article_id)


def _handoff(question: str, r: dict, top: dict, confidence: float, reason: str, queue: str) -> dict:
    if r["role"] == "host":
        who = f"Host {r['name']} · {r['listing']}, {r['city']}"
    else:
        who = f"Guest {r['name']} · {r['listing']}, {r['city']} · {r['status']}"
    topic = f"{top['id']} {top['title']}" if top["score"] > 0 else "Unclear"
    if queue in FIRST_STEP:
        step = FIRST_STEP[queue]
    elif reason == "Asked to rebook":
        step = "Search comparable listings within 2 km for the same dates and hold one before replying."
    elif top["score"] > 0:
        step = f"Start from {top['id']}; the copilot's draft is attached for review."
    else:
        step = "Ask one clarifying question; no help article matched."
    if queue == "safety":
        reply = ("If you're in immediate danger, call local emergency services now. I'm connecting you with Hearth's "
                 "safety team. They'll reach you in this thread within minutes.")
    elif queue == "trust":
        reply = ("I'm passing this to our trust team, who handle disputes and fairness concerns. They'll reply here "
                 "with your reservation details already in hand.")
    else:
        reply = ("I'm passing this to a support specialist with your reservation details, so you won't need to "
                 "repeat yourself.")
    return {
        "queue": queue, "queue_label": QUEUES[queue], "reply": reply,
        "summary": [["Reservation", f"{r['id']} · {who}"], ["Asked", f"“{question}”"], ["Likely topic", topic],
                    ["Why handed off", reason], ["Copilot confidence", f"{confidence:.2f}"], ["Suggested first step", step]],
    }

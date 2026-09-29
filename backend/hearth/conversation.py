"""Multi-turn layer: clarify before handing off, and resolve with confirmable actions.

Rules that never bend:
  * Safety, disputes and "talk to a person" hand off on the first message. No clarifying.
  * Every clarifying menu has an "I don't feel safe" option that goes straight to the safety line.
  * Anything that moves money or speaks for the person needs an explicit confirm.
  * After `max_clarify` clarifying questions the copilot hands off with the whole conversation attached.

The engine is stateless: the caller passes `state` in and gets the next `state` back.
"""
from __future__ import annotations

from .data import ARTICLES, RESERVATIONS
from .engine import DEFAULT_THRESHOLD, FIRST_STEP, QUEUES, fmt_date, money, refund_for, render, round_half_up

DEFAULT_MAX_CLARIFY = 2
SAFETY_OPTION = "SAFETY"
OTHER_OPTION = "OTHER"
HUMAN_OPTION = "HUMAN"
TITLES = {a["id"]: a["title"] for a in ARTICLES}

# Topics people ask about most, by where they are in the trip. Used to fill clarifying menus.
PRIORS = {
    "upcoming": ["HC-01", "HC-03", "HC-04", "HC-09", "HC-08", "HC-02"],
    "arriving today": ["HC-04", "HC-09", "HC-01", "HC-05", "HC-03", "HC-02"],
    "in stay": ["HC-05", "HC-04", "HC-09", "HC-01", "HC-03", "HC-02"],
    "cancelled": ["HC-02", "HC-10", "HC-03", "HC-01"],
    "host": ["HC-06", "HC-07", "HC-11", "HC-10"],
}
OPTION_LABELS = {
    "HC-01": "Cancelling or leaving early", "HC-02": "A refund I'm waiting on", "HC-03": "Changing dates or guests",
    "HC-04": "Getting in", "HC-05": "Something wrong with the place", "HC-06": "When I get paid",
    "HC-07": "Damage after a stay", "HC-08": "Pets or assistance animals", "HC-09": "Check-in or checkout times",
    "HC-10": "A receipt or statement", "HC-11": "Cancelling a guest's stay",
}


def new_state() -> dict:
    return {"clarify_turns": 0, "context": "", "pending_action": None, "overrides": {}, "log": []}


def reservation(rid: str, state: dict) -> dict:
    return {**RESERVATIONS[rid], **state.get("overrides", {})}


def _copy(state: dict | None) -> dict:
    s = new_state() if state is None else state
    return {"clarify_turns": s.get("clarify_turns", 0), "context": s.get("context", ""),
            "pending_action": s.get("pending_action"), "overrides": dict(s.get("overrides", {})),
            "log": list(s.get("log", []))}


# ---------------------------------------------------------------- actions

def actions_for(article_id: str, r: dict) -> list[dict]:
    guest = r["role"] == "guest"
    if article_id == "HC-01" and guest and r["status"] != "cancelled":
        f = refund_for(r)
        label = f"Check out early and refund {money(r, f['refund'])}" if r["status"] == "in stay" else f"Cancel and refund {money(r, f['refund'])}"
        return [{"id": "cancel_reservation", "label": label, "confirm": True}]
    if article_id == "HC-03" and guest and r["status"] != "cancelled":
        return [{"id": "message_host_change", "label": f"Ask {r['host']} about a change", "confirm": True}]
    if article_id == "HC-04" and guest and r["status"] != "cancelled":
        return [{"id": "resend_entry", "label": "Resend my entry instructions", "confirm": False}]
    if article_id == "HC-05" and guest and r["status"] != "cancelled":
        return [{"id": "report_issue", "label": f"Report it to {r['host']}", "confirm": True}]
    if article_id == "HC-07" and not guest:
        return [{"id": "start_claim", "label": f"Start a damage claim for {r['last_stay']['guest']}'s stay", "confirm": True}]
    if article_id == "HC-08" and guest and r["status"] != "cancelled":
        if r["pets"]:
            return [{"id": "add_pet", "label": f"Add a pet ({money(r, r['pet_fee'])})", "confirm": True}]
        return [{"id": "notify_assistance_animal", "label": f"Tell {r['host']} about an assistance animal", "confirm": True}]
    if article_id == "HC-09" and guest and r["status"] != "cancelled":
        return [{"id": "message_host_times", "label": f"Ask {r['host']} about early check-in or late checkout", "confirm": True}]
    if article_id == "HC-10":
        return [{"id": "send_receipt", "label": "Email me the statement" if not guest else "Email me the receipt", "confirm": False}]
    if article_id == "HC-11" and not guest and not r.get("next_cancelled"):
        n = r["next_stay"]
        return [{"id": "host_cancel", "label": f"Cancel {n['guest']}'s stay (fee {money(r, round_half_up(n['earnings'] * 0.5))})", "confirm": True}]
    return []


def _code(prefix: str, rid: str) -> str:
    return f"{prefix}-{rid[-4:]}"


def preview(action: str, r: dict) -> dict:
    """What the person sees before confirming."""
    if action == "cancel_reservation":
        f = refund_for(r)
        return {"title": "Cancel this reservation?", "confirm_label": f"Yes, cancel and refund {money(r, f['refund'])}",
                "points": [f"{r['listing']}, {fmt_date(r['check_in'])}–{fmt_date(r['check_out'])}",
                           f"Refund: {money(r, f['refund'])} of {money(r, f['total'])} to your original card",
                           "This can't be undone. The dates go back on the calendar."]}
    if action == "message_host_change":
        return {"title": f"Send this to {r['host']}?", "confirm_label": "Send message",
                "points": [f"“Hi {r['host']}, would it be possible to change our reservation ({fmt_date(r['check_in'])}–"
                           f"{fmt_date(r['check_out'])})? Happy to work around what suits you. Thanks, {r['name']}”",
                           f"{r['host']} has 24 hours to reply. Nothing changes until you both accept."]}
    if action == "report_issue":
        return {"title": f"Report an issue to {r['host']}?", "confirm_label": "Report it",
                "points": [f"{r['host']} is notified now and has 24 hours to fix it.",
                           "If it isn't fixed, you can choose a refund for the affected nights or a rebooking.",
                           "Add photos in the report link I'll send."]}
    if action == "start_claim":
        last = r["last_stay"]
        return {"title": f"Start a damage claim for {last['guest']}'s stay?", "confirm_label": "Start claim",
                "points": [f"{last['guest']} is asked to respond within 24 hours.",
                           "Upload photos and receipts to the draft; a specialist reviews it if you can't agree."]}
    if action == "add_pet":
        return {"title": "Add a pet to this reservation?", "confirm_label": f"Add pet for {money(r, r['pet_fee'])}",
                "points": [f"A {money(r, r['pet_fee'])} pet fee is charged to your card now.", f"{r['host']} is notified."]}
    if action == "notify_assistance_animal":
        return {"title": f"Let {r['host']} know?", "confirm_label": "Send message",
                "points": [f"“Hi {r['host']}, I'll be traveling with an assistance animal. Letting you know ahead of time. "
                           f"Thanks, {r['name']}”", "No fee, and no approval needed."]}
    if action == "message_host_times":
        return {"title": f"Send this to {r['host']}?", "confirm_label": "Send message",
                "points": [f"“Hi {r['host']}, is there any flexibility on check-in ({r['check_in_time']}) or checkout "
                           f"({r['check_out_time']})? Thanks, {r['name']}”"]}
    if action == "host_cancel":
        n = r["next_stay"]
        return {"title": f"Cancel {n['guest']}'s stay?", "confirm_label": "Yes, cancel the stay",
                "points": [f"{n['guest']} gets a full refund and help rebooking.",
                           f"A {money(r, round_half_up(n['earnings'] * 0.5))} fee comes out of your next payout.",
                           "If the reason is outside your control, talk to a person first so the fee can be waived."]}
    return {"title": "Go ahead?", "confirm_label": "Confirm", "points": []}


def execute(action: str, rid: str, state: dict) -> tuple[str, dict]:
    """Performs the action on the fictional reservation. Returns the reply text and the log entry."""
    r = reservation(rid, state)
    if action == "cancel_reservation":
        f = refund_for(r)
        code = _code("CX", rid)
        state["overrides"].update({"status": "cancelled", "refunded": f["refund"], "cancel_code": code})
        text = (f"Done. Your reservation is cancelled and <mark>{money(r, f['refund'])}</mark> is on its way back to your "
                f"card. Confirmation <mark>{code}</mark>. Banks usually post it in 5–10 business days.")
    elif action == "message_host_change":
        code = _code("MSG", rid)
        text = f"Sent. {r['host']} has 24 hours to reply, and you'll get a notification when they do."
    elif action == "resend_entry":
        code = _code("ENT", rid)
        text = (f"Sent your entry instructions again by text and email: {r['entry_detail']}. I've also let {r['host']} "
                f"know you're arriving. If you still can't get in within 30 minutes, reply \"rebook\".")
    elif action == "report_issue":
        code = _code("ISS", rid)
        text = (f"Reported. {r['host']} has been notified and has until this time tomorrow to fix it. Your report number is "
                f"<mark>{code}</mark>; I'll check back with you then.")
    elif action == "start_claim":
        code = _code("CLM", rid)
        text = (f"Claim <mark>{code}</mark> is open. I've sent you the upload link for photos and receipts, and "
                f"{r['last_stay']['guest']} has 24 hours to respond.")
    elif action == "add_pet":
        code = _code("PET", rid)
        text = f"Added. The {money(r, r['pet_fee'])} pet fee is charged and {r['host']} knows to expect your pet."
    elif action == "notify_assistance_animal":
        code = _code("MSG", rid)
        text = f"Sent. {r['host']} knows you're bringing an assistance animal."
    elif action == "message_host_times":
        code = _code("MSG", rid)
        text = f"Sent. {r['host']} will reply in the reservation thread."
    elif action == "send_receipt":
        code = _code("RCP", rid)
        text = "Sent to the email on your account. It can take a few minutes to arrive."
    elif action == "host_cancel":
        n = r["next_stay"]
        code = _code("HCX", rid)
        state["overrides"]["next_cancelled"] = True
        text = (f"Cancelled. {n['guest']} has been refunded and offered help rebooking. The "
                f"{money(r, round_half_up(n['earnings'] * 0.5))} fee will come out of your next payout. Confirmation "
                f"<mark>{code}</mark>.")
    else:
        raise KeyError(action)
    entry = {"action": action, "code": code, "reservation_id": rid, "summary": _strip(text)}
    state["log"].append(entry)
    return text, entry


def _strip(html: str) -> str:
    return html.replace("<mark>", "").replace("</mark>", "")


# ---------------------------------------------------------------- turns

def _options(rid: str, r: dict, ranked: list[dict]) -> list[dict]:
    role = r["role"]
    ids: list[str] = []
    for x in ranked:
        aud = next(a["audience"] for a in ARTICLES if a["id"] == x["id"])
        if x["score"] > 0 and aud in ("both", role) and x["id"] not in ids:
            ids.append(x["id"])
        if len(ids) == 2:
            break
    prior = PRIORS["host"] if role == "host" else PRIORS.get(r["status"], PRIORS["upcoming"])
    for pid in prior:
        if len(ids) >= 4:
            break
        if pid not in ids:
            ids.append(pid)
    return [{"id": i, "label": OPTION_LABELS[i]} for i in ids] + [
        {"id": OTHER_OPTION, "label": "Something else"},
    ] + ESCAPES


ESCAPES = [{"id": SAFETY_OPTION, "label": "I don't feel safe"}, {"id": HUMAN_OPTION, "label": "Talk to a person"}]


def _handoff_after(rid: str, r: dict, state: dict, reason: str, last: dict | None) -> dict:
    who = f"Host {r['name']}" if r["role"] == "host" else f"Guest {r['name']} · {r['status']}"
    likely = f"{last['ranked'][0]['id']} {last['ranked'][0]['title']}" if last and last["ranked"][0]["score"] > 0 else "Unclear"
    h = {
        "queue": "specialist", "queue_label": QUEUES["specialist"],
        "reply": ("I haven't been able to pin this down, so I'm bringing in a support specialist. They'll see everything "
                  "we've covered, so you won't need to repeat yourself."),
        "summary": [["Reservation", f"{rid} · {who} · {r['listing']}, {r['city']}"],
                    ["Conversation", f"“{state['context'].strip()}”"], ["Likely topic", likely],
                    ["Why handed off", reason], ["Clarifying questions asked", str(state["clarify_turns"])],
                    ["Suggested first step", "Read the conversation, then ask one specific question about what they need."]],
    }
    return {"kind": "handoff", "decision": "handoff", "queue": "specialist", "reason": reason, "handoff": h,
            "text": None}


def _safety_handoff(rid: str, r: dict, state: dict) -> dict:
    h = {
        "queue": "safety", "queue_label": QUEUES["safety"],
        "reply": ("If you're in immediate danger, call local emergency services now. I'm connecting you with Hearth's "
                  "safety team. They'll reach you in this thread within minutes."),
        "summary": [["Reservation", f"{rid} · {r['name']} · {r['listing']}, {r['city']}"],
                    ["Conversation", f"“{state['context'].strip()}”"],
                    ["Why handed off", "Chose “I don't feel safe” from a clarifying menu"],
                    ["Suggested first step", FIRST_STEP["safety"]]],
    }
    return {"kind": "handoff", "decision": "handoff", "queue": "safety", "reason": "Chose “I don't feel safe”",
            "handoff": h, "text": None}


YES = {"yes", "y", "yeah", "yep", "confirm", "do it", "go ahead", "ok", "okay", "sure", "please do"}
NO = {"no", "n", "nope", "cancel that", "don't", "dont", "never mind", "nevermind", "stop", "keep it"}


def turn(rid: str, inp: dict, state: dict | None = None, threshold: float = DEFAULT_THRESHOLD,
         max_clarify: int = DEFAULT_MAX_CLARIFY, engine: str = "v2.3", router=None) -> dict:
    """One conversational turn.

    inp is one of:
      {"type": "message", "text": "..."}
      {"type": "choose", "option": "HC-04" | "SAFETY" | "OTHER"}
      {"type": "action", "action": "cancel_reservation", "confirm": true | false | None}

    engine is "v2.3" (keyword rules) or "v3" (model routing over the keyword floor; see v3.py).
    """
    state = _copy(state)
    r = reservation(rid, state)
    kind = inp.get("type")

    # Typed yes/no while an action is waiting for confirmation.
    if kind == "message" and state["pending_action"]:
        said = inp.get("text", "").strip().lower().rstrip(".!")
        if said in YES:
            inp, kind = {"type": "action", "action": state["pending_action"], "confirm": True}, "action"
        elif said in NO:
            inp, kind = {"type": "action", "action": state["pending_action"], "confirm": False}, "action"
        else:
            state["pending_action"] = None

    if kind == "action":
        action = inp["action"]
        allowed = {a["id"]: a for a in _all_actions(r)}
        if action not in allowed:
            return {"kind": "notice", "text": "That option isn't available for this reservation anymore.", "state": state}
        if allowed[action]["confirm"] and inp.get("confirm") is None:
            state["pending_action"] = action
            return {"kind": "confirm", "action": action, **preview(action, r), "state": state}
        state["pending_action"] = None
        if inp.get("confirm") is False:
            return {"kind": "notice", "text": "Okay, I haven't changed anything.", "state": state}
        text, entry = execute(action, rid, state)
        return {"kind": "done", "text": text, "entry": entry, "state": state,
                "followups": ["Anything else?"] if action != "resend_entry" else ["Still can't get in", "Talk to a person"]}

    if kind == "choose":
        opt = inp["option"]
        if opt == SAFETY_OPTION:
            state["context"] = (state["context"] + " [chose: I don't feel safe]").strip()
            out = _safety_handoff(rid, r, state)
            state.update(clarify_turns=0, context="")
            return {**out, "state": state}
        if opt == HUMAN_OPTION:
            state["context"] = (state["context"] + " [chose: talk to a person]").strip()
            out = _handoff_after(rid, r, state, "Asked for a person", None)
            state.update(clarify_turns=0, context="")
            return {**out, "state": state}
        if opt == OTHER_OPTION:
            if state["clarify_turns"] >= max_clarify:
                out = _handoff_after(rid, r, state, f"Still unclear after {state['clarify_turns']} clarifying questions", None)
                state.update(clarify_turns=0, context="")
                return {**out, "state": state}
            state["clarify_turns"] += 1
            return {"kind": "clarify", "text": ("Tell me a little more in your own words: what are you trying to do, or "
                                                "what's gone wrong?"), "options": ESCAPES, "open": True,
                    "turn": state["clarify_turns"], "max": max_clarify, "state": state}
        art = next(a for a in ARTICLES if a["id"] == opt)
        body = render(art["id"], r)
        state.update(clarify_turns=0, context="")
        return {"kind": "answer", "decision": "answer", "article": art["id"], "article_title": art["title"],
                "chosen": True, "followups": art["followups"], "actions": actions_for(art["id"], r), **body, "state": state}

    # A message: combine with anything we've been clarifying.
    text = inp.get("text", "").strip()
    combined = (state["context"] + " " + text).strip() if state["clarify_turns"] else text
    from .v3 import answer_with  # late import: v3 builds on this module's engine

    a = answer_with(engine, router)(combined, rid, threshold, reservation=r)
    if a["decision"] == "answer":
        state.update(clarify_turns=0, context="")
        return {"kind": "answer", **a, "actions": actions_for(a["article"], r), "state": state}
    if a["handoff_kind"] != "unclear" or max_clarify == 0:
        state.update(clarify_turns=0, context="")
        return {"kind": "handoff", **a, "state": state}
    state["context"] = combined
    if state["clarify_turns"] >= max_clarify:
        out = _handoff_after(rid, r, state, f"Still unclear after {state['clarify_turns']} clarifying questions", a)
        out["ranked"], out["confidence"], out["rules"] = a["ranked"], a["confidence"], a["rules"]
        state.update(clarify_turns=0, context="")
        return {**out, "state": state}
    state["clarify_turns"] += 1
    first = state["clarify_turns"] == 1
    return {"kind": "clarify", "decision": "clarify",
            "text": ("I want to get this right before I answer. Which of these is closest?" if first else
                     "Thanks. I'm still not sure I've got it. Is it one of these?"),
            "options": _options(rid, r, a["ranked"]), "open": False, "turn": state["clarify_turns"], "max": max_clarify,
            "ranked": a["ranked"], "confidence": a["confidence"], "rules": a["rules"], "reason": a["reason"],
            "state": state}


def _all_actions(r: dict) -> list[dict]:
    out: list[dict] = []
    for a in ARTICLES:
        out.extend(actions_for(a["id"], r))
    return out

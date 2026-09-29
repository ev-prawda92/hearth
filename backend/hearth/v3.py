"""v3: a language model decides where a message goes; the v2.3 keyword rules stay underneath as a floor.

Decision order for one message:
  1. safety   if the model says safety OR a keyword safety rule fires (the floor: v3 can't miss what v2.3 caught)
  2. trust    if the model says trust OR a keyword dispute/fairness rule fires
  3. person   if the model says person OR a keyword "talk to a person" rule fires
  4. answer   if the model picked an article; the engine renders it with the policy math, as before
  5. unclear  otherwise, which sends the conversation layer into its clarifying menu

If the model call fails, v3 answers exactly as v2.3 would and marks the result degraded, so an outage costs
accuracy on unusual phrasing but never takes the copilot down.
"""
from __future__ import annotations

from . import text as tx
from .data import ARTICLES, RESERVATIONS
from .engine import HUMAN, SAFETY, SENSITIVE, _handoff, _matches, answer, render
from .model import ModelError, ModelRouter

ENGINE_VERSION = "v3"
_router: ModelRouter | None = None


def default_router() -> ModelRouter:
    global _router
    if _router is None:
        _router = ModelRouter()
    return _router


def answer_v3(question: str, reservation_id: str, threshold: float, reservation: dict | None = None,
              router: ModelRouter | None = None) -> dict:
    r = reservation or RESERVATIONS[reservation_id]
    base = answer(question, reservation_id, threshold, reservation=r)
    router = router or default_router()
    try:
        m = router.route(question, r)
    except ModelError as e:
        return {**base, "engine": ENGINE_VERSION, "degraded": True, "model": {"error": str(e)}}

    toks = tx.stems(question)
    kw_safety = _matches(toks, SAFETY, fuzzy=False)
    kw_trust = _matches(toks, SENSITIVE, fuzzy=False)
    kw_human = _matches(toks, HUMAN, fuzzy=False)
    model_info = {"model": router.model, "route": m["route"], "article": m["article"], "reason": m["reason"],
                  "latency_ms": m["latency_ms"]}
    out = {**{k: base[k] for k in ("reservation_id", "question", "ranked", "rules", "confidence", "threshold")},
           "engine": ENGINE_VERSION, "degraded": False, "model": model_info}
    top = base["ranked"][0]

    def handoff(queue: str, kind: str, reason: str) -> dict:
        return {**out, "decision": "handoff", "queue": queue, "reason": reason, "handoff_kind": kind,
                "handoff": _handoff(question, r, top, base["confidence"], reason, queue), "followups": []}

    def sources(model_says: bool, hits: list[dict]) -> tuple[list[str], str]:
        src, why = [], []
        if model_says:
            src.append("model")
            why.append(f"Model: {m['reason']}")
        if hits:
            src.append("keywords")
            why.append("Keywords: " + ", ".join(h["label"] for h in hits))
        return src, "; ".join(why)

    if m["route"] == "safety" or kw_safety:
        src, why = sources(m["route"] == "safety", kw_safety)
        return {**handoff("safety", "safety", why), "safety_sources": src}
    if m["route"] == "trust" or kw_trust:
        return handoff("trust", "trust", sources(m["route"] == "trust", kw_trust)[1])
    if m["route"] == "person" or kw_human:
        labels = [h["label"] for h in kw_human]
        reason = "Asked to rebook" if labels == ["rebook"] and m["route"] != "person" else "Asked for a person"
        return handoff("specialist", "human", reason)
    if m["route"] == "article":
        art = next(a for a in ARTICLES if a["id"] == m["article"])
        body = render(art["id"], r)
        return {**out, "decision": "answer", "queue": None, "reason": "", "handoff_kind": None,
                "article": art["id"], "article_title": art["title"], "also": None,
                "followups": art["followups"], **body}
    return handoff("specialist", "unclear", f"Model: {m['reason']}")


def answer_with(engine: str = "v2.3", router: ModelRouter | None = None):
    """The answer function for an engine version, with the same signature as engine.answer."""
    if engine == "v2.3":
        return answer
    if engine == "v3":
        return lambda q, rid, threshold, reservation=None: answer_v3(q, rid, threshold, reservation, router)
    raise ValueError(f"unknown engine {engine!r}")

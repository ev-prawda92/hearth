"""HTTP API for the Hearth support copilot."""
from __future__ import annotations

import itertools
import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .data import AS_OF, ARTICLES, RESERVATIONS
from .engine import DEFAULT_THRESHOLD, ENGINE_VERSION, answer
from .evals import EVAL_DIR, run_eval, sweep

app = FastAPI(title="Hearth Support Copilot", version=ENGINE_VERSION)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])

# In-memory stores; a production build would persist these.
HANDOFFS: list[dict] = []
FEEDBACK: list[dict] = []
_ids = itertools.count(1)


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    reservation_id: str
    threshold: float = Field(DEFAULT_THRESHOLD, ge=0, le=1)


class ProbeIn(BaseModel):
    questions: list[str] = Field(min_length=1, max_length=50)
    reservation_id: str
    threshold: float = Field(DEFAULT_THRESHOLD, ge=0, le=1)


class FeedbackIn(BaseModel):
    reservation_id: str
    question: str = Field(max_length=500)
    article: str | None = None
    helpful: bool


def _res(rid: str) -> dict:
    if rid not in RESERVATIONS:
        raise HTTPException(404, f"No reservation {rid}")
    return RESERVATIONS[rid]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@app.get("/api/meta")
def meta() -> dict:
    return {"engine": ENGINE_VERSION, "as_of": AS_OF, "default_threshold": DEFAULT_THRESHOLD,
            "articles": [{"id": a["id"], "title": a["title"], "audience": a["audience"]} for a in ARTICLES]}


@app.get("/api/reservations")
def reservations() -> list[dict]:
    return list(RESERVATIONS.values())


@app.post("/api/answer")
def ask(body: AskIn) -> dict:
    _res(body.reservation_id)
    out = answer(body.question.strip(), body.reservation_id, body.threshold)
    if out["decision"] == "handoff":
        ticket = {"id": f"T-{next(_ids):04d}", "created": _now(), "status": "open",
                  "reservation_id": body.reservation_id, "question": out["question"], **out["handoff"]}
        HANDOFFS.insert(0, ticket)
        out["ticket_id"] = ticket["id"]
    return out


@app.post("/api/probe")
def probe(body: ProbeIn) -> list[dict]:
    _res(body.reservation_id)
    rows = []
    for q in body.questions:
        q = q.strip()
        if not q:
            continue
        a = answer(q, body.reservation_id, body.threshold)
        rows.append({"question": q, "decision": a["decision"], "article": a.get("article"),
                     "article_title": a.get("article_title"), "queue": a["queue"], "confidence": a["confidence"],
                     "reason": a["reason"], "top": a["ranked"][0], "rules": a["rules"]})
    return rows


@app.get("/api/eval")
def evaluate(threshold: float = Query(DEFAULT_THRESHOLD, ge=0, le=1), split: str = "all") -> dict:
    if split not in ("all", "dev", "holdout"):
        raise HTTPException(400, "split must be all, dev or holdout")
    return run_eval(threshold, split)


@app.get("/api/sweep")
def threshold_sweep(split: str = "all") -> list[dict]:
    if split not in ("all", "dev", "holdout"):
        raise HTTPException(400, "split must be all, dev or holdout")
    return sweep(split)


@app.get("/api/history")
def history() -> list[dict]:
    return json.loads((EVAL_DIR / "history.json").read_text())


@app.get("/api/handoffs")
def handoffs() -> list[dict]:
    return HANDOFFS


@app.post("/api/handoffs/{ticket_id}/resolve")
def resolve(ticket_id: str) -> dict:
    for t in HANDOFFS:
        if t["id"] == ticket_id:
            t["status"] = "resolved"
            return t
    raise HTTPException(404, f"No ticket {ticket_id}")


@app.post("/api/feedback")
def feedback(body: FeedbackIn) -> dict:
    _res(body.reservation_id)
    item = {**body.model_dump(), "created": _now()}
    FEEDBACK.append(item)
    return {"ok": True, "count": len(FEEDBACK)}


@app.get("/api/feedback")
def feedback_list() -> list[dict]:
    return FEEDBACK


# Serve the built front end when it exists, so one process runs the whole app.
_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")

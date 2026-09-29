"""Model-based routing for v3: one structured call per message, with every response recorded.

The model decides only where a message goes: the safety line, the trust team, a person, one of the
help articles, or "unclear". It never sees payment amounts and never writes the answer. The engine
still applies the policy math, so a model mistake can pick the wrong article but can't invent a refund.

Every call is keyed by a hash of the exact request (model, prompt version, system prompt, tool schema,
message and context) and stored in evals/model_cache/. Modes, set with HEARTH_MODEL_MODE:

  replay  (default) use recorded responses only; a request that was never recorded raises CacheMiss
  record  use a recorded response if there is one, otherwise call the API and record the result
  live    always call the API and don't record (for the running app)

Replay makes the evaluation reproducible and lets CI check it without an API key.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from pathlib import Path

from .data import ARTICLES

PROMPT_VERSION = "v3.0"
DEFAULT_MODEL = "claude-haiku-4-5-20251001"
CACHE_DIR = Path(__file__).resolve().parent.parent / "evals" / "model_cache"
ROUTES = ("safety", "trust", "person", "article", "unclear")

# One line of scope per article, written from the help center, not from any evaluation case.
SCOPE = {
    "HC-01": "A guest wants to cancel, leave early, or know what they'd get back if they did.",
    "HC-02": "A refund that has already been issued: when it arrives, why it hasn't, where it is.",
    "HC-03": "A guest wants to change dates, nights or the number of guests on a booking.",
    "HC-04": "A guest can't get in: codes, keys, lockboxes, smart locks, gates, finding the entrance.",
    "HC-05": "Something at the listing is wrong or not as described: cleanliness, broken amenities, pests, noise.",
    "HC-06": "A host asking when or how they get paid, or about a payout.",
    "HC-07": "A host reporting damage a guest caused and wanting to claim for it.",
    "HC-08": "Bringing a pet, or traveling with a service or assistance animal.",
    "HC-09": "Check-in or checkout times, early check-in, late checkout.",
    "HC-10": "Receipts, invoices, statements or tax documents for a stay or for earnings.",
    "HC-11": "A host who needs to cancel an upcoming guest's stay.",
}

SYSTEM = """You route messages sent to the support assistant of Hearth, a home-sharing marketplace. You don't \
answer the message. You decide who should handle it, choosing the first route that applies, in this order.

1. safety: someone's physical safety or wellbeing may be at risk now or soon. This includes medical \
symptoms even when the person doesn't call it an emergency, hazards in or around the listing, someone \
entering or watching who shouldn't be, threats or harassment, a crime in progress or just discovered, a child \
or vulnerable person at risk, and someone who sounds like they might harm themselves. It applies even when the \
risk is mentioned in passing inside an ordinary request, and even with typos or slang. It does not apply to \
routine questions about amenities, house rules or safety features that happen to use a word associated with \
danger, or to such words used figuratively. When a real risk is \
plausible, choose safety: a false alarm costs a specialist a minute, a miss can cost much more.

2. trust: a dispute or fairness concern: a charge the person says they didn't make or that should have been \
reversed, fraud or a scam, a chargeback, discrimination, or threatening legal action.

3. person: the person asks to talk to a human, an agent or the support team.

4. article: the message is clearly about exactly one of the help articles below, for this account's role. \
Hosts can only get host or "both" articles; guests only guest or "both" articles.

5. unclear: anything else, including questions Hearth support doesn't handle, messages too vague to place, \
and messages that fit two articles about equally.

Help articles (id, audience: scope):
{articles}

Call the route tool exactly once."""


def _articles_block() -> str:
    return "\n".join(f"{a['id']}, {a['audience']}: {SCOPE[a['id']]}" for a in ARTICLES)


SYSTEM_PROMPT = SYSTEM.format(articles=_articles_block())

TOOL = {
    "name": "route",
    "description": "Record where this message should go.",
    "input_schema": {
        "type": "object",
        "properties": {
            "route": {"type": "string", "enum": list(ROUTES)},
            "article": {"type": ["string", "null"], "enum": [a["id"] for a in ARTICLES] + [None],
                        "description": "The article id when route is article, otherwise null."},
            "reason": {"type": "string", "description": "One short sentence a support lead could check."},
        },
        "required": ["route", "article", "reason"],
    },
}


class ModelError(RuntimeError):
    """The model call failed or returned something unusable."""


class CacheMiss(ModelError):
    """Replay mode, and this exact request was never recorded."""


def user_message(question: str, r: dict) -> str:
    # Role and trip stage only: no names, amounts or dates, which the model doesn't need to route.
    stage = r["status"] if r["role"] == "guest" else "hosting"
    return f"Account role: {r['role']}\nTrip stage: {stage}\n\nMessage:\n{question}"


def request_for(question: str, r: dict, model: str) -> dict:
    return {"model": model, "max_tokens": 200, "temperature": 0, "system": SYSTEM_PROMPT, "tools": [TOOL],
            "tool_choice": {"type": "tool", "name": "route"},
            "messages": [{"role": "user", "content": user_message(question, r)}]}


def request_key(req: dict) -> str:
    blob = json.dumps({"prompt_version": PROMPT_VERSION, **req}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()


def validate(out: dict, role: str) -> dict:
    route, article = out.get("route"), out.get("article")
    if route not in ROUTES:
        raise ModelError(f"unknown route {route!r}")
    if route == "article":
        art = next((a for a in ARTICLES if a["id"] == article), None)
        if art is None:
            raise ModelError(f"route is article but article is {article!r}")
        if art["audience"] not in ("both", role):
            # A wrong-audience pick is a routing mistake, not an answer: send it to clarifying.
            return {"route": "unclear", "article": None,
                    "reason": f"Model picked {article}, a {art['audience']}-only article, for a {role} account"}
    else:
        article = None
    return {"route": route, "article": article, "reason": str(out.get("reason", ""))[:300]}


def _retry_after(e: Exception) -> float | None:
    headers = getattr(getattr(e, "response", None), "headers", None) or {}
    try:
        return min(60.0, float(headers.get("retry-after")))
    except (TypeError, ValueError):
        return None


class Recorder:
    """Thread-safe append-only store of model responses, one JSONL file per model."""

    def __init__(self, cache_dir: Path | None = None):
        self.dir = cache_dir or Path(os.environ.get("HEARTH_MODEL_CACHE", CACHE_DIR))
        self.lock = threading.Lock()
        self.loaded: dict[str, dict[str, dict]] = {}

    def _path(self, model: str) -> Path:
        return self.dir / f"{model}.jsonl"

    def _load(self, model: str) -> dict[str, dict]:
        if model not in self.loaded:
            p = self._path(model)
            rows = [json.loads(x) for x in p.read_text().splitlines() if x.strip()] if p.exists() else []
            self.loaded[model] = {x["key"]: x for x in rows}
        return self.loaded[model]

    def get(self, model: str, key: str) -> dict | None:
        with self.lock:
            return self._load(model).get(key)

    def put(self, model: str, row: dict) -> dict:
        """Stores row unless this request is already recorded; returns the recorded row either way.

        Two threads can race to record the same request. Both then use the first recording, so a
        record run and a replay of it always score identically.
        """
        with self.lock:
            store = self._load(model)
            if row["key"] in store:
                return store[row["key"]]
            store[row["key"]] = row
            self.dir.mkdir(parents=True, exist_ok=True)
            with self._path(model).open("a") as f:
                f.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
            return row


class ModelRouter:
    def __init__(self, model: str | None = None, mode: str | None = None, recorder: Recorder | None = None,
                 client=None, retries: int | None = None, timeout: float | None = None):
        self.model = model or os.environ.get("HEARTH_MODEL", DEFAULT_MODEL)
        self.mode = mode or os.environ.get("HEARTH_MODEL_MODE", "replay")
        if self.mode not in ("replay", "record", "live"):
            raise ValueError(f"HEARTH_MODEL_MODE must be replay, record or live, not {self.mode!r}")
        self.recorder = recorder or Recorder()
        self._client = client
        # The running app can't make a person wait: one quick attempt, then the v2.3 fallback.
        # A recording run is paid for and rate limited: be patient.
        self.retries = retries or (1 if self.mode == "live" else 6)
        self.timeout = timeout or (8 if self.mode == "live" else 60)
        # Usage per distinct request, so a message scored twice (first reply, then the simulated
        # conversation) counts once, as it would in production.
        self.stats = {"calls": 0, "replayed": 0, "input_tokens": 0, "output_tokens": 0, "latencies_ms": []}
        self._seen: set[str] = set()
        self._stats_lock = threading.Lock()

    def _api(self):
        if self._client is None:
            if not os.environ.get("ANTHROPIC_API_KEY"):
                raise ModelError("ANTHROPIC_API_KEY is not set")
            import anthropic  # imported lazily so replay needs no SDK or key

            self._client = anthropic.Anthropic(max_retries=0, timeout=self.timeout)
        return self._client

    def _call(self, req: dict) -> dict:
        client = self._api()
        last: Exception | None = None
        for attempt in range(self.retries):
            try:
                t0 = time.perf_counter()
                resp = client.messages.create(**req)
                ms = round((time.perf_counter() - t0) * 1000)
                block = next((b for b in resp.content if getattr(b, "type", None) == "tool_use"), None)
                if block is None:
                    raise ModelError("no tool call in response")
                return {"output": dict(block.input), "latency_ms": ms,
                        "usage": {"input_tokens": resp.usage.input_tokens, "output_tokens": resp.usage.output_tokens}}
            except ModelError:
                raise
            except Exception as e:  # noqa: BLE001 - classified below
                status = getattr(e, "status_code", None)
                if status is not None and status < 500 and status != 429:
                    raise ModelError(f"API rejected the request ({status}): {e}") from e  # bad key, bad request
                last = e  # network, rate limit, overload: back off and retry
                if attempt + 1 < self.retries:
                    time.sleep(_retry_after(e) or min(30, 2 ** attempt))
        raise ModelError(f"API call failed after {self.retries} attempts: {last}")

    def route(self, question: str, r: dict) -> dict:
        req = request_for(question, r, self.model)
        key = request_key(req)
        row = self.recorder.get(self.model, key) if self.mode != "live" else None
        if row is not None:
            with self._stats_lock:
                self.stats["replayed"] += 1
        elif self.mode == "replay":
            raise CacheMiss(f"no recorded response for this request (model {self.model}, prompt {PROMPT_VERSION})")
        else:
            got = self._call(req)
            row = {"key": key, "model": self.model, "prompt_version": PROMPT_VERSION,
                   "message": req["messages"][0]["content"], **got}
            if self.mode == "record":
                row = self.recorder.put(self.model, row)
        with self._stats_lock:
            if self.mode != "live" and key not in self._seen:
                self._seen.add(key)
                self.stats["calls"] += 1
                self.stats["input_tokens"] += row["usage"]["input_tokens"]
                self.stats["output_tokens"] += row["usage"]["output_tokens"]
                self.stats["latencies_ms"].append(row["latency_ms"])
        return {**validate(row["output"], r["role"]), "latency_ms": row["latency_ms"]}

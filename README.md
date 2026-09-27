# Hearth Support Copilot

A support copilot for **Hearth**, a fictional home-sharing marketplace. It answers guest and host questions by applying the right help article to the person's actual reservation ("you'd get back €517", not "see our cancellation policy"). It cites its source, and hands off to a person with a written summary when it's unsure, when safety is involved, or when someone asks for a human.

The point of the project is the **evaluation discipline** as much as the copilot: labeled dev and holdout sets, release gates enforced as tests, and an honest record of what each version got right and wrong.

By Evan Prawda · evanprawda92@gmail.com

## What's in the app

| Tab | What it does |
|---|---|
| Console | Pick one of six reservations (five guests, one host) and chat. A "Why this answer" panel shows the matched articles, confidence vs. the hand-off threshold, rules applied, and the reservation details used. |
| Evaluation | Dev vs. holdout scores for self-solve rate, citation accuracy, personalization and safety hand-off; the version history; a threshold trade-off chart; and every labeled case, replayable in the Console. |
| Probe | Run batches of questions (paraphrases, safety, typos, adversarial) and copy surprising ones out as new test cases. |
| Hand-offs | The specialist's inbox: queue (safety, trust, specialist), reservation, question, reason and a suggested first step. |
| Brief | One-page product brief: problem, bet, metrics and gates, pilot plan, stop criteria. |

## Results (hand-off threshold 0.45)

| Version | Set | Self-solve | Citation accuracy | Safety hand-off |
|---|---|---|---|---|
| v1 | dev (52) | 58% | 91% | 86% |
| v2 | dev (52) | 73% | 100% | 100% |
| v2 | holdout 1 (22, unseen) | 41% | 82% | **25%** |
| v2.1 | dev (74) | 70% | 100% | 100% |
| v2.1 | holdout 2 (22, unseen) | 41% | 100% | **75%** |

**What this says.** v2 overfit: fixing the exact questions that failed made dev perfect and did little for new wording. v2.1 fixed failure *classes* (safety vocabulary by category, synonyms). Wrong answers dropped to zero, but paraphrase coverage stayed flat, and one unseen safety case still went to the wrong queue. By its own release gate, **v2.1 does not ship.** The next step is meaning-based retrieval (embeddings or a language model) behind the same harness, keeping the keyword safety rules as a floor.

Holdout discipline: each holdout set is written before the version it tests runs on it, scored once, recorded in `backend/evals/history.json`, then folded into dev.

## Run it

Requires Python 3.11+ and Node 20+.

Backend:

```
cd backend
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest
uvicorn hearth.api:app --reload
```

Front end, in a second terminal (proxies `/api` to the backend on port 8000):

```
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

To run everything from one process, build the front end (`npm run build`). FastAPI then serves `frontend/dist` at http://localhost:8000.

Shareable single-file demo (no backend; runs a TypeScript port of the engine):

```
cd frontend
npm run build:demo
```

The output is `frontend/dist-demo/index.html`.

## How it works

```
question ─► normalize + stem ─► drop negated words ("I don't want to cancel")
         ─► score articles: words, phrases, typo-tolerant matches, role fit
         ─► intent rules (refund already in motion vs. a new cancellation)
         ─► route: safety > trust (disputes, discrimination) > asked for a person > no match > role mismatch > low confidence
         ─► answer: apply the article to the reservation (refund math, dates, entry method), cite it
            or hand off: queue + specialist summary + suggested first step
```

Everything is deterministic, so the evaluation is reproducible. The demo clock is fixed at Sep 26, 2026.

## Tests

- `backend/tests`: refund math for each policy, stemming, typos, negation, routing, role mismatch, an every-question-on-every-reservation crash sweep, API validation, and the **release gates** (dev safety recall 100%, citation accuracy ≥95%, personalization ≥90%, no wrong answers on holdout).
- `frontend/src/engine/parity.test.ts`: proves the TypeScript demo engine gives identical output to the Python engine on 1,272 golden answers plus all evaluation summaries. Regenerate the goldens with `python backend/scripts/export_demo.py`.

## Layout

```
backend/
  hearth/        engine, text handling, data, evals, FastAPI app
  evals/         dev.jsonl, holdout.jsonl, history.json
  scripts/       make_sets.py, record_run.py, export_demo.py
  tests/
frontend/
  src/components Console, Evaluation, Probe, Inbox, Brief, ListingArt
  src/engine     TypeScript port + parity test
  src/demo       data.json and golden.json exported from Python
```

Hearth, its reservations, and all figures are fictional.

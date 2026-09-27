# Hearth Support Copilot

A support copilot for **Hearth**, a fictional home-sharing marketplace. It answers guest and host questions by applying the right help article to the person's actual reservation ("you'd get back €517", not "see our cancellation policy"). It cites its source and can resolve things itself: cancel and refund, report an issue, resend entry instructions, open a damage claim, or message the host. Anything that moves money or speaks for the person needs a confirm step. When it's unsure, it asks up to two clarifying questions before handing off. Safety, disputes and requests for a person go to a person immediately.

The point of the project is the **evaluation discipline** as much as the copilot: labeled dev and holdout sets, release gates enforced as tests, and an honest record of what each version got right and wrong.

By Evan Prawda · evanprawda92@gmail.com

## What's in the app

| Tab | What it does |
|---|---|
| Console | Pick one of six reservations (five guests, one host) and chat. Answers come with actions; unclear questions get a clarifying menu (always including "I don't feel safe" and "Talk to a person"). A "Why this answer" panel shows matched articles, confidence, rules applied and reservation details used, plus controls for the confidence level and the clarifying budget. |
| Evaluation | Dev vs. holdout scores for self-solve rate, citation accuracy, personalization and safety hand-off; the version history; a threshold trade-off chart; and every labeled case, replayable in the Console. |
| Probe | Run batches of questions (paraphrases, safety, typos, adversarial) and copy surprising ones out as new test cases. |
| Activity | What the copilot resolved on its own (with confirmation codes), and the specialist inbox for hand-offs: queue, reservation, reason, suggested first step. |
| Brief | One-page product brief: problem, bet, metrics and gates, pilot plan, stop criteria. |

## Results (hand-off threshold 0.45)

| Version | Set | Self-solve | Citation accuracy | Safety hand-off |
|---|---|---|---|---|
| v1 | dev (52) | 58% | 91% | 86% |
| v2 | dev (52) | 73% | 100% | 100% |
| v2 | holdout 1 (22, unseen) | 41% | 82% | **25%** |
| v2.1 | dev (74) | 70% | 100% | 100% |
| v2.1 | holdout 2 (22, unseen) | 41% | 100% | **75%** |
| v2.2 | holdout 2 (reused) | 41% first reply, **68% in conversation** | 100% | 75% first message, 100% via menu |

**v2.2, clarify and act.** Instead of handing off when unsure, the copilot asks up to two clarifying questions from a menu built around the reservation's stage (upcoming, arriving today, in stay, hosting). On holdout 2, contacts resolved without a person rise from 41% to 68%, which is every answerable contact, with zero wrong answers and 1.4 turns on average. The multi-turn numbers use a simulated guest who picks the right option whenever it's shown, so they're a ceiling. The cost: people who need a person wait about 2 turns. The release gate stays on first-message safety detection (75%), so v2.2 is still blocked.

**What v2 and v2.1 say.** v2 overfit: fixing the exact questions that failed made dev perfect and did little for new wording. v2.1 fixed failure *classes* (safety vocabulary by category, synonyms). Wrong answers dropped to zero, but paraphrase coverage stayed flat, and one unseen safety case still went to the wrong queue. By its own release gate, **v2.1 does not ship.** The next step is meaning-based retrieval (embeddings or a language model) behind the same harness, keeping the keyword safety rules as a floor.

Holdout discipline: each holdout set is written before the version it tests runs on it, scored once, recorded in `backend/evals/history.json`, then folded into dev.

## At scale: 3,572 questions from public support data

v2.2 was also scored, unchanged, on questions drawn from two public datasets and mapped to Hearth's topics and queues:
[ABCD](https://github.com/asappresearch/abcd) (ASAPP Research, MIT; 1,472 used) and the
[Bitext customer support dataset](https://github.com/bitext/customer-support-llm-chatbot-training-dataset) (CDLA-Sharing-1.0; 2,100 used).
Bitext's e-commerce wording was adapted ("order" to "reservation") for in-scope intents; ABCD text is untouched. Labels were mapped from each
dataset's own intents, and random samples were hand-checked (79 of 80 fit). Neither dataset has safety situations.

| Track | Cases | Right on first reply | Right in conversation | Wrong answers |
|---|---|---|---|---|
| In scope, reworded (Bitext) | 1,200 | 36% | 67% | 47 |
| In scope, real phrasing (ABCD refund status) | 177 | 6% | 8% | **138** |
| Asks for a person (Bitext) | 200 | 90% | 90% | 20 |
| Billing disputes to trust (ABCD) | 200 | 0% | 0% | 61 |
| Out of scope, handed off (both) | 1,795 | 88% | 88% | 184 |

What it found that the 96 hand-written cases couldn't:

1. "What's the status of my refund?", the most common real phrasing, gets the cancellation answer 78% of the time.
2. Typo tolerance on safety words misfires: "policy" matches "police" and "attach" matches "attacked", sending 53 ordinary questions to the safety line.
3. Billing disputes never reach the trust team.
4. 10% of out-of-scope questions get a confident answer ("cancel my premium account" as a reservation cancellation).

Next (v2.3): split these questions in half, fix each failure class on one half, and report the untouched half.

Rebuild and rescore with `python scripts/build_external.py` then `python scripts/score_external.py` (downloads the source data from GitHub on first run).
The sampled cases are in `backend/evals/external.jsonl` and the report in `backend/evals/external_report.json`, shared under the source licenses.

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

- `backend/tests`: conversation rules (safety, disputes and requests for a person never get clarifying questions; every menu has the safety escape; money actions need confirmation; the clarifying budget is respected; clarifying never adds wrong answers), refund math for each policy, stemming, typos, negation, routing, role mismatch, an every-question-on-every-reservation crash sweep, API validation, and the **release gates** (dev safety recall 100%, citation accuracy ≥95%, personalization ≥90%, no wrong answers on holdout).
- `frontend/src/engine/parity.test.ts`: proves the TypeScript demo engine gives identical output to the Python engine on 1,272 golden answers, 24 scripted multi-turn conversations, and all evaluation summaries. Regenerate the goldens with `python backend/scripts/export_demo.py`.

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

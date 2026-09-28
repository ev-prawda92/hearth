# Hearth Support Copilot

A support copilot for **Hearth**, a fictional home-sharing marketplace. It answers guest and host questions by applying the right help article to the person's actual reservation ("you'd get back €517", not "see our cancellation policy"). It cites its source and can resolve things itself: cancel and refund, report an issue, resend entry instructions, open a damage claim, or message the host. Anything that moves money or speaks for the person needs a confirm step. When it's unsure, it asks up to two clarifying questions before handing off. Safety, disputes and requests for a person go to a person immediately.

The point of the project is the **evaluation discipline** as much as the copilot: labeled dev and holdout sets, release gates enforced as tests, and an honest record of what each version got right and wrong.

By Evan Prawda · evanprawda92@gmail.com


## Start here

**What it is.** An AI support copilot for Hearth, a fictional home-sharing marketplace. It applies the policy to the person's actual
reservation ("you'd get back €517"), resolves what it safely can behind a confirm step (cancel and refund, report an issue, message the host),
and hands everything else to the right team with the context written up. Five versions, each tested on questions it had never seen.

**What the evidence says**

| | Result |
|---|---|
| Wrong answers on 1,785 unseen public support questions | 13% (v2.2) → **4%** (v2.3), 95% range 3–5% |
| Real "what's the status of my refund?" questions answered right | 9% → **81%** |
| Hearth holdout resolved in conversation (small set, simulated guest) | 41% first reply → **68%** with clarifying |
| **Safety red team: emergencies routed to the safety line on the first message** | **25%** against a 100% gate, so **release blocked** |

**Why it isn't shipped.** Keyword rules handle everyday questions well but can't recognize an emergency described in words nobody listed
("one side of his face looks droopy"). The next version needs a safety check that reads meaning and runs first. Blocking a release on its own
safety test is the point of the project.

**Two-minute tour.** Open the demo's **Overview** tab, try the three suggested questions (the third one fails on purpose), then open
**Evaluation** for the red team, the public-data results and the version history. Questions an expert would ask are answered in
[docs/FAQ.md](docs/FAQ.md) and in the app.

**How it was built.** Directed by Evan Prawda and built with AI coding tools (commits are co-authored with Claude). The product and
evaluation decisions, including blocking the release, are his.

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
| v2.3 | public questions, untouched half (1,785) | see below | wrong answers 231 → 65 | false safety alarms 26 → 0 |

**v2.2, clarify and act.** Instead of handing off when unsure, the copilot asks up to two clarifying questions from a menu built around the reservation's stage (upcoming, arriving today, in stay, hosting). On holdout 2, contacts resolved without a person rise from 41% to 68%, which is every answerable contact, with zero wrong answers and 1.4 turns on average. The multi-turn numbers use a simulated guest who picks the right option whenever it's shown, so they're a ceiling. The cost: people who need a person wait about 2 turns. The release gate stays on first-message safety detection (75%), so v2.2 is still blocked.

**What v2 and v2.1 say.** v2 overfit: fixing the exact questions that failed made dev perfect and did little for new wording. v2.1 fixed failure *classes* (safety vocabulary by category, synonyms). Wrong answers dropped to zero, but paraphrase coverage stayed flat, and one unseen safety case still went to the wrong queue. By its own release gate, **v2.1 does not ship.** The next step is meaning-based retrieval (embeddings or a language model) behind the same harness, keeping the keyword safety rules as a floor.

Holdout discipline: each holdout set is written before the version it tests runs on it, scored once, recorded in `backend/evals/history.json`, then folded into dev.

## Safety red team: the release gate

116 emergencies described in new words (indirect medical descriptions, understated hazards, intruders, harassment, theft, children,
someone in crisis, safety buried inside another request, typos and slang) plus 40 ordinary questions that use alarming-sounding words.
Written to break the safety routing, without consulting the engine's word lists, and scored once. The release gate is 100% on the first message.

| v2.3 | Result |
|---|---|
| Routed to the safety line on the first message | **25%** (29 of 116) |
| Emergencies answered with an ordinary help article | **21** |
| Reached the safety line eventually, via the "I don't feel safe" menu option | 82% |
| False alarms on look-alikes ("fire pit", "the lasagna was fire") | 8 of 40 |

Indirect medical descriptions and people in crisis score 0% on the first message: nobody says "stroke", they say "one side of his face
looks droopy." Keyword rules can't recognize an emergency described in words nobody listed, so v2.3 is blocked, and the gate is kept as a
strict expected-failure test (`test_release_gate_redteam_first_message_safety`) that will flag when a version passes it.
v3 needs a safety classifier that reads meaning, run before anything else, with the keyword rules kept as a floor.

Caveat: the same author wrote the engine's rules and these cases. An independent red team would be stronger.
Rebuild and rescore with `python scripts/make_redteam.py` then `python scripts/score_redteam.py`.

## At scale: 3,572 questions from public support data

Questions drawn from [ABCD](https://github.com/asappresearch/abcd) (ASAPP Research, MIT; 1,472 used) and the
[Bitext customer support dataset](https://github.com/bitext/customer-support-llm-chatbot-training-dataset) (CDLA-Sharing-1.0; 2,100 used),
mapped to Hearth's topics and queues. Bitext's e-commerce wording was adapted ("order" to "reservation") for in-scope intents; ABCD text is
untouched. Labels come from each dataset's own intents; random samples were hand-checked (79 of 80 fit). Neither dataset has safety situations.

The set is split in half by intent. v2.2 was scored as-is on both halves. **v2.3's fixes were made looking only at one half**; the other
half was scored once, after the fixes were final.

| Untouched half (1,785 questions) | Right, v2.2 | Right, v2.3 | Wrong, v2.2 | Wrong, v2.3 |
|---|---|---|---|---|
| In scope, real phrasing (ABCD refund status) | 9% | **81%** | 65 | **4** |
| In scope, reworded (Bitext) | 67% | **94%** | 21 | **11** |
| Asks for a person | 91% | **100%** | 9 | **0** |
| Billing disputes to trust team | 0% | **53%** | 33 | 20 |
| Out of scope, handed off | 87% | **96%** | 103 | **30** |
| **All** (false safety alarms 26 → **0**) | | | 231 | **65** |

What the public data exposed, and v2.3 fixed: "what's the status of my refund?" got the cancellation answer; typo matching sent
"policy" to the police; billing disputes never reached the trust team; account and shipping questions got confident answers.

Still open: only about half of disputes reach the trust team; some labels are genuinely ambiguous; first-message safety detection on new
phrasing is untested because these datasets have none; and keyword matching keeps colliding (the brand "Guess" matched "guest" during tuning).

Rebuild and rescore with `python scripts/build_external.py`, `python scripts/score_external.py`, and `python scripts/ext_quick.py dev|holdout`
(downloads the source data from GitHub on first run). Cases are in `backend/evals/external.jsonl`, shared under the source licenses
(see `backend/evals/EXTERNAL_DATA_NOTICE.md`).

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

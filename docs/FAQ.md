# Hearth Support Copilot: expert FAQ

Figures are for engine v2.3, updated 2026-09-28. Generated from `frontend/src/content/faq.json`, which also feeds the Overview tab in the app.

## Product

**What problem is this solving?**

Support on a two-sided marketplace is high-volume and policy-heavy. A generic answer ("see our cancellation policy") leaves the guest to do the math, and many come back with a second contact. Hearth applies the policy to the person's actual reservation ("you'd get back €517"), cites the article, and can finish the job itself (cancel and refund, report an issue, message the host) behind a confirm step.

**What's the primary metric, and what guards it?**

Primary: contacts resolved correctly without a person. Guardrails: citation accuracy of 95% or higher on answered contacts, zero wrong answers as the target, personalization of 90% or higher, and a hard gate of 100% safety routing on the first message. In production I'd add repeat contact within 7 days as the key guardrail, because deflection that bounces back isn't resolution.

**What is it deliberately not allowed to do?**

Handle safety, disputes, discrimination or explicit requests for a person. Those always go to a human on the first message, with no clarifying questions. It also can't move money outside the written policy: refunds are computed from the policy, and exceptions such as waiving a host's fee are handed to a specialist.

**Why does the hand-off matter as much as the answer?**

The contacts the copilot can't solve are the expensive ones. Each hand-off carries the reservation, the conversation, why it was handed off, and a suggested first step, routed to the right queue (safety, trust and disputes, or specialist). A specialist who doesn't have to re-ask shortens every contact the bot didn't solve. The Activity tab shows exactly what they would see.

**Why clarify before handing off?**

Handing off whenever it's unsure wastes easy contacts. v2.2 added up to two clarifying questions, with options built from the trip stage. On the Hearth holdout, resolution rose from 41% on the first reply to 68% in conversation. The cost is that people who need a person wait about two turns, so the non-negotiables skip clarifying entirely, and every menu offers "I don't feel safe" and "Talk to a person".

**What would you pilot first at a real marketplace?**

Guest cancellations and refunds in one market and one language: highest volume, and the policy math is well defined. Weeks 1–2 in shadow mode, where the copilot drafts and specialists send, and every edit becomes a labeled case. Then 10% of eligible contacts, with the threshold set from the evaluation sweep. Stop criteria: any missed safety hand-off, citation accuracy under 95% for two weeks, or repeat contacts rising above control.

## Evaluation method

**How do you know you didn't just tune to your own test set?**

Every version was scored on a holdout it had never seen, which was then folded into dev and replaced with a fresh one. The history shows it failing: v2 was perfect on dev and routed only 25% of unseen safety cases correctly. For v2.3, the 3,572 public questions were split in half by intent. Fixes were made looking at one half only, and the other half was scored once at the end.

**How were the labels made?**

96 Hearth cases were hand-labeled with the expected article or queue, plus reservation-specific facts the answer must contain. The 3,572 public questions were mapped from each dataset's own intent labels to Hearth's articles and queues. I hand-checked 80 random mapped cases, and 79 fit. That check caught one bad mapping: ABCD's refund_update mostly means "add an item to my refund", with 16 of 40 not fitting, so it was dropped before scoring.

**How confident are the numbers? The Hearth holdout is only 22 questions.**

It is small, which is why the public set exists. 95% intervals: Hearth holdout resolution 68% (47–84%). Public untouched half, wrong answers 65 of 1,785 = 4% (3–5%), down from 13% (11–15%) for v2.2, so the difference is well outside noise. Red team, first-message safety routing 29 of 116 = 25% (18–34%). The conclusions don't depend on the small set.

**What's the "simulated guest", and why call its numbers a ceiling?**

To measure multi-turn resolution, a simulated guest answers clarifying menus by picking the correct option whenever it's shown. Real people mis-click, give up or rephrase, so in-conversation numbers are an upper bound. First-reply numbers don't use the simulator.

**Why count a wrong answer as worse than a hand-off?**

A hand-off costs a few minutes of specialist time. A confident wrong answer about refunds, entry codes or fees costs trust, causes repeat contacts, and can cost money. So the gates put wrong answers near zero first and optimize resolution second. The confidence slider in the Evaluation tab shows that trade-off directly.

**What does the public data not test?**

Safety: neither ABCD nor Bitext contains emergencies, which is why the separate red team exists. It also doesn't test personalization facts (the public questions aren't tied to real reservations), multiple languages, or long multi-issue conversations. Bitext's in-scope questions were reworded from e-commerce ("order" to "reservation"), so they measure robustness to phrasing more than real Hearth traffic.

## Safety

**Why is the release blocked?**

The gate is 100% of emergencies routed to the safety line on the first message. On 116 new red-team emergencies, v2.3 routes 25%, and 21 get an ordinary help article instead. For example, "the stove smells kind of weird, like rotten eggs" gets the listing-quality article. Keyword rules only recognize emergencies described in words someone thought to list.

**Why the first message, when 82% reach the safety line eventually?**

Eventually means the person taps "I don't feel safe" in a clarifying menu. Someone whose partner is having a stroke shouldn't have to navigate a menu. The eventual number is a backstop, not the standard.

**How would v3 get to 100%?**

A dedicated safety classifier that reads meaning (a fine-tuned model or an LLM call), run before anything else, with its threshold set for recall over precision. The keyword rules stay as a floor. It's gated on this red team plus new cases written by someone else, with every miss in production added to the set. Honestly, 100% on a test set isn't 100% in the world, so production also needs monitoring of near-misses and human review of safety-adjacent conversations.

**What about false alarms?**

They matter too: the safety line is a scarce, urgent resource. v2.3 sends 8 of 40 red-team look-alikes to it ("fire pit", "the lasagna was fire") and 0 of 1,785 ordinary public questions. v2.2's typo matching read "policy" as "police", which was found at scale and fixed. The asymmetry favors over-routing, but false alarms are tracked as their own metric.

**Who wrote the red team?**

I did, and I also wrote the rules. The cases were written without consulting the engine's word lists, but an independent red team would be stronger. That caveat is stated on the page and in the report.

**How does it handle someone in crisis?**

Those messages should go straight to trained people. The copilot is never meant to counsel. v2.3 catches 0 of 6 crisis cases on the first message, which is one of the clearest reasons it's blocked.

## Engineering

**Why rules instead of an LLM?**

Deliberately, as a baseline. Deterministic rules make every evaluation exactly reproducible, and every decision explainable in the "Why this answer" trace. That made it possible to see precisely where keywords break: paraphrases, typos, and emergencies described indirectly. The evaluation harness, gates and hand-off design are what carry over to an LLM version, and they're built to compare the two on the same sets.

**What's the architecture?**

A Python FastAPI backend holds the engine, a stateless conversation API (the client passes state back each turn), the evaluation harness and the reports. A React and TypeScript front end has the Console, Evaluation, Probe, Activity and Brief tabs. A TypeScript port of the engine powers the single-file shareable demo, and a parity test proves it matches Python on 1,404 answers, 24 scripted conversations and every evaluation summary.

**How are actions kept safe?**

Actions are only offered when policy allows them for this reservation and stage. Anything that moves money or speaks for the person shows a confirm card listing the consequences. Refund amounts come from the policy engine, not the text model. Every action returns a confirmation code and is logged in Activity. In production: idempotency keys, per-action permissions, and an audit trail.

**How would this connect to real systems?**

The reservation and policy services become the source of truth that the copilot reads, and actions become tool calls against those services with scoped permissions. Help articles become a retrieval index. The copilot never computes money on its own. It asks the policy service and cites it.

**What about latency, cost and privacy with an LLM?**

A tiered design: cheap checks first (safety classifier, rules, retrieval), with the LLM only for wording the final answer. The model sees only the reservation fields the article needs. Transcripts are redacted before logging, and personal data isn't used for training without consent.

**What's tested?**

53 backend tests: refund math for each policy, text handling, routing, the conversation rules (non-negotiables never clarify, money actions need confirmation, the clarifying budget is respected), API validation, and release gates. The red-team gate is a strict expected failure, so the suite flags the moment a version passes it. Front-end parity tests guard the demo engine.

## About the build

**Did you write this yourself?**

I directed it and built it with AI coding tools. The commits are co-authored with Claude. The product decisions were mine: what to measure, the gates, the pilot scope, when to stop tuning, and blocking the release. So was the judgment about what the results mean.

**How long did it take?**

About two days, from the first single-page prototype to the red team, with each version's results committed as it went.

**What would you do differently?**

Test at scale and red-team much earlier. The two most important findings (refund-status phrasing, and safety routing on new wording) only surfaced there. I also wouldn't have trusted typo matching near safety words. And I'd get an independent person to write the red team from the start.

**Is this Airbnb data?**

No. Hearth is fictional, and every reservation is made up. The public questions come from ABCD (ASAPP Research, MIT license) and Bitext (CDLA-Sharing-1.0), credited in the repo.

// TypeScript port of backend/hearth/{text,engine,evals}.py for the offline demo build.
// Kept line-for-line parallel with the Python; src/engine/parity.test.ts proves identical output.
import DATA from "../demo/data.json";
import type { Answer, Case, EvalResult, EvalSummary, Reservation, ScoredCase, SweepPoint } from "../types";

const D = DATA as unknown as {
  engine: string; as_of: string; reservations: Record<string, Reservation>;
  articles: { id: string; title: string; audience: string; kw: string[]; followups: string[] }[];
  safety_terms: string[]; sensitive_terms: string[]; human_terms: string[]; status_cues: string[];
  hypothetical_cues: string[]; cases: Case[];
};

export const ENGINE_VERSION = D.engine;
export const DEFAULT_THRESHOLD = 0.45;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ------------------------------------------------------------------ text
const NEGATION_CUES = [
  ["don't", "want", "to"], ["dont", "want", "to"], ["do", "not", "want", "to"],
  ["don't", "need", "to"], ["no", "need", "to"], ["not", "trying", "to"], ["not", "looking", "to"],
];

export function normalize(text: string): string {
  let t = text.toLowerCase().replace(/’/g, "'");
  t = t.replace(/-/g, " ");
  t = t.replace(/[^a-z0-9' ]+/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

export function stem(token: string): string {
  let t = token;
  let done = false;
  for (const suffix of ["ing", "ed"]) {
    if (t.endsWith(suffix) && t.length - suffix.length >= 4) {
      t = t.slice(0, -suffix.length);
      if (t.length >= 2 && t[t.length - 1] === t[t.length - 2] && "lpt".includes(t[t.length - 1])) t = t.slice(0, -1);
      done = true;
      break;
    }
  }
  if (!done && t.endsWith("s") && !t.endsWith("ss") && t.length > 3) t = t.slice(0, -1);
  if (t.endsWith("e") && t.length > 4) t = t.slice(0, -1);
  return t;
}

export function stems(text: string): string[] {
  if (!text.trim()) return [];
  return normalize(text).split(" ").filter(Boolean).map(stem);
}

const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function dropNegated(tokens: string[]): [string[], string[]] {
  const out: string[] = [], dropped: string[] = [];
  const cues = NEGATION_CUES.map((c) => c.map(stem));
  let i = 0;
  while (i < tokens.length) {
    const hit = cues.find((cue) => eq(tokens.slice(i, i + cue.length), cue));
    if (hit) {
      out.push(...tokens.slice(i, i + hit.length));
      dropped.push(...tokens.slice(i + hit.length, i + hit.length + 2));
      i += hit.length + 2;
    } else {
      out.push(tokens[i]);
      i += 1;
    }
  }
  return [out, dropped];
}

export function editDistanceLe1(a: string, b: string): boolean {
  if (a === b) return true;
  let la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    const diff: number[] = [];
    for (let i = 0; i < la; i++) if (a[i] !== b[i]) diff.push(i);
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  if (la > lb) { [a, b] = [b, a]; [la, lb] = [lb, la]; }
  let i = 0, j = 0, skipped = false;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; }
    else if (skipped) return false;
    else { skipped = true; j++; }
  }
  return true;
}

function containsSeq(tokens: string[], seq: string[]): boolean {
  for (let i = 0; i < tokens.length - seq.length + 1; i++) if (eq(tokens.slice(i, i + seq.length), seq)) return true;
  return false;
}

function fuzzyHit(tokens: string[], kw: string): string | null {
  if (kw.length < 5) return null;
  for (const t of tokens) if (t.length >= 5 && t[0] === kw[0] && t !== kw && editDistanceLe1(t, kw)) return t;
  return null;
}

// ------------------------------------------------------------------ helpers
const isoDays = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const days = (a: string, b: string) => isoDays(b) - isoDays(a);
const addDays = (s: string, n: number) => new Date((isoDays(s) + n) * 86400000).toISOString().slice(0, 10);
export const fmtDate = (s: string) => `${MONTHS[Number(s.slice(5, 7)) - 1]} ${Number(s.slice(8, 10))}`;
const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const money = (r: Reservation, n: number) => `${r.cur}${group(n)}`;
const roundHalfUp = (x: number) => Math.floor(x + 0.5);
const round2 = (x: number) => Math.floor(x * 100 + 0.5) / 100;
const plural = (n: number, w: string) => (n === 1 ? `${n} ${w}` : `${n} ${w}s`);
const TODAY = D.as_of;

// ------------------------------------------------------------------ policy
type Refund = { total: number; refund: number; days_out: number; nights: number; rule: string; detail?: string };
export function refundFor(r: Reservation): Refund {
  const nights = days(r.check_in!, r.check_out!);
  const total = nights * r.nightly! + r.cleaning!;
  const daysOut = days(TODAY, r.check_in!);
  const sinceBooking = days(r.booked!, TODAY);
  if (r.status === "in stay") {
    const remaining = days(TODAY, r.check_out!);
    const refundable = Math.max(0, remaining - 1);
    return { total, refund: roundHalfUp(refundable * r.nightly! * 0.5), days_out: daysOut, nights,
      rule: "Moderate, mid-stay: nights more than 24 hours away are refunded at 50%",
      detail: `${refundable} of your ${remaining} remaining nights qualify` };
  }
  if (r.policy === "Flexible") {
    if (daysOut >= 1) return { total, refund: total, days_out: daysOut, nights, rule: "Flexible: full refund up to 24 hours before check-in" };
    return { total, refund: total - r.nightly!, days_out: daysOut, nights, rule: "Flexible: inside 24 hours, the first night is non-refundable" };
  }
  if (r.policy === "Moderate") {
    if (daysOut >= 5) return { total, refund: total, days_out: daysOut, nights, rule: "Moderate: full refund up to 5 days before check-in" };
    return { total, refund: roundHalfUp(nights * r.nightly! * 0.5) + r.cleaning!, days_out: daysOut, nights,
      rule: "Moderate: inside 5 days, 50% of nights plus the cleaning fee are refunded" };
  }
  if (sinceBooking <= 2 && daysOut >= 14) return { total, refund: total, days_out: daysOut, nights, rule: "Strict: full refund within 48 hours of booking" };
  if (daysOut >= 7) return { total, refund: roundHalfUp(nights * r.nightly! * 0.5) + r.cleaning!, days_out: daysOut, nights, rule: "Strict: 50% of nights refunded 7 or more days out" };
  return { total, refund: r.cleaning!, days_out: daysOut, nights, rule: "Strict: inside 7 days, nights are non-refundable and the cleaning fee is refunded" };
}
const when = (d: number) => (d === 0 ? "today" : `in ${plural(d, "day")}`);

// ------------------------------------------------------------------ answers
type Body = { text: string; facts: string[]; signals: [string, string][] };
function render(id: string, r: Reservation): Body {
  switch (id) {
    case "HC-01": {
      const f = refundFor(r);
      const signals: [string, string][] = [["Policy", r.policy], ["Check-in", r.status === "in stay" ? "in stay" : when(f.days_out)], ["Paid", money(r, f.total)]];
      const text = r.status === "in stay"
        ? `You're mid-stay in ${r.city}, so the ${r.policy} policy's mid-stay rule applies: ${f.detail}. If you leave early today, you'd get back <mark>${money(r, f.refund)}</mark>. Cancel from Trips → ${r.id} → Change or cancel, and tell ${r.host} when you plan to check out.`
        : `Your ${r.listing} booking uses the <mark>${r.policy}</mark> policy and check-in is <mark>${when(f.days_out)}</mark>. If you cancel now you'd get back <mark>${money(r, f.refund)}</mark> of the ${money(r, f.total)} you paid. ${f.rule}. Cancel from Trips → ${r.id} → Change or cancel.`;
      return { text, facts: [money(r, f.refund)], signals };
    }
    case "HC-02":
      return { text: `Refunds go back to the original payment method. Hearth issues them the same day you cancel; banks usually post them in <mark>5–10 business days</mark>. If it's been longer, reply "talk to a person" and a specialist will trace it with the bank reference for ${r.id}.`,
        facts: ["5–10 business days"], signals: [["Payment method", "original card"]] };
    case "HC-03": {
      const dates = `${fmtDate(r.check_in!)}–${fmtDate(r.check_out!)}`;
      return { text: `You can request a change from Trips → ${r.id} → Change reservation, and ${r.host} has 24 hours to accept. Right now it's <mark>${dates}</mark> for ${plural(r.guests!, "guest")} at ${money(r, r.nightly!)}/night. Any price difference is charged or refunded when the host accepts.`,
        facts: [dates], signals: [["Dates", dates], ["Guests", String(r.guests)], ["Nightly", money(r, r.nightly!)]] };
    }
    case "HC-04":
      return { text: `Entry for this stay is a <mark>${r.entry}</mark>: ${r.entry_detail}. If that doesn't work, message ${r.host} from the reservation thread. If you still can't get in within 30 minutes, reply "rebook" and a specialist will find you a comparable place nearby at no extra cost.`,
        facts: [r.entry!], signals: [["Entry", r.entry!], ["Host", r.host!]] };
    case "HC-05": {
      const text = r.status === "in stay"
        ? `Sorry about that. Report it within <mark>72 hours</mark> of finding it: add photos in Trips → ${r.id} → Report an issue. ${r.host} gets a chance to fix it first; if it isn't fixed within 24 hours, we'll refund the affected nights or rebook you.`
        : `If something doesn't match the listing when you arrive, report it within <mark>72 hours</mark> with photos from Trips → ${r.id} → Report an issue. The host gets a chance to fix it first, then we refund or rebook.`;
      return { text, facts: ["72 hours"], signals: [["Stay status", r.status]] };
    }
    case "HC-06": {
      const n = r.next_stay!, last = r.last_stay!;
      const payout = addDays(n.check_in, 1);
      return { text: `Payouts release the day after check-in. Your stay with ${last.guest} (${money(r, last.earnings)}) was paid out on ${fmtDate(last.paid)}. The next one is <mark>${money(r, n.earnings)}</mark> for ${n.guest}'s stay, releasing <mark>${fmtDate(payout)}</mark>. Banks can take 1–3 business days after that.`,
        facts: [money(r, n.earnings), fmtDate(payout), money(r, last.earnings)],
        signals: [["Last payout", money(r, last.earnings)], ["Next stay", `${n.guest}, ${fmtDate(n.check_in)}`], ["Next payout", money(r, n.earnings)]] };
    }
    case "HC-07": {
      const last = r.last_stay!;
      const deadline = addDays(last.check_out, 14);
      return { text: `File a damage claim within 14 days of checkout. For ${last.guest}'s stay that's by <mark>${fmtDate(deadline)}</mark>. Upload photos and receipts in Hosting → Reservations → Request money. ${last.guest} gets 24 hours to respond before a specialist reviews it.`,
        facts: [fmtDate(deadline)], signals: [["Last checkout", fmtDate(last.check_out)], ["Claim deadline", fmtDate(deadline)]] };
    }
    case "HC-08": {
      const text = r.pets
        ? `This listing <mark>allows pets</mark>, with a ${money(r, r.pet_fee!)} pet fee added at checkout. Add your pet from Trips → ${r.id} → Change reservation. Assistance animals are always welcome and never charged.`
        : `This listing <mark>doesn't allow pets</mark>. Assistance animals are the exception: they're always welcome at no charge, and you don't need the host's approval. Let ${r.host} know so they can prepare.`;
      return { text, facts: [r.pets ? "allows pets" : "doesn't allow pets"], signals: [["Pets allowed", r.pets ? "yes" : "no"]] };
    }
    case "HC-09":
      return { text: `Check-in is from <mark>${r.check_in_time}</mark> and checkout is by <mark>${r.check_out_time}</mark>. Early check-in or late checkout is up to ${r.host}; ask in the reservation thread and they'll confirm there.`,
        facts: [r.check_in_time!, r.check_out_time!], signals: [["Check-in", r.check_in_time!], ["Checkout", r.check_out_time!]] };
    case "HC-10": {
      const path = r.role === "host" ? "Hosting → Earnings → Get statement" : `Trips → ${r.id} → Get receipt`;
      return { text: `Download it from <mark>${path}</mark>. For a business invoice with VAT details, add your company info under Account → Payments first, then regenerate it.`,
        facts: [path], signals: [["Reservation", r.id]] };
    }
    case "HC-11": {
      const n = r.next_stay!;
      const d = days(TODAY, n.check_in);
      return { text: `Cancelling ${n.guest}'s stay is <mark>${plural(d, "day")}</mark> before check-in, so a <mark>50% fee</mark> of the reservation (${money(r, roundHalfUp(n.earnings * 0.5))}) comes out of your next payout and the dates are blocked. If the reason is outside your control (a burst pipe, a local emergency), reply "talk to a person" before cancelling so a specialist can waive the fee.`,
        facts: [plural(d, "day"), "50% fee"], signals: [["Next stay", `${n.guest}, ${fmtDate(n.check_in)}`], ["Days out", String(d)]] };
    }
  }
  throw new Error(id);
}

// ------------------------------------------------------------------ retrieval
type Kw = { label: string; stems: string[]; weight: number };
function compile(terms: string[], phraseWeight = 2.0): Kw[] {
  const out: Kw[] = [];
  const seen = new Set<string>();
  for (const raw of terms) {
    let label = raw, weight: number | null = null;
    const k = raw.lastIndexOf(":");
    if (k >= 0) { label = raw.slice(0, k); weight = parseFloat(raw.slice(k + 1)); }
    const s = stems(label);
    const key = JSON.stringify(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, stems: s, weight: weight ?? (s.length > 1 ? phraseWeight : 1.0) });
  }
  return out;
}
const COMPILED = Object.fromEntries(D.articles.map((a) => [a.id, compile(a.kw)]));
const SAFETY = compile(D.safety_terms), SENSITIVE = compile(D.sensitive_terms), HUMAN = compile(D.human_terms);
const STATUS = compile(D.status_cues), HYPO = compile(D.hypothetical_cues);
const MONEY_STEMS = ["refund", "money", "cancel", "cancellation"];

type Hit = { label: string; weight: number; kind: string };
function matches(tokens: string[], compiled: Kw[], fuzzy = true): Hit[] {
  const hits: Hit[] = [];
  for (const k of compiled) {
    const s = k.stems;
    if (s.length > 1) {
      if (containsSeq(tokens, s)) hits.push({ label: k.label, weight: k.weight, kind: "phrase" });
    } else if (s.length && tokens.includes(s[0])) {
      hits.push({ label: k.label, weight: k.weight, kind: "word" });
    } else if (fuzzy && s.length) {
      const t = fuzzyHit(tokens, s[0]);
      if (t) hits.push({ label: `${k.label} (typo: ${t})`, weight: 0.75, kind: "typo" });
    }
  }
  return hits;
}

type Ranked = { id: string; title: string; score: number; hits: string[] };
function retrieve(question: string, r: Reservation) {
  const [tokens, dropped] = dropNegated(stems(question));
  const rules: string[] = [];
  if (dropped.length) rules.push(`Ignored negated words: ${dropped.join(" ")}`);
  const ranked: Ranked[] = D.articles.map((a) => {
    const hits = matches(tokens, COMPILED[a.id]);
    let score = hits.reduce((s, h) => s + h.weight, 0);
    if (a.audience !== "both" && a.audience !== r.role) score *= 0.25;
    return { id: a.id, title: a.title, score, hits: hits.map((h) => h.label) };
  });
  const status = matches(tokens, STATUS, false);
  const hypo = matches(tokens, HYPO, false);
  if (status.length && !hypo.length && MONEY_STEMS.some((m) => tokens.includes(m))) {
    for (const x of ranked) {
      if (x.id === "HC-02") x.score += 3;
      if (x.id === "HC-01") x.score *= 0.5;
    }
    rules.push("Refund-status rule: asks about a refund already in motion (" + status.map((h) => h.label).join(", ") + ")");
  }
  ranked.sort((a, b) => b.score - a.score);
  return { tokens, ranked, rules };
}

// ------------------------------------------------------------------ routing
const QUEUES: Record<string, string> = { safety: "Safety line · priority 1", trust: "Trust & disputes", specialist: "Support specialist" };
const FIRST_STEP: Record<string, string> = {
  safety: "Call now and confirm they're safe before anything else. Emergency services first if needed.",
  trust: "Read the full thread before replying. Don't commit to a refund amount in the first message.",
};
const audience = (id: string) => D.articles.find((a) => a.id === id)!.audience;

export function answer(question: string, reservationId: string, threshold = DEFAULT_THRESHOLD): Answer {
  const r = D.reservations[reservationId];
  const ret = retrieve(question, r);
  const ranked = ret.ranked;
  const all = stems(question);
  const safety = matches(all, SAFETY, true), sensitive = matches(all, SENSITIVE, false), human = matches(all, HUMAN, false);
  const top = ranked[0], second = ranked[1];
  const strength = Math.min(1.0, top.score / 3);
  const margin = top.score > 0 ? (top.score - second.score) / top.score : 0.0;
  const confidence = round2(0.5 * strength + 0.5 * margin);

  let decision: "answer" | "handoff" = "answer", queue: string | null = null, reason = "";
  if (safety.length) { decision = "handoff"; queue = "safety"; reason = "Safety signal: " + safety.map((h) => h.label).join(", "); }
  else if (sensitive.length) { decision = "handoff"; queue = "trust"; reason = "Sensitive topic: " + sensitive.map((h) => h.label).join(", "); }
  else if (human.length) {
    const labels = human.map((h) => h.label);
    decision = "handoff"; queue = "specialist";
    reason = labels.length === 1 && labels[0] === "rebook" ? "Asked to rebook" : "Asked for a person";
  }
  else if (top.score === 0) { decision = "handoff"; queue = "specialist"; reason = "No matching help article"; }
  else if (!["both", r.role].includes(audience(top.id))) {
    decision = "handoff"; queue = "specialist";
    reason = `Best match is a ${audience(top.id)}-only article, but this is a ${r.role} account`;
  }
  else if (confidence < threshold) { decision = "handoff"; queue = "specialist"; reason = `Confidence ${confidence.toFixed(2)} is below the ${threshold.toFixed(2)} threshold`; }

  const out: Answer = { reservation_id: reservationId, question, engine: ENGINE_VERSION, ranked: ranked.slice(0, 3), rules: ret.rules,
    confidence, threshold, decision, queue, reason } as Answer;
  if (decision === "answer") {
    const art = D.articles.find((a) => a.id === top.id)!;
    const body = render(art.id, r);
    const also = second.score >= 2 && second.score >= 0.6 * top.score ? { id: second.id, title: second.title } : null;
    Object.assign(out, { article: art.id, article_title: art.title, also, followups: art.followups, ...body });
  } else {
    out.handoff = handoff(question, r, top, confidence, reason, queue!);
    out.followups = [];
  }
  return out;
}

function handoff(question: string, r: Reservation, top: Ranked, confidence: number, reason: string, queue: string) {
  const who = r.role === "host" ? `Host ${r.name} · ${r.listing}, ${r.city}` : `Guest ${r.name} · ${r.listing}, ${r.city} · ${r.status}`;
  const topic = top.score > 0 ? `${top.id} ${top.title}` : "Unclear";
  let step: string;
  if (queue in FIRST_STEP) step = FIRST_STEP[queue];
  else if (reason === "Asked to rebook") step = "Search comparable listings within 2 km for the same dates and hold one before replying.";
  else if (top.score > 0) step = `Start from ${top.id}; the copilot's draft is attached for review.`;
  else step = "Ask one clarifying question; no help article matched.";
  const reply = queue === "safety"
    ? "If you're in immediate danger, call local emergency services now. I'm connecting you with Hearth's safety team. They'll reach you in this thread within minutes."
    : queue === "trust"
      ? "I'm passing this to our trust team, who handle disputes and fairness concerns. They'll reply here with your reservation details already in hand."
      : "I'm passing this to a support specialist with your reservation details, so you won't need to repeat yourself.";
  return { queue, queue_label: QUEUES[queue], reply,
    summary: [["Reservation", `${r.id} · ${who}`], ["Asked", `“${question}”`], ["Likely topic", topic], ["Why handed off", reason],
      ["Copilot confidence", confidence.toFixed(2)], ["Suggested first step", step]] as [string, string][] };
}

// ------------------------------------------------------------------ evals
export function scoreCase(c: Case, threshold: number): ScoredCase {
  const a = answer(c.question, c.reservation_id, threshold);
  const got = a.decision === "answer" ? a.article! : "HANDOFF";
  let factsOk: boolean | null = null;
  if (a.decision === "answer" && c.facts !== undefined && c.facts !== null) factsOk = c.facts.every((f) => a.text!.includes(f));
  let verdict: ScoredCase["verdict"];
  if (c.expect === "HANDOFF") {
    if (got !== "HANDOFF") verdict = c.queue === "safety" ? "missed_safety" : "wrong";
    else if (a.queue !== c.queue) verdict = c.queue === "safety" ? "missed_safety" : "wrong_queue";
    else verdict = "pass";
  } else if (got === "HANDOFF") verdict = "handoff";
  else verdict = got === c.expect && factsOk !== false ? "pass" : "wrong";
  return { ...c, got, got_queue: a.queue, confidence: a.confidence, reason: a.reason, facts_ok: factsOk, verdict };
}

export function summarize(rows: ScoredCase[]): EvalSummary {
  const n = rows.length;
  const answered = rows.filter((r) => r.got !== "HANDOFF");
  const correct = answered.filter((r) => r.got === r.expect);
  const withFacts = correct.filter((r) => r.facts && r.facts.length);
  const safety = rows.filter((r) => r.queue === "safety");
  return {
    n, answerable: rows.filter((r) => r.expect !== "HANDOFF").length,
    self_solve: n ? correct.length / n : 0.0,
    citation_accuracy: answered.length ? correct.length / answered.length : 1.0,
    personalization: withFacts.length ? withFacts.filter((r) => r.facts_ok).length / withFacts.length : 1.0,
    safety_recall: safety.length ? safety.filter((r) => r.verdict === "pass").length / safety.length : 1.0,
    wrong_answers: answered.length - correct.length, handoffs: n - answered.length,
    unneeded_handoffs: rows.filter((r) => r.verdict === "handoff").length,
    wrong_queue: rows.filter((r) => r.verdict === "wrong_queue").length,
  };
}

export function runEval(threshold = DEFAULT_THRESHOLD, split = "all"): EvalResult {
  const rows = D.cases.filter((c) => split === "all" || c.split === split).map((c) => scoreCase(c, threshold));
  const by_split: Record<string, EvalSummary> = {};
  for (const s of ["dev", "holdout"]) if (split === "all" || split === s) by_split[s] = summarize(rows.filter((r) => r.split === s));
  return { threshold, split, summary: summarize(rows), by_split, rows };
}

export function sweep(split = "all"): SweepPoint[] {
  const out: SweepPoint[] = [];
  for (let i = 0; i < 13; i++) {
    const t = Math.round((0.2 + 0.05 * i) * 100) / 100;
    const s = runEval(t, split).summary;
    out.push({ threshold: t, self_solve: s.self_solve, citation_accuracy: s.citation_accuracy, wrong_answers: s.wrong_answers, handoffs: s.handoffs });
  }
  return out;
}

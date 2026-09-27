// TypeScript port of backend/hearth/conversation.py. Parity is checked in parity.test.ts.
import DATA from "../demo/data.json";
import type { ActionOffer, ConvState, Reservation, TurnInput, TurnResult } from "../types";
import { answer, DEFAULT_THRESHOLD, fmtDate, money, QUEUE_LABELS, refundFor, render, roundHalfUp, SAFETY_FIRST_STEP } from "./engine";

const D = DATA as unknown as { reservations: Record<string, Reservation>; articles: { id: string; title: string; audience: string; followups: string[] }[] };

export const DEFAULT_MAX_CLARIFY = 2;
export const SAFETY_OPTION = "SAFETY", OTHER_OPTION = "OTHER", HUMAN_OPTION = "HUMAN";

const PRIORS: Record<string, string[]> = {
  upcoming: ["HC-01", "HC-03", "HC-04", "HC-09", "HC-08", "HC-02"],
  "arriving today": ["HC-04", "HC-09", "HC-01", "HC-05", "HC-03", "HC-02"],
  "in stay": ["HC-05", "HC-04", "HC-09", "HC-01", "HC-03", "HC-02"],
  cancelled: ["HC-02", "HC-10", "HC-03", "HC-01"],
  host: ["HC-06", "HC-07", "HC-11", "HC-10"],
};
export const OPTION_LABELS: Record<string, string> = {
  "HC-01": "Cancelling or leaving early", "HC-02": "A refund I'm waiting on", "HC-03": "Changing dates or guests",
  "HC-04": "Getting in", "HC-05": "Something wrong with the place", "HC-06": "When I get paid",
  "HC-07": "Damage after a stay", "HC-08": "Pets or assistance animals", "HC-09": "Check-in or checkout times",
  "HC-10": "A receipt or statement", "HC-11": "Cancelling a guest's stay",
};
const ESCAPES = [{ id: SAFETY_OPTION, label: "I don't feel safe" }, { id: HUMAN_OPTION, label: "Talk to a person" }];

export const newState = (): ConvState => ({ clarify_turns: 0, context: "", pending_action: null, overrides: {}, log: [] });
export const reservationWith = (rid: string, s: ConvState): Reservation => ({ ...D.reservations[rid], ...s.overrides }) as Reservation;
const copy = (s: ConvState | null): ConvState => {
  const x = s ?? newState();
  return { clarify_turns: x.clarify_turns ?? 0, context: x.context ?? "", pending_action: x.pending_action ?? null,
    overrides: { ...(x.overrides ?? {}) }, log: [...(x.log ?? [])] };
};

export function actionsFor(id: string, r: Reservation): ActionOffer[] {
  const guest = r.role === "guest";
  const live = r.status !== "cancelled";
  if (id === "HC-01" && guest && live) {
    const f = refundFor(r);
    return [{ id: "cancel_reservation", label: r.status === "in stay" ? `Check out early and refund ${money(r, f.refund)}` : `Cancel and refund ${money(r, f.refund)}`, confirm: true }];
  }
  if (id === "HC-03" && guest && live) return [{ id: "message_host_change", label: `Ask ${r.host} about a change`, confirm: true }];
  if (id === "HC-04" && guest && live) return [{ id: "resend_entry", label: "Resend my entry instructions", confirm: false }];
  if (id === "HC-05" && guest && live) return [{ id: "report_issue", label: `Report it to ${r.host}`, confirm: true }];
  if (id === "HC-07" && !guest) return [{ id: "start_claim", label: `Start a damage claim for ${r.last_stay!.guest}'s stay`, confirm: true }];
  if (id === "HC-08" && guest && live) {
    if (r.pets) return [{ id: "add_pet", label: `Add a pet (${money(r, r.pet_fee!)})`, confirm: true }];
    return [{ id: "notify_assistance_animal", label: `Tell ${r.host} about an assistance animal`, confirm: true }];
  }
  if (id === "HC-09" && guest && live) return [{ id: "message_host_times", label: `Ask ${r.host} about early check-in or late checkout`, confirm: true }];
  if (id === "HC-10") return [{ id: "send_receipt", label: !guest ? "Email me the statement" : "Email me the receipt", confirm: false }];
  if (id === "HC-11" && !guest && !r.next_cancelled) {
    const n = r.next_stay!;
    return [{ id: "host_cancel", label: `Cancel ${n.guest}'s stay (fee ${money(r, roundHalfUp(n.earnings * 0.5))})`, confirm: true }];
  }
  return [];
}

const code = (prefix: string, rid: string) => `${prefix}-${rid.slice(-4)}`;
const LQ = "“", RQ = "”";

function preview(action: string, r: Reservation) {
  if (action === "cancel_reservation") {
    const f = refundFor(r);
    return { title: "Cancel this reservation?", confirm_label: `Yes, cancel and refund ${money(r, f.refund)}`,
      points: [`${r.listing}, ${fmtDate(r.check_in!)}–${fmtDate(r.check_out!)}`, `Refund: ${money(r, f.refund)} of ${money(r, f.total)} to your original card`,
        "This can't be undone. The dates go back on the calendar."] };
  }
  if (action === "message_host_change")
    return { title: `Send this to ${r.host}?`, confirm_label: "Send message",
      points: [`${LQ}Hi ${r.host}, would it be possible to change our reservation (${fmtDate(r.check_in!)}–${fmtDate(r.check_out!)})? Happy to work around what suits you. Thanks, ${r.name}${RQ}`,
        `${r.host} has 24 hours to reply. Nothing changes until you both accept.`] };
  if (action === "report_issue")
    return { title: `Report an issue to ${r.host}?`, confirm_label: "Report it",
      points: [`${r.host} is notified now and has 24 hours to fix it.`, "If it isn't fixed, you can choose a refund for the affected nights or a rebooking.", "Add photos in the report link I'll send."] };
  if (action === "start_claim") {
    const last = r.last_stay!;
    return { title: `Start a damage claim for ${last.guest}'s stay?`, confirm_label: "Start claim",
      points: [`${last.guest} is asked to respond within 24 hours.`, "Upload photos and receipts to the draft; a specialist reviews it if you can't agree."] };
  }
  if (action === "add_pet")
    return { title: "Add a pet to this reservation?", confirm_label: `Add pet for ${money(r, r.pet_fee!)}`,
      points: [`A ${money(r, r.pet_fee!)} pet fee is charged to your card now.`, `${r.host} is notified.`] };
  if (action === "notify_assistance_animal")
    return { title: `Let ${r.host} know?`, confirm_label: "Send message",
      points: [`${LQ}Hi ${r.host}, I'll be traveling with an assistance animal. Letting you know ahead of time. Thanks, ${r.name}${RQ}`, "No fee, and no approval needed."] };
  if (action === "message_host_times")
    return { title: `Send this to ${r.host}?`, confirm_label: "Send message",
      points: [`${LQ}Hi ${r.host}, is there any flexibility on check-in (${r.check_in_time}) or checkout (${r.check_out_time})? Thanks, ${r.name}${RQ}`] };
  if (action === "host_cancel") {
    const n = r.next_stay!;
    return { title: `Cancel ${n.guest}'s stay?`, confirm_label: "Yes, cancel the stay",
      points: [`${n.guest} gets a full refund and help rebooking.`, `A ${money(r, roundHalfUp(n.earnings * 0.5))} fee comes out of your next payout.`,
        "If the reason is outside your control, talk to a person first so the fee can be waived."] };
  }
  return { title: "Go ahead?", confirm_label: "Confirm", points: [] as string[] };
}

function execute(action: string, rid: string, state: ConvState) {
  const r = reservationWith(rid, state);
  let c: string, text: string;
  if (action === "cancel_reservation") {
    const f = refundFor(r);
    c = code("CX", rid);
    Object.assign(state.overrides, { status: "cancelled", refunded: f.refund, cancel_code: c });
    text = `Done. Your reservation is cancelled and <mark>${money(r, f.refund)}</mark> is on its way back to your card. Confirmation <mark>${c}</mark>. Banks usually post it in 5–10 business days.`;
  } else if (action === "message_host_change") {
    c = code("MSG", rid); text = `Sent. ${r.host} has 24 hours to reply, and you'll get a notification when they do.`;
  } else if (action === "resend_entry") {
    c = code("ENT", rid);
    text = `Sent your entry instructions again by text and email: ${r.entry_detail}. I've also let ${r.host} know you're arriving. If you still can't get in within 30 minutes, reply "rebook".`;
  } else if (action === "report_issue") {
    c = code("ISS", rid);
    text = `Reported. ${r.host} has been notified and has until this time tomorrow to fix it. Your report number is <mark>${c}</mark>; I'll check back with you then.`;
  } else if (action === "start_claim") {
    c = code("CLM", rid);
    text = `Claim <mark>${c}</mark> is open. I've sent you the upload link for photos and receipts, and ${r.last_stay!.guest} has 24 hours to respond.`;
  } else if (action === "add_pet") {
    c = code("PET", rid); text = `Added. The ${money(r, r.pet_fee!)} pet fee is charged and ${r.host} knows to expect your pet.`;
  } else if (action === "notify_assistance_animal") {
    c = code("MSG", rid); text = `Sent. ${r.host} knows you're bringing an assistance animal.`;
  } else if (action === "message_host_times") {
    c = code("MSG", rid); text = `Sent. ${r.host} will reply in the reservation thread.`;
  } else if (action === "send_receipt") {
    c = code("RCP", rid); text = "Sent to the email on your account. It can take a few minutes to arrive.";
  } else if (action === "host_cancel") {
    const n = r.next_stay!;
    c = code("HCX", rid);
    state.overrides.next_cancelled = true;
    text = `Cancelled. ${n.guest} has been refunded and offered help rebooking. The ${money(r, roundHalfUp(n.earnings * 0.5))} fee will come out of your next payout. Confirmation <mark>${c}</mark>.`;
  } else throw new Error(action);
  const entry = { action, code: c, reservation_id: rid, summary: text.replace(/<mark>/g, "").replace(/<\/mark>/g, "") };
  state.log.push(entry);
  return { text, entry };
}

function options(r: Reservation, ranked: { id: string; score: number }[]) {
  const ids: string[] = [];
  for (const x of ranked) {
    const aud = D.articles.find((a) => a.id === x.id)!.audience;
    if (x.score > 0 && (aud === "both" || aud === r.role) && !ids.includes(x.id)) ids.push(x.id);
    if (ids.length === 2) break;
  }
  const prior = r.role === "host" ? PRIORS.host : PRIORS[r.status] ?? PRIORS.upcoming;
  for (const p of prior) {
    if (ids.length >= 4) break;
    if (!ids.includes(p)) ids.push(p);
  }
  return [...ids.map((id) => ({ id, label: OPTION_LABELS[id] })), { id: OTHER_OPTION, label: "Something else" }, ...ESCAPES];
}

function handoffAfter(rid: string, r: Reservation, state: ConvState, reason: string, last: { ranked: { id: string; title: string; score: number }[] } | null) {
  const who = r.role === "host" ? `Host ${r.name}` : `Guest ${r.name} · ${r.status}`;
  const likely = last && last.ranked[0].score > 0 ? `${last.ranked[0].id} ${last.ranked[0].title}` : "Unclear";
  const h = { queue: "specialist", queue_label: QUEUE_LABELS.specialist,
    reply: "I haven't been able to pin this down, so I'm bringing in a support specialist. They'll see everything we've covered, so you won't need to repeat yourself.",
    summary: [["Reservation", `${rid} · ${who} · ${r.listing}, ${r.city}`], ["Conversation", `${LQ}${state.context.trim()}${RQ}`], ["Likely topic", likely],
      ["Why handed off", reason], ["Clarifying questions asked", String(state.clarify_turns)],
      ["Suggested first step", "Read the conversation, then ask one specific question about what they need."]] as [string, string][] };
  return { kind: "handoff", decision: "handoff", queue: "specialist", reason, handoff: h, text: null } as Partial<TurnResult>;
}

function safetyHandoff(rid: string, r: Reservation, state: ConvState) {
  const h = { queue: "safety", queue_label: QUEUE_LABELS.safety,
    reply: "If you're in immediate danger, call local emergency services now. I'm connecting you with Hearth's safety team. They'll reach you in this thread within minutes.",
    summary: [["Reservation", `${rid} · ${r.name} · ${r.listing}, ${r.city}`], ["Conversation", `${LQ}${state.context.trim()}${RQ}`],
      ["Why handed off", `Chose ${LQ}I don't feel safe${RQ} from a clarifying menu`], ["Suggested first step", SAFETY_FIRST_STEP]] as [string, string][] };
  return { kind: "handoff", decision: "handoff", queue: "safety", reason: `Chose ${LQ}I don't feel safe${RQ}`, handoff: h, text: null } as Partial<TurnResult>;
}

const YES = new Set(["yes", "y", "yeah", "yep", "confirm", "do it", "go ahead", "ok", "okay", "sure", "please do"]);
const NO = new Set(["no", "n", "nope", "cancel that", "don't", "dont", "never mind", "nevermind", "stop", "keep it"]);

const allActions = (r: Reservation) => D.articles.flatMap((a) => actionsFor(a.id, r));

export function turn(rid: string, inp: TurnInput, stateIn: ConvState | null = null, threshold = DEFAULT_THRESHOLD, maxClarify = DEFAULT_MAX_CLARIFY): TurnResult {
  const state = copy(stateIn);
  const r = reservationWith(rid, state);
  let kind = inp.type;

  if (kind === "message" && state.pending_action) {
    const said = (inp.text ?? "").trim().toLowerCase().replace(/[.!]+$/, "");
    if (YES.has(said)) { inp = { type: "action", action: state.pending_action, confirm: true }; kind = "action"; }
    else if (NO.has(said)) { inp = { type: "action", action: state.pending_action, confirm: false }; kind = "action"; }
    else state.pending_action = null;
  }

  if (kind === "action") {
    const action = inp.action!;
    const allowed = Object.fromEntries(allActions(r).map((a) => [a.id, a]));
    if (!(action in allowed)) return { kind: "notice", text: "That option isn't available for this reservation anymore.", state } as TurnResult;
    if (allowed[action].confirm && (inp.confirm === undefined || inp.confirm === null)) {
      state.pending_action = action;
      return { kind: "confirm", action, ...preview(action, r), state } as TurnResult;
    }
    state.pending_action = null;
    if (inp.confirm === false) return { kind: "notice", text: "Okay, I haven't changed anything.", state } as TurnResult;
    const { text, entry } = execute(action, rid, state);
    return { kind: "done", text, entry, state, followups: action !== "resend_entry" ? ["Anything else?"] : ["Still can't get in", "Talk to a person"] } as TurnResult;
  }

  if (kind === "choose") {
    const opt = inp.option!;
    if (opt === SAFETY_OPTION) {
      state.context = (state.context + " [chose: I don't feel safe]").trim();
      const out = safetyHandoff(rid, r, state);
      state.clarify_turns = 0; state.context = "";
      return { ...out, state } as TurnResult;
    }
    if (opt === HUMAN_OPTION) {
      state.context = (state.context + " [chose: talk to a person]").trim();
      const out = handoffAfter(rid, r, state, "Asked for a person", null);
      state.clarify_turns = 0; state.context = "";
      return { ...out, state } as TurnResult;
    }
    if (opt === OTHER_OPTION) {
      if (state.clarify_turns >= maxClarify) {
        const out = handoffAfter(rid, r, state, `Still unclear after ${state.clarify_turns} clarifying questions`, null);
        state.clarify_turns = 0; state.context = "";
        return { ...out, state } as TurnResult;
      }
      state.clarify_turns += 1;
      return { kind: "clarify", text: "Tell me a little more in your own words: what are you trying to do, or what's gone wrong?",
        options: ESCAPES, open: true, turn: state.clarify_turns, max: maxClarify, state } as TurnResult;
    }
    const art = D.articles.find((a) => a.id === opt)!;
    const body = render(art.id, r);
    state.clarify_turns = 0; state.context = "";
    return { kind: "answer", decision: "answer", article: art.id, article_title: art.title, chosen: true, followups: art.followups,
      actions: actionsFor(art.id, r), ...body, state } as TurnResult;
  }

  const text = (inp.text ?? "").trim();
  const combined = state.clarify_turns ? (state.context + " " + text).trim() : text;
  const a = answer(combined, rid, threshold, r);
  if (a.decision === "answer") {
    state.clarify_turns = 0; state.context = "";
    return { kind: "answer", ...a, actions: actionsFor(a.article!, r), state } as TurnResult;
  }
  if (a.handoff_kind !== "unclear" || maxClarify === 0) {
    state.clarify_turns = 0; state.context = "";
    return { kind: "handoff", ...a, state } as TurnResult;
  }
  state.context = combined;
  if (state.clarify_turns >= maxClarify) {
    const out = handoffAfter(rid, r, state, `Still unclear after ${state.clarify_turns} clarifying questions`, a);
    Object.assign(out, { ranked: a.ranked, confidence: a.confidence, rules: a.rules });
    state.clarify_turns = 0; state.context = "";
    return { ...out, state } as TurnResult;
  }
  state.clarify_turns += 1;
  const first = state.clarify_turns === 1;
  return { kind: "clarify", decision: "clarify",
    text: first ? "I want to get this right before I answer. Which of these is closest?" : "Thanks. I'm still not sure I've got it. Is it one of these?",
    options: options(r, a.ranked), open: false, turn: state.clarify_turns, max: maxClarify,
    ranked: a.ranked, confidence: a.confidence, rules: a.rules, reason: a.reason, state } as TurnResult;
}

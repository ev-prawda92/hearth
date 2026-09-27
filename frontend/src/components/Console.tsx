import { useEffect, useMemo, useRef, useState } from "react";
import type { Api } from "../api";
import { fmtDate } from "../engine/engine";
import type { ConvState, Reservation, TurnInput, TurnResult } from "../types";
import { DecisionBadge, QueueBadge, RichText } from "./bits";
import { Check, Chevron, Flame, Send, Shield, Thumb } from "./icons";
import { ListingArt } from "./ListingArt";

type Msg = { id: number; kind: "me"; text: string } | { id: number; kind: "bot"; r: TurnResult; helpful?: boolean };

const SUGGEST: Record<string, string[]> = {
  "HT-1042": ["How much would I get back if I cancel?", "The lockbox code isn't working", "hmm, quick question", "I smell gas in the kitchen"],
  "HT-2218": ["Can I get a refund if I cancel?", "Can I bring my dog?", "Can we change our dates?", "Is there good hiking nearby?"],
  "HT-3307": ["If we leave tomorrow do we get anything back?", "There's no hot water and the wifi is down", "it's really loud at night", "Could we get a late checkout?"],
  "HT-5120": ["What happens if we cancel?", "the keypad isn't accepting my code", "Are dogs allowed?", "Can I talk to a real person?"],
  "HT-6031": ["The gate won't unlock", "My flight got cancelled, can I get a refund?", "What's the latest we can check out?", "There's smoke coming from the kitchen"],
  "HT-4410": ["When do I get paid for my next booking?", "The guests cracked the glass table", "I have to cancel my next guest, what happens?", "I need a statement for taxes"],
};

export function tripDates(r: Reservation) {
  if (r.role === "host") return r.next_cancelled ? "Hosting · next stay cancelled" : `Hosting · next guest ${fmtDate(r.next_stay!.check_in)}`;
  return `${fmtDate(r.check_in!)} – ${fmtDate(r.check_out!)}`;
}

type Props = {
  api: Api; reservations: Reservation[]; current: string; setCurrent: (id: string) => void;
  threshold: number; setThreshold: (t: number) => void; maxClarify: number; setMaxClarify: (n: number) => void;
  pending: { rid: string; q: string } | null; clearPending: () => void; onActivity: () => void;
};

export function Console(p: Props) {
  const { api, reservations, current, setCurrent, threshold, maxClarify, pending, clearPending, onActivity } = p;
  const [threads, setThreads] = useState<Record<string, Msg[]>>({});
  const [states, setStates] = useState<Record<string, ConvState | null>>({});
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastAsked = useRef("");
  const threadRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);

  const withOverrides = (r: Reservation) => ({ ...r, ...(states[r.id]?.overrides ?? {}) }) as Reservation;
  const res = withOverrides(reservations.find((r) => r.id === current)!);
  const thread = threads[current] ?? [];
  const state = states[current] ?? null;

  const inspected = useMemo(() => {
    const bots = thread.filter((m): m is Extract<Msg, { kind: "bot" }> => m.kind === "bot" && !!m.r.ranked);
    return bots.find((m) => m.id === selected) ?? bots[bots.length - 1] ?? null;
  }, [thread, selected]);

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }); }, [thread.length, busy]);

  async function send(input: TurnInput, shown: string | null, rid = current) {
    if (busy) return;
    setError(null);
    if (shown) setThreads((t) => ({ ...t, [rid]: [...(t[rid] ?? []), { id: idRef.current++, kind: "me", text: shown }] }));
    setBusy(true);
    try {
      const [r] = (await Promise.all([api.turn(rid, input, states[rid] ?? null, threshold, maxClarify), new Promise((ok) => setTimeout(ok, 380))])) as [TurnResult, unknown];
      const bot: Msg = { id: idRef.current++, kind: "bot", r };
      setThreads((t) => ({ ...t, [rid]: [...(t[rid] ?? []), bot] }));
      setStates((s) => ({ ...s, [rid]: r.state }));
      if (r.ranked) setSelected(bot.id);
      if (r.kind === "handoff" || r.kind === "done") onActivity();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const ask = (q: string, rid = current) => { const text = q.trim(); if (!text) return; lastAsked.current = text; send({ type: "message", text }, text, rid); };
  const choose = (id: string, label: string) => send({ type: "choose", option: id }, label);
  const act = (action: string, label: string, confirm?: boolean) => send({ type: "action", action, confirm }, label);

  useEffect(() => {
    if (pending) { setCurrent(pending.rid); ask(pending.q, pending.rid); clearPending(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  function rate(id: number, helpful: boolean) {
    const m = thread.find((x) => x.id === id);
    if (!m || m.kind !== "bot") return;
    setThreads((t) => ({ ...t, [current]: t[current].map((x) => (x.id === id && x.kind === "bot" ? { ...x, helpful } : x)) }));
    api.feedback(current, m.r.question ?? "", m.r.article, helpful).catch(() => undefined);
  }

  const last = thread[thread.length - 1];
  const lastBot = last && last.kind === "bot" ? last : null;

  return (
    <div className="console">
      <nav className="trips" aria-label="Reservations">
        <h2>Trips and hosting</h2>
        {reservations.map(withOverrides).map((r) => (
          <button key={r.id} className="trip" aria-pressed={r.id === current} onClick={() => { setCurrent(r.id); setSelected(null); }}>
            <span className="thumb"><ListingArt scene={r.art.scene} hue={r.art.hue} label={r.listing} /></span>
            <span className="trip-body">
              <span className="trip-city">{r.city}</span>
              <span className="trip-sub">{r.listing}</span>
              <span className="trip-sub">{tripDates(r)}</span>
              <span className="trip-tags">
                <span className={`tag ${r.status === "in stay" || r.status === "arriving today" ? "live" : r.status === "cancelled" ? "off" : ""}`}>{r.role === "host" ? "Host" : r.status}</span>
                {r.role === "guest" && <span className="tag">{r.policy}</span>}
              </span>
            </span>
          </button>
        ))}
      </nav>

      <section className="chat" aria-label="Conversation">
        <header className="chat-head">
          <span className="thumb"><ListingArt scene={res.art.scene} hue={res.art.hue} /></span>
          <div>
            <h3>{res.role === "host" ? `${res.name}, hosting in ${res.city}` : `${res.name} · ${res.listing}`}</h3>
            <div className="muted" style={{ fontSize: 13 }}>
              <span className="mono">{res.id}</span> · {res.role === "host" ? res.listing : `${tripDates(res)} · ${res.status === "cancelled" ? "cancelled" : `${res.policy} policy`}`}
            </div>
          </div>
          <span className="spacer" />
          {thread.length > 0 && <button className="btn-ghost" onClick={() => { setThreads((t) => ({ ...t, [current]: [] })); setStates((s) => ({ ...s, [current]: s[current] ? { ...s[current]!, clarify_turns: 0, context: "", pending_action: null } : null })); }}>New chat</button>}
        </header>

        <div className="thread" ref={threadRef} aria-live="polite">
          {thread.length === 0 && !busy && (
            <div className="welcome">
              <h3>Hi {res.name}, how can we help?</h3>
              <p className="muted">I can see reservation {res.id}, so I can answer with your policy, dates and entry details, and take care of things like cancelling, reporting a problem or messaging your host. Try one of these:</p>
              <div className="suggests">{(SUGGEST[current] ?? []).map((s) => <button key={s} className="pill-btn" onClick={() => ask(s)}>{s}</button>)}</div>
            </div>
          )}
          {thread.map((m) => m.kind === "me" ? (
            <div key={m.id} className="row me"><div className="bubble">{m.text}</div></div>
          ) : (
            <BotTurn key={m.id} m={m} isLast={m === lastBot && !busy} inspected={inspected?.id === m.id}
              onInspect={() => m.r.ranked && setSelected(m.id)} onRate={(h) => rate(m.id, h)}
              ask={ask} choose={choose} act={act} />
          ))}
          {busy && <div className="row bot"><span className="avatar"><Flame /></span><div className="bubble typing" aria-label="Copilot is typing"><i /><i /><i /></div></div>}
          {error && <p className="badge crit" role="alert">{error}</p>}
        </div>

        <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(draft); setDraft(""); }}>
          {state && state.clarify_turns > 0 && <p className="clarify-note">Clarifying {state.clarify_turns} of {maxClarify}. Reply in your own words or pick an option above.</p>}
          {state?.pending_action && <p className="clarify-note">Waiting for your go-ahead. Type "yes" to confirm or "no" to leave it.</p>}
          <div className="composer-box">
            <label htmlFor="ask" className="sr-only">Message</label>
            <textarea id="ask" rows={1} value={draft} placeholder={`Message about ${res.id}…`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(draft); setDraft(""); }
                if (e.key === "ArrowUp" && !draft && lastAsked.current) { e.preventDefault(); setDraft(lastAsked.current); }
              }} />
            <button className="send" type="submit" disabled={!draft.trim() || busy} aria-label="Send"><Send /></button>
          </div>
          <p className="hint">Enter to send · Shift+Enter for a new line · ↑ to edit your last question</p>
        </form>
      </section>

      <WhyPanel r={inspected?.r ?? null} res={res} {...p} />
    </div>
  );
}

type BotProps = {
  m: Extract<Msg, { kind: "bot" }>; isLast: boolean; inspected: boolean; onInspect: () => void; onRate: (h: boolean) => void;
  ask: (q: string) => void; choose: (id: string, label: string) => void; act: (a: string, label: string, confirm?: boolean) => void;
};

function BotTurn({ m, isLast, inspected, onInspect, onRate, ask, choose, act }: BotProps) {
  const r = m.r;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="row bot">
        <span className="avatar"><Flame /></span>
        <div className={`bubble ${inspected ? "inspected" : ""}`} onClick={onInspect} style={{ cursor: r.ranked ? "pointer" : undefined }}>
          {r.kind === "answer" && (
            <>
              <RichText html={r.text!} />
              <div className="bubble-meta">
                <span className="source">Source <b>{r.article}</b> {r.article_title}{r.chosen && " · you picked this topic"}</span>
                <span className="feedback">
                  <button className="icon-btn" aria-label="Helpful" aria-pressed={m.helpful === true} onClick={(e) => { e.stopPropagation(); onRate(true); }}><Thumb /></button>
                  <button className="icon-btn" aria-label="Not helpful" aria-pressed={m.helpful === false} onClick={(e) => { e.stopPropagation(); onRate(false); }}><Thumb down /></button>
                </span>
              </div>
            </>
          )}
          {r.kind === "clarify" && (
            <>
              <span>{r.text}</span>
              <div className="clarify-meta">Question {r.turn} of {r.max} before I bring in a person</div>
            </>
          )}
          {r.kind === "confirm" && (
            <div className="confirm-card">
              <strong>{r.title}</strong>
              <ul>{r.points!.map((pt) => <li key={pt}>{pt}</li>)}</ul>
              {isLast && (
                <div className="confirm-actions">
                  <button className="btn-primary sm" onClick={(e) => { e.stopPropagation(); act(r.action!, r.confirm_label!, true); }}>{r.confirm_label}</button>
                  <button className="btn-ghost" onClick={(e) => { e.stopPropagation(); act(r.action!, "Not now", false); }}>Not now</button>
                </div>
              )}
            </div>
          )}
          {r.kind === "done" && (
            <div className="done-card"><span className="done-icon"><Check /></span><div><RichText html={r.text!} /><div className="mono muted" style={{ marginTop: 6 }}>{r.entry?.code}</div></div></div>
          )}
          {r.kind === "notice" && <span>{r.text}</span>}
          {r.kind === "handoff" && (
            <>
              {r.handoff!.reply}
              <div className={`handoff-card ${r.queue === "safety" ? "safety" : ""}`}>
                <div className="handoff-head">
                  {r.queue === "safety" && <Shield />}
                  <QueueBadge queue={r.queue!} label={r.handoff!.queue_label} />
                  {r.ticket_id && <span className="mono muted">{r.ticket_id}</span>}
                </div>
                <details>
                  <summary>What the specialist sees <Chevron /></summary>
                  <dl className="kv">{r.handoff!.summary.map(([k, v]) => <KV key={k} k={k} v={v} />)}</dl>
                </details>
              </div>
            </>
          )}
        </div>
      </div>
      {isLast && r.kind === "clarify" && (
        <div className="followups">
          {r.options!.map((o) => (
            <button key={o.id} className={`pill-btn ${o.id === "SAFETY" ? "danger" : o.id === "HUMAN" || o.id === "OTHER" ? "quiet" : ""}`}
              onClick={() => choose(o.id, o.label)}>{o.label}</button>
          ))}
        </div>
      )}
      {isLast && r.kind === "answer" && ((r.actions?.length ?? 0) > 0 || r.also || (r.followups?.length ?? 0) > 0) && (
        <div className="followups">
          {r.actions!.map((a) => <button key={a.id} className="pill-btn action" onClick={() => act(a.id, a.label)}>{a.label}</button>)}
          {r.also && <button className="pill-btn also" onClick={() => ask(ALSO[r.also!.id] ?? r.also!.title)}>Also: {r.also.title}</button>}
          {r.followups!.filter((f) => !(r.actions?.length && f === "Talk to a person")).map((f) => <button key={f} className="pill-btn" onClick={() => ask(f)}>{f}</button>)}
        </div>
      )}
      {isLast && r.kind === "done" && r.followups!.some((f) => f !== "Anything else?") && (
        <div className="followups">{r.followups!.filter((f) => f !== "Anything else?").map((f) => <button key={f} className="pill-btn" onClick={() => ask(f)}>{f}</button>)}</div>
      )}
    </div>
  );
}

const ALSO: Record<string, string> = {
  "HC-01": "How much would I get back if I cancel?", "HC-02": "When would the refund arrive?", "HC-03": "Can I change my dates?",
  "HC-04": "How do I get inside?", "HC-05": "Something isn't as described", "HC-08": "Can I bring a pet?", "HC-09": "What time is check-in?",
};

function KV({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}

function WhyPanel({ r, res, threshold, setThreshold, maxClarify, setMaxClarify }: { r: TurnResult | null; res: Reservation } & Props) {
  const max = r?.ranked ? Math.max(1, r.ranked[0].score) : 1;
  return (
    <aside className="why" aria-label="Why this answer">
      <div className="why-head">
        <h3>Why this answer</h3>
        {r && (r.kind === "clarify" ? <span className="badge neutral">Clarifying</span> : r.decision && <DecisionBadge a={{ decision: r.decision as "answer" | "handoff", queue: r.queue ?? null }} />)}
      </div>
      {!r || !r.ranked ? (
        <p className="empty-why">Ask something and I'll show which help articles matched, how confident the copilot was, and which details from {res.id} it used.</p>
      ) : (
        <>
          <div>
            <div className="section-label">Confidence</div>
            <div className="gauge" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={r.confidence}>
              <div className="fill" style={{ width: `${(r.confidence ?? 0) * 100}%` }} />
              <div className="mark" style={{ left: `calc(${threshold * 100}% - 1px)` }} />
            </div>
            <div className="gauge-row"><span>{(r.confidence ?? 0).toFixed(2)}</span><span>clarify below {threshold.toFixed(2)}</span></div>
            {r.reason && <p style={{ fontSize: 13.5, marginTop: 8 }}>{r.reason}{r.kind === "clarify" && ". Asking a clarifying question instead of handing off."}</p>}
          </div>
          <div>
            <div className="section-label">Help articles matched</div>
            <ul className="ranked">
              {r.ranked.map((x) => (
                <li key={x.id}>
                  <span>{x.id} · {x.title}</span><span className="mono">{Number(x.score.toFixed(2))}</span>
                  <span className="bar"><i style={{ width: `${(x.score / max) * 100}%` }} /></span>
                  {x.hits.length > 0 && <span className="hits">matched {x.hits.join(", ")}</span>}
                </li>
              ))}
            </ul>
          </div>
          {r.rules && r.rules.length > 0 && <div><div className="section-label">Rules applied</div><ul className="rules">{r.rules.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          {r.signals && <div><div className="section-label">Reservation details used</div><dl className="kv" style={{ padding: 0 }}>{r.signals.map(([k, v]) => <KV key={k} k={k} v={v} />)}</dl></div>}
        </>
      )}
      <div className="slider" style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 14 }}>
        <label htmlFor="thr-console"><span>Confidence to answer</span><span className="mono">{threshold.toFixed(2)}</span></label>
        <input id="thr-console" type="range" min={0.2} max={0.8} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        <small>Below this, the copilot asks a clarifying question instead of answering.</small>
      </div>
      <div className="slider">
        <label htmlFor="clar-console"><span>Clarifying questions before a person</span><span className="mono">{maxClarify}</span></label>
        <input id="clar-console" type="range" min={0} max={3} step={1} value={maxClarify} onChange={(e) => setMaxClarify(Number(e.target.value))} />
        <small>Safety, disputes and "talk to a person" always go to a person right away.</small>
      </div>
    </aside>
  );
}

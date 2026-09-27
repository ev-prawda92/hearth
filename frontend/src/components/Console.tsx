import { useEffect, useMemo, useRef, useState } from "react";
import { ListingArt } from "./ListingArt";
import type { Api } from "../api";
import { fmtDate } from "../engine/engine";
import type { Answer, Reservation } from "../types";
import { Chevron, Flame, Send, Shield, Thumb } from "./icons";

import { RichText, QueueBadge, DecisionBadge } from "./bits";

type Msg = { id: number; kind: "me"; text: string } | { id: number; kind: "bot"; a: Answer; helpful?: boolean };

const SUGGEST: Record<string, string[]> = {
  "HT-1042": ["How much would I get back if I cancel?", "The lockbox code isn't working", "Can we bring our cat?", "I smell gas in the kitchen"],
  "HT-2218": ["Can I get a refund if I cancel?", "Can I bring my dog?", "Can we change our dates?", "Is there good hiking nearby?"],
  "HT-3307": ["If we leave tomorrow do we get anything back?", "There's no hot water and the wifi is down", "the host is being rude and racist", "Could we get a late checkout?"],
  "HT-5120": ["What happens if we cancel?", "the keypad isn't accepting my code", "Are dogs allowed?", "Can I talk to a real person?"],
  "HT-6031": ["My flight got cancelled, can I get a refund?", "How do we get in when we arrive?", "What's the latest we can check out?", "There's smoke coming from the kitchen"],
  "HT-4410": ["When do I get paid for my next booking?", "The guests stained the couch, can I file a claim?", "I have to cancel my next guest, what happens?", "I need a statement for taxes"],
};

export function tripDates(r: Reservation) {
  if (r.role === "host") return `Hosting · next guest ${fmtDate(r.next_stay!.check_in)}`;
  return `${fmtDate(r.check_in!)} – ${fmtDate(r.check_out!)}`;
}

type Props = {
  api: Api; reservations: Reservation[]; current: string; setCurrent: (id: string) => void;
  threshold: number; setThreshold: (t: number) => void; pending: { rid: string; q: string } | null; clearPending: () => void;
  onTicket: () => void;
};

export function Console({ api, reservations, current, setCurrent, threshold, setThreshold, pending, clearPending, onTicket }: Props) {
  const [threads, setThreads] = useState<Record<string, Msg[]>>({});
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastAsked = useRef<string>("");
  const threadRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);
  const res = reservations.find((r) => r.id === current)!;
  const thread = threads[current] ?? [];

  const inspected = useMemo(() => {
    const bots = thread.filter((m): m is Extract<Msg, { kind: "bot" }> => m.kind === "bot");
    return bots.find((m) => m.id === selected) ?? bots[bots.length - 1] ?? null;
  }, [thread, selected]);

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }); }, [thread.length, busy]);

  async function ask(q: string, rid = current) {
    const question = q.trim();
    if (!question || busy) return;
    lastAsked.current = question;
    setError(null);
    const me: Msg = { id: idRef.current++, kind: "me", text: question };
    setThreads((t) => ({ ...t, [rid]: [...(t[rid] ?? []), me] }));
    setBusy(true);
    try {
      const [a] = await Promise.all([api.answer(question, rid, threshold), new Promise((r) => setTimeout(r, 380))]) as [Answer, unknown];
      const bot: Msg = { id: idRef.current++, kind: "bot", a };
      setThreads((t) => ({ ...t, [rid]: [...(t[rid] ?? []), bot] }));
      setSelected(bot.id);
      if (a.ticket_id) onTicket();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (pending) { setCurrent(pending.rid); ask(pending.q, pending.rid); clearPending(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  function rate(id: number, helpful: boolean) {
    const m = thread.find((x) => x.id === id);
    if (!m || m.kind !== "bot") return;
    setThreads((t) => ({ ...t, [current]: t[current].map((x) => (x.id === id && x.kind === "bot" ? { ...x, helpful } : x)) }));
    api.feedback(current, m.a.question, m.a.article, helpful).catch(() => undefined);
  }

  return (
    <div className="console">
      <nav className="trips" aria-label="Reservations">
        <h2>Trips and hosting</h2>
        {reservations.map((r) => (
          <button key={r.id} className="trip" aria-pressed={r.id === current} onClick={() => { setCurrent(r.id); setSelected(null); }}>
            <span className="thumb"><ListingArt scene={r.art.scene} hue={r.art.hue} label={r.listing} /></span>
            <span className="trip-body">
              <span className="trip-city">{r.city}</span>
              <span className="trip-sub">{r.listing}</span>
              <span className="trip-sub">{tripDates(r)}</span>
              <span className="trip-tags">
                <span className={`tag ${r.status === "in stay" || r.status === "arriving today" ? "live" : ""}`}>{r.role === "host" ? "Host" : r.status}</span>
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
              <span className="mono">{res.id}</span> · {res.role === "host" ? `${res.listing}` : `${tripDates(res)} · ${res.policy} policy`}
            </div>
          </div>
          <span className="spacer" />
          {thread.length > 0 && <button className="btn-ghost" onClick={() => setThreads((t) => ({ ...t, [current]: [] }))}>New chat</button>}
        </header>

        <div className="thread" ref={threadRef} aria-live="polite">
          {thread.length === 0 && !busy && (
            <div className="welcome">
              <h3>Hi {res.name}, how can we help?</h3>
              <p className="muted">I can see reservation {res.id}, so answers use your policy, dates and entry details. Try one of these:</p>
              <div className="suggests">
                {(SUGGEST[current] ?? []).map((s) => <button key={s} className="pill-btn" onClick={() => ask(s)}>{s}</button>)}
              </div>
            </div>
          )}
          {thread.map((m, i) => m.kind === "me" ? (
            <div key={m.id} className="row me"><div className="bubble">{m.text}</div></div>
          ) : (
            <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="row bot">
                <span className="avatar"><Flame /></span>
                <div className="bubble" onClick={() => setSelected(m.id)} style={{ cursor: "pointer", outline: inspected?.id === m.id ? "2px solid var(--line)" : undefined }}>
                  {m.a.decision === "answer" ? <RichText html={m.a.text!} /> : m.a.handoff!.reply}
                  {m.a.decision === "answer" ? (
                    <div className="bubble-meta">
                      <span className="source">Source <b>{m.a.article}</b> {m.a.article_title}</span>
                      <span className="feedback">
                        <button className="icon-btn" aria-label="Helpful" aria-pressed={m.helpful === true} onClick={(e) => { e.stopPropagation(); rate(m.id, true); }}><Thumb /></button>
                        <button className="icon-btn" aria-label="Not helpful" aria-pressed={m.helpful === false} onClick={(e) => { e.stopPropagation(); rate(m.id, false); }}><Thumb down /></button>
                      </span>
                    </div>
                  ) : (
                    <div className={`handoff-card ${m.a.queue === "safety" ? "safety" : ""}`}>
                      <div className="handoff-head">
                        {m.a.queue === "safety" && <Shield />}
                        <QueueBadge queue={m.a.queue!} label={m.a.handoff!.queue_label} />
                        {m.a.ticket_id && <span className="mono muted">{m.a.ticket_id}</span>}
                      </div>
                      <details>
                        <summary>What the specialist sees <Chevron /></summary>
                        <dl className="kv">{m.a.handoff!.summary.map(([k, v]) => <FragmentKV key={k} k={k} v={v} />)}</dl>
                      </details>
                    </div>
                  )}
                </div>
              </div>
              {i === thread.length - 1 && !busy && (m.a.also || m.a.followups.length > 0) && (
                <div className="followups">
                  {m.a.also && <button className="pill-btn also" onClick={() => ask(ALSO[m.a.also!.id] ?? m.a.also!.title)}>Also: {m.a.also.title}</button>}
                  {m.a.followups.map((f) => <button key={f} className="pill-btn" onClick={() => ask(f)}>{f}</button>)}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="row bot"><span className="avatar"><Flame /></span><div className="bubble typing" aria-label="Copilot is typing"><i /><i /><i /></div></div>}
          {error && <p className="badge crit" role="alert">{error}</p>}
        </div>

        <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(draft); setDraft(""); }}>
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

      <WhyPanel a={inspected?.a ?? null} res={res} threshold={threshold} setThreshold={setThreshold} />
    </div>
  );
}

const ALSO: Record<string, string> = {
  "HC-01": "How much would I get back if I cancel?", "HC-02": "When would the refund arrive?", "HC-03": "Can I change my dates?",
  "HC-04": "How do I get inside?", "HC-05": "Something isn't as described", "HC-08": "Can I bring a pet?", "HC-09": "What time is check-in?",
};

function FragmentKV({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}

function WhyPanel({ a, res, threshold, setThreshold }: { a: Answer | null; res: Reservation; threshold: number; setThreshold: (t: number) => void }) {
  const max = a ? Math.max(1, a.ranked[0].score) : 1;
  return (
    <aside className="why" aria-label="Why this answer">
      <div className="why-head">
        <h3>Why this answer</h3>
        {a && <DecisionBadge a={a} />}
      </div>
      {!a ? (
        <p className="empty-why">Ask something and I'll show which help articles matched, how confident the copilot was, and which details from {res.id} it used.</p>
      ) : (
        <>
          <div>
            <div className="section-label">Confidence</div>
            <div className="gauge" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={a.confidence}>
              <div className="fill" style={{ width: `${a.confidence * 100}%` }} />
              <div className="mark" style={{ left: `calc(${a.threshold * 100}% - 1px)` }} />
            </div>
            <div className="gauge-row"><span>{a.confidence.toFixed(2)}</span><span>hand-off below {a.threshold.toFixed(2)}</span></div>
            {a.reason && <p style={{ fontSize: 13.5, marginTop: 8 }}>{a.reason}</p>}
          </div>
          <div>
            <div className="section-label">Help articles matched</div>
            <ul className="ranked">
              {a.ranked.map((r) => (
                <li key={r.id}>
                  <span>{r.id} · {r.title}</span><span className="mono">{Number(r.score.toFixed(2))}</span>
                  <span className="bar"><i style={{ width: `${(r.score / max) * 100}%` }} /></span>
                  {r.hits.length > 0 && <span className="hits">matched {r.hits.join(", ")}</span>}
                </li>
              ))}
            </ul>
          </div>
          {a.rules.length > 0 && (
            <div><div className="section-label">Rules applied</div><ul className="rules">{a.rules.map((r) => <li key={r}>{r}</li>)}</ul></div>
          )}
          {a.signals && (
            <div><div className="section-label">Reservation details used</div>
              <dl className="kv" style={{ padding: 0 }}>{a.signals.map(([k, v]) => <FragmentKV key={k} k={k} v={v} />)}</dl></div>
          )}
        </>
      )}
      <div className="slider" style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 14 }}>
        <label htmlFor="thr-console"><span>Hand-off threshold</span><span className="mono">{threshold.toFixed(2)}</span></label>
        <input id="thr-console" type="range" min={0.2} max={0.8} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        <small>Below this confidence the copilot hands off. Safety, disputes and requests for a person always hand off.</small>
      </div>
    </aside>
  );
}

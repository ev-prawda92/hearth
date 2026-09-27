import { useEffect, useState } from "react";
import type { Api } from "../api";
import type { Ticket } from "../types";
import { QueueBadge } from "./bits";

export function Inbox({ api, refreshKey, onChange, goToConsole }: { api: Api; refreshKey: number; onChange: () => void; goToConsole: (rid: string, q: string) => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [queue, setQueue] = useState("all");
  useEffect(() => { api.handoffs().then(setTickets).catch(() => undefined); }, [api, refreshKey]);

  const shown = tickets.filter((t) => queue === "all" || t.queue === queue);
  const open = tickets.filter((t) => t.status === "open");

  async function resolve(id: string) {
    await api.resolve(id);
    setTickets(await api.handoffs());
    onChange();
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="page-head">
        <div>
          <h1>Hand-offs</h1>
          <p>What a specialist sees when the copilot passes a conversation on: the reservation, the question, why it was handed off, and a suggested first step. Safety tickets sort to the top.</p>
        </div>
        <div className="seg" role="group" aria-label="Queue">
          {[["all", "All"], ["safety", "Safety"], ["trust", "Trust"], ["specialist", "Specialist"]].map(([k, l]) => (
            <button key={k} aria-pressed={queue === k} onClick={() => setQueue(k)}>{l}</button>
          ))}
        </div>
      </div>
      {tickets.length === 0 ? (
        <div className="empty">
          <strong style={{ color: "var(--ink)" }}>No hand-offs yet this session</strong>
          <span>They appear here when a conversation in the Console reaches a person.</span>
          <button className="pill-btn" onClick={() => goToConsole("HT-6031", "There's smoke coming from the kitchen")}>Try a safety message</button>
        </div>
      ) : (
        <>
          <p className="muted">{open.length} open · {tickets.length - open.length} resolved</p>
          <div className="inbox">
            {[...shown].sort((a, b) => Number(b.queue === "safety") - Number(a.queue === "safety") || Number(a.status === "resolved") - Number(b.status === "resolved"))
              .map((t) => (
                <article key={t.id} className={`ticket ${t.queue === "safety" && t.status === "open" ? "safety" : ""} ${t.status}`}>
                  <div className="ticket-head">
                    <QueueBadge queue={t.queue} label={t.queue_label} />
                    <span className="mono muted">{t.id} · {new Date(t.created).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                  </div>
                  <q>{t.question}</q>
                  <dl className="kv">{t.summary.filter(([k]) => k !== "Asked").map(([k, v]) => <Pair key={k} k={k} v={v} />)}</dl>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    {t.status === "open" ? <button className="btn-ghost" onClick={() => resolve(t.id)}>Mark resolved</button> : <span className="badge good">Resolved</span>}
                  </div>
                </article>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}

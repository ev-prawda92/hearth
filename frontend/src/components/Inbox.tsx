import { useEffect, useState } from "react";
import type { Api } from "../api";
import type { LogEntry, Ticket } from "../types";
import { QueueBadge } from "./bits";
import { Check } from "./icons";

const ACTION_NAMES: Record<string, string> = {
  cancel_reservation: "Cancelled and refunded", message_host_change: "Messaged host about a change", resend_entry: "Resent entry instructions",
  report_issue: "Reported an issue", start_claim: "Opened a damage claim", add_pet: "Added a pet", notify_assistance_animal: "Told host about an assistance animal",
  message_host_times: "Asked host about times", send_receipt: "Emailed a receipt", host_cancel: "Cancelled a guest's stay (host)",
};

export function Activity({ api, refreshKey, onChange, goToConsole }: { api: Api; refreshKey: number; onChange: () => void; goToConsole: (rid: string, q: string) => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [queue, setQueue] = useState("all");
  useEffect(() => {
    api.handoffs().then(setTickets).catch(() => undefined);
    api.actions().then(setLog).catch(() => undefined);
  }, [api, refreshKey]);

  const shown = tickets.filter((t) => queue === "all" || t.queue === queue);
  const open = tickets.filter((t) => t.status === "open");
  const total = tickets.length + log.length;

  async function resolve(id: string) {
    await api.resolve(id);
    setTickets(await api.handoffs());
    onChange();
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p>Everything the copilot did this session: what it resolved on its own, and what it passed to a person, with the context the specialist sees.</p>
        </div>
      </div>
      {total > 0 && (
        <div className="stat-row">
          <span className="badge good">{log.length} resolved by the copilot</span>
          <span className="badge warn">{tickets.length} handed off</span>
          {tickets.some((t) => t.queue === "safety") && <span className="badge crit">{tickets.filter((t) => t.queue === "safety").length} safety</span>}
        </div>
      )}

      <section className="card">
        <h3>Resolved by the copilot</h3>
        {log.length === 0 ? (
          <p className="muted" style={{ marginTop: 8 }}>Nothing yet. Actions like cancelling, reporting an issue or messaging a host show up here.</p>
        ) : (
          <div style={{ marginTop: 8 }}>
            {log.map((e, i) => (
              <div key={`${e.code}-${i}`} className="activity-row">
                <span className="done-icon"><Check /></span>
                <div><strong>{ACTION_NAMES[e.action] ?? e.action}</strong><div className="muted" style={{ fontSize: 13.5 }}>{e.summary}</div></div>
                <span className="mono muted">{e.code} · {e.reservation_id}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="stack">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ fontSize: 18 }}>Handed off to a person {tickets.length > 0 && <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}>· {open.length} open</span>}</h3>
          <div className="seg" role="group" aria-label="Queue">
            {[["all", "All"], ["safety", "Safety"], ["trust", "Trust"], ["specialist", "Specialist"]].map(([k, l]) => (
              <button key={k} aria-pressed={queue === k} onClick={() => setQueue(k)}>{l}</button>
            ))}
          </div>
        </div>
        {tickets.length === 0 ? (
          <div className="empty">
            <strong style={{ color: "var(--ink)" }}>No hand-offs yet this session</strong>
            <span>They appear here when a conversation reaches a person.</span>
            <button className="pill-btn" onClick={() => goToConsole("HT-6031", "There's smoke coming from the kitchen")}>Try a safety message</button>
          </div>
        ) : (
          <div className="inbox">
            {[...shown].sort((a, b) => Number(b.queue === "safety") - Number(a.queue === "safety") || Number(a.status === "resolved") - Number(b.status === "resolved"))
              .map((t) => (
                <article key={t.id} className={`ticket ${t.queue === "safety" && t.status === "open" ? "safety" : ""} ${t.status}`}>
                  <div className="ticket-head">
                    <QueueBadge queue={t.queue} label={t.queue_label} />
                    <span className="mono muted">{t.id} · {new Date(t.created).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                  </div>
                  <q>{t.question}</q>
                  <dl className="kv">{t.summary.filter(([k]) => k !== "Asked" && k !== "Conversation").map(([k, v]) => <Pair key={k} k={k} v={v} />)}</dl>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    {t.status === "open" ? <button className="btn-ghost" onClick={() => resolve(t.id)}>Mark resolved</button> : <span className="badge good">Resolved</span>}
                  </div>
                </article>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}

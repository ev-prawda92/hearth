import { useCallback, useEffect, useState } from "react";
import { DEMO, getApi, type Api } from "./api";
import { Brief } from "./components/Brief";
import { Console } from "./components/Console";
import { Evaluation } from "./components/Evaluation";
import { Inbox } from "./components/Inbox";
import { Logo } from "./components/icons";
import { Probe } from "./components/Probe";
import { fmtDate } from "./engine/engine";
import type { Meta, Reservation } from "./types";

const TABS = [["console", "Console"], ["eval", "Evaluation"], ["probe", "Probe"], ["handoffs", "Hand-offs"], ["brief", "Brief"]] as const;
type Tab = (typeof TABS)[number][0];
const readHash = (): Tab => {
  const h = window.location.hash.slice(1);
  return (TABS.some(([k]) => k === h) ? h : "console") as Tab;
};

export default function App() {
  const [api, setApi] = useState<Api | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [tab, setTab] = useState<Tab>(readHash);
  const [current, setCurrent] = useState("HT-1042");
  const [threshold, setThreshold] = useState(0.45);
  const [pending, setPending] = useState<{ rid: string; q: string } | null>(null);
  const [openTickets, setOpenTickets] = useState(0);
  const [ticketKey, setTicketKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getApi().then(async (a) => {
      setApi(a);
      const [m, r] = await Promise.all([a.meta(), a.reservations()]);
      setMeta(m); setReservations(r); setThreshold(m.default_threshold);
    }).catch(() => setError("Can't reach the copilot API. Start the backend with: uvicorn hearth.api:app --reload"));
  }, []);

  useEffect(() => {
    const on = () => setTab(readHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const refreshTickets = useCallback(() => {
    setTicketKey((k) => k + 1);
    api?.handoffs().then((t) => setOpenTickets(t.filter((x) => x.status === "open").length)).catch(() => undefined);
  }, [api]);

  const go = (t: Tab) => { setTab(t); history.replaceState(null, "", `#${t}`); window.scrollTo({ top: 0 }); };
  const replay = (rid: string, q: string) => { setPending({ rid, q }); go("console"); };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="logo" href="#console" onClick={(e) => { e.preventDefault(); go("console"); }}><Logo />hearth</a>
          <div className="tabs" role="tablist" aria-label="Sections">
            {TABS.map(([k, label]) => (
              <button key={k} role="tab" className="tab" aria-selected={tab === k} onClick={() => go(k)}>
                {label}{k === "handoffs" && openTickets > 0 && <span className="count">{openTickets}</span>}
              </button>
            ))}
          </div>
          <div className="topbar-meta">
            {meta && <span className="chip-soft">Demo clock · {fmtDate(meta.as_of)}, 2026</span>}
            {meta && <span className="chip-soft">Engine {meta.engine}{DEMO ? " · offline" : ""}</span>}
          </div>
        </div>
      </header>

      <main className="page">
        {error && <div className="empty" role="alert"><strong style={{ color: "var(--ink)" }}>{error}</strong></div>}
        {api && reservations.length > 0 && (
          <>
            <div hidden={tab !== "console"}>
              <Console api={api} reservations={reservations} current={current} setCurrent={setCurrent} threshold={threshold}
                setThreshold={setThreshold} pending={pending} clearPending={() => setPending(null)} onTicket={refreshTickets} />
            </div>
            {tab === "eval" && <Evaluation api={api} threshold={threshold} setThreshold={setThreshold} replay={replay} />}
            {tab === "probe" && <Probe api={api} reservations={reservations} threshold={threshold} />}
            {tab === "handoffs" && <Inbox api={api} refreshKey={ticketKey} onChange={refreshTickets} goToConsole={replay} />}
            {tab === "brief" && <Brief />}
          </>
        )}
      </main>
      <footer className="foot">Hearth is a fictional marketplace; all reservations are made up. A portfolio prototype by Evan Prawda.</footer>
    </>
  );
}

import { useEffect, useState } from "react";
import type { Api } from "../api";
import { pct } from "./bits";
import { Chevron, Shield } from "./icons";

export type RedTeamReport = {
  engine: string; n_should_trigger: number; n_look_alike: number; first_message_recall: number; eventual_recall: number;
  answered_instead: number; false_alarms: number; caveat: string;
  false_alarm_examples: { question: string; reason: string }[];
  categories: { category: string; label: string; n: number; first_message: number; eventual: number; answered_instead: number;
    missed_examples: { question: string; what_happened: string }[] }[];
};

export function RedTeam({ api }: { api: Api }) {
  const [r, setR] = useState<RedTeamReport | null>(null);
  useEffect(() => { api.redteam().then(setR).catch(() => undefined); }, [api]);
  if (!r) return null;
  const cats = [...r.categories].sort((a, b) => a.first_message - b.first_message);
  const answeredMisses = r.categories.flatMap((c) => c.missed_examples.filter((m) => m.what_happened.startsWith("answered")));

  return (
    <section className="card stack" style={{ gap: 18 }} aria-labelledby="rt-title">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <h3 id="rt-title" style={{ display: "flex", alignItems: "center", gap: 8 }}><Shield size={18} /> Safety red team</h3>
          <p className="muted" style={{ marginTop: 6, maxWidth: "78ch" }}>
            {r.n_should_trigger} emergencies described in new words, written to break the safety routing, plus {r.n_look_alike} ordinary questions
            with alarming-sounding words. Engine {r.engine}, scored once. The release gate is 100% on the first message.
          </p>
        </div>
        <span className="badge crit">Release blocked</span>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="kpi-top"><span className="kpi-name">Safety line, first message</span></div>
          <div className="kpi-vals"><div><span>v2.3</span><strong className="bad">{pct(r.first_message_recall)}</strong></div><div><span>Gate</span><strong style={{ color: "var(--muted)" }}>100%</strong></div></div>
          <p>Emergencies routed to the safety line on the first message.</p></div>
        <div className="kpi"><div className="kpi-top"><span className="kpi-name">Answered instead</span></div>
          <div className="kpi-vals"><div><span>Emergencies</span><strong className="bad">{r.answered_instead}</strong></div><div><span>of</span><strong style={{ color: "var(--muted)" }}>{r.n_should_trigger}</strong></div></div>
          <p>The worst outcome: an emergency got an ordinary help article.</p></div>
        <div className="kpi"><div className="kpi-top"><span className="kpi-name">Reached it eventually</span></div>
          <div className="kpi-vals"><div><span>Via menu</span><strong>{pct(r.eventual_recall)}</strong></div><div /></div>
          <p>Only if the person taps "I don't feel safe" in a clarifying menu. Too slow for an emergency.</p></div>
        <div className="kpi"><div className="kpi-top"><span className="kpi-name">False alarms</span></div>
          <div className="kpi-vals"><div><span>Look-alikes</span><strong>{r.false_alarms}</strong></div><div><span>of</span><strong style={{ color: "var(--muted)" }}>{r.n_look_alike}</strong></div></div>
          <p>Ordinary questions sent to the safety line ("fire pit", "the lasagna was fire").</p></div>
      </div>

      <div className="table-wrap" style={{ maxHeight: "none" }}>
        <table className="data">
          <thead><tr><th>Kind of emergency</th><th className="num">Cases</th><th style={{ width: "40%" }}>Safety line on first message</th><th className="num">Eventually</th></tr></thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.category}>
                <td>{c.label}{c.answered_instead > 0 && <div className="muted" style={{ fontSize: 12 }}>{c.answered_instead} answered with a help article</div>}</td>
                <td className="num">{c.n}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div className="gauge" style={{ flex: 1 }}><div className="fill" style={{ width: `${c.first_message * 100}%`, background: "var(--crit)" }} /></div>
                    <span className="mono" style={{ width: 38, textAlign: "right" }}>{pct(c.first_message)}</span>
                  </div>
                </td>
                <td className="num">{pct(c.eventual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="examples">
        <summary>Emergencies that got an ordinary answer, and false alarms <Chevron /></summary>
        <div className="stack" style={{ marginTop: 10 }}>
          <div><b>Answered instead of handed off</b>
            <ul>{answeredMisses.slice(0, 8).map((m) => <li key={m.question}>{m.question} <span className="muted">({m.what_happened})</span></li>)}</ul></div>
          <div><b>False alarms</b>
            <ul>{r.false_alarm_examples.map((f) => <li key={f.question}>{f.question} <span className="muted">({f.reason})</span></li>)}</ul></div>
        </div>
      </details>

      <div className="callout">
        <b>What this means:</b> keyword rules recognize an emergency only when it's described in words someone thought to list. Nobody says
        "stroke"; they say "one side of his face looks droopy." v3 needs a safety classifier that reads meaning, run before anything else, with
        these keyword rules kept as a floor and this red-team set as its gate. <span className="muted">{r.caveat}</span>
      </div>
    </section>
  );
}

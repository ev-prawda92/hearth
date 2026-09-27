import { useEffect, useMemo, useState } from "react";
import type { Api } from "../api";
import type { EvalResult, HistoryEntry, SweepPoint } from "../types";
import { AtScale } from "./AtScale";
import { pct, VERDICT_LABEL } from "./bits";

type Props = {
  api: Api; threshold: number; setThreshold: (t: number) => void; maxClarify: number; setMaxClarify: (n: number) => void;
  replay: (rid: string, q: string) => void;
};

const CONV_LABEL: Record<string, string> = { ...VERDICT_LABEL, resolved: "resolved", handoff: "handed off", late_safety: "safety via menu" };
const CONV_CLASS: Record<string, string> = { pass: "pass", resolved: "pass", handoff: "handoff", late_safety: "handoff", wrong: "wrong", wrong_queue: "wrong_queue", missed_safety: "missed_safety" };

export function Evaluation({ api, threshold, setThreshold, maxClarify, setMaxClarify, replay }: Props) {
  const [result, setResult] = useState<EvalResult | null>(null);
  const [sweepPts, setSweep] = useState<SweepPoint[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [split, setSplit] = useState<"all" | "dev" | "holdout">("holdout");
  const [verdict, setVerdict] = useState("changed");
  const [topic, setTopic] = useState("all");
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.evaluate(threshold, "all", maxClarify).then(setResult).catch((e) => setErr(String(e.message ?? e))); }, [api, threshold, maxClarify]);
  useEffect(() => { api.sweep(split, maxClarify).then(setSweep).catch(() => undefined); }, [api, split, maxClarify]);
  useEffect(() => { api.history().then(setHistory).catch(() => undefined); }, [api]);

  const rows = useMemo(() => {
    if (!result) return [];
    return result.rows.filter((r) =>
      (split === "all" || r.split === split) &&
      (verdict === "all" ||
        (verdict === "changed" ? (r.verdict !== "pass" || r.clarified > 0) :
          verdict === "misses" ? !["pass", "resolved"].includes(r.conv_verdict) : r.conv_verdict === verdict)) &&
      (topic === "all" || r.topic === topic) &&
      (!query || r.question.toLowerCase().includes(query.toLowerCase())));
  }, [result, split, verdict, topic, query]);
  const topics = useMemo(() => [...new Set(result?.rows.map((r) => r.topic) ?? [])].sort(), [result]);

  if (err) return <p className="badge crit" role="alert">Couldn't load the evaluation: {err}</p>;
  if (!result) return <p className="muted">Scoring test cases…</p>;
  const dev = result.by_split.dev, hold = result.by_split.holdout;

  return (
    <div className="stack" style={{ gap: 28 }}>
      <div className="page-head">
        <div>
          <h1>Evaluation</h1>
          <p>
            {dev.n + hold.n} labeled contacts. The <b>dev</b> set is what I tuned against; the <b>holdout</b> set is the honest number.
            Multi-turn results use a simulated guest who picks the right option whenever it's offered, so read them as a ceiling.
          </p>
        </div>
        <div className="controls">
          <div className="slider">
            <label htmlFor="thr-eval"><span>Confidence to answer</span><span className="mono">{threshold.toFixed(2)}</span></label>
            <input id="thr-eval" type="range" min={0.2} max={0.8} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          </div>
          <div className="field" style={{ fontSize: 13 }}>Clarifying questions
            <div className="seg" role="group" aria-label="Clarifying questions before a person">
              {[0, 1, 2, 3].map((n) => <button key={n} aria-pressed={maxClarify === n} onClick={() => setMaxClarify(n)}>{n}</button>)}
            </div>
          </div>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-name">Resolved without a person</span><span className="badge neutral">Holdout</span></div>
          <div className="kpi-vals">
            <div><span>First reply</span><strong style={{ color: "var(--muted)" }}>{pct(hold.self_solve)}</strong></div>
            <div><span>In conversation</span><strong>{pct(hold.resolved_in_conversation)}</strong></div>
          </div>
          <p>Ceiling is {pct(hold.answerable / hold.n)}; the rest should reach a person. {maxClarify > 0 ? `${pct(hold.clarify_rate)} of contacts got a clarifying question.` : "Clarifying is off."}</p>
        </div>
        <Kpi name="Wrong answers" hold={hold.conv_wrong_answers} dev={dev.conv_wrong_answers} count
          ok={hold.conv_wrong_answers === 0} okLabel="None" badLabel="Review"
          note="Answers that cited the wrong article or stated the wrong facts, counting every turn." />
        <Kpi name="Safety on first message" hold={hold.safety_recall} dev={dev.safety_recall}
          ok={hold.safety_recall >= 1} okLabel="Gate: 100%" badLabel="Release blocked" crit
          note={`Routed to the safety line from the first message. With the menu's "I don't feel safe" option, ${pct(hold.safety_eventual)} get there eventually.`} />
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-name">Cost in turns</span><span className="badge neutral">Holdout</span></div>
          <div className="kpi-vals">
            <div><span>To resolve</span><strong>{hold.avg_turns_resolved.toFixed(1)}</strong></div>
            <div><span>To reach a person</span><strong>{hold.avg_turns_to_handoff.toFixed(1)}</strong></div>
          </div>
          <p>Average turns per contact. Clarifying helps resolution but makes people who need a person wait longer.</p>
        </div>
      </div>

      <section className="card">
        <h3>How it got here</h3>
        <p className="muted" style={{ marginTop: 6 }}>Each version was scored on a holdout set it hadn't seen. After scoring, that set joined dev and a fresh one was written.</p>
        <div className="timeline">
          {history.map((h) => <Step key={h.version} h={h} />)}
          <div className="step next">
            <div className="step-head"><span className="step-v">v3</span><span className="badge neutral">Next</span></div>
            <p>Retrieve by meaning (embeddings or a language model) instead of keywords, which keep colliding ("Guess" jeans matched "guest"). Add a red-team set of new safety phrasing, and keep the keyword safety rules as a floor and every gate unchanged.</p>
          </div>
        </div>
      </section>

      <AtScale api={api} />

      <div className="grid-2 eval-grid">
        <section className="card stack">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <h3>Confidence trade-off</h3>
            <SplitSeg split={split} setSplit={setSplit} />
          </div>
          <div className="legend">
            <span><i style={{ background: "var(--s1)" }} />Resolved in conversation</span>
            <span><i style={{ background: "var(--s3)" }} />Resolved on first reply</span>
            <span><i style={{ background: "var(--s2)" }} />Citation accuracy</span>
          </div>
          <SweepChart pts={sweepPts} threshold={threshold} onPick={setThreshold} />
          <p className="muted" style={{ fontSize: 13.5 }}>Click a point to set the confidence level. Below it the copilot clarifies instead of answering, so raising it trades speed for fewer wrong answers.</p>
        </section>

        <section className="card stack">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <h3>Cases</h3>
            <span className="muted" style={{ fontSize: 13 }}>{rows.length} shown · click to replay</span>
          </div>
          <div className="filters">
            <SplitSeg split={split} setSplit={setSplit} />
            <select className="select" value={verdict} onChange={(e) => setVerdict(e.target.value)} aria-label="Result">
              <option value="changed">Clarified or missed</option><option value="misses">Still unresolved</option><option value="all">All results</option>
              <option value="resolved">Resolved</option><option value="handoff">Handed off</option><option value="late_safety">Safety via menu</option>
              <option value="wrong_queue">Wrong queue</option><option value="wrong">Wrong answers</option>
            </select>
            <select className="select" value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic">
              <option value="all">All topics</option>{topics.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="search" type="search" placeholder="Search questions" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search questions" />
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Question</th><th>First reply</th><th>Conversation</th><th className="num">Turns</th><th>Expected</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="click" tabIndex={0} onClick={() => replay(r.reservation_id, r.question)}
                    onKeyDown={(e) => e.key === "Enter" && replay(r.reservation_id, r.question)}>
                    <td>{r.question}<div className="mono muted">{r.id} · {r.reservation_id}</div></td>
                    <td><span className={`v ${r.verdict}`}>{VERDICT_LABEL[r.verdict]}</span></td>
                    <td><span className={`v ${CONV_CLASS[r.conv_verdict]}`}>{CONV_LABEL[r.conv_verdict]}</span></td>
                    <td className="num">{r.turns}</td>
                    <td className="mono nowrap">{r.expect === "HANDOFF" ? r.queue : r.expect}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={5} className="muted">No cases match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function SplitSeg({ split, setSplit }: { split: string; setSplit: (s: "all" | "dev" | "holdout") => void }) {
  return (
    <div className="seg" role="group" aria-label="Test set">
      {(["holdout", "dev", "all"] as const).map((s) => (
        <button key={s} aria-pressed={split === s} onClick={() => setSplit(s)}>{s === "all" ? "Both" : s === "dev" ? "Dev" : "Holdout"}</button>
      ))}
    </div>
  );
}

function Kpi({ name, dev, hold, note, ok, okLabel, badLabel, crit, count }: {
  name: string; dev: number; hold: number; note: string; ok: boolean; okLabel: string; badLabel: string; crit?: boolean; count?: boolean;
}) {
  const fmt = (v: number) => (count ? String(v) : pct(v));
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className="kpi-name">{name}</span>
        <span className={`badge ${ok ? "good" : crit ? "crit" : "warn"}`}>{ok ? okLabel : badLabel}</span>
      </div>
      <div className="kpi-vals">
        <div><span>Holdout</span><strong>{fmt(hold)}</strong></div>
        <div><span>Dev</span><strong style={{ color: "var(--muted)" }}>{fmt(dev)}</strong></div>
      </div>
      <p>{note}</p>
    </div>
  );
}

function Step({ h }: { h: HistoryEntry }) {
  const label = h.version === "v1" ? "Baseline" : h.version === "v2" ? "Overfit" : h.version === "v2.1" ? "Not shippable" : h.version === "v2.2" ? "Blocked on safety" : "Generalizes";
  const tone = h.version === "v1" ? "neutral" : h.version === "v2.3" ? "good" : h.version === "v2.2" ? "warn" : "crit";
  const cell = (v: number | undefined, gate?: number) =>
    v === undefined ? "–" : <span className={gate !== undefined && v < gate ? "bad" : undefined}>{pct(v)}</span>;
  return (
    <div className="step">
      <div className="step-head"><span className="step-v">{h.version}</span><span className={`badge ${tone}`}>{label}</span></div>
      <p>{h.note}</p>
      <table className="mini">
        <thead><tr><th /><th>Dev</th><th>{h.holdout ? h.holdout.set.replace("holdout-", "Holdout ") : "Holdout"}</th></tr></thead>
        <tbody>
          <tr><td>First reply</td><td>{cell(h.dev.self_solve)}</td><td>{cell(h.holdout?.self_solve)}</td></tr>
          {h.holdout?.resolved_in_conversation !== undefined && (h.version === "v2.2" || h.version === "v2.3") &&
            <tr><td>In conversation</td><td>{cell(h.dev.resolved_in_conversation)}</td><td>{cell(h.holdout.resolved_in_conversation)}</td></tr>}
          <tr><td>Citation</td><td>{cell(h.dev.citation_accuracy, 0.95)}</td><td>{cell(h.holdout?.citation_accuracy, 0.95)}</td></tr>
          <tr><td>Safety, 1st msg</td><td>{cell(h.dev.safety_recall, 1)}</td><td>{cell(h.holdout?.safety_recall, 1)}</td></tr>
        </tbody>
      </table>
      {h.external && <p style={{ fontSize: 13 }}>Public questions, untouched half: wrong answers <b>{h.external["v2.2"]._total_wrong} → {h.external["v2.3"]._total_wrong}</b>, false safety alarms <b>{h.external["v2.2"]._false_safety} → {h.external["v2.3"]._false_safety}</b>.</p>}
      {h.verdict && <p style={{ fontWeight: 600 }}>{h.verdict}</p>}
      {h.holdout_note && <p className="muted" style={{ fontSize: 12 }}>{h.holdout_note}</p>}
    </div>
  );
}

type Key = "resolved_in_conversation" | "self_solve" | "citation_accuracy";
const SERIES: [Key, string][] = [["citation_accuracy", "var(--s2)"], ["self_solve", "var(--s3)"], ["resolved_in_conversation", "var(--s1)"]];

function SweepChart({ pts, threshold, onPick }: { pts: SweepPoint[]; threshold: number; onPick: (t: number) => void }) {
  const [hover, setHover] = useState<SweepPoint | null>(null);
  if (!pts.length) return <div style={{ height: 240 }} />;
  const W = 600, H = 260, m = { l: 44, r: 16, t: 14, b: 38 };
  const lo = Math.max(0, Math.floor(Math.min(...pts.flatMap((p) => SERIES.map(([k]) => p[k]))) * 10) / 10);
  const x = (t: number) => m.l + ((t - 0.2) / 0.6) * (W - m.l - m.r);
  const y = (v: number) => m.t + (1 - (v - lo) / (1 - lo)) * (H - m.t - m.b);
  const path = (k: Key) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.threshold).toFixed(1)} ${y(p[k]).toFixed(1)}`).join(" ");
  const ticks: number[] = []; for (let v = lo; v <= 1.0001; v += 0.1) ticks.push(Math.round(v * 10) / 10);
  const show = hover ?? pts.find((p) => Math.abs(p.threshold - threshold) < 1e-6) ?? null;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Resolution and citation accuracy by confidence level">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" />
            <text x={m.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{Math.round(v * 100)}%</text>
          </g>
        ))}
        {[0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((t) => <text key={t} x={x(t)} y={H - m.b + 18} textAnchor="middle" fontSize="11" fill="var(--muted)">{t.toFixed(1)}</text>)}
        <text x={(W + m.l) / 2} y={H - 2} textAnchor="middle" fontSize="11.5" fill="var(--muted)">Confidence to answer</text>
        <line x1={x(threshold)} x2={x(threshold)} y1={m.t} y2={H - m.b} stroke="var(--ink)" strokeDasharray="3 4" />
        {SERIES.map(([k, c]) => <path key={k} d={path(k)} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" />)}
        {show && SERIES.map(([k, c]) => <circle key={k} cx={x(show.threshold)} cy={y(show[k])} r="5" fill={c} stroke="var(--card)" strokeWidth="2" />)}
        {pts.map((p) => (
          <rect key={p.threshold} x={x(p.threshold) - 18} y={m.t} width="36" height={H - m.t - m.b} fill="transparent" style={{ cursor: "pointer" }}
            onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} onClick={() => onPick(p.threshold)} />
        ))}
      </svg>
      {hover && (
        <div className="tip" style={{ left: `${(x(hover.threshold) / W) * 100}%`, top: `${(y(Math.max(hover.resolved_in_conversation, hover.citation_accuracy)) / H) * 100}%` }}>
          Confidence {hover.threshold.toFixed(2)}<br />In conversation {pct(hover.resolved_in_conversation)} · First reply {pct(hover.self_solve)}<br />
          Citation {pct(hover.citation_accuracy)} · {hover.wrong_answers} wrong on first reply
        </div>
      )}
    </div>
  );
}

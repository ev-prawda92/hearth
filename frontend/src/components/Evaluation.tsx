import { useEffect, useMemo, useState } from "react";
import type { Api } from "../api";
import type { EvalResult, HistoryEntry, SweepPoint } from "../types";
import { pct, VERDICT_LABEL } from "./bits";

type Props = { api: Api; threshold: number; setThreshold: (t: number) => void; replay: (rid: string, q: string) => void };

const TARGETS = {
  citation_accuracy: { min: 0.95, label: "Target ≥95%" },
  personalization: { min: 0.9, label: "Target ≥90%" },
  safety_recall: { min: 1, label: "Gate: 100%" },
} as const;

export function Evaluation({ api, threshold, setThreshold, replay }: Props) {
  const [result, setResult] = useState<EvalResult | null>(null);
  const [sweepPts, setSweep] = useState<SweepPoint[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [split, setSplit] = useState<"all" | "dev" | "holdout">("holdout");
  const [verdict, setVerdict] = useState("misses");
  const [topic, setTopic] = useState("all");
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.evaluate(threshold, "all").then(setResult).catch((e) => setErr(String(e.message ?? e))); }, [api, threshold]);
  useEffect(() => { api.sweep(split).then(setSweep).catch(() => undefined); }, [api, split]);
  useEffect(() => { api.history().then(setHistory).catch(() => undefined); }, [api]);

  const rows = useMemo(() => {
    if (!result) return [];
    return result.rows.filter((r) =>
      (split === "all" || r.split === split) &&
      (verdict === "all" || (verdict === "misses" ? r.verdict !== "pass" : r.verdict === verdict)) &&
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
            {dev.n + hold.n} labeled contacts. The <b>dev</b> set is what I tuned against. The <b>holdout</b> set was written before the current
            version ran on it, so it's the honest number. Move the threshold to trade self-service against hand-offs.
          </p>
        </div>
        <div className="controls">
          <div className="slider">
            <label htmlFor="thr-eval"><span>Hand-off threshold</span><span className="mono">{threshold.toFixed(2)}</span></label>
            <input id="thr-eval" type="range" min={0.2} max={0.8} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          </div>
        </div>
      </div>

      <div className="kpis">
        <Kpi name="Self-solve rate" dev={dev.self_solve} hold={hold.self_solve}
          note={`Resolved correctly with no person involved. Ceiling on holdout is ${pct(hold.answerable / hold.n)}; the rest should reach a person.`} />
        <Kpi name="Citation accuracy" dev={dev.citation_accuracy} hold={hold.citation_accuracy} target={TARGETS.citation_accuracy}
          note={`Answered contacts that cited the right article. ${hold.wrong_answers} wrong answer${hold.wrong_answers === 1 ? "" : "s"} on holdout.`} />
        <Kpi name="Personalization" dev={dev.personalization} hold={hold.personalization} target={TARGETS.personalization}
          note="Correct answers that stated the right refund amount, dates or entry details." />
        <Kpi name="Safety hand-off" dev={dev.safety_recall} hold={hold.safety_recall} target={TARGETS.safety_recall}
          note="Safety contacts routed to the safety line. Anything under 100% blocks release." />
      </div>

      <section className="card">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <h3>How it got here</h3>
            <p>Each version was scored on a holdout set it hadn't seen. After scoring, that set joined dev and a fresh one was written.</p>
          </div>
        </div>
        <div className="timeline">
          {history.map((h) => <Step key={h.version} h={h} />)}
          <div className="step next">
            <div className="step-head"><span className="step-v">v3</span><span className="badge neutral">Next</span></div>
            <p>Retrieve by meaning (embeddings or a language model) so paraphrases like "the gate won't unlock" land on the right article.
              Keep the keyword safety rules as a floor, and keep these gates unchanged.</p>
          </div>
        </div>
      </section>

      <div className="grid-2 eval-grid">
        <section className="card stack">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <h3>Threshold trade-off</h3>
            <SplitSeg split={split} setSplit={setSplit} />
          </div>
          <div className="legend"><span><i style={{ background: "var(--s1)" }} />Self-solve rate</span><span><i style={{ background: "var(--s2)" }} />Citation accuracy</span></div>
          <SweepChart pts={sweepPts} threshold={threshold} onPick={setThreshold} />
          <p className="muted" style={{ fontSize: 13.5 }}>Click a point to set the threshold. Raising it hands off more contacts; lowering it answers more but risks wrong answers.</p>
        </section>

        <section className="card stack">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <h3>Cases</h3>
            <span className="muted" style={{ fontSize: 13 }}>{rows.length} shown · click to replay</span>
          </div>
          <div className="filters">
            <SplitSeg split={split} setSplit={setSplit} />
            <select className="select" value={verdict} onChange={(e) => setVerdict(e.target.value)} aria-label="Result">
              <option value="misses">Misses only</option><option value="all">All results</option>
              <option value="handoff">Extra hand-offs</option><option value="wrong">Wrong answers</option>
              <option value="missed_safety">Missed safety</option><option value="wrong_queue">Wrong queue</option>
            </select>
            <select className="select" value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic">
              <option value="all">All topics</option>{topics.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="search" type="search" placeholder="Search questions" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search questions" />
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Question</th><th>Result</th><th>Expected</th><th>Got</th><th className="num">Conf.</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="click" tabIndex={0} onClick={() => replay(r.reservation_id, r.question)}
                    onKeyDown={(e) => e.key === "Enter" && replay(r.reservation_id, r.question)}>
                    <td>{r.question}<div className="mono muted">{r.id} · {r.reservation_id}</div></td>
                    <td><span className={`v ${r.verdict}`}>{VERDICT_LABEL[r.verdict]}</span></td>
                    <td className="mono nowrap">{r.expect === "HANDOFF" ? r.queue : r.expect}</td>
                    <td className="mono nowrap">{r.got === "HANDOFF" ? r.got_queue : r.got}</td>
                    <td className="num">{r.confidence.toFixed(2)}</td>
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

function Kpi({ name, dev, hold, note, target }: { name: string; dev: number; hold: number; note: string; target?: { min: number; label: string } }) {
  const ok = target ? hold >= target.min : null;
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className="kpi-name">{name}</span>
        {target && <span className={`badge ${ok ? "good" : target.min === 1 ? "crit" : "warn"}`}>{ok ? target.label : target.min === 1 ? "Release blocked" : `Below ${pct(target.min)}`}</span>}
      </div>
      <div className="kpi-vals">
        <div className="holdout"><span>Holdout</span><strong>{pct(hold)}</strong></div>
        <div><span>Dev</span><strong style={{ color: "var(--muted)" }}>{pct(dev)}</strong></div>
      </div>
      <p>{note}</p>
    </div>
  );
}

function Step({ h }: { h: HistoryEntry }) {
  const tone = h.version === "v1" ? "neutral" : h.holdout && (h.holdout.safety_recall ?? 1) < 1 ? "crit" : "good";
  const label = h.version === "v1" ? "Baseline" : h.version === "v2" ? "Overfit" : "Not shippable";
  const cell = (v: number | undefined, gate?: number) =>
    v === undefined ? "–" : <span className={gate !== undefined && v < gate ? "bad" : undefined}>{pct(v)}</span>;
  return (
    <div className="step">
      <div className="step-head"><span className="step-v">{h.version}</span><span className={`badge ${tone}`}>{label}</span></div>
      <p>{h.note}</p>
      <table className="mini">
        <thead><tr><th /><th>Dev</th><th>{h.holdout ? h.holdout.set.replace("holdout-", "Holdout ") : "Holdout"}</th></tr></thead>
        <tbody>
          <tr><td>Self-solve</td><td>{cell(h.dev.self_solve)}</td><td>{cell(h.holdout?.self_solve)}</td></tr>
          <tr><td>Citation</td><td>{cell(h.dev.citation_accuracy, 0.95)}</td><td>{cell(h.holdout?.citation_accuracy, 0.95)}</td></tr>
          <tr><td>Safety</td><td>{cell(h.dev.safety_recall, 1)}</td><td>{cell(h.holdout?.safety_recall, 1)}</td></tr>
        </tbody>
      </table>
      {h.verdict && <p style={{ fontWeight: 600 }}>{h.verdict}</p>}
    </div>
  );
}

function SweepChart({ pts, threshold, onPick }: { pts: SweepPoint[]; threshold: number; onPick: (t: number) => void }) {
  const [hover, setHover] = useState<SweepPoint | null>(null);
  if (!pts.length) return <div style={{ height: 240 }} />;
  const W = 600, H = 250, m = { l: 44, r: 16, t: 14, b: 38 };
  const lo = Math.max(0, Math.floor(Math.min(...pts.map((p) => Math.min(p.self_solve, p.citation_accuracy))) * 10) / 10);
  const x = (t: number) => m.l + ((t - 0.2) / 0.6) * (W - m.l - m.r);
  const y = (v: number) => m.t + (1 - (v - lo) / (1 - lo)) * (H - m.t - m.b);
  const path = (k: "self_solve" | "citation_accuracy") => pts.map((p, i) => `${i ? "L" : "M"}${x(p.threshold).toFixed(1)} ${y(p[k]).toFixed(1)}`).join(" ");
  const ticks: number[] = []; for (let v = lo; v <= 1.0001; v += 0.1) ticks.push(Math.round(v * 10) / 10);
  const cur = pts.find((p) => Math.abs(p.threshold - threshold) < 1e-6);
  const show = hover ?? cur ?? null;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Self-solve rate and citation accuracy by hand-off threshold">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" />
            <text x={m.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{Math.round(v * 100)}%</text>
          </g>
        ))}
        {[0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((t) => <text key={t} x={x(t)} y={H - m.b + 18} textAnchor="middle" fontSize="11" fill="var(--muted)">{t.toFixed(1)}</text>)}
        <text x={(W + m.l) / 2} y={H - 2} textAnchor="middle" fontSize="11.5" fill="var(--muted)">Hand-off threshold</text>
        <line x1={x(threshold)} x2={x(threshold)} y1={m.t} y2={H - m.b} stroke="var(--ink)" strokeDasharray="3 4" />
        <path d={path("citation_accuracy")} fill="none" stroke="var(--s2)" strokeWidth="2" strokeLinejoin="round" />
        <path d={path("self_solve")} fill="none" stroke="var(--s1)" strokeWidth="2" strokeLinejoin="round" />
        {show && <>
          <circle cx={x(show.threshold)} cy={y(show.citation_accuracy)} r="5" fill="var(--s2)" stroke="var(--card)" strokeWidth="2" />
          <circle cx={x(show.threshold)} cy={y(show.self_solve)} r="5" fill="var(--s1)" stroke="var(--card)" strokeWidth="2" />
        </>}
        {pts.map((p) => (
          <rect key={p.threshold} x={x(p.threshold) - 18} y={m.t} width="36" height={H - m.t - m.b} fill="transparent" style={{ cursor: "pointer" }}
            onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} onClick={() => onPick(p.threshold)} />
        ))}
      </svg>
      {hover && (
        <div className="tip" style={{ left: `${(x(hover.threshold) / W) * 100}%`, top: `${(y(Math.max(hover.self_solve, hover.citation_accuracy)) / H) * 100}%` }}>
          Threshold {hover.threshold.toFixed(2)}<br />Self-solve {pct(hover.self_solve)} · Citation {pct(hover.citation_accuracy)}<br />
          {hover.wrong_answers} wrong · {hover.handoffs} hand-offs
        </div>
      )}
    </div>
  );
}


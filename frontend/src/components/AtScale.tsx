import { useEffect, useState } from "react";
import type { Api } from "../api";
import { pct } from "./bits";
import { Chevron } from "./icons";

type Track = {
  track: string; label: string; n: number; clarify_rate: number;
  resolved_first_reply?: number; resolved_in_conversation?: number; wrong_first_reply?: number; wrong_in_conversation?: number; handed_off?: number;
  correct_queue_first_reply?: number; correct_queue_in_conversation?: number; answered_in_conversation?: number; to_safety_line?: number; expected_queue?: string;
};
export type ExternalReport = {
  engine: string; n: number; total_wrong_answers: number; false_safety_count: number;
  sources: { name: string; license: string; url: string; used: number }[];
  label_checks: Record<string, string>; tracks: Track[];
  wrong_clusters: { track: string; expected: string; got: string; count: number; examples: string[] }[];
  missed_in_scope: { intent: string; count: number; examples: string[] }[];
  false_safety_alarms: { question: string; reason: string }[];
  halves?: Record<string, Record<string, HalfSummary>>;
};

type Half = { n: number; first: number; conv: number; wrong: number; to_safety?: number };
type HalfSummary = Record<string, Half | number>;
const ORDER = ["in_scope_real", "in_scope_adapted", "asks_for_person", "dispute", "out_of_scope"];
const LABELS: Record<string, string> = {
  in_scope_real: "In scope, real phrasing (ABCD refund status)", in_scope_adapted: "In scope, reworded (Bitext)",
  asks_for_person: "Asks for a person (Bitext)", dispute: "Billing disputes (ABCD)", out_of_scope: "Out of scope (both)",
};

export function AtScale({ api }: { api: Api }) {
  const [r, setR] = useState<ExternalReport | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { api.external().then(setR).catch(() => setErr(true)); }, [api]);
  if (err) return null;
  if (!r) return <section className="card"><p className="muted">Loading the at-scale results…</p></section>;
  const halves = r.halves;
  const hold22 = (halves?.["v2.2"]?.holdout ?? {}) as HalfSummary, hold23 = (halves?.["v2.3"]?.holdout ?? {}) as HalfSummary;

  return (
    <section className="card stack" style={{ gap: 18 }} aria-labelledby="scale-title">
      <div>
        <h3 id="scale-title">At scale: {r.n.toLocaleString()} questions from public support data</h3>
        <p className="muted" style={{ marginTop: 6, maxWidth: "78ch" }}>
          Questions from two public datasets, mapped to Hearth's topics and queues and split in half. v2.2 was scored as-is; v2.3's fixes were
          made looking only at one half, and the table below is the other half, which was never looked at until v2.3 was scored on it once.
        </p>
        <div className="stat-row" style={{ marginTop: 10 }}>
          {r.sources.map((s) => (
            <a key={s.name} className="chip-soft" href={s.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
              {s.name} · {s.license} · {s.used.toLocaleString()} used
            </a>
          ))}
        </div>
      </div>

      {halves?.["v2.2"] && halves?.["v2.3"] ? (
        <>
          <div className="table-wrap" style={{ maxHeight: "none" }}>
            <table className="data">
              <thead><tr><th>Untouched half ({ORDER.reduce((s, k) => s + ((hold23[k] as Half | undefined)?.n ?? 0), 0).toLocaleString()} questions)</th><th className="num">Right, v2.2</th><th className="num">Right, v2.3</th><th className="num">Wrong, v2.2</th><th className="num">Wrong, v2.3</th></tr></thead>
              <tbody>
                {ORDER.filter((k) => hold22[k] && hold23[k]).map((k) => {
                  const a = hold22[k] as Half, b = hold23[k] as Half;
                  return (
                    <tr key={k}>
                      <td>{LABELS[k]}<div className="muted" style={{ fontSize: 12 }}>{a.n} questions · {k.startsWith("in_scope") ? "right = correct article, after clarifying" : k === "dispute" ? "right = handed to the trust team" : "right = handed to a specialist"}</div></td>
                      <td className="num">{pct(a.conv)}</td>
                      <td className="num"><b>{pct(b.conv)}</b></td>
                      <td className="num">{a.wrong}</td>
                      <td className="num"><b className={b.wrong > a.wrong ? "bad" : undefined}>{b.wrong}</b></td>
                    </tr>
                  );
                })}
                <tr>
                  <td><b>All tracks</b><div className="muted" style={{ fontSize: 12 }}>False safety alarms: {hold22._false_safety as number} → {hold23._false_safety as number}</div></td>
                  <td /><td />
                  <td className="num">{hold22._total_wrong as number}</td>
                  <td className="num"><b>{hold23._total_wrong as number}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="grid-2" style={{ marginTop: 0 }}>
            <div>
              <div className="section-label">What the public data exposed, and v2.3 fixed</div>
              <ol className="findings">
                <li><b>"What's the status of my refund?"</b> got the cancellation answer. Refund synonyms and status words now route it: {pct((hold22.in_scope_real as Half).conv)} → {pct((hold23.in_scope_real as Half).conv)} right.</li>
                <li><b>Typo matching raised false safety alarms</b> ("policy" read as "police"). Safety words now match exactly, plus a short misspelling list: {hold22._false_safety as number} → {hold23._false_safety as number}.</li>
                <li><b>Billing disputes never reached the trust team.</b> "Charge not reversed" and "never ordered" now go there: {pct((hold22.dispute as Half).conv)} → {pct((hold23.dispute as Half).conv)}.</li>
                <li><b>Account and shipping questions got confident answers.</b> A scope check hands them off unless the reservation is mentioned: {(hold22.out_of_scope as Half).wrong} → {(hold23.out_of_scope as Half).wrong} wrong.</li>
              </ol>
            </div>
            <div>
              <div className="section-label">Still open</div>
              <ol className="findings">
                <li>Only {pct((hold23.dispute as Half).conv)} of disputes reach the trust team; many start with "I have a question about my account" and only reveal the dispute later.</li>
                <li>Some labels are genuinely ambiguous: "what's your refund policy?" is in scope for Hearth but was labeled out of scope for a clothing store.</li>
                <li>These datasets have no safety situations, so first-message safety detection on new phrasing is still untested.</li>
                <li>Keyword matching keeps hitting its ceiling. The brand "Guess" matched "guest" during tuning. Meaning-based retrieval is still the next big step.</li>
              </ol>
            </div>
          </div>
        </>
      ) : null}

      <details className="examples">
        <summary>Examples of wrong answers and false alarms <Chevron /></summary>
        <div className="stack" style={{ marginTop: 10 }}>
          {r.wrong_clusters.slice(0, 6).map((c) => (
            <div key={`${c.track}-${c.expected}-${c.got}`}>
              <b>{c.count}×</b> expected <span className="mono">{c.expected === "HANDOFF" ? "hand-off" : c.expected}</span>, got <span className="mono">{c.got}</span>
              <ul>{c.examples.slice(0, 3).map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          ))}
          <div>
            <b>False safety alarms</b>
            <ul>{r.false_safety_alarms.slice(0, 5).map((a) => <li key={a.question}>{a.question} <span className="muted">({a.reason})</span></li>)}</ul>
          </div>
        </div>
      </details>

    </section>
  );
}

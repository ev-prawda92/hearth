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
};

const T = (r: ExternalReport, k: string) => r.tracks.find((t) => t.track === k);

export function AtScale({ api }: { api: Api }) {
  const [r, setR] = useState<ExternalReport | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { api.external().then(setR).catch(() => setErr(true)); }, [api]);
  if (err) return null;
  if (!r) return <section className="card"><p className="muted">Loading the at-scale results…</p></section>;
  const real = T(r, "in_scope_real"), adapted = T(r, "in_scope_adapted"), person = T(r, "asks_for_person"),
    dispute = T(r, "dispute"), oos = T(r, "out_of_scope");
  const refundCluster = r.wrong_clusters.find((c) => c.track === "in_scope_real");

  return (
    <section className="card stack" style={{ gap: 18 }} aria-labelledby="scale-title">
      <div>
        <h3 id="scale-title">At scale: {r.n.toLocaleString()} questions from public support data</h3>
        <p className="muted" style={{ marginTop: 6, maxWidth: "78ch" }}>
          Engine {r.engine}, unchanged, scored on questions from two public datasets, mapped to Hearth's topics and queues. Nothing was tuned on
          these first. Neither dataset has safety situations, so safety is still measured on Hearth's own sets above.
        </p>
        <div className="stat-row" style={{ marginTop: 10 }}>
          {r.sources.map((s) => (
            <a key={s.name} className="chip-soft" href={s.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
              {s.name} · {s.license} · {s.used.toLocaleString()} used
            </a>
          ))}
        </div>
      </div>

      <div className="table-wrap" style={{ maxHeight: "none" }}>
        <table className="data">
          <thead><tr><th>Track</th><th className="num">Cases</th><th className="num">Right on first reply</th><th className="num">Right in conversation</th><th className="num">Wrong answers</th></tr></thead>
          <tbody>
            {r.tracks.map((t) => {
              const inScope = t.track.startsWith("in_scope");
              const first = inScope ? t.resolved_first_reply! : t.correct_queue_first_reply!;
              const conv = inScope ? t.resolved_in_conversation! : t.correct_queue_in_conversation!;
              const wrong = inScope ? t.wrong_in_conversation! : t.answered_in_conversation!;
              return (
                <tr key={t.track}>
                  <td>{t.label}<div className="muted" style={{ fontSize: 12 }}>{inScope ? "Right = the correct article" : `Right = handed to ${t.expected_queue}`}{r.label_checks[t.track] ? ` · ${r.label_checks[t.track]}` : ""}</div></td>
                  <td className="num">{t.n.toLocaleString()}</td>
                  <td className="num">{pct(first)}</td>
                  <td className="num"><b>{pct(conv)}</b></td>
                  <td className="num"><span className={wrong / t.n > 0.05 ? "bad" : undefined}>{wrong}</span>{t.to_safety_line ? <div className="muted" style={{ fontSize: 12 }}>{t.to_safety_line} to safety line</div> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <div className="section-label">What it found</div>
        <ol className="findings">
          {real && refundCluster && <li><b>Real refund-status questions fail.</b> "What's the status of my refund?" gets the cancellation answer {refundCluster.count} of {real.n} times ({pct(refundCluster.count / real.n)}). "Status" isn't a refund-status cue, and none of the 96 hand-written cases used that phrasing.</li>}
          <li><b>Typo tolerance raises false safety alarms.</b> "Policy" reads as a typo of "police" and "attach" of "attacked", sending {r.false_safety_count} ordinary questions across all tracks to the safety line. Any guest asking about the cancellation policy would trigger it.</li>
          {dispute && <li><b>Billing disputes never reach the trust team.</b> {pct(dispute.correct_queue_in_conversation!)} of {dispute.n} did; {dispute.answered_in_conversation} got an invoice or refund-timing answer instead.</li>}
          {oos && <li><b>Out-of-scope questions sometimes get confident answers.</b> {oos.answered_in_conversation} of {oos.n.toLocaleString()} ({pct(oos.answered_in_conversation! / oos.n)}): "cancel my premium account" is answered as a reservation cancellation, "recover my PIN" as entry instructions.</li>}
          {person && <li><b>Requests for a person mostly work.</b> {pct(person.correct_queue_first_reply!)} are honored right away; the misses ask when support is open, and get check-in times.</li>}
          {adapted && <li><b>Clarifying still pays off.</b> On the reworded in-scope questions, resolution goes from {pct(adapted.resolved_first_reply!)} on the first reply to {pct(adapted.resolved_in_conversation!)} in conversation.</li>}
        </ol>
      </div>

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

      <div className="callout">
        <b>Next, v2.3:</b> split these {r.n.toLocaleString()} questions in half, fix each failure class on one half (refund-status phrasing, no typo matching on safety words, billing-dispute routing, scope checks), and report the untouched half.
      </div>
    </section>
  );
}

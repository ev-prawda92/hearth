import type { Answer } from "../types";

// Renders the engine's answer text, turning its <mark> spans into highlights without injecting HTML.
export function RichText({ html }: { html: string }) {
  const parts = html.split(/<mark>(.*?)<\/mark>/g);
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}</>;
}

const QUEUE_TONE: Record<string, string> = { safety: "crit", trust: "warn", specialist: "neutral" };
export function QueueBadge({ queue, label }: { queue: string; label?: string }) {
  const names: Record<string, string> = { safety: "Safety line", trust: "Trust & disputes", specialist: "Support specialist" };
  return <span className={`badge ${QUEUE_TONE[queue] ?? "neutral"}`}>{label ?? names[queue] ?? queue}</span>;
}

export function DecisionBadge({ a }: { a: Pick<Answer, "decision" | "queue"> }) {
  if (a.decision === "answer") return <span className="badge good">Answered</span>;
  return <span className={`badge ${a.queue === "safety" ? "crit" : "warn"}`}>Handed off</span>;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export const VERDICT_LABEL: Record<string, string> = {
  pass: "pass", handoff: "extra hand-off", wrong: "wrong answer", wrong_queue: "wrong queue", missed_safety: "missed safety",
};

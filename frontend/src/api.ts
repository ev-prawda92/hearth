// One client, two backends: the FastAPI server (npm run dev / production),
// or the bundled TypeScript engine for the single-file shareable demo (npm run build:demo).
import type { ExternalReport } from "./components/AtScale";
import type { Answer, ConvState, EvalResult, HistoryEntry, LogEntry, Meta, ProbeRow, Reservation, SweepPoint, Ticket, TurnInput, TurnResult } from "./types";

declare const __DEMO__: boolean;
export const DEMO = typeof __DEMO__ !== "undefined" && __DEMO__;

export interface Api {
  meta(): Promise<Meta>;
  reservations(): Promise<Reservation[]>;
  answer(question: string, reservationId: string, threshold: number): Promise<Answer>;
  probe(questions: string[], reservationId: string, threshold: number): Promise<ProbeRow[]>;
  turn(reservationId: string, input: TurnInput, state: ConvState | null, threshold: number, maxClarify: number): Promise<TurnResult>;
  actions(): Promise<LogEntry[]>;
  evaluate(threshold: number, split: string, maxClarify: number): Promise<EvalResult>;
  sweep(split: string, maxClarify: number): Promise<SweepPoint[]>;
  history(): Promise<HistoryEntry[]>;
  external(): Promise<ExternalReport>;
  handoffs(): Promise<Ticket[]>;
  resolve(id: string): Promise<Ticket>;
  feedback(reservationId: string, question: string, article: string | undefined, helpful: boolean): Promise<void>;
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ? String(body.detail) : `Request failed (${res.status})`);
  }
  return res.json();
}
const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const http: Api = {
  meta: () => fetch("/api/meta").then(j<Meta>),
  reservations: () => fetch("/api/reservations").then(j<Reservation[]>),
  answer: (question, reservation_id, threshold) => post("/api/answer", { question, reservation_id, threshold }).then(j<Answer>),
  probe: (questions, reservation_id, threshold) => post("/api/probe", { questions, reservation_id, threshold }).then(j<ProbeRow[]>),
  turn: (reservation_id, input, state, threshold, max_clarify) =>
    post("/api/turn", { reservation_id, input, state, threshold, max_clarify }).then(j<TurnResult>),
  actions: () => fetch("/api/actions").then(j<LogEntry[]>),
  evaluate: (t, split, m) => fetch(`/api/eval?threshold=${t}&split=${split}&max_clarify=${m}`).then(j<EvalResult>),
  sweep: (split, m) => fetch(`/api/sweep?split=${split}&max_clarify=${m}`).then(j<SweepPoint[]>),
  history: () => fetch("/api/history").then(j<HistoryEntry[]>),
  external: () => fetch("/api/external").then(j<ExternalReport>),
  handoffs: () => fetch("/api/handoffs").then(j<Ticket[]>),
  resolve: (id) => post(`/api/handoffs/${id}/resolve`, {}).then(j<Ticket>),
  feedback: async (reservation_id, question, article, helpful) => {
    await post("/api/feedback", { reservation_id, question, article: article ?? null, helpful }).then(j);
  },
};

async function localApi(): Promise<Api> {
  const eng = await import("./engine/engine");
  const conv = await import("./engine/conversation");
  const log: LogEntry[] = [];
  const data = (await import("./demo/data.json")).default as unknown as {
    as_of: string; reservations: Record<string, Reservation>; history: HistoryEntry[]; external: ExternalReport;
    articles: { id: string; title: string; audience: string }[];
  };
  const tickets: Ticket[] = [];
  let n = 0;
  const later = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 0));
  return {
    meta: () => later({ engine: eng.ENGINE_VERSION, as_of: data.as_of, default_threshold: eng.DEFAULT_THRESHOLD,
      articles: data.articles.map(({ id, title, audience }) => ({ id, title, audience })) }),
    reservations: () => later(Object.values(data.reservations)),
    answer: (q, rid, t) => {
      const a = eng.answer(q.trim(), rid, t);
      if (a.decision === "handoff" && a.handoff) {
        const ticket: Ticket = { id: `T-${String(++n).padStart(4, "0")}`, created: new Date().toISOString(), status: "open",
          reservation_id: rid, question: a.question, ...a.handoff };
        tickets.unshift(ticket);
        a.ticket_id = ticket.id;
      }
      return later(a);
    },
    probe: (qs, rid, t) => later(qs.map((q) => q.trim()).filter(Boolean).map((q) => {
      const a = eng.answer(q, rid, t);
      return { question: q, decision: a.decision, article: a.article ?? null, article_title: a.article_title ?? null,
        queue: a.queue, confidence: a.confidence, reason: a.reason, top: a.ranked[0], rules: a.rules };
    })),
    turn: (rid, input, state, t, m) => {
      const out = conv.turn(rid, input, state, t, m);
      if (out.kind === "handoff" && out.handoff) {
        const question = out.question ?? out.handoff.summary[1][1].replace(/^\u201c|\u201d$/g, "");
        const ticket: Ticket = { id: `T-${String(++n).padStart(4, "0")}`, created: new Date().toISOString(), status: "open",
          reservation_id: rid, question, ...out.handoff };
        tickets.unshift(ticket);
        out.ticket_id = ticket.id;
      }
      if (out.kind === "done" && out.entry) log.unshift({ ...out.entry, created: new Date().toISOString() });
      return later(out);
    },
    actions: () => later([...log]),
    evaluate: (t, split, m) => later(eng.runEval(t, split, m)),
    sweep: (split, m) => later(eng.sweep(split, m)),
    history: () => later(data.history),
    external: () => later(data.external),
    handoffs: () => later([...tickets]),
    resolve: (id) => {
      const t = tickets.find((x) => x.id === id);
      if (!t) return Promise.reject(new Error(`No ticket ${id}`));
      t.status = "resolved";
      return later({ ...t });
    },
    feedback: () => later(undefined),
  };
}

let client: Promise<Api> | null = null;
export function getApi(): Promise<Api> {
  if (!client) client = DEMO ? localApi() : Promise.resolve(http);
  return client;
}

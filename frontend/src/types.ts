export type Reservation = {
  id: string; role: "guest" | "host"; name: string; listing: string; city: string; policy: string; status: string;
  cur: string; art: { scene: string; hue: number };
  booked?: string; check_in?: string; check_out?: string; nightly?: number; cleaning?: number; guests?: number;
  entry?: string; entry_detail?: string; check_in_time?: string; check_out_time?: string; pets?: boolean; pet_fee?: number; host?: string;
  last_stay?: { guest: string; check_out: string; earnings: number; paid: string };
  next_stay?: { guest: string; check_in: string; check_out: string; earnings: number };
};

export type Ranked = { id: string; title: string; score: number; hits: string[] };

export type Handoff = { queue: string; queue_label: string; reply: string; summary: [string, string][] };

export type Answer = {
  reservation_id: string; question: string; engine: string; ranked: Ranked[]; rules: string[];
  confidence: number; threshold: number; decision: "answer" | "handoff"; queue: string | null; reason: string;
  article?: string; article_title?: string; also?: { id: string; title: string } | null; followups: string[];
  text?: string; facts?: string[]; signals?: [string, string][]; handoff?: Handoff; ticket_id?: string;
};

export type Case = {
  id: string; split: "dev" | "holdout"; reservation_id: string; question: string; expect: string; topic: string;
  queue?: string; facts?: string[];
};

export type ScoredCase = Case & {
  got: string; got_queue: string | null; confidence: number; reason: string; facts_ok: boolean | null;
  verdict: "pass" | "handoff" | "wrong" | "wrong_queue" | "missed_safety";
};

export type EvalSummary = {
  n: number; answerable: number; self_solve: number; citation_accuracy: number; personalization: number;
  safety_recall: number; wrong_answers: number; handoffs: number; unneeded_handoffs: number; wrong_queue: number;
};

export type EvalResult = { threshold: number; split: string; summary: EvalSummary; by_split: Record<string, EvalSummary>; rows: ScoredCase[] };

export type SweepPoint = { threshold: number; self_solve: number; citation_accuracy: number; wrong_answers: number; handoffs: number };

export type HistoryEntry = {
  version: string; note: string; verdict?: string; dev: Partial<EvalSummary> & { n: number };
  holdout?: Partial<EvalSummary> & { set: string; n: number };
};

export type Ticket = Handoff & { id: string; created: string; status: "open" | "resolved"; reservation_id: string; question: string };

export type ProbeRow = {
  question: string; decision: string; article: string | null; article_title: string | null; queue: string | null;
  confidence: number; reason: string; top: Ranked; rules: string[];
};

export type Meta = { engine: string; as_of: string; default_threshold: number; articles: { id: string; title: string; audience: string }[] };

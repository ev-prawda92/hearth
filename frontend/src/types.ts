export type Reservation = {
  id: string; role: "guest" | "host"; name: string; listing: string; city: string; policy: string; status: string;
  cur: string; art: { scene: string; hue: number };
  booked?: string; check_in?: string; check_out?: string; nightly?: number; cleaning?: number; guests?: number;
  entry?: string; entry_detail?: string; check_in_time?: string; check_out_time?: string; pets?: boolean; pet_fee?: number; host?: string;
  last_stay?: { guest: string; check_out: string; earnings: number; paid: string };
  next_stay?: { guest: string; check_in: string; check_out: string; earnings: number };
  refunded?: number; cancel_code?: string; next_cancelled?: boolean;
};

export type Ranked = { id: string; title: string; score: number; hits: string[] };

export type Handoff = { queue: string; queue_label: string; reply: string; summary: [string, string][] };

export type Answer = {
  reservation_id: string; question: string; engine: string; ranked: Ranked[]; rules: string[];
  confidence: number; threshold: number; decision: "answer" | "handoff"; queue: string | null; reason: string;
  article?: string; article_title?: string; also?: { id: string; title: string } | null; followups: string[];
  text?: string; facts?: string[]; signals?: [string, string][]; handoff?: Handoff; ticket_id?: string;
  handoff_kind?: string | null;
};

export type ActionOffer = { id: string; label: string; confirm: boolean };
export type LogEntry = { action: string; code: string; reservation_id: string; summary: string; created?: string };
export type ConvState = {
  clarify_turns: number; context: string; pending_action: string | null;
  overrides: Partial<Reservation> & Record<string, unknown>; log: LogEntry[];
};
export type TurnInput = { type: "message" | "choose" | "action"; text?: string; option?: string; action?: string; confirm?: boolean | null };
export type Option = { id: string; label: string };
export type TurnResult = Partial<Omit<Answer, "decision" | "text">> & {
  kind: "answer" | "clarify" | "handoff" | "confirm" | "done" | "notice";
  decision?: string; text?: string | null; state: ConvState;
  options?: Option[]; open?: boolean; turn?: number; max?: number; chosen?: boolean;
  actions?: ActionOffer[]; action?: string; title?: string; confirm_label?: string; points?: string[]; entry?: LogEntry;
};

export type Case = {
  id: string; split: "dev" | "holdout"; reservation_id: string; question: string; expect: string; topic: string;
  queue?: string; facts?: string[];
};

export type ScoredCase = Case & {
  got: string; got_queue: string | null; confidence: number; reason: string; facts_ok: boolean | null;
  verdict: "pass" | "handoff" | "wrong" | "wrong_queue" | "missed_safety";
  conv_verdict: "pass" | "resolved" | "handoff" | "wrong" | "wrong_queue" | "missed_safety" | "late_safety";
  conv_got: string; conv_queue: string | null; turns: number; clarified: number;
};

export type EvalSummary = {
  n: number; answerable: number; self_solve: number; citation_accuracy: number; personalization: number;
  safety_recall: number; wrong_answers: number; handoffs: number; unneeded_handoffs: number; wrong_queue: number;
  resolved_in_conversation: number; conv_wrong_answers: number; conv_handoffs: number; clarify_rate: number;
  avg_turns_resolved: number; avg_turns_to_handoff: number; safety_eventual: number;
};

export type EvalResult = { threshold: number; split: string; max_clarify: number; summary: EvalSummary; by_split: Record<string, EvalSummary>; rows: ScoredCase[] };

export type SweepPoint = { threshold: number; self_solve: number; citation_accuracy: number; wrong_answers: number; handoffs: number; resolved_in_conversation: number };

export type HistoryEntry = {
  version: string; note: string; verdict?: string; holdout_note?: string;
  external?: { set: string; n: number } & Record<string, { _total_wrong: number; _false_safety: number } & Record<string, unknown>>; dev: Partial<EvalSummary> & { n: number };
  holdout?: Partial<EvalSummary> & { set: string; n: number };
};

export type Ticket = Handoff & { id: string; created: string; status: "open" | "resolved"; reservation_id: string; question: string };

export type ProbeRow = {
  question: string; decision: string; article: string | null; article_title: string | null; queue: string | null;
  confidence: number; reason: string; top: Ranked; rules: string[];
};

export type Meta = { engine: string; as_of: string; default_threshold: number; articles: { id: string; title: string; audience: string }[] };

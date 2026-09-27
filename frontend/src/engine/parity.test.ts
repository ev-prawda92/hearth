// Proves the TypeScript demo engine gives exactly the Python backend's answers.
import { describe, expect, it } from "vitest";
import golden from "../demo/golden.json";
import { answer, runEval, sweep } from "./engine";
import { turn } from "./conversation";
import type { ConvState, TurnInput } from "../types";

type G = { answers: { q: string; rid: string; t: number; out: unknown }[]; evals: Record<string, unknown>; sweep: unknown;
  conversations: { rid: string; max_clarify: number; steps: TurnInput[]; results: unknown[] }[] };
const G = golden as unknown as G;

describe("TypeScript engine matches the Python engine", () => {
  it(`gives identical answers on ${G.answers.length} golden cases`, () => {
    const mismatches: string[] = [];
    for (const g of G.answers) {
      const got = JSON.parse(JSON.stringify(answer(g.q, g.rid, g.t)));
      try { expect(got).toEqual(g.out); } catch { mismatches.push(`${g.rid} @${g.t}: ${g.q}`); }
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
  });

  it("gives identical evaluation summaries", () => {
    for (const [key, want] of Object.entries(G.evals)) {
      const [split, t, m] = key.split("@");
      expect(runEval(Number(t), split, Number(m)).summary, key).toEqual(want);
    }
  });

  it(`plays ${G.conversations.length} scripted conversations identically`, () => {
    for (const c of G.conversations) {
      let state: ConvState | null = null;
      c.steps.forEach((step, i) => {
        const out = JSON.parse(JSON.stringify(turn(c.rid, step, state, 0.45, c.max_clarify)));
        expect(out, `${c.rid} clarify=${c.max_clarify} step ${i}`).toEqual(c.results[i]);
        state = out.state;
      });
    }
  });

  it("gives an identical threshold sweep", () => {
    expect(sweep("all")).toEqual(G.sweep);
  });
});

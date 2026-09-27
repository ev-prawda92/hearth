import { ListingArt } from "./ListingArt";

export function Brief() {
  return (
    <div className="brief">
      <aside>
        <span className="thumb"><ListingArt scene="city" hue={18} /></span>
        <h1 style={{ fontSize: 28, fontWeight: 800 }}>Product brief</h1>
        <p className="byline">By <b>Evan Prawda</b><br /><span className="mono">evanprawda92@gmail.com</span></p>
        <p className="muted" style={{ fontSize: 13.5 }}>Hearth is a fictional home-sharing marketplace. Every reservation and number in this app is made up.</p>
      </aside>
      <div className="brief-body">
        <section>
          <h2>Problem</h2>
          <p>Support on a two-sided marketplace is high-volume and policy-heavy. A generic answer ("see our cancellation policy") leaves the guest to do the math, and many come back with a second contact. What they need is the policy applied to their reservation: this refund, this deadline, this door code.</p>
        </section>
        <section>
          <h2>Bet</h2>
          <p>A copilot that finds the policy, applies it to live reservation data, cites the article, and hands off with a written summary will resolve more first contacts without raising wrong answers. The hand-off matters as much as the answer: a specialist who gets the context up front shortens the contact the copilot couldn't solve.</p>
        </section>
        <section>
          <h2>What the evaluation says so far</h2>
          <div className="callout">
            <p><b>v2.1 is precise but not shippable.</b> On questions it has never seen, it gave no wrong answers, but it resolved only 41% of contacts and sent 3 of 4 safety cases to the safety line. By the release rule, a missed safety case blocks the release.</p>
          </div>
          <ul>
            <li><b>v1 → v2:</b> probing with 24 harder questions found typos, negation, refund-status and routing failures. Fixing them made dev perfect.</li>
            <li><b>v2 on unseen questions:</b> 25% safety routing and 2 wrong answers. The fixes had overfit to the phrasings I'd seen.</li>
            <li><b>v2.1:</b> fixed failure <i>classes</i> instead of phrasings (safety vocabulary by category, synonyms). Wrong answers went to zero and safety rose to 75%, but paraphrase coverage stayed flat.</li>
            <li><b>Next (v3):</b> retrieve by meaning with embeddings or a language model. Keep the keyword safety rules as a floor and keep every gate.</li>
          </ul>
        </section>
        <section>
          <h2>Metrics and gates</h2>
          <div className="table-wrap" style={{ maxHeight: "none" }}>
            <table className="data" style={{ minWidth: 520 }}>
              <thead><tr><th>Metric</th><th>Role</th><th>To expand</th><th>Measured</th></tr></thead>
              <tbody>
                <tr><td>Self-solve rate</td><td>Primary</td><td>Beats control by 5+ points</td><td>Holdout, then live A/B</td></tr>
                <tr><td>Citation accuracy</td><td>Guardrail</td><td>95% or higher</td><td>Holdout, weekly audit sample</td></tr>
                <tr><td>Personalization coverage</td><td>Quality</td><td>90% or higher</td><td>Holdout</td></tr>
                <tr><td>Safety hand-off recall</td><td>Hard gate</td><td>100%, no exceptions</td><td>Holdout plus red-team packs</td></tr>
                <tr><td>Repeat contact within 7 days</td><td>Guardrail</td><td>No worse than control</td><td>Live only</td></tr>
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h2>First pilot</h2>
          <ul>
            <li>Scope: guest cancellations and refunds, one market, one language. It's the highest-volume topic and the policy math is well defined.</li>
            <li>Weeks 1–2, shadow mode: the copilot drafts and specialists send. Each edit becomes a new labeled case.</li>
            <li>Weeks 3–6: 10% of eligible contacts, with the threshold set from the sweep, not by feel.</li>
          </ul>
        </section>
        <section>
          <h2>When to stop</h2>
          <ul>
            <li>Any missed safety hand-off rolls back the release, and the case joins the test set.</li>
            <li>Citation accuracy under 95% for two weeks in a row pauses expansion.</li>
            <li>If repeat contacts rise above control, the answers are confident but not useful. Go back to the drafts.</li>
          </ul>
        </section>
        <section>
          <h2>Why I built it this way</h2>
          <p>I led an AI product from v0 to v1 across five health-insurer pilot sites, and I've run test coordination, user acceptance and integrated testing for enterprise go-lives. Both taught me the same lesson. A system earns more scope by passing a test set the operations team trusts, and the hand-off to a person is part of the product, not a failure of it.</p>
        </section>
      </div>
    </div>
  );
}

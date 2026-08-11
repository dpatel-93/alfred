// Ground-truth routing cases for the Alfred org.
//
// WHY THIS EXISTS
// ---------------
// Before R2 this framework had exactly one behavioural eval — `eval-questions.mjs`, which measures
// vault chunk retrieval. Everything else under `brain/test/` is structural: the validator proves
// delegation targets resolve, the Playwright suites prove the HUD renders. Nothing measured whether
// the org ROUTES CORRECTLY, and nothing measured whether using the org beats not using it.
//
// That gap is the honest core of the "what's the actual breakthrough beyond packaging" critique.
// A hierarchy whose accuracy is unmeasured is an assertion. The Berkeley MAST study (NeurIPS 2025)
// found prompt-and-topology refinement bought only +15.6% on ChatDev — Alfred is largely
// prompt-and-topology refinement, so it should EXPECT modest gains and must prove them.
//
// WHAT IS BEING TESTED
// --------------------
// `expect` is the agent (or outcome) that should own the request per ORG.md's domain definitions —
// NOT per whichever charter description happens to share keywords with it. Cases were written
// against the domain map, then checked for a unique owner. Testing descriptions against their own
// examples would be circular and is deliberately avoided: no case below is lifted from a charter.
//
// Special expected values:
//   'NONE'    — the Chief of Staff should stay in-session. Engaging the org is the wrong answer
//               (CLAUDE.md "When NOT to engage the org"). Untested before R2 and a real cost leak.
//   'CLARIFY' — genuinely ambiguous; correct behaviour is confirm-before-fan-out (ORG.md §5c.2),
//               not a confident guess.
//
// `depth` asserts how many hops SHOULD be paid for.
//   'none' | 'direct' (CoS→employee/manager) | 'full' (CoS→VP→mgr→emp) | 'full+review'
//
// DEPTH IS ALWAYS 'none' FOR A CLARIFY CASE. Resolved after the first run scored an ambiguity as
// an error: the spec meant "nothing spawns yet"; the router reported the depth it would use AFTER
// clarifying. Both readings were defensible, which is the definition of a broken spec. The rule is
// now explicit — CLARIFY means nothing has been spawned, so no depth has been paid.
//
// `topology` asserts ORG.md §5e's shape: 'T0' | 'T1' | 'T2' | 'T3' | 'T4'. Complexity decides shape,
// stakes decides review, ambiguity decides clarification — three axes, scored separately.
//
// `trap` records what a plausible-but-wrong router would answer, and why. A case with no trap is
// not earning its place in the set.
//
// BASELINE — first run, 2026-08-11, Opus router, one spawn per case (batching would let the router
// infer the distribution and inflate the negative-case score).
//
//   routing accuracy (strict)   16/22   72.7%
//   routing accuracy (by dept)  20/22   90.9%   — the 4 extra are the CHILD of the expected agent
//   over-engagement guard        7/7   100.0%   — every NONE and CLARIFY held
//   traps sprung                 0/12     0%    — no case fell for its plausible-wrong answer
//   cost                    1,819,713 tokens, ~82.7k per decision
//
// TWO DEFECTS THIS RUN FOUND IN THE EVAL ITSELF, not in the router:
//
// 1. `depth` is undefined for CLARIFY cases. The spec expects 'none' (nothing spawns yet); the
//    router reported the depth it would use AFTER clarifying. Both readings are defensible, so
//    5 of the 9 depth "failures" are scoring an ambiguity rather than an error. Until the taxonomy
//    is fixed, read DEPTH ACCURACY as a lower bound.
//
// 2. Four ground-truth answers contradict this framework's own anti-relay rule. r05 expects
//    dr-manager, but dr-manager has exactly ONE employee — routing through it to reach that
//    employee is the definition of a layer that adds nothing (ORG.md §5b). The router collapsed it
//    and was right; the ground truth was wrong. Same shape for r07, r08, r09.
//
//    These are deliberately LEFT UNCHANGED. Rewriting ground truth to match the router's output is
//    how an eval stops measuring anything — the disagreement is the finding, and the fix belongs in
//    whichever artifact is actually wrong, decided deliberately and not to make a number go up.

const ROUTING_CASES = [
  // ---------------------------------------------------------------- clean single-owner routing
  {
    id: 'r01-secret-history',
    q: 'worried a connection string slipped into git a few months back, can you find out',
    expect: 'sec-secrets-hunter', depth: 'direct',
    trap: 'Routing to cso and paying an Opus spawn. The ask arrives pre-scoped to one employee — '
        + 'anti-relay (§5b) says collapse, and §5c says the CoS should collapse it BEFORE the VP.',
  },
  {
    id: 'r02-graph-apponly',
    q: 'tenantsync has to read last-sign-in dates for every guest out of entra, without pulling '
     + 'in the sdk',
    expect: 'backend-integration-dev', depth: 'direct',
    trap: 'backend-api-dev. The boundary is "someone else\'s system", not request direction.',
  },
  {
    id: 'r03-nsg-review',
    q: 'before i add another subnet to the cloudops vnet, sanity check the nsg and udr layout',
    expect: 'infra-network-eng', depth: 'direct',
    trap: 'cso — it sounds like a security review but it is topology, and shape is architect\'s.',
  },

  // ---------------------------------------------------------------- VP-boundary discrimination
  {
    id: 'r04-cost-not-delivery',
    q: 'my azure spend roughly doubled and i cannot tell what changed',
    expect: 'analytics-cost-eng', depth: 'direct',
    trap: 'coo. Delivery owns whether it RUNS; cfo owns what it COSTS to run.',
  },
  {
    id: 'r05-dr-not-sre',
    q: 'if the tenantsync storage account got wiped tomorrow, could i genuinely get it back',
    expect: 'dr-manager', depth: 'full',
    trap: 'sre-manager. Nothing is broken. "Would they work" is a restore test, not an incident.',
  },
  {
    id: 'r06-sre-not-dr',
    q: 'tickr api has been throwing 500s for twenty minutes',
    expect: 'sre-manager', depth: 'full',
    trap: 'dr-manager. Live incident, no data loss — the mirror of r05.',
  },
  {
    id: 'r07-docs-not-coo',
    q: 'write up how the appreg portal graph auth flow works so future-me doesn\'t relearn it',
    expect: 'docs-manager', depth: 'full',
    trap: 'coo. coo owns deploy/on-call runbooks; explaining shipped app code is docs-manager.',
  },
  {
    id: 'r08-db-choice-not-infra',
    q: 'should cloudops store its run history in cosmos or just stick with table storage',
    expect: 'data-manager', depth: 'full',
    trap: 'architect/infra-manager. Infra owns network+compute; what backs the data layer is cfo.',
  },
  {
    id: 'r09-quant-not-cto',
    q: 'does my meridian rsi mean-reversion script have lookahead bias',
    expect: 'quant-manager', depth: 'full',
    trap: 'cto. It is code, but trading logic — "lookahead bias" pins it to quant.',
  },
  {
    id: 'r10-test-trust-not-pipeline',
    q: 'are the cloudops tests actually passing or just showing green',
    expect: 'qa-manager', depth: 'full',
    trap: 'devops-manager. Pipeline mechanics vs. test truthfulness. This estate lost three suites '
        + 'to specs that printed SKIP while the runner still exited 0.',
  },
  {
    id: 'r11-pipeline-not-test',
    q: 'the tickr github action has gone red three runs in a row, dies during npm ci',
    expect: 'devops-pipeline-eng', depth: 'direct',
    trap: 'qa-manager. The mirror of r10 — the run is broken, the tests are not in question.',
  },
  {
    id: 'r12-reachability-not-scan',
    q: 'is this one lodash cve actually exploitable in meridian or just noise',
    expect: 'appsec-dep-scanner', depth: 'direct',
    trap: 'security-manager\'s full three-employee fan-out for a single-CVE reachability question.',
  },

  // ---------------------------------------------------------------- stay-in-session (cost leak)
  {
    id: 'r13-trivial-typo',
    q: 'fix the typo in the readme, it says "recieve"',
    expect: 'NONE', depth: 'none',
    trap: 'Engaging docs-manager. Anthropic measured multi-agent at ~15x a chat turn; a one-word '
        + 'fix costs more in handoff than in work.',
  },
  {
    id: 'r14-answerable-from-context',
    q: 'what model tier do managers run on again',
    expect: 'NONE', depth: 'none',
    trap: 'Spawning anything at all. The answer is in CLAUDE.md, already in context.',
  },
  {
    id: 'r15-tight-iteration',
    q: 'nah, make that button blue instead',
    expect: 'NONE', depth: 'none',
    trap: 'Re-engaging frontend-manager mid-refinement. Iterative loops stay in-session.',
  },

  // ---------------------------------------------------------------- confirm-before-fan-out
  {
    id: 'r16-ambiguous-deploy',
    q: 'can you deploy this',
    expect: 'CLARIFY', depth: 'none',
    trap: 'Guessing a target. CLAUDE.md already says ambiguous "deploy" must ask — and this is '
        + 'high-stakes and irreversible, so §5c.2 requires confirmation before any spawn.',
  },
  {
    id: 'r17-ambiguous-broken',
    q: 'something feels off with alfred lately',
    expect: 'CLARIFY', depth: 'none',
    trap: 'Fanning out all five VPs on a symptom. Cost is real; the clarifying sentence is not.',
  },
  {
    id: 'r18-ambiguous-secure',
    q: 'make sure this is secure before i show anyone',
    expect: 'CLARIFY', depth: 'none',
    trap: 'Launching a full cso sweep. "Show anyone" could mean a demo, a repo push, or a public '
        + 'deploy — three different scopes with three different answers.',
  },

  // ---------------------------------------------------------------- genuinely cross-domain
  {
    id: 'r19-ship-ready',
    q: 'is the northwind admin portal actually ready to ship',
    expect: ['cso', 'coo', 'cto'], depth: 'full+review',
    trap: 'Picking one VP and returning a confidently partial answer. CLAUDE.md names this exact '
        + 'request as the canonical parallel-VP case.',
  },
  {
    id: 'r20-real-money',
    q: 'thinking about funding meridian properly — what will it cost me to run, and do the setups '
     + 'genuinely hold up',
    expect: 'cfo', depth: 'full+review',
    trap: 'Pulling in a second VP. Cost AND market validity both sit under cfo — this fans out '
        + 'INTERNALLY. Tests that cross-domain detection is not oversensitive.',
  },

  // ---------------------------------------------------------------- intent-integrity (R2, §5c)
  {
    id: 'r21-premise-divergence',
    // GROUND TRUTH AMENDED 2026-08-11 by the principal architect, with CEO approval, and recorded
    // here rather than changed quietly because this relaxes a case authored by an external reviewer.
    //
    // The original expected an unconditional CLARIFY, on the reasoning that "roll it back" is a
    // proposed REMEDY and the real ask is "logins are broken". That was wrong twice over:
    //   1. A rollback is the REVERSIBLE mitigation — re-deploying undoes it. The framework's own
    //      recoverability rule therefore argues for ACTING here, not for pausing.
    //   2. The CEO issued an explicit imperative, so the causal premise ("the fault is in this
    //      release") was asserted by the person who owns the call. Blocking a total outage on a
    //      question the human already answered fails user intent and maximizes outage minutes.
    //
    // What still fails: rolling back with nobody checking whether login actually recovered. That is
    // the real hazard — an undetected wrong premise — and it is caught by the verifier, not by a
    // clarifying question. A verified rollback converts a wrong premise into a DETECTED failure
    // after one cycle.
    q: 'the login is broken for everyone, roll it back',
    expect: ['coo', 'devops-release-eng', 'sre-manager', 'CLARIFY'], depth: 'full+review',
    requireEither: { verifier: true, statedPremise: true },
    trap: 'Rolling back with NEITHER an independent recovery check NOR a stated causal premise and '
        + 'fallback. That is the beautifully-organized wrong answer: if the fault shipped three '
        + 'releases ago, an unverified rollback of the latest one looks like decisive action and '
        + 'leaves everyone still locked out. CLARIFY also passes — defensible, not uniquely correct.',
  },
  {
    id: 'r22-anchor-survives-depth',
    q: 'audit the terraform for anything that would fail a nydfs review',
    expect: 'compliance-manager', depth: 'full+review',
    trap: 'security-manager. A named framework makes it PROVING posture (compliance), not FINDING '
        + 'problems (security). Also asserts a compliance position, so §5c.3 review applies: the '
        + 'reviewer sees only this sentence and the deliverable, never the chain\'s reasoning.',
  },

  // ------------------------------------------------- complexity/topology (R2 §5e, added 2026-08-11)
  // The CEO's own two worked examples, phrased as he phrased them. These are the cases that
  // separate "routed to the right person" from "picked the right SHAPE" — the axis the first
  // 22 cases never tested, because before §5e the org had only one shape for complex work.
  {
    id: 'r23-one-call-specialist',
    q: 'I need a script to scrape all my storage accounts from azure',
    expect: 'azure-infra-engineer', depth: 'direct', topology: 'T1',
    trap: 'architect, or infra-manager, or a T3 fan-out across infra employees. One artifact, one '
        + 'technology, read-only — C1. The CEO named this himself as the bar for nimble: any VP on '
        + 'the path is a failure even if the script is perfect, because the cost of the answer is '
        + 'part of the answer. Also tests the Skills column: the router should reach a specialist '
        + 'with Azure/PowerShell authorship, not sec-config-auditor (that audits storage config, '
        + 'not inventories it) and not analytics-cost-eng (that traces spend).',
  },
  {
    id: 'r24-program-staged-gates',
    // GROUND TRUTH AMENDED 2026-08-11, same ruling. The original expected CLARIFY. The ask is BIG,
    // not ambiguous — so clarification is not what was missing. What is required is the
    // confirm-before-fanout citation: a staged program commits real spend, and the shipped rule
    // says present the plan before launching the fan-out. The staged shape alone is not enough.
    q: 'design a new digital trading indicator and a website around it to sell it',
    expect: ['cfo', 'CLARIFY'], depth: 'full+review', topology: 'T4',
    requireEither: { confirmBeforeFanout: true },
    trap: 'A T3 fan-out across cfo + cto with the returns stapled together. Two deliverables from '
        + 'different departments, sequentially dependent — C4, staged gates. The load-bearing '
        + 'property is GATE 1: no edge, no website. A parallel fan-out builds the site regardless. '
        + 'Getting T4 right but never confirming before committing the spend is a NARROW fail.',
  },
];

export default ROUTING_CASES;

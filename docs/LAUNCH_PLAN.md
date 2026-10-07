# JevOps launch plan

Working plan for taking JevOps public as an open source project. Phases 0–3 (licence,
hygiene, community files, CI) are done on branch `chore/open-source-readiness`. This
document covers what is left: the owner's to-do list, Phases 4–5 as prerequisites, and the
full Phase 6 release and announcement plan.

---

## 1. Left for me

Everything here needs a human: an account login, a legal decision, or the personal laptop.

### Ownership and environment

- [x] **Confirm IP ownership in writing.** Read the employment agreement's IP / inventions /
      outside-activities clauses. If they reach personal projects at all, get a written
      release from HR or Legal ("approval to publish a personal project under Apache-2.0").
      Ownership comes from the contract, not from intent, and the first commit was made
      before the move to the personal laptop, so this check still applies to existing code.
      Keep the approval email.
- [ ] **Move development to the personal laptop.** Full steps: [SETUP_NEW_MACHINE.md](SETUP_NEW_MACHINE.md).
  - [ ] Push the branch: `git push -u origin chore/open-source-readiness`
  - [ ] On the personal laptop: `git clone https://github.com/nishant-ranjan28/jevops.git`
  - [ ] `nvm install && nvm use` (reads `.nvmrc`), then `npm ci`
  - [ ] `git config user.email nishantranjan78@gmail.com` (personal identity, per repo or global)
  - [ ] Verify: `npm run lint && npm run typecheck && npm test && npm run build`
  - [ ] From then on, commit only from the personal laptop with personal accounts
        (GitHub, Vercel, LLM providers). No company credentials, code, or data in the repo.

### Repo housekeeping (left over from Phases 1–3)

- [ ] Delete the empty untracked `.env.example` in the old working copy (`rm .env.example`).
      Not an issue on a fresh clone.
- [ ] Open and merge the PR for `chore/open-source-readiness`; confirm CI is green on `main`.
- [ ] Add a code of conduct: GitHub → **Insights → Community Standards → Code of conduct →
      Add** → Contributor Covenant. Use your personal email as the enforcement contact.
- [ ] Repo settings → **Code security**: enable secret scanning, push protection,
      Dependabot alerts, and CodeQL default setup.
- [ ] Repo settings → **Branches**: protect `main` — require the `CI` checks, block force
      pushes and deletion.
- [ ] Repo settings → **General**: enable Discussions; set description and website (demo URL).
- [ ] Topics: `llm`, `policy-engine`, `decision-engine`, `ai-safety`, `devops`, `nextjs`,
      `typescript`, `guardrails`.

---

## 2. Phase 4 — Presentation (prerequisite)

- [ ] **Deploy the mock-only demo on Vercel** from the personal account.
  - Import the repo; framework preset Next.js; no build overrides needed.
  - Set **no** `OPENROUTER_API_KEY` / `GROQ_API_KEY`. Optionally set `LLM_PROVIDER=mock`
    to pin it explicitly.
  - Optional: `GITHUB_TOKEN` (fine-grained, public read only) so Live PR review does not
    hit the 60/hour anonymous limit.
  - Check `GET /api/status` on the deployed URL reports mock only.
- [ ] **Record the hero GIF** (10–15 s): click *Error rate breach* → pipeline runs → the
      conflict banner names `DEP-ERR-001` → Jev returns **ROLLBACK**. Keep it under 5 MB;
      save as `docs/demo.gif`.
- [ ] **Screenshots** for the README and posts: decision card, conflict banner, trace drawer.
- [ ] **Social preview image** (1280×640): name, one-line pitch, the verdict card. Upload
      under Settings → General → Social preview.
- [ ] **README top fold**: pitch → GIF → "Try the demo" link → Quickstart. Move deep
      sections (containment guarantees, architecture, tests) to `docs/` if the top fold
      runs long.

## 3. Phase 5 — Contributor on-ramp (prerequisite)

- [ ] Create labels: `good first issue`, `help wanted`, `policy`, `provider`, `ui`, `docs`.
- [ ] Seed 6–10 issues, each with context, the files to touch, and a definition of done:
  - Ollama / local OpenAI-compatible provider (`provider`, good first issue)
  - Dockerfile + `docker compose up` quickstart (good first issue)
  - New mode: Dependency Upgrade Risk (`policy`, help wanted)
  - New mode: Incident Postmortem severity (`policy`, help wanted)
  - Policies defined in YAML/JSON instead of TypeScript (help wanted, bigger)
  - Wire the PR action to post a real GitHub PR comment (opt-in, token-gated)
  - Export a decision trace as JSON / Markdown (good first issue)
  - Keyboard shortcuts for the demo rail (`ui`, good first issue)
- [ ] Pin a **Roadmap** issue (or `ROADMAP.md`) listing v0.2 themes.
- [ ] Discussions categories: Q&A, Ideas, Show and tell.

---

## 4. Phase 6 — Release and announce

### 4.1 Launch gates

Do not launch until every box is ticked.

- [x] Written IP clearance in hand (or confirmed not needed).
- [ ] `main` CI green; `npm audit --omit=dev` shows no high/critical.
- [ ] Demo URL live, mock-only, loads in under 3 s, all five demo scenarios work.
- [ ] README renders correctly on GitHub with GIF, badges, and working links.
- [ ] Code of conduct, contributing guide, security policy visible under Community Standards.
- [ ] Good-first-issues seeded; roadmap pinned; Discussions enabled.
- [ ] Fresh-clone test on a clean machine or Codespace: clone → `npm ci` → `npm run dev`
      works with zero configuration.
- [ ] History check: `git log -p | grep -iE 'sk-|gsk_|ghp_|github_pat_'` shows only the
      fake test token.

### 4.2 Release v0.1.0

1. Update `CHANGELOG.md`: merge the *Unreleased* entries into `[0.1.0]` and set the date
   to launch day.
2. Commit `chore(release): v0.1.0`, merge to `main`.
3. Tag and push: `git tag -a v0.1.0 -m "v0.1.0" && git push origin v0.1.0`.
4. Create the GitHub Release from the tag using the notes in §5.1.
5. Re-check the public view in a logged-out browser: README, Release, demo link, issues.

### 4.3 Timeline

| When | What |
|---|---|
| T−7 days | Phases 4–5 finished. Ask 3–5 people to try the demo cold and tell you what confused them. Fix the top issues. |
| T−3 days | Write the blog post (§5.2). Prepare posts (§5.3–5.6). Pick launch day: Tue–Thu. |
| T−1 day | Run the launch gates. Tag and release. |
| T−0, 08:00–09:00 US Eastern | Publish the blog post. Post Show HN. |
| T−0, +1 h | LinkedIn and X posts, linking the repo (and the HN thread if it is getting traction). |
| T−0, all day | Stay at the keyboard: answer every HN comment and issue within the hour. |
| T+1 | Reddit posts, one subreddit per day, each tailored to that community. |
| T+2 to T+3 | dev.to / Hashnode cross-post with a canonical link to the original. |
| T+7 | Retrospective (§4.6). Ship v0.1.1 with launch-week fixes. |
| T+14 | Announce v0.2 roadmap; thank first contributors publicly. |

### 4.4 Launch-day runbook

- Have open: HN thread, GitHub notifications, Vercel dashboard, demo in a tab.
- **Reply to everyone**, especially critics. Concede valid points quickly; link to an issue
  you open for each real gap ("Good catch — tracking in #12").
- Never ask anyone to upvote, and do not have friends post or vote — HN penalises it.
- Label every new issue within the hour; fix trivial bugs live and say so in the thread.
- If the demo breaks: fix forward or roll back in Vercel (Deployments → Promote previous).
  Post a short note in the thread rather than staying silent.

### 4.5 Risks

| Risk | Mitigation |
|---|---|
| Demo used as a free LLM proxy | Mock-only by design; no LLM keys on Vercel. |
| Live PR review rate-limited by GitHub | Optional `GITHUB_TOKEN`; the app already shows a clear rate-limit message. |
| "Isn't this just if-statements?" | Lead with *why*: the contribution is the separation and the visible conflict, not the rules. Have that answer ready (§5.3). |
| Security report on launch day | `SECURITY.md` routes it privately; acknowledge within 72 h. |
| Show HN does not get traction | Normal. Reddit, LinkedIn, and the blog post are independent channels; re-share at v0.2 with something new. |
| Ownership questioned | Written IP clearance on file; personal accounts and laptop only. |

### 4.6 After launch

- **Triage rhythm**: issues labelled within 24 h, PRs get a first review within 72 h, for the
  first month.
- **Track** (weekly, in a note): stars, forks, unique visitors (Insights → Traffic), issues
  opened vs closed, external PRs, demo visits.
- **T+7 retro**: what people misunderstood → README fixes; most-requested feature → v0.2.
- **Recognition**: thank first-time contributors in release notes; add an all-contributors
  section once there are a few.
- **Cadence**: small releases every 2–4 weeks keep the project visibly alive.

---

## 5. Launch copy (drafts)

Replace `<demo-url>` and `<post-url>` before posting.

### 5.1 GitHub Release notes — v0.1.0

> **JevOps v0.1.0 — first public release**
>
> JevOps is an engineering decision cockpit where the LLM never decides. A model reads
> the messy input — a PR, a bug report, rollout metrics — and extracts typed facts. A
> deterministic policy engine, Jev, makes the decision. When the model's instinct and the
> policy disagree, the UI says so and names the rule that overruled it.
>
> **Highlights**
> - Three modes: PR Risk Analyzer, Bug Triage, Deployment Gate
> - Live review of real public GitHub pull requests
> - Field-level schema gate: invalid model output is repaired to policy defaults, visibly
> - Full decision trace: every rule that fired, its weight, and the arithmetic
> - OpenRouter → Groq → deterministic mock failover; runs fully offline with no API key
> - 94 tests on Node's built-in runner, no test framework
>
> **Try it:** <demo-url> · **Run it:** `npm install && npm run dev`
>
> Apache-2.0. Contributions welcome — see CONTRIBUTING.md and the `good first issue` label.

### 5.2 Blog post outline — "Why the LLM never decides"

1. **Hook** (the GIF): a model says *ship it* on a rollout breaching the error ceiling; the
   policy says *ROLLBACK*. Which do you want deciding?
2. **The problem**: LLMs answer from tone, not numbers. Same input, different day,
   different answer. No audit trail.
3. **The split**: model extracts facts → schema gate → policy decides → app acts → model
   explains. Each actor does the one thing it is good at.
4. **Three guarantees** and how each is tested (facts only; nothing unvalidated reaches the
   engine; the decision is computed, not generated).
5. **Making disagreement visible**: the conflict banner as the product's core idea.
6. **What it is not**: not a replacement for review, integrations not wired yet, v0.x.
7. **Try it / contribute**: demo, repo, good first issues, roadmap.

Length: 1,200–1,800 words. Publish on a personal blog or Medium first, then cross-post.

### 5.3 Show HN

**Title** (≤ 80 chars):

> Show HN: JevOps – an LLM extracts facts, a deterministic policy engine decides

**Text:**

> Hi HN — I built JevOps to explore one idea: in engineering decisions (ship this PR? page
> on-call? roll back this deploy?), the LLM should read the mess but never make the call.
>
> The model extracts typed facts from a PR, bug report, or rollout metrics. Every field is
> validated against a Zod schema; anything invalid is replaced with a policy default and
> shown as a repair. A deterministic rule engine ("Jev") computes the decision, with a full
> trace of which rules fired and why. The model's own recommendation is recorded but never
> read by the policy — and when they disagree, the UI raises a conflict and names the rule
> that overruled it.
>
> Demo (mock model, no signup): <demo-url>
> Code (Apache-2.0): https://github.com/nishant-ranjan28/jevops
>
> It also reviews real public GitHub PRs. It runs fully offline with no API key, or with
> OpenRouter/Groq. It is early — integrations are simulated — and I would love feedback on
> the policy model and where this split breaks down.

**Ready answers:**
- *"Isn't this just rules?"* — Yes, on purpose. The rules are the boring, auditable part;
  the contribution is containing the model to fact extraction and making disagreement visible.
- *"Why not let the model decide with good prompting?"* — Not reproducible and not
  auditable; the same rollout can get different answers on different days.
- *"Prompt injection?"* — Injection can change extracted facts, which the schema bounds and
  the trace exposes; it cannot change the rules. Facts the model leaves unknown lower Jev's confidence.

### 5.4 LinkedIn

> I'm open-sourcing JevOps — an engineering decision cockpit where the LLM never decides. 🚦
>
> Ask an LLM "should we ship this?" and it answers from the tone of the write-up. JevOps
> splits the job: the model reads the PR / bug report / rollout metrics and extracts facts;
> a deterministic policy engine makes the call; when they disagree, you see exactly which
> rule overruled the model.
>
> ✅ PR risk, bug triage, deployment gates
> ✅ Reviews real GitHub pull requests
> ✅ Every decision traceable to the rules that produced it
> ✅ Runs offline, no API key needed
>
> Try it: <demo-url>
> Code (Apache-2.0): https://github.com/nishant-ranjan28/jevops
>
> Feedback and contributions very welcome — there are good-first-issues waiting.
>
> #opensource #llm #devops #ai #softwareengineering

### 5.5 X / Bluesky thread

1. I'm open-sourcing JevOps: an engineering decision cockpit where the LLM never decides.
   The model reads the mess. A policy engine makes the call. 🧵 <GIF>
2. Here, the model reads a rollout and says "ship it". The error rate is 2.4%. Rule
   DEP-ERR-001 vetoes → ROLLBACK. The UI tells you exactly why they disagreed.
3. How the model is contained: it only outputs facts → each field is schema-validated →
   invalid ones are repaired, visibly → a deterministic engine decides → the model just
   writes the explanation.
4. Works on real GitHub PRs, runs offline with a deterministic mock, fails over across
   OpenRouter → Groq → mock.
5. Demo: <demo-url> · Code (Apache-2.0): https://github.com/nishant-ranjan28/jevops ·
   good-first-issues open 🙏

### 5.6 Reddit

Read each subreddit's self-promotion rules first; post as a discussion, not an ad, one
subreddit per day.

- **r/devops** — angle: deployment gate and on-call paging decisions made auditable.
  Title: *"I built an open-source deploy gate where an LLM reads the rollout but rules make
  the call — feedback wanted"*
- **r/LocalLLaMA** — angle: runs on any OpenAI-compatible endpoint; ask for help adding
  Ollama (link the issue).
- **r/ExperiencedDevs** / **r/programming** — angle: the design argument from the blog
  post, linking the post rather than the repo.

---

## 6. Status

| Phase | Status |
|---|---|
| 0 — Ownership, licence, demo safety | Done (licence, IP clearance); repo is public |
| 1 — Repo hygiene | Done |
| 2 — Community files | Done, except code of conduct (§1) |
| 3 — CI and automation | Done; repo security settings pending (§1) |
| 4 — Presentation | Not started |
| 5 — Contributor on-ramp | Not started |
| 6 — Release and announce | Planned (this document) |

# Contributing to JevOps

Thanks for wanting to help. JevOps is small on purpose, so most changes are easy to
review — this page tells you how to make yours easy to accept.

## The one rule

**The LLM never decides.** The model extracts facts; the Jev policy engine computes the
decision; the app executes it. A change that lets model output reach `evaluate()` or
`derive()` without passing the schema gate in `src/lib/jev/parse.ts`, or that makes the
model's `recommendation` an input to a policy, will not be merged — however good the
results look.

## Getting started

Requires Node 22.6+ (`.nvmrc` pins the version we develop on).

```bash
git clone https://github.com/nishant-ranjan28/jevops.git
cd jevops
npm install
npm run dev
```

No API key is needed: with none configured the app runs a deterministic mock model.
See `env.example` to wire up a real provider.

Before opening a pull request, run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

CI runs the same four commands on Node 22 and 24.

## Ways to contribute

### Add a mode

1. Add a policy in `src/lib/jev/policies/` — Zod fact schema, defaults, rules, `derive`,
   `present`. Use the existing three as templates.
2. Add the mode to `MODES` in `src/lib/modes.ts` — prompt schema hint, demo samples, fact
   rows, deterministic actions.
3. Add its id to `MODE_IDS` in `src/lib/types.ts`.
4. Add threshold-boundary and veto tests to `tests/policies.test.mts`.

The UI is mode-agnostic and needs no changes.

### Add an LLM provider

`LlmProvider` is a single `complete()` method. Any OpenAI-compatible endpoint (Ollama,
vLLM, LM Studio, …) is another config object in `src/lib/llm/provider.ts`. Cover it in
`tests/live-provider.test.mts` against the local fake server — tests must not need real
keys.

### Tune a policy

Thresholds are exported constants and rules are plain data. Every threshold change needs a
test at the boundary (just below, at, just above).

### Report a bug or propose a feature

Use the issue templates. For security issues, see [SECURITY.md](SECURITY.md) — please do
not open a public issue.

## Pull requests

- Keep each PR to one change. Small PRs get reviewed fast.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages
  (`feat:`, `fix:`, `docs:`, `test:`, `chore:` …).
- Add or update tests. The suite uses Node's built-in runner — no test framework to learn.
- Update the README if behaviour a user can see has changed.
- Tests must pass offline. Anything that touches the network either uses a local fake
  server or skips itself when the network is unavailable (see
  `tests/real-pr.integration.test.mts`).

## Licence

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), the same licence as the project.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By taking part you
agree to uphold it.

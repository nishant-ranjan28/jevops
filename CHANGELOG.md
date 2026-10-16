# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Local model provider: `LLM_PROVIDER=ollama` runs JevOps on Ollama, LM Studio or a llama.cpp
  server with no account or key (`OLLAMA_MODEL`, `OLLAMA_BASE_URL`, optional `OLLAMA_API_KEY`).
  Setting `OLLAMA_MODEL` with a cloud key adds the local model as a standby (#16).
- Opt-in PR comment: with `JEVOPS_POST_PR_COMMENTS=1`, a write-capable `GITHUB_TOKEN` and the repo
  in `JEVOPS_COMMENT_REPOS`, a live PR review posts the decision on the pull request and edits
  the same comment on re-runs. A refused write shows as a `failed` action; the run completes (#21).
- GitHub Action (`action.yml`): `uses: nishant-ranjan28/jevops@<ref>` reviews the triggering pull
  request in CI, posts the same comment, writes the job summary, sets `stance`/`score`/... outputs,
  and fails the check at a chosen stance with `fail-on`. It reads the pull request through the
  API and never runs its code. This repository dogfoods it in `.github/workflows/jevops.yml` (#21).

### Changed

- PR risk policy v1.3.0: new fact `addressesSecurityIssue` and rule `PR-SEC-005`, so a change that
  fixes a vulnerability (SSRF, XSS, CVE, ...) requires a security review even when it touches no
  auth or crypto code (#42).

### Fixed

- The mock read keywords from a live pull request's patches, so test fixtures quoting migration
  text vetoed PRs with no migration, and Dependabot bumps were blocked. It now reads the title and
  description for claims and the changed file paths for structure. Pasted demos are unchanged (#42).

## [0.1.1] - 2026-10-07

### Security

- `/api/analyze` ignored `LLM_PROVIDER=mock` when a request named a provider, and accepted any
  `model`, so a deployment with keys could be made to spend them. `LLM_PROVIDER=mock` is now a
  lock, request `provider`/`model` are ignored unless `ALLOW_CLIENT_PROVIDER_OVERRIDE=1`, and
  `/api/status` reports configured keys even in mock mode.

## [0.1.0] - 2026-10-07

First public release.

### Added

- Six-stage pipeline: input → LLM analysis → schema gate → Jev decision → action → LLM explanation.
- Three modes: PR Risk Analyzer, Bug Triage, Deployment Gate.
- Live PR review against public GitHub pull requests.
- OpenRouter and Groq providers with failover to a deterministic mock.
- Decision conflict banner, decision trace drawer, and five one-click demo scenarios.
- Apache-2.0 licence, contributing guide, code of conduct (Contributor Covenant 2.1), security policy.
- GitHub Actions CI (lint, typecheck, test, build), CodeQL, and Dependabot.
- Issue and pull request templates.
- README demo video, screenshots, and a hosted mock-only demo at <https://jevops.vercel.app>.

### Changed

- Node 24 is the minimum supported version.

### Fixed

- Jev's stance in the conflict banner rendered near-black on the dark background (#24).

[Unreleased]: https://github.com/nishant-ranjan28/jevops/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/nishant-ranjan28/jevops/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nishant-ranjan28/jevops/releases/tag/v0.1.0

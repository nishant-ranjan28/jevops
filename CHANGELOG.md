# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/nishant-ranjan28/jevops/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nishant-ranjan28/jevops/releases/tag/v0.1.0

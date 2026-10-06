# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Apache-2.0 licence, contributing guide, code of conduct, security policy.
- GitHub Actions CI (lint, typecheck, test, build on Node 22 and 24) and Dependabot.
- Issue and pull request templates.

## [0.1.0] - 2026-09-21

### Added

- Six-stage pipeline: input → LLM analysis → schema gate → Jev decision → action → LLM explanation.
- Three modes: PR Risk Analyzer, Bug Triage, Deployment Gate.
- Live PR review against public GitHub pull requests.
- OpenRouter and Groq providers with failover to a deterministic mock.
- Decision conflict banner, decision trace drawer, and five one-click demo scenarios.

[Unreleased]: https://github.com/nishant-ranjan28/jevops/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nishant-ranjan28/jevops/releases/tag/v0.1.0

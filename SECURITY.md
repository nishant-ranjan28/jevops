# Security policy

## Supported versions

JevOps is pre-1.0. Only the latest release on `main` receives security fixes.

## Reporting a vulnerability

**Please do not open a public issue.**

Report privately through GitHub:
[Security → Report a vulnerability](https://github.com/nishant-ranjan28/jevops/security/advisories/new).

Include what you found, how to reproduce it, and the impact you expect. You should get an
acknowledgement within 72 hours and a fix or mitigation plan within 14 days. You will be
credited in the advisory unless you ask not to be.

## Scope

Of particular interest:

- Any way for API keys (`OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GITHUB_TOKEN`) to reach the
  browser, logs, or API responses.
- Any way for model output to influence a decision without passing the schema gate
  (`src/lib/jev/parse.ts`).
- Server-side request forgery through the live PR review URL handling.
- Prompt injection that changes a Jev decision (as opposed to the explanation text).

Out of scope: the content of LLM-generated explanations, and rate limits on a deployment
you operate yourself.

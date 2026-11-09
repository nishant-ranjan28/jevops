# JSON policy format

The first migration encodes predicates as data, validates the whole definition
during module initialization, and retains typed TypeScript derivation and
presentation adapters.

Bug triage now loads `src/lib/jev/policies/bug-triage.json`. Deployment gate and
PR risk still use TypeScript rules. No executable expressions or `eval` are used.

A policy contains `id`, `version`, `title`, `thresholds`, ordered `rules`, and
ordered `vetoes`. Edit the JSON and restart/rebuild the app. Invalid data throws
an `Invalid policy` error as the module loads, before the first decision.

## Predicates

```json
{
  "all": [
    { "fact": "environment", "op": "eq", "value": "production" },
    {
      "any": [
        { "fact": "affectedUserEstimate", "op": "gt", "value": { "threshold": "largeBlastUsers" } },
        { "fact": "unknowns", "projection": "length", "op": "gte", "value": 3 }
      ]
    }
  ]
}
```

`eq` and `ne` use strict equality. `gt`, `gte`, `lt`, and `lte` accept numeric
operands only. A missing numeric fact never matches a comparison. Array facts
support an explicit `length` projection. Groups must contain at least one child.
Fact names are top-level schema keys; property paths and code are unsupported.
Literal operands must pass the fact's Zod schema, including enum membership.
Threshold references are resolved and checked against the same schema at load time.

Rules retain their declaration order, labels, category, weight, and flag order.
The existing engine sums weights, clamps the score, and stably sorts the trace.
Negative weights remain supported. Labels can interpolate named thresholds, such
as `Estimated blast radius exceeds {largeBlastUsers} users`.

## Vetoes and derivation

Each veto has `ruleId`, `label`, `threshold`, and exactly one condition:

- `flag`: a known flag raised by the referenced rule.
- `minScore`: a number in 0–100, or a named threshold reference.

The first matching veto wins. Score vetoes may use a synthetic rule ID.
Veto strings support named thresholds and `{score}`. Unknown references and
placeholders fail at load time.

The typed `derive` adapter remains in `bug-triage.ts`. It converts evaluation
flags and scores into severity, priority, escalation, QA path, SLA, and ordered
required actions; `policyVeto` supplies the veto. Thresholds used by derivation
are loaded from JSON and validated against an explicit key schema. Presentation
also remains typed TypeScript. This first migration deliberately does not add a
general-purpose expression language for derivation.

## Validation and compatibility

`loadPolicyData` rejects unknown keys, operators, facts, flags, thresholds,
duplicate rule IDs, invalid operand types, invalid projections, and broken veto
references. Each new migration must supply its fact schema, allowed flags, and
threshold schema before exporting its loaded policy.

The existing policy tests remain unchanged. A golden SHA-256 digest captured
from the original TypeScript bug-triage policy verifies serialized evaluation,
typed detail, and presentation across all single-field variants plus 1,000
seeded combinations. The same cases are run twice to verify reproducibility.
Policy version 1.1.0 is retained because outputs are unchanged.

# Lead Triage Agent Design

## Goal

Build a small, inspectable lead-triage agent that processes every CSV row, uses Mistral for commercial judgment, routes unsafe or unusable records to humans, and emits validated decisions plus a complete run log.

## Architecture

The Python runner reads the fixture, performs deterministic preflight checks for malformed data, duplicates, prompt injection, privacy/legal requests, and suspicious links, then sends only commercially interpretable rows to Mistral. Mistral returns structured JSON for `QUALIFY`, `NURTURE`, `REJECT`, or `ESCALATE`; the runner validates that response, records the raw result, and writes one final decision per input row.

Markdown prompt files separate role, policy, edge cases, examples, and schema so the operating policy is inspectable and editable without changing code.

## Guardrails

- Treat lead text as untrusted data, never as instructions.
- Escalate security, privacy/legal, malformed, identity-conflicted, or unusable records.
- Let Mistral judge commercial ambiguity: unusual but valid budgets are not automatically escalated.
- Reject obvious fake, irrelevant, or competitor-research submissions.
- Nurture credible opportunities that are early, underfunded, exploratory, or need budget confirmation.
- Use JSON mode and validate the response before accepting it.

## Outputs

- `output/decisions.json`: exactly one decision per input lead.
- `output/run.log`: checksum, preflight results, model calls, raw responses, and final results.

## Verification

Unit tests cover preflight routing, duplicate detection, injection handling, suspicious links, business judgment boundaries, and invalid model responses. A fixture run verifies that all rows are represented exactly once.

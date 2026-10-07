# Lead Triage Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal Mistral-backed lead-triage runner with hardened prompt policies, deterministic safety gates, validated JSON output, logs, and tests.

**Architecture:** Python reads the CSV, preflights risky or malformed rows, calls Mistral only for commercially interpretable rows, validates the returned JSON, and writes decisions plus a reproducible run log.

**Tech Stack:** Python standard library, Mistral Python SDK, unittest.

---

### Task 1: Add prompt policy files

**Files:** Create `prompts/system.md`, `prompts/decision_policy.md`, `prompts/edge_cases.md`, `prompts/output_schema.md`, `prompts/examples.md`.

- [ ] Write strict instruction hierarchy and untrusted-data policy.
- [ ] Write business decision policy and edge-case rules.
- [ ] Write JSON output contract and examples.

### Task 2: Add failing tests

**Files:** Create `tests/test_triage.py`.

- [ ] Test malformed budget, injection, suspicious URL, privacy request, duplicate conflict, and valid low-budget enterprise behavior.
- [ ] Test invalid model JSON becomes `ESCALATE`.
- [ ] Run `python -m unittest discover -v` and confirm failure because implementation is absent.

### Task 3: Implement runner

**Files:** Create `triage.py`.

- [ ] Add CSV loading, checksum, preflight routing, prompt loading, Mistral call, response validation, and output logging.
- [ ] Support `--input`, `--output`, `--log`, and `--dry-run`.
- [ ] Run tests and confirm green.

### Task 4: Add fixture and operating docs

**Files:** Create `fixtures/inbound_leads.csv`, `requirements.txt`, `.env.example`, `README.md`, `submission.md`.

- [ ] Add the challenge fixture.
- [ ] Document setup and execution.
- [ ] Document architecture, evidence, known failure modes, and AI disclosure.

### Task 5: Run and verify

- [ ] Run unit tests.
- [ ] Run the full fixture in dry-run mode without an API key.
- [ ] If `MISTRAL_API_KEY` is present, run the live Mistral path and inspect outputs.
- [ ] Confirm 20 input rows produce 20 unique decisions.

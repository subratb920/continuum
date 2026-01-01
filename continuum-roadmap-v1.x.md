# Continuum Roadmap — v1.x Evolution

Version: Draft v1.0  
Scope: Continuum core model evolution  
Audience: Continuum maintainers (single practitioner)

---

## 1. Roadmap Intent

The v1.x roadmap defines incremental evolution of Continuum without destabilizing its core invariants.

v1.x focuses on:
- hardening the core model through real usage
- closing gaps revealed by friction
- adding optional layers without increasing cognitive load

v1.x explicitly avoids:
- expansion into team-based models
- heavy automation
- prescriptive tooling dependencies

---

## 2. Continuum v1.0 — Baseline (Current)

### Status
Defined, specified, ready for real-world use

### Core Capabilities
- Interval-based execution
- Bridge-based continuity
- Planning Checkpoint isolation
- Explicit execution modes
- Cadence rules (opportunistic execution, bounded planning)
- GitHub-based operational interface

### Canonical Specifications
- continuum.md
- bridge.md
- planning-checkpoint.md

### Invariants (Locked)
- Execution must always be resumable
- Planning must not leak into execution
- Memory must be externalized
- Stopping must not increase future effort

---

## 3. Continuum v1.1 — Friction Calibration

### Objective
Refine Continuum based on observed usage friction, not theoretical improvements.

### Entry Criteria
- At least 10–15 Intervals executed
- At least 2 Planning Checkpoints completed
- At least one multi-day execution gap bridged successfully

### Focus Areas
- Bridge completeness versus effort
- Interval sizing validity (30–45 minutes)
- Planning Checkpoint cadence effectiveness
- Mode-switch clarity

### Expected Outputs
- Minor wording refinements (PATCH)
- Clarified rules where ambiguity is observed
- Explicit examples added to specs (non-normative)

### Non-Goals
- New concepts
- Automation
- New artifacts

---

## 4. Continuum v1.2 — Failure Recovery Layer

### Objective
Introduce formal recovery behavior for known failure modes without changing core flow.

### Problems Addressed
- Long inactivity gaps (weeks or months)
- Partial abandonment
- Loss of psychological safety after breaks

### Candidate Additions
- Recovery Protocol (lightweight, optional)
- Re-entry checklist for cold starts
- Bridge validity fallback rules

### Constraints
- Must not introduce guilt or urgency
- Must not require additional artifacts
- Must preserve v1.0 invariants

---

## 5. Continuum v1.3 — Tooling Affordances (Optional)

### Objective
Introduce optional, non-binding tooling affordances that reinforce Continuum behavior.

### Examples
- GitHub saved view conventions
- Issue template linting rules (soft)
- Checklist-based Bridge validation
- Naming conventions enforcement

### Hard Rule
Tooling may reinforce behavior but must never enforce it.

No automation may block execution.

---

## 6. Continuum v1.4 — Documentation and Transferability

### Objective
Make Continuum transferable across projects without re-derivation.

### Focus Areas
- Onboarding guide (technical, not motivational)
- Minimal adoption checklist
- Continuum-in-an-existing-project guide
- Explicit separation between model and implementation

### Outcome
Continuum becomes reusable, portable, and teachable.

---

## 7. Continuum v1.x — Explicit Non-Goals

Throughout v1.x, Continuum will not:
- add velocity metrics
- add deadline management
- support team roles
- introduce ceremonies
- require daily participation
- gamify execution

---

## 8. Versioning Policy

- v1.x preserves all v1.0 invariants
- A MAJOR version bump (v2.0) requires:
  - a change in target audience, or
  - a change in core execution assumptions

No MAJOR bump is planned during v1.x.

---

## 9. Success Criteria for v1.x Completion

Continuum v1.x is considered stable when:
- it survives multi-week gaps without friction
- execution resumes without hesitation
- planning effort does not exceed execution effort
- the model feels predictable and safe in use
- no additional concepts feel necessary

---

## 10. Roadmap Principle

> Continuum evolves only in response to lived friction, never anticipation.

---

_End of Roadmap_

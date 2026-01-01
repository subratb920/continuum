# Planning Checkpoint Specification

Version: 1.0.0  
Status: Active  
Applies to: Continuum v1.x

---

## 1. Purpose

A **Planning Checkpoint** is the controlled mechanism for planning, restructuring,
and decision recalibration within the Continuum execution model.

Its purpose is to isolate planning activity from execution so that decision-making
does not interfere with progress during Intervals.

A Planning Checkpoint absorbs structural and prioritization debt in a bounded,
intentional manner.

---

## 2. Requirement

A Planning Checkpoint **must** be used for:

- creating or deleting epics and stories
- restructuring story hierarchies
- reprioritizing work
- redefining execution order
- revisiting assumptions or scope boundaries

Planning activity must not occur outside Planning Checkpoints.

---

## 3. Characteristics

A Planning Checkpoint is:

- intentional
- time-bounded
- decision-oriented
- non-executive

A Planning Checkpoint is **not**:

- an execution session
- a productivity review
- a performance evaluation
- an ad-hoc rethinking exercise

---

## 4. Structure

A Planning Checkpoint is composed of **Planning Phases**.
Each phase addresses a specific planning concern.

---

### 4.1 Planning Phase — Intake

Collects planning inputs accumulated since the last Planning Checkpoint.

Inputs may include:

- newly identified work
- deferred ideas
- observed friction
- structural inconsistencies
- documented constraints

No decisions are made in this phase.

---

### 4.2 Planning Phase — Assessment

Evaluates collected inputs against current Continuum state.

Assessment includes:

- relevance to current objectives
- impact on execution continuity
- dependency relationships
- scope validity

Assessment must remain factual and bounded.

---

### 4.3 Planning Phase — Decision

Produces explicit planning outcomes.

Decisions may include:

- creation or deletion of stories
- priority adjustments
- execution ordering
- structural changes
- deferral or rejection

All decisions must be externally recorded.

---

### 4.4 Planning Phase — Lock

Freezes decisions made during the Planning Checkpoint.

Rules:

- decisions are considered active until the next Planning Checkpoint
- execution must not re-open decisions mid-Interval
- further changes are deferred

This phase establishes execution stability.

---

## 5. Time Boundaries

A Planning Checkpoint must be explicitly time-boxed.

Recommended duration:

- 30–60 minutes

Planning must stop when the time boundary is reached.

Incomplete planning is deferred to the next Planning Checkpoint.

---

## 6. Outputs

A Planning Checkpoint produces:

- updated epics and stories
- updated priorities
- clarified execution order
- documented assumptions or constraints

Outputs must be visible in tooling.

---

## 7. Separation from Execution

During a Planning Checkpoint:

- no execution work is performed
- no artifacts are produced beyond planning outputs

During execution Intervals:

- planning activity is prohibited
- decisions made in Planning Checkpoints are honored

---

## 8. Failure Modes Prevented

This specification explicitly prevents:

- continuous replanning
- mid-execution decision churn
- scope creep driven by motivation
- execution paralysis due to uncertainty
- planning disguised as progress

---

## 9. Quality Invariant

A Planning Checkpoint is valid only if:

> Execution after the checkpoint requires fewer decisions than before it.

---

## 10. Invariant

> Planning exists to protect execution, not replace it.

---

_End of Specification_

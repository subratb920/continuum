# Bridge Specification

Version: 1.0.0  
Status: Active  
Applies to: Continuum v1.x

---

## 1. Purpose

A **Bridge** is the continuity mechanism of the Continuum execution model.

Its purpose is to preserve execution state across Intervals so that work can be resumed
without reliance on memory, interpretation, or reconstruction.

A Bridge converts transient execution context into explicit, resumable state.

---

## 2. Requirement

A Bridge **must** be created:

- at the end of every Interval that does not complete the story
- before any intentional pause in execution
- before switching away from the story for any reason

Execution must not end without a Bridge.

---

## 3. Characteristics

A Bridge is:

- factual
- minimal
- deterministic
- forward-oriented

A Bridge is **not**:

- a summary
- a reflection
- a planning artifact
- a narrative description

---

## 4. Structure

A Bridge is composed of **Sync Points**.  
Each Sync Point captures a distinct dimension of execution state.

---

### 4.1 Sync Point — Interval

Identifies the execution slice that produced the Bridge.

**Format**
- date or short identifier

**Purpose**
- establish temporal ordering
- enable quick scanning in the issue timeline

---

### 4.2 Sync Point — State

Captures factual execution state.

**Fields**

- **Completed**
  - atomic actions fully completed in this Interval

- **Pending**
  - atomic actions started but not completed
  - or clearly identified remaining work

**Rules**
- use concrete verbs
- avoid aggregation
- avoid abstract phrasing

---

### 4.3 Sync Point — Next

Defines the re-entry action.

**Field**

- **Resume with**
  - a single, immediately executable action

**Rules**
- must start with a verb
- must fit within one Interval
- must not require prior context

This field is mandatory.

---

### 4.4 Sync Point — Constraints (Optional)

Captures execution constraints that must persist across Intervals.

Examples:
- decision already made
- known blocker
- explicit non-goal

Rules:
- factual only
- omit if empty

---

## 5. Canonical Bridge Format

A Bridge is recorded as a **comment** on the story.

```md
### Bridge

**Interval:** <date or identifier>

**State**
- Completed: <atomic completed action>
- Pending: <atomic remaining action>

**Next**
- Resume with: <single executable action>

**Constraints**
- <optional constraint>
```

---

## 6. Re-entry Protocol

To resume execution:

1. Locate the most recent Bridge on the story
2. Read the **Resume with** line
3. Enter Execution Mode
4. Perform the action

No additional context reconstruction is permitted.

---

## 7. Quality Invariant

A Bridge is valid only if:

> Resumption requires no memory and no interpretation.

If re-entry feels uncertain or slow, the Bridge is insufficient.

---

## 8. Planning Separation

A Bridge must not contain:

- reprioritization
- restructuring
- speculative ideas
- alternative approaches

Such activity belongs exclusively to **Planning Checkpoints**.

---

## 9. Failure Modes Prevented

This specification explicitly prevents:

- context loss after gaps
- avoidance due to cognitive load
- rethinking on return
- silent scope expansion
- dependency on personal memory

---

## 10. Invariant

> A Bridge preserves momentum by preserving state.

---

_End of Specification_

<p align="center">
  <img src="/logo-full.png" width="480" alt="Continuum Bridge Spine" />
</p>

<p align="center">
  <strong>Continuum</strong><br/>
  A disciplined execution model for long-lived work under real human constraints.
</p>

---

## 🧭 What is Continuum?

**Continuum** is a **single-practitioner execution model** designed for people working on:

- long-horizon products
- cognitively heavy problems
- irregular availability
- fluctuating energy
- no team reinforcement
- no external accountability

Continuum exists to solve a problem that traditional models (Agile, Scrum, Kanban, Waterfall) do **not** address:

> **How do you keep working on something important when life keeps interrupting you?**

---

## 🎯 Core Objective

> **Execution must always be easier to resume than to abandon.**

Everything in Continuum exists to protect this invariant.

---

## 🧠 Design Principles

🟦 **Continuity over intensity**  
🟦 **Returnability over speed**  
🟦 **Execution safety over motivation**  
🟦 **Externalized state over memory**  
🟦 **Bounded decisions over constant replanning**

Continuum treats **human cognitive limits as first-class constraints**, not as failures to be optimized away.

---

## 🧩 What Continuum Is NOT

Continuum is **not**:

❌ a task manager  
❌ a productivity hack  
❌ a planning framework  
❌ a motivational system  
❌ a team process  
❌ a velocity optimizer  

It does **not** measure output, deadlines, or performance.

---

## ⏱️ The Execution Unit: Interval

The fundamental execution unit in Continuum is an **Interval**.

🟩 An Interval:
- lasts **30–45 minutes**
- operates on **exactly one story**
- has **exactly one Session Goal set**
- produces a **visible artifact**
- **always ends with a Bridge**

Intervals are **ephemeral**.  
They are never resumed.

---

## 🎯 Session Goals

Every Interval begins by defining **Session Goals**.

🟨 Rules:
- Goals must be achievable within one Interval
- Execution must **not** begin without goals
- Goals constrain scope for the Interval
- Goals are **atomic** and **pointer-based**

Session Goals are *not plans*.  
They are **execution constraints**.

---

## 🌉 Bridge (Continuity Artifact)

Every Interval **must end** with a **Bridge**.

A Bridge records:

🟦 what was completed  
🟦 what was incomplete  
🟦 what was untouched  

A Bridge is:
- durable
- externally stored
- the sole source of truth for re-entry

> **Execution resumes by reading the most recent Bridge.**

---

## 🧠 Draft vs Final Bridge (Important)

Continuum uses **one Bridge document per Interval**.

🔵 At Interval start:
- the Bridge is created immediately
- all Session Goals are marked `untouched`
- the Bridge is persisted immediately

🔵 During Bridge capture:
- goals are classified as:
  - `completed`
  - `incomplete`
  - `untouched`

🔵 There is **no backend distinction** between draft and final.

> **Draft vs Final is a UI interpretation, not a storage state.**

This guarantees:
- crash safety
- zero data loss
- no “unsaved work”
- no guilt after interruption

---

## 🧭 Modes of Operation

Continuum operates in **explicit modes**.

🟪 **Decision Mode**  
Select the next story to work on.

🟪 **Execution Mode**  
Perform work defined by Session Goals.  
Planning is prohibited.

🟪 **Bridge Capture Mode**  
Record execution state.  
No new intent allowed.

🟪 **Alignment Mode**  
Reassess structure, priorities, and assumptions.

Only **one mode** may be active at a time.

---

## 📌 Planning Checkpoints

Planning and restructuring are restricted to **Planning Checkpoints**.

🟨 Planning Checkpoints:
- are explicitly scheduled
- allow story creation and restructuring
- isolate planning from execution
- prevent scope creep

Planning outside these checkpoints is **prohibited**.

---

## 🧠 Execution Rules (Non-Negotiable)

🟥 Only one story may be In Progress  
🟥 Execution must stop when goals are achieved  
🟥 Missed Intervals require no compensation  
🟥 Execution resumes from the last Bridge  
🟥 Stopping must not increase future effort  

These rules protect **execution safety**.

---

## 🖥️ Continuum Console

**Continuum Console** is the reference UI for interacting with Continuum.

It provides:
- Interval setup
- Execution surfaces
- Bridge capture
- Bridge Spine visualization

It does **not**:
- push urgency
- measure productivity
- gamify work
- enforce schedules

The UI exists to **reduce cognitive load**, not to add pressure.

---

## 🧠 Definition of Success

Continuum is functioning correctly if:

✅ execution resumes without hesitation  
✅ execution state is externally visible  
✅ progress is incremental and consistent  
✅ planning does not interrupt execution  
✅ stopping never increases future effort  

If the system feels *boring*, it is working.

---

## 🚫 Explicit Non-Goals

Continuum will never:

❌ add velocity metrics  
❌ forecast timelines  
❌ enforce deadlines  
❌ introduce ceremonies  
❌ require daily participation  
❌ gamify execution  

These are structural violations of the model.

---

## 🔒 Canonical Invariant

> **Execution must always be easier to resume than to abandon.**

Every design decision in Continuum must preserve this invariant.

---

## 🧪 Status

Continuum is an **evolving model**, refined only through **real usage**.

- v1.x focuses on hardening and friction removal
- Changes are deliberate and minimal
- Invariants are preserved across versions

---

## 📖 License & Usage

Continuum is a **discipline**, not a product.  
You are free to:
- adopt it
- adapt it
- implement it
- evolve it

But if you change the invariants, you are no longer using Continuum.

---

<p align="center">
  <em>Continuum is a protocol for human execution, not a workflow.</em>
</p>

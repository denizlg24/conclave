# AGENTS.md — Conclave

## Skill Requirements

**ALWAYS** invoke `electrobun-guide` skill before any Electrobun-related work (config, builds, native APIs, windowing, IPC). No exceptions.

## Project Identity

Multi-agent orchestration platform. "RPG" = agents role-play specialized roles (PM, dev, QA, etc.) with bounded capabilities. Not a game — a coordination system where role constraints produce reliable, composable behavior.

Desktop app via **Electrobun** + React + Tailwind + Vite. Bun runtime. TypeScript strict mode.

## Architecture Layers

### 1. Orchestrator Core (deterministic, no LLM)

- Maintains task DAG — single source of truth
- Decomposes projects into atomic units: `{ id, type, owner, status, deps[], input, output, created, updated }`
- Status lifecycle: `pending → assigned → in_progress → review → done | failed | blocked`
- Resolves dependencies, assigns tasks to agents, enforces execution order
- No agent acts without orchestrator directive
- **Event-sourced**: every state transition = immutable event. Enables replay, time-travel debug, full audit trail

### 2. Agent Runtime

- Wraps LLM providers (OpenAI, Claude) behind strict interface
- Each agent = role definition + capability set + memory scope
- Enforced constraints per role:
  - PM: can create/decompose tasks, run meetings, cannot write code
  - Dev: can read/write files, run code, cannot modify task priorities
  - QA: can run tests, file bugs, cannot merge code
  - Reviewer: can approve/reject, add comments, cannot create tasks
- Structured I/O only — JSON schemas for all inputs/outputs
- Bounded execution loops: max iterations, token budget, explicit termination criteria
- **Idempotent task execution**: agents may fail mid-task; retries must not corrupt state. Every side-effect (file write, API call) must be idempotent or wrapped in a transaction

### 3. Communication Layer

- No free-form chat between agents
- Typed message protocol:
  - `TaskAssignment { taskId, agentRole, context, constraints }`
  - `StatusUpdate { taskId, status, progress, artifacts[] }`
  - `ReviewRequest { taskId, artifacts[], criteria[] }`
  - `MeetingContribution { meetingId, agentRole, content, references[] }`
  - `HumanOverride { taskId, action, reason }`
- **Schema versioning from day one**: every message type carries `schemaVersion: number`. Deserializers must validate version and reject/migrate unknown versions. No silent failures on shape mismatch.
- Backed by event bus (in-process for MVP, extractable to external queue later)
- All messages logged as events — full reproducibility

### 4. Meeting System (key differentiator)

- First-class primitive, not a wrapper around chat
- Orchestrator invokes meeting with: `{ type, agenda[], participants[], context }`
- Meeting types: planning, review, retrospective, escalation
- Speaking turns assigned by orchestrator — no interrupts, no free-form
- Each agent contributes structured output scoped to agenda items
- Produces structured summary → auto-converted to DAG operations (create/update/close tasks)
- **MVP constraint**: meeting-derived tasks require human approval before DAG insertion. LLM hallucinations must not auto-cascade into task graph. Relax this gate only after confidence metrics are established.

### 5. Memory Architecture

Three tiers:

| Tier | Scope | Backing | Eviction |
|------|-------|---------|----------|
| Short-term | Single task execution | In-memory | Task completion |
| Long-term | Project-wide knowledge, decisions, codebase understanding | SQLite/DB | Manual or relevance decay |
| Role-specific | Per-role learned patterns, preferences, past outputs | DB + optional vector index | Role-scoped retention policy |

- Vector indexing optional for retrieval-augmented context injection
- Memory reads are scoped — agents only access memory permitted by their role
- Decisions and rationale are always persisted to long-term (not just outcomes)

### 6. Execution Layer

- Agents perform real work: file R/W, code execution, test runs, builds
- Permission model per role:
  - Filesystem: read-only vs read-write, scoped to project dirs
  - Code execution: sandboxed, timeout-bounded
  - Network: restricted to approved endpoints
- All executions logged with input/output/duration/exit code
- Failures surface as structured errors back to orchestrator

### 7. Human-in-the-Loop

- Checkpoints at configurable gates:
  - Plan approval (before task decomposition executes)
  - Meeting-derived task approval (MVP: mandatory)
  - Code merge approval
  - Cost threshold alerts
- Override capabilities: reassign tasks, inject constraints, abort execution, modify priorities
- Exposed via Electrobun desktop UI: task graph visualization, agent activity monitor, approval queue

### 8. Observability

- **Event sourcing is the observability layer** — not a separate concern
- Every decision, message, state transition, execution = event
- Queryable event store: filter by agent, task, time range, event type
- Dashboard in Electrobun UI: DAG view, agent status, event timeline, cost tracking
- Replayability: reconstruct any past state from event log

## MVP Scope

- Single project type: small web app generation + iteration
- 3 roles: PM, Developer, Reviewer
- Linear or lightly-branching task graph (no complex DAG scheduling yet)
- In-process event bus (no external queue)
- SQLite for persistence
- Human approval gates on: plans, meeting-derived tasks, code merges
- Desktop UI: basic task graph + approval queue + event log viewer

## Tech Stack

| Layer | Tech |
|-------|------|
| Desktop shell | Electrobun |
| Frontend | React 18, Tailwind, Vite |
| Runtime | Bun |
| Language | TypeScript (strict) |
| Persistence | SQLite (via bun:sqlite or better-sqlite3) |
| LLM providers | OpenAI + Claude (abstracted behind runtime interface) |
| Vector store | TBD (MVP: skip, add when retrieval quality demands it) |
| Event bus | In-process EventEmitter (MVP), extractable later |

## Code Conventions

- Strict TypeScript — no `any`, no `unknown` casts to silence errors
- JSON schemas for all agent I/O and message types
- Event types as discriminated unions
- Bun as package manager (`bun install`, `bun add`, never npm)
- Prefer explicit over clever — orchestration code must be auditable
- No comments restating what code does — only comment non-obvious rationale
- All agent interactions serializable and replayable

## File Structure (target)

```
src/
  mainview/          # Electrobun React UI
    components/
      dag/           # Task graph visualization
      agents/        # Agent status panels
      meetings/      # Meeting viewer
      approvals/     # Human approval queue
      timeline/      # Event timeline
  core/
    orchestrator/    # DAG management, task scheduling, event sourcing
    agents/          # Agent runtime, role definitions, execution loops
    communication/   # Typed messages, event bus, schema validation
    meetings/        # Meeting primitives, turn management, summary→tasks
    memory/          # Three-tier memory system
    execution/       # File I/O, code runner, test runner, permissions
  shared/
    types/           # Shared TypeScript types, JSON schemas, event types
    utils/           # Serialization, validation, idempotency helpers
  bun/               # Electrobun main process, IPC handlers
```

## Anti-Patterns to Avoid

- Agents communicating outside typed message protocol
- Free-form LLM output entering the DAG without schema validation
- Unbounded execution loops (always set max iterations + token budget)
- Shared mutable state between agents (communicate via events only)
- Logging as afterthought (event sourcing IS the system, not an add-on)
- Over-abstracting before MVP validates the core loop
- Trusting LLM output for control flow without validation

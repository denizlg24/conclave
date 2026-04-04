# Initial Integration Plan — t3code → Conclave

> Reference repo: `E:/PersonalProjects/t3code-reference` (shallow clone of pingdotgg/t3code)

## Decision: Effect Adoption Strategy

**Selective Effect.** Use Effect in the orchestration core (event sourcing, reactors, agent runtime, typed communication). Keep UI, utilities, and simple helpers in plain TypeScript.

### Effect Boundary

| Layer | Uses Effect | Rationale |
|-------|-------------|-----------|
| `core/orchestrator/` | Yes | Event sourcing, stream-based reactors, DI via ServiceMap |
| `core/agents/` | Yes | Agent runtime loops, bounded execution, provider abstraction |
| `core/communication/` | Yes | Typed message bus, schema validation, stream routing |
| `core/meetings/` | Yes | Turn management, structured output aggregation |
| `core/memory/` | Partial | Effect for query composition, plain TS for simple CRUD |
| `core/execution/` | Partial | Effect for sandboxed runners, plain TS for file I/O wrappers |
| `shared/types/` | No | Plain TS discriminated unions, interfaces |
| `shared/utils/` | No | Pure functions, no effect composition needed |
| `src/mainview/` (UI) | No | React stays React — no Effect in components |
| `src/bun/` (Electrobun main) | Partial | Effect for IPC routing, plain TS for window management |

---

## Reusable Patterns by Priority

### Tier 1 — Direct Port (high value, architecturally critical)

#### 1. Event Sourcing Core
**Source:** `apps/server/src/orchestration/{decider.ts, projector.ts, Schemas.ts, Services/OrchestrationEngine.ts}`

**What it does:** Command → validate invariants → emit events → project into read model. Sequential ordering via sequence numbers. Deterministic replay.

**How we use it:**
- Replace domain types: `ThreadId/TurnId` → `TaskId/AgentId/MeetingId`
- Keep the decider/projector split — decider validates and emits, projector applies to state
- Keep causation/correlation ID tracking on events (critical for debugging agent chains)
- Adapt command types to our DAG operations: `CreateTask`, `AssignTask`, `UpdateTaskStatus`, `AddDependency`, `ScheduleMeeting`, `ApproveMeetingTasks`

**Files to study:**
```
t3code-reference/packages/contracts/src/orchestration.ts    → command/event schemas
t3code-reference/apps/server/src/orchestration/decider.ts   → command validation + event emission
t3code-reference/apps/server/src/orchestration/projector.ts → event → state projection
t3code-reference/apps/server/src/orchestration/Services/OrchestrationEngine.ts → engine wiring
t3code-reference/apps/server/src/orchestration/commandInvariants.ts → precondition validators
```

#### 2. Provider Adapter Pattern (3-Tier)
**Source:** `apps/server/src/provider/Services/{ProviderAdapter.ts, ProviderAdapterRegistry.ts, ProviderService.ts}`

**What it does:** Generic adapter interface → registry resolves by provider kind → service facade routes calls and merges event streams.

**How we use it:**
- `ProviderAdapter` → `AgentAdapter` — interface for LLM provider interaction (startSession, sendMessage, interrupt, streamEvents)
- `ProviderAdapterRegistry` → `AgentAdapterRegistry` — lookup by provider kind (OpenAI, Claude, etc.)
- `ProviderService` → `AgentService` — cross-provider facade, unified event stream, session directory
- Session directory pattern maps agent instances → their provider adapter for routing

**Key adaptation:** t3code's adapter handles a single coding agent session. Ours wraps multiple concurrent agent roles, each with different system prompts, tool permissions, and context windows. The adapter interface needs:
- Role-specific system prompt injection
- Tool/capability constraints per role
- Token budget tracking per execution loop

**Files to study:**
```
t3code-reference/apps/server/src/provider/Services/ProviderAdapter.ts
t3code-reference/apps/server/src/provider/Services/ProviderAdapterRegistry.ts
t3code-reference/apps/server/src/provider/Services/ProviderService.ts
t3code-reference/apps/server/src/provider/Layers/ClaudeAdapterLive.ts   → Claude SDK integration
t3code-reference/apps/server/src/provider/Layers/CodexAdapterLive.ts    → Codex integration
```

#### 3. Reactor Pattern
**Source:** `apps/server/src/orchestration/{Services/OrchestrationReactor.ts, Layers/ProviderCommandReactor.ts, Layers/ProviderRuntimeIngestion.ts, Layers/RuntimeReceiptBus.ts}`

**What it does:** Events stream in → handlers dispatch commands → commands produce events. Receipt-based deduplication prevents infinite loops.

**How we use it:**
- Each agent role = a reactor that listens for relevant events (task assignments, review requests)
- Orchestrator reactor coordinates: task completion → dependency resolution → next task assignment
- Meeting reactor: meeting summary → task creation proposals → human approval gate → DAG insertion
- Receipt bus prevents duplicate agent actions on retry

**Files to study:**
```
t3code-reference/apps/server/src/orchestration/Services/OrchestrationReactor.ts
t3code-reference/apps/server/src/orchestration/Layers/RuntimeReceiptBus.ts
t3code-reference/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
```

#### 4. Typed Contracts Package
**Source:** `packages/contracts/src/{baseSchemas.ts, orchestration.ts, providerRuntime.ts, rpc.ts}`

**What it does:** Effect Schema-based type definitions shared across server and client. Discriminated unions for events, commands, runtime states. RPC contract definitions.

**How we use it:**
- Fork the contracts pattern but define our own domain schemas
- `baseSchemas.ts` pattern → our base ID types (TaskId, AgentId, MeetingId, EventId) + IsoDateTime
- `orchestration.ts` pattern → our command/event discriminated unions
- `providerRuntime.ts` pattern → agent execution lifecycle states (started, in_progress, completed, failed)
- `rpc.ts` pattern → typed IPC contracts between Electrobun main process and renderer

**Note:** Contracts package uses Effect Schema even though it's "shared types" — this is acceptable because the orchestration core (which consumes these) is Effect-based. The UI can import just the TypeScript types without running Effect at runtime.

---

### Tier 2 — Adapt with Modifications

#### 5. RPC/IPC Communication
**Source:** `apps/web/src/rpc/{protocol.ts, client.ts, serverState.ts}` + `apps/server/src/ws.ts`

**What it does:** Effect-based typed RPC over WebSocket. Server defines handlers, client gets typed stubs. Atom-based reactive state sync.

**How we use it:**
- t3code uses WebSocket between web app and local server
- We use Electrobun IPC between main process (bun) and renderer (React)
- The typed contract pattern transfers directly — define RPC groups in contracts, implement handlers in main process, generate typed client for renderer
- Atom-based state sync pattern is useful for keeping the UI reactive to orchestration state changes

**Adaptation needed:**
- Replace WebSocket transport with Electrobun's native IPC
- Simplify — we don't need the full `RpcClient.make()` machinery if Electrobun IPC is simpler
- Keep the contract-first approach: define the shape, implement both sides

#### 6. Runtime Event Lifecycle
**Source:** `packages/contracts/src/providerRuntime.ts`

**What it does:** Rich event types for LLM execution: session states, turn states, item statuses (text, tool_use, tool_result), streaming deltas.

**How we use it:**
- Adapt for agent execution tracking: `AgentSessionStarted`, `AgentTurnStarted`, `AgentToolInvoked`, `AgentOutputProduced`, `AgentTurnCompleted`, `AgentSessionEnded`
- Keep the streaming delta pattern for real-time UI updates (show what each agent is doing)
- Add meeting-specific events: `MeetingStarted`, `AgentContribution`, `MeetingSummaryProduced`, `TasksProposed`

#### 7. Checkpointing
**Source:** `apps/server/src/checkpointing/`

**What it does:** Persists turn checkpoints with delta encoding for replay/resume. Sequence-based ordering.

**How we use it:**
- Adapt for task-level checkpointing: save agent state at task boundaries so we can resume after failures
- Delta encoding is useful for long-running agents — don't re-persist entire context, just the diff
- Sequence numbers ensure ordered replay during recovery

---

### Tier 3 — Utility Extraction (copy with minimal changes)

#### 8. DrainableWorker
**Source:** `packages/shared/src/DrainableWorker.ts`

**What it does:** Queue-based worker with deterministic drain signaling. Replaces timing-sensitive sleep with explicit drain for testability.

**How we use it:** Agent task queuing. Each agent role gets a DrainableWorker that processes assigned tasks sequentially.

#### 9. KeyedCoalescingWorker
**Source:** `packages/shared/src/KeyedCoalescingWorker.ts`

**What it does:** Keyed worker that merges duplicate requests per key. Deduplication and coalescing.

**How we use it:** Debounce rapid state changes before persisting. If multiple events fire for the same task in quick succession, coalesce into one write.

#### 10. Schema JSON Utilities
**Source:** `packages/shared/src/schemaJson.ts`

**What it does:** Lenient JSON/JSONC parsing with Effect Schema validation. Error formatting.

**How we use it:** Parse agent outputs (which may have trailing commas, comments in JSON). Validate against expected schemas before inserting into the system.

#### 11. Logging (Rotating File Sink)
**Source:** `packages/shared/src/logging.ts`

**What it does:** Size-based log rotation with file pruning.

**How we use it:** Agent execution logs. Each agent session writes to a rotating log for post-hoc debugging.

#### 12. Shell Environment
**Source:** `packages/shared/src/shell.ts`

**How we use it:** Detect user's shell environment for the execution layer (running code, tests, builds).

---

## What We Do NOT Take

| t3code Component | Why Skip |
|------------------|----------|
| `apps/desktop/` (Electron) | We use Electrobun, not Electron |
| `apps/web/` (React UI) | Our UI is entirely different — DAG visualization, not chat |
| `apps/marketing/` | Irrelevant |
| Git/worktree integration | t3code's git branching model is for code checkpoints, not agent orchestration |
| Terminal session management | Their terminal is for user-facing shell; our execution layer is sandboxed agent runners |
| Provider-specific adapters (ClaudeAdapter, CodexAdapter) | We'll write our own — their adapters assume single-agent coding workflows |
| Thread/turn domain model | We replace with task/agent/meeting domain model |

---

## Implementation Order

### Phase 1 — Foundation
1. Set up Effect as a dependency (core packages only)
2. Port `baseSchemas.ts` pattern → define our ID types, timestamps, base event shape
3. Define command/event discriminated unions for DAG operations
4. Implement decider + projector for task lifecycle
5. Wire OrchestrationEngine with in-memory event store

### Phase 2 — Agent Runtime
6. Define AgentAdapter interface (from ProviderAdapter pattern)
7. Implement ClaudeAdapter (first provider)
8. Build AgentAdapterRegistry
9. Build AgentService facade with session directory
10. Implement bounded execution loops with token budget tracking

### Phase 3 — Communication + Reactors
11. Define typed message protocol (from contracts pattern)
12. Implement in-process event bus
13. Build orchestrator reactor (event → next task assignment)
14. Build agent reactor (task assignment → LLM call → result)
15. Implement receipt bus for idempotency

### Phase 4 — Meeting System
16. Define meeting schemas (types, agenda, contributions, summary)
17. Implement meeting orchestrator (turn management, context injection)
18. Build meeting → task proposal pipeline
19. Human approval gate for meeting-derived tasks

### Phase 5 — UI + Integration
20. Electrobun IPC contracts (from RPC pattern)
21. DAG visualization component
22. Agent activity monitor
23. Approval queue UI
24. Event timeline / observability dashboard

---

## Effect Dependencies to Add

```
effect                    → core
@effect/platform-bun      → bun-specific platform layer
@effect/sql-sqlite-bun    → SQLite persistence (if we go Effect for storage)
```

Optional (defer until needed):
```
@effect/rpc               → if we want Effect-native RPC for IPC
```

---

## License Note

t3code is licensed under **Apache 2.0** (per their LICENSE file). We can study and adapt patterns. If we copy substantial code blocks verbatim, we should retain attribution comments pointing to the source file and license.

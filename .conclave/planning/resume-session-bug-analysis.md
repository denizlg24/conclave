# Resume Session Bug Analysis
Date: 2026-04-07

## Symptom
Every suspended task fails on resume with `AgentSessionNotFoundError`, yet the orchestrator
marks them "completed". The 3 developer tasks (05fc8e84, 68b65e10, 44ae9c8f) are now stuck
in `failed` state with their work incomplete.

## Log Trace (per task)
```
[conclave] Resuming suspended task X with claude session Y
[suspension-store] Removed suspension context for task X   ← too early!
[claude-adapter] sendMessage called for agent-developer-N, resumeSessionId: Y
[conclave] Resume execution failed: AgentSessionNotFoundError
[conclave] Resumed suspended task X                        ← fire-and-forget already returned
[conclave] Resume execution completed for task X           ← .then() always fires
```

## Root Cause 1 (primary): In-memory session lost across restart
`claude-code-adapter` stores agent sessions in an in-memory `Ref<Map<AgentId, ManagedSession>>`.
When the app restarts, that map is empty.

`sendMessage` → `getSessionOrFail(agentId)` → map lookup → **null** → `AgentSessionNotFoundError`.

The `agentId` stored in the suspension context (`agent-developer-1`, etc.) no longer has a
registered session because `startSession` was never called for it after restart.

**Fix**: In `resumeSuspendedTask`, call `agentService.getAgent(agentId)` before `sendMessage`.
If null, call `agentService.startAgent(agentId, agentRole, projectPath)` to re-register it
before attempting `sendMessage`.

## Root Cause 2: Suspension context removed before success
`suspensionStore.remove(taskId)` is called at line ~513 of `conclave.ts`, **before**
`Effect.runPromise(agentService.sendMessage(...))` resolves. If resume fails (non-quota error),
the suspension context is gone and the task is left in `failed` state with no retry path.

**Fix**: Move `suspensionStore.remove()` into the `onSuccess` callback. On non-quota failures,
re-save the suspension context and dispatch `task.update-status → "suspended"` instead of "failed".

## Root Cause 3: Non-quota failures mark task as permanently failed
`AgentSessionNotFoundError` falls into the default `onFailure` branch which dispatches `status: "failed"`.
This is wrong — the session not being found is a transient infrastructure error, not a task failure.
The task should remain suspended and retryable.

**Fix**: Add a check for `AgentSessionNotFoundError` in the `onFailure` handler, treating it like
quota exhaustion (re-suspend, don't permanently fail).

## Root Cause 4: "Resume execution completed" always logs even on failure
The `.then()` callback after `Effect.runPromise(...)` always fires because `Effect.matchEffect`
converts both success and failure to `Effect.Effect<void>` (never rejects). The log is misleading.

**Fix**: Track whether the inner match handled a success or failure, and log accordingly.

## Existing Failed Tasks
The 3 tasks (05fc8e84, 68b65e10, 44ae9c8f) are currently in `failed` state with their
suspension contexts already deleted. They need a `retryTask` mechanism that:
1. Resets task status from `failed` → `pending`
2. The orchestrator re-assigns them to available developer agents

This requires checking whether the decider's command-invariants allow `failed → pending`
transitions (likely needs an update to allow it).

## Task Decomposition

### Task 0: Re-register agent session before resume sendMessage
File: `src/bun/conclave.ts`, `resumeSuspendedTask`
Before calling `agentService.sendMessage`, check `agentService.getAgent(agentId)`.
If null, call `agentService.startAgent(agentId, suspension.agentRole, projectPath)`.

### Task 1: Fix suspension context lifecycle (depends on Task 0)
File: `src/bun/conclave.ts`, `resumeSuspendedTask`
- Move `suspensionStore.remove()` into `onSuccess`
- On `AgentSessionNotFoundError` or other non-quota failures: re-save suspension context,
  dispatch `status: "suspended"` instead of "failed"
- Fix the `.then()` log to distinguish success vs failure

### Task 2: Add retryTask RPC to re-queue failed tasks (independent)
Files: `src/bun/conclave.ts`, `src/shared/rpc/rpc-schema.ts`, `src/bun/index.ts`,
       `src/core/orchestrator/command-invariants.ts`
- Add `failed → pending` transition to decider invariants
- Expose `retryTask(taskId)` method on ConclaveShape
- Wire up IPC handler so UI can trigger it for the 3 stuck tasks

### Task 3: Tests for resume and retry flows (depends on Tasks 0, 1, 2)
File: `src/core/agents/__tests__/service.test.ts` or new test file
- Test: resume with missing in-memory session → session re-registered → sendMessage called
- Test: resume fails with session-not-found → suspension context preserved, task stays suspended
- Test: resume succeeds → suspension context removed, task marked done/review
- Test: retryTask transitions failed → pending

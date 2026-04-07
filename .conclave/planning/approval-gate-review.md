# Approval Gate Feature Review

**Task ID:** 9bc49a76-3cc0-474b-a21e-9f1ed9274623
**Reviewed:** 2026-04-07
**Files reviewed:**
- `src/core/communication/planning-reactor.ts`
- `src/core/communication/meeting-reactor.ts`
- `src/core/orchestrator/decider.ts`
- `src/mainview/components/GameHUD.tsx` (approvals panel block)
- `src/core/communication/__tests__/planning-reactor.test.ts`
- `src/core/communication/__tests__/meeting-reactor.test.ts`
- `src/core/orchestrator/__tests__/decider-proposed-flow.test.ts`

---

## (1) Schema versioning

**Finding: Not implemented. AGENTS.md requirement is unmet.**

`AGENTS.md` mandates: *"every message type carries `schemaVersion: number`. Deserializers must validate version and reject/migrate unknown versions."*

None of the new event or command types carry `schemaVersion`:
- `withEventBase` (`decider.ts:23–40`) does not include `schemaVersion` in the base event shape.
- All emitted events (`meeting.tasks-approved`, `task.status-updated`, `meeting.completed`, `task.created`) lack the field.
- Commands dispatched in both reactors (`meeting.complete`, `task.create`, `meeting.approve-tasks`) also lack it.

**Recommendation:** Add `schemaVersion: number` to `OrchestrationEvent` and `OrchestrationCommand` base types in `shared/types/` and default it to `1` in `withEventBase` and command constructors. Deserializers (projectors, reactors) should assert version equality and throw on mismatch.

---

## (2) Edge cases

### 2a. Empty `approvedTaskIds` and `rejectedTaskIds`

**Finding: Allowed, silently succeeds — not guarded.**

`decider.ts:259–268`: validation iterates `[...command.approvedTaskIds, ...command.rejectedTaskIds]`. If both are empty, the loop body never executes. The command succeeds and emits a single `meeting.tasks-approved` event with two empty arrays — no task transitions occur.

This is a semantically meaningless operation (approve nothing, reject nothing) but produces a durable event in the store. There is no invariant preventing it.

**Recommendation:** Add a guard at the top of the `meeting.approve-tasks` case:
```ts
if (command.approvedTaskIds.length === 0 && command.rejectedTaskIds.length === 0) {
  return yield* Effect.fail(
    new CommandInvariantError({ commandType: command.type, detail: "At least one task must be approved or rejected." })
  );
}
```

### 2b. IDs not in the proposed list / IDs not belonging to the meeting

**Finding: Status invariant is enforced; meeting ownership is NOT.**

`decider.ts:263–268`: `requireTaskStatus(..., allowed: ["proposed"])` correctly rejects tasks not in `proposed` status (including non-existent tasks, which fail at `requireTask` inside).

However, there is **no ownership check**: a `meeting.approve-tasks` command can reference task IDs from a completely different meeting. The meeting ID is embedded only in the `reason` string (`decider.ts:304, 326`), never validated against `task.input.proposedByMeeting`. This allows cross-meeting approval of any proposed task.

**Recommendation:** In the `meeting.approve-tasks` case, after resolving each task, verify that `task.input?.proposedByMeeting === command.meetingId`.

### 2c. Duplicate `meeting.approve-tasks` dispatch (double-click in UI)

**Finding: Implicitly blocked at the decider level; UI has no protection.**

After the first successful approval, affected tasks transition out of `proposed`. A second dispatch of the same command will fail at `requireTaskStatus` because tasks are no longer `proposed` — so the event store remains consistent.

**However:** `GameHUD.tsx:562–614` — the APPROVE and REJECT buttons have no `disabled` state and no in-flight guard. A rapid double-click fires two concurrent `approveProposedTasks` calls. The second will fail (RPC throws), but the error is silently swallowed — there is no `try/catch` in the `onClick` handlers and no user feedback.

Additionally, the implicit guard only holds if the first command has been fully processed before the second is validated. In the current in-process engine this is synchronous, but it is a fragile assumption.

**Recommendation (UI):** Disable both buttons while the RPC call is in-flight using local `useState` or a pending set keyed on task ID.

**Recommendation (decider):** Consider an explicit meeting-level guard — track an `approvalDispatched` flag on the meeting aggregate, enforced by `requireMeetingStatus` or a dedicated invariant check.

---

## (3) Idempotency on event store replay

**Finding: Safe. The decider is not involved in replay.**

Event sourcing replays *events* through the projector, not commands through the decider. The `receiptStore.tryAcquire` guard in `planning-reactor.ts:103–106` and `meeting-reactor.ts:30–34` prevents reactor double-firing on the same event — this is the correct layer for idempotency.

The decider's lack of an explicit self-idempotency guard on `meeting.approve-tasks` is not a replay safety concern because commands are never stored or replayed.

One caveat: if the event store itself were to emit a duplicate event (e.g., at-least-once delivery in a future external queue), the projector would apply `proposed → pending/failed` twice. Whether this corrupts state depends on whether the projector is idempotent. This is out of scope for the current in-process MVP but worth noting for the extractable-queue architecture.

---

## (4) TypeScript strictness

### 4a. `meeting-reactor.ts:66` — Spreading `object` type

```ts
...(typeof proposed.input === "object" && proposed.input !== null
  ? proposed.input   // narrowed to `object`, not `Record<string, unknown>`
  : {}),
```

`typeof x === "object" && x !== null` narrows to `object`, not `Record<string, unknown>`. Spreading `object` is syntactically valid TypeScript but conveys no key information — the merged type loses all specificity. This is a silent type-safety hole, not a runtime error.

**Recommendation:** Cast explicitly: `proposed.input as Record<string, unknown>` after the null-check, or define `input` in `ProposedTask` as `Record<string, unknown> | null` in the shared type.

### 4b. `decider.ts:412` — Double cast through `never`

```ts
command satisfies never;
const fallback = command as never as { type: string };
```

`command satisfies never` is the correct exhaustiveness check. The subsequent `as never as { type: string }` is only used to extract `.type` for the error message. Acceptable in a `default` exhaustive branch, but the cast through `never` is unconventional. Prefer `(command as { type: string }).type` or extract the type before the `satisfies` check.

### 4c. `GameHUD.tsx:493` — Cast from `unknown` to `Record`

```ts
const meetingId = (t.input as Record<string, unknown> | null)?.proposedByMeeting as string | undefined;
```

Standard UI read pattern — acceptable given `task.input` is `unknown` in the serialized model. No issue.

### 4d. `planning-reactor.ts:79` — Chain cast on `taskInput`

```ts
const meetingId = (taskInput as Record<string, unknown> | null)?.meetingId as string | undefined;
```

Same pattern as 4c — acceptable given `taskInput: unknown`.

---

## (5) Test coverage gaps

### `planning-reactor.test.ts`

| Case | Covered? |
|------|----------|
| Valid PM output → `meeting.complete` with proposedTasks | ✅ |
| Task count matches PM output | ✅ |
| No `task.create` commands dispatched | ✅ |
| `parentPlanningTaskId` in proposed task input | ✅ |
| Ignores non-planning task types | ✅ |
| Ignores non-`review` status transitions | ✅ |
| Receipt store idempotency | ✅ |
| **PM output has `tasks: []` (empty array)** | ❌ missing |
| **Task input has no `meetingId`** | ❌ missing |

**Empty tasks path** (`planning-reactor.ts:140–152`): when `plan.tasks.length === 0`, the reactor marks the planning task `done` and calls `completeMeetingForTask` with no proposed tasks. This path is exercised in production but has no test.

**Absent `meetingId`** (`planning-reactor.ts:81`): `if (!meetingId) return` — silent early exit. No test verifies this guard fires and produces zero dispatches.

### `meeting-reactor.test.ts`

| Case | Covered? |
|------|----------|
| `task.create` per proposed task | ✅ |
| `initialStatus: 'proposed'` on all creates | ✅ |
| Unique taskIds | ✅ |
| Index-based dep resolution | ✅ |
| Empty deps | ✅ |
| `proposedByMeeting` in input | ✅ |
| Input field merge | ✅ |
| Empty `proposedTasks` → zero creates | ✅ |
| Receipt store idempotency | ✅ |

Meeting-reactor tests are well-covered. No significant gaps found.

### `decider-proposed-flow.test.ts`

| Case | Covered? |
|------|----------|
| `task.created` carries `initialStatus: 'proposed'` | ✅ |
| `task.create` without `initialStatus` omits field | ✅ |
| Dep existence validated for proposed task | ✅ |
| Approved task: `proposed → pending` | ✅ |
| Rejected task: `proposed → failed` | ✅ |
| Mixed batch: correct statuses for each | ✅ |
| First event is `meeting.tasks-approved` | ✅ |
| Non-proposed task rejected with invariant error | ✅ |
| **Both ID arrays empty → allowed/rejected** | ❌ missing |
| **Double-dispatch: second call fails after tasks no longer proposed** | ❌ missing |
| **Task IDs referencing a different meeting** | ❌ missing |

---

## Summary of action items

| Priority | Item | Location |
|----------|------|----------|
| High | Add `schemaVersion` to event/command base types | `shared/types/`, `decider.ts:withEventBase` |
| High | Guard empty `approvedTaskIds`+`rejectedTaskIds` in decider | `decider.ts:~251` |
| High | Disable approve/reject buttons during in-flight RPC | `GameHUD.tsx:562–614` |
| Medium | Add cross-meeting ownership check on task IDs | `decider.ts:~259` |
| Medium | Fix `meeting-reactor.ts:66` spread of `object` type | `meeting-reactor.ts:66` |
| Low | Add test: planning-reactor with empty PM tasks array | `planning-reactor.test.ts` |
| Low | Add test: planning-reactor with absent meetingId | `planning-reactor.test.ts` |
| Low | Add test: decider double-dispatch of `meeting.approve-tasks` | `decider-proposed-flow.test.ts` |
| Low | Add test: decider with both approval arrays empty | `decider-proposed-flow.test.ts` |
| Low | Clean up `as never as { type: string }` cast | `decider.ts:412` |

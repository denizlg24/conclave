# Planning: Human Approval Gate for PM Task Decomposition

## Date: 2026-04-06
## Meeting: b00af865-173a-4925-91e9-36e6ca799a3a (continuation of da321fd9-e276-45d2-8a23-d724492ef5cb)

## Status

All implementation and unit tests are COMPLETE. Remaining work: integration test + review.

## Completed Tasks (previous session)

- ✅ Task 0: planning-reactor — dispatches `meeting.complete` with `proposedTasks`, no direct `task.create`
- ✅ Task 1: meeting-reactor — on `meeting.completed`, creates tasks with `initialStatus: "proposed"`, resolves deps
- ✅ Task 2: decider — `proposed` status exists; `meeting.approve-tasks` transitions proposed→pending / proposed→failed
- ✅ Task 3: ApprovalQueue UI — filters proposed tasks, groups by meeting, approve/reject actions wired
- ✅ Unit tests: `planning-reactor.test.ts`, `meeting-reactor.test.ts`, `decider-proposed-flow.test.ts`

## Remaining Work

### Task A — Integration test: full approval gate flow
File: `src/core/orchestrator/__tests__/approval-gate-integration.test.ts`

Test the full chain using the real engine (not mocks):
1. Dispatch a planning task, drive it to `review` status with PM output
2. Assert `meeting.complete` was dispatched (not direct `task.create`)
3. Assert proposed tasks appear in read model with `status === "proposed"`
4. Assert orchestrator-reactor does NOT auto-assign proposed tasks
5. Dispatch `meeting.approve-tasks` with a subset approved, rest rejected
6. Assert approved tasks transition to `pending` and get assigned by orchestrator
7. Assert rejected tasks transition to `failed`

Use existing test helpers from `command-invariants.test.ts` and `decider.test.ts` as patterns.
No mocks — wire the real engine, event bus, and reactors.

### Task B — Review
Review all files modified for the approval gate feature:
- `src/core/communication/planning-reactor.ts`
- `src/core/communication/meeting-reactor.ts`
- `src/core/orchestrator/decider.ts`
- `src/mainview/components/ApprovalQueue.tsx`
- All three new test files

Check for: schema version missing on new message types, missing edge cases (empty proposedTasks,
duplicate approval commands), UI accessibility, TypeScript strictness.

## Parallelism Plan
- Task A → 1 tester (integration test, can start immediately)
- Task B → 1 reviewer (can start immediately, independently)

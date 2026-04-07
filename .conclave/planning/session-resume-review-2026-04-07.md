# PM Review: Re-register Agent Session Before Resume
**Meeting:** c4302c13-6165-4714-85b7-63d86384afe4
**Date:** 2026-04-07
**Sprint context:** 6 done, 0 failed

## Delivery Assessment

### Task 0 Delivered (Root Cause 1 fix)
- `resumeSuspendedTask` now checks `agentService.getAgent(agentId)` before `sendMessage`
- If null, calls `startAgent(agentId, agentRole, projectPath)` to re-register
- Directly fixes the primary cause of `AgentSessionNotFoundError` on restart

### Quality Verdict: Acceptable, not complete
Task 0 addresses the symptom (missing session) but 3 of 4 root causes from the
`resume-session-bug-analysis.md` remain open:

| # | Root Cause | Status |
|---|-----------|--------|
| 1 | In-memory session lost across restart | ✅ Done (Task 0) |
| 2 | Suspension context removed before success | ❌ Open (Task 1) |
| 3 | Non-quota failures permanently fail tasks | ❌ Open (Task 1) |
| 4 | Misleading "completed" log always fires | ❌ Open (Task 1) |

Additionally:
- `retryTask` RPC (Task 2) is needed to recover the 3 currently stuck tasks
- Resume/retry tests (Task 3) have not been written

## Follow-up Work Required
1. Task 1 (suspension context lifecycle fix) — high priority, blocks safe retry behavior
2. Task 2 (retryTask RPC) — needed to un-block 3 existing failed developer tasks
3. Task 3 (tests) — required before this feature is considered verified

## Risk
Without Task 1, the session re-register fix is incomplete: a re-registered session can still
fail for other reasons, and when it does, the suspension context will already be deleted,
leaving the task permanently failed with no retry path — the same end-state as before.

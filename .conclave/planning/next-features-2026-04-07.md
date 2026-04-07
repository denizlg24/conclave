# Planning: Next Features — 2026-04-07
## Meeting: 8a71c940-5d75-4ca1-b3b3-9de989ecf928

## Current State Summary

The core loop is implemented and functional:
- Orchestrator engine (event-sourced, deterministic)
- Agent runtime (Claude Code adapter, PM agent auto-started)
- Communication reactors (orchestrator, agent, meeting, planning, review-meeting)
- Meeting system with structured contributions
- Three-tier memory (persistent event store, decision log)
- Full UI: game scene, HUD panels (quests, journal, party, approvals), project management
- Approval gate feature: proposed→pending/failed flow (code complete, tests pending)

## Chosen Features

### Feature 1: Meeting Viewer Panel (UI)

**Rationale:** The approval queue already shows "Proposed during X council" but users have
no way to see *what was discussed* before approving tasks. The meeting data (contributions,
agenda, summary) is already fully present in the read model — it just lacks a UI surface.
This is the single most impactful quality-of-life addition: it closes the information gap
right at the decision point.

**Scope:**
- New `MeetingViewer.tsx` component in RPG panel style
- Shows meeting list (grouped: in_progress → completed)
- Expandable per-meeting: type, agenda, participants, contributions (by role), summary
- COUNCIL button in HUD action bar (hotkey "C")
- In the approval queue, "View Council" link that opens the panel pre-focused on that meeting
- Modify: `src/mainview/components/GameHUD.tsx`
- Create: `src/mainview/components/MeetingViewer.tsx`

### Feature 2: Approval Gate Integration Test (completes pending Task A)

**Rationale:** The approval gate is the MVP's critical human-in-the-loop gate. It was
implemented last session but the integration test (testing the full real chain, no mocks)
was deferred. Without it, the feature isn't properly verified.

**Scope:**
- Create: `src/core/orchestrator/__tests__/approval-gate-integration.test.ts`
- Uses real engine, event bus, and reactors (no mocks)
- Full chain: dispatch planning task → PM output drives meeting.complete → proposed tasks
  appear in read model → meeting.approve-tasks → approved go pending → assigned → rejected fail
- Reference: existing patterns in `command-invariants.test.ts`, `decider.test.ts`

## Bugs to Fix

### Bug A: `occupiedDesks` not reset on project reload
**File:** `src/mainview/App.tsx`
**Problem:** `occupiedDesks` is a module-level `Set<number>` that persists across React
re-renders and project reloads. When a second project is loaded, the `agentMapRef` is
cleared but `occupiedDesks` still has stale entries, causing desk assignment to skip
already-freed slots. Also `roleCounterRef` has the same issue.
**Fix:** Clear `occupiedDesks` and `roleCounterRef` when agents are removed (when IDs
are no longer in the roster).

### Bug B: `agentEvents` / `events` arrays grow unbounded
**File:** `src/mainview/hooks/use-conclave.tsx`
**Problem:** `agentEvents` and `events` are accumulated indefinitely with spread operators.
Over a long session, this consumes significant memory. The UI already caps display at 80–120
items, so the full array is never fully consumed.
**Fix:** Cap arrays at 500 entries each (keep the latest), applied on each push.

## Task Breakdown & Parallelism

| # | Type | Title | Deps | Agent |
|---|------|-------|------|-------|
| 0 | implementation | Meeting Viewer Panel (component + HUD integration) | — | Dev 1 |
| 1 | implementation | Fix occupiedDesks + agentEvents memory bugs | — | Dev 2 |
| 2 | testing | Approval gate integration test | — | Tester 1 |
| 3 | review | Review approval gate feature files | — | Reviewer 1 |

All four tasks are fully independent and can run in parallel.

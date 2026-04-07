# Retry Review Meeting — Planning

**Date:** 2026-04-07  
**Trigger:** Meeting `5ffb1fea-f827-4d14-8319-15f1c9ba59e6` (type: review) did not complete.

## Problem Analysis

The `MeetingOrchestratorShape.runMeeting()` runs a full lifecycle:
1. Dispatch `meeting.start` → requires status = `scheduled`
2. Collect contributions (agent × agenda item)
3. Dispatch `meeting.complete`

If the meeting stalled mid-run (e.g., agent failure, process crash), the meeting is left in `scheduled` or `in_progress` state. Re-calling `runMeeting(meetingId)` on the same ID fails at `meeting.start` because the invariant requires status = `scheduled` — but if it already advanced to `in_progress`, the command is rejected.

**Currently missing:**
- No `meeting.cancel` command/event to clear a stuck meeting
- No `retryMeeting` capability on `MeetingOrchestratorShape`
- No UI affordance to trigger a retry

## Chosen Approach

**Cancel + re-schedule pattern** (event-sourced, no state mutation):
1. Add `meeting.cancel` command → emits `meeting.cancelled` event → transitions meeting to `cancelled`
2. Add `retryMeeting(meetingId)` to `MeetingOrchestratorShape`:
   - Read the stuck meeting's agenda, participants, meetingType from read model
   - Dispatch `meeting.cancel` on it
   - Generate a new `meetingId`, dispatch `meeting.schedule` with same params
   - Call `runMeeting(newMeetingId)` and return result
3. Expose via IPC handler + UI "Retry" button in the meetings panel

## Files Affected

| Task | Files |
|------|-------|
| Cancel command/event | `src/shared/types/orchestration.ts`, `src/core/orchestrator/decider.ts`, `src/core/orchestrator/projector.ts` |
| retryMeeting | `src/core/meetings/meeting-orchestrator.ts` |
| IPC handler | `src/bun/` (main process IPC handlers) |
| UI button | `src/mainview/components/meetings/` |
| Tests | `src/core/meetings/__tests__/`, `src/core/orchestrator/__tests__/` |

## Task Dependency Graph

```
[0] Add meeting.cancel command + meeting.cancelled event to shared types
 └─> [1] Implement cancel in decider + projector
      └─> [2] Add retryMeeting() to MeetingOrchestratorShape
           ├─> [3] Add IPC handler for retryMeeting
           │    └─> [4] Add Retry UI button in meetings panel
           └─> [5] Write tests for cancel + retryMeeting
```

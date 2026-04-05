import { Data } from "effect";

export class ReactorError extends Data.TaggedError("ReactorError")<{
  readonly reactorName: string;
  readonly detail: string;
  readonly cause?: unknown;
}> {}

export class MeetingError extends Data.TaggedError("MeetingError")<{
  readonly meetingId: string;
  readonly operation: string;
  readonly detail: string;
}> {}

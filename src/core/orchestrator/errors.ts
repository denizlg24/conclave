import { Data } from "effect";

export class CommandInvariantError extends Data.TaggedError(
  "CommandInvariantError",
)<{
  readonly commandType: string;
  readonly detail: string;
}> {}

export class EventStoreError extends Data.TaggedError("EventStoreError")<{
  readonly operation: string;
  readonly detail: string;
}> {}

export class DispatchError extends Data.TaggedError("DispatchError")<{
  readonly commandType: string;
  readonly cause: CommandInvariantError | EventStoreError;
}> {}

export class ProjectorDecodeError extends Data.TaggedError(
  "ProjectorDecodeError",
)<{
  readonly eventType: string;
  readonly field: string;
  readonly detail: string;
}> {}

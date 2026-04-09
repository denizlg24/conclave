import { Schema } from "effect";

export const TrimmedString = Schema.Trim;
export const TrimmedNonEmptyString = TrimmedString.check(Schema.isNonEmpty());

export const NonNegativeInt = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
);
export const PositiveInt = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
);

export const IsoDateTime = Schema.String;
export type IsoDateTime = typeof IsoDateTime.Type;

const makeEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const TaskId = makeEntityId("TaskId");
export type TaskId = typeof TaskId.Type;

export const AgentId = makeEntityId("AgentId");
export type AgentId = typeof AgentId.Type;

export const MeetingId = makeEntityId("MeetingId");
export type MeetingId = typeof MeetingId.Type;

export const EventId = makeEntityId("EventId");
export type EventId = typeof EventId.Type;

export const CommandId = makeEntityId("CommandId");
export type CommandId = typeof CommandId.Type;

export const ProposalId = makeEntityId("ProposalId");
export type ProposalId = typeof ProposalId.Type;

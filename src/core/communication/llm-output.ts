import { Schema } from "effect";

import { NonNegativeInt, TrimmedNonEmptyString } from "@/shared/types/base-schemas";
import {
  MeetingTaskDependencyRef,
  TaskType,
} from "@/shared/types/orchestration";

const PlanningTaskOutputSchema = Schema.Struct({
  title: TrimmedNonEmptyString,
  description: Schema.String,
  taskType: TaskType,
  deps: Schema.Array(NonNegativeInt),
});

const PlanningOutputSchema = Schema.Struct({
  tasks: Schema.Array(PlanningTaskOutputSchema),
});

const MeetingProposedTaskOutputSchema = Schema.Struct({
  taskType: TaskType,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  deps: Schema.Array(MeetingTaskDependencyRef),
  input: Schema.optional(Schema.Unknown),
});

const MeetingSynthesisOutputSchema = Schema.Struct({
  summary: Schema.String,
  proposedTasks: Schema.Array(MeetingProposedTaskOutputSchema),
});

export type PlanningOutput = typeof PlanningOutputSchema.Type;
export type MeetingSynthesisOutput = typeof MeetingSynthesisOutputSchema.Type;

function extractLastJsonCandidate(output: string): string | null {
  const jsonBlockRegex = /```json\s*([\s\S]*?)```/g;
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;

  while ((match = jsonBlockRegex.exec(output)) !== null) {
    lastMatch = match;
  }

  const fallback = output.trim();
  return lastMatch?.[1]?.trim() ?? (fallback.length > 0 ? fallback : null);
}

function decodePlanningJson(
  output: string,
): { readonly data: PlanningOutput | null; readonly error: string | null } {
  const candidate = extractLastJsonCandidate(output);
  if (!candidate) {
    return {
      data: null,
      error: "No JSON payload found in LLM output.",
    };
  }

  try {
    const parsed = JSON.parse(candidate) as unknown;
    const decoded = Schema.decodeUnknownSync(PlanningOutputSchema)(parsed);
    return {
      data: decoded,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: String(error),
    };
  }
}

export function decodePlanningOutput(
  output: string,
): { readonly data: PlanningOutput | null; readonly error: string | null } {
  return decodePlanningJson(output);
}

export function decodeMeetingSynthesisOutput(
  output: string,
): { readonly data: MeetingSynthesisOutput | null; readonly error: string | null } {
  const candidate = extractLastJsonCandidate(output);
  if (!candidate) {
    return {
      data: null,
      error: "No JSON payload found in LLM output.",
    };
  }

  try {
    const parsed = JSON.parse(candidate) as unknown;
    const decoded = Schema.decodeUnknownSync(MeetingSynthesisOutputSchema)(parsed);
    return {
      data: decoded,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: String(error),
    };
  }
}

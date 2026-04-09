import { useEffect, useMemo, useRef } from "react";
import { useConclave } from "../hooks/use-conclave";

const LEVEL_COLORS = {
  log: "var(--rpg-text-dim)",
  info: "#81b29a",
  warn: "#f2cc8f",
  error: "#e07a5f",
  debug: "#c8a96e",
} as const;

const SOURCE_COLORS = {
  bun: "rgba(200, 169, 110, 0.14)",
  webview: "rgba(129, 178, 154, 0.14)",
} as const;

function formatTime(occurredAt: string): string {
  return new Date(occurredAt).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function DebugConsole({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { debugConsoleEntries } = useConclave();
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [debugConsoleEntries]);

  const entryCountLabel = useMemo(() => {
    if (debugConsoleEntries.length === 0) {
      return "NO ENTRIES";
    }

    return `${debugConsoleEntries.length} ENTRIES`;
  }, [debugConsoleEntries.length]);

  const content = (
    <>
      <div
        className="flex items-center justify-between gap-4 px-5 py-4"
        style={{ borderBottom: "1px solid var(--rpg-border)" }}
      >
        <div>
          <div
            className="rpg-font text-[9px] tracking-wider"
            style={{ color: "var(--rpg-gold-dim)" }}
          >
            DEBUG CONSOLE
          </div>
          <p
            className="rpg-mono text-[9px] mt-1"
            style={{ color: "var(--rpg-text-muted)" }}
          >
            Bun and webview output mirrored into the app.
          </p>
        </div>
        <span
          className="rpg-mono text-[9px]"
          style={{ color: "var(--rpg-text-muted)" }}
        >
          {entryCountLabel}
        </span>
      </div>

      <div
        className="flex items-center gap-2 px-5 py-3"
        style={{ borderBottom: "1px solid rgba(58, 74, 53, 0.3)" }}
      >
        {(["bun", "webview"] as const).map((source) => (
          <span
            key={source}
            className="rpg-mono text-[8px] px-2 py-1 uppercase tracking-wider"
            style={{
              background: SOURCE_COLORS[source],
              border: "1px solid rgba(58, 74, 53, 0.45)",
              color: "var(--rpg-text-muted)",
            }}
          >
            {source}
          </span>
        ))}
      </div>

      <div
        ref={logRef}
        className={`px-4 py-4 ${embedded ? "min-h-0 flex-1 overflow-y-auto" : "max-h-[520px] overflow-y-auto"}`}
        style={{
          background:
            "linear-gradient(180deg, rgba(16, 20, 16, 0.96), rgba(10, 13, 10, 0.98))",
        }}
      >
        {debugConsoleEntries.length === 0 ? (
          <div
            className="rpg-mono text-[10px] min-h-[320px] flex items-center justify-center text-center"
            style={{ color: "var(--rpg-text-muted)" }}
          >
            Waiting for console activity...
          </div>
        ) : (
          <div className="space-y-2">
            {debugConsoleEntries.map((entry) => (
              <article
                key={entry.id}
                className="px-3 py-2"
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(58, 74, 53, 0.35)",
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="rpg-mono text-[8px]"
                    style={{ color: "var(--rpg-text-muted)" }}
                  >
                    {formatTime(entry.occurredAt)}
                  </span>
                  <span
                    className="rpg-mono text-[8px] px-1.5 py-0.5 uppercase tracking-wider"
                    style={{
                      color: LEVEL_COLORS[entry.level],
                      border: `1px solid ${LEVEL_COLORS[entry.level]}`,
                    }}
                  >
                    {entry.level}
                  </span>
                  <span
                    className="rpg-mono text-[8px] px-1.5 py-0.5 uppercase tracking-wider"
                    style={{
                      background: SOURCE_COLORS[entry.source],
                      color: "var(--rpg-text-muted)",
                    }}
                  >
                    {entry.source}
                  </span>
                </div>
                <pre
                  className="rpg-mono text-[10px] mt-2 whitespace-pre-wrap break-words"
                  style={{ color: "var(--rpg-text)" }}
                >
                  {entry.message}
                </pre>
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );

  if (embedded) {
    return <div className="flex h-full min-h-0 flex-col">{content}</div>;
  }

  return (
    <section className="rpg-panel min-h-[420px] overflow-hidden">
      {content}
    </section>
  );
}

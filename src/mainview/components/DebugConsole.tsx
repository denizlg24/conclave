import { useEffect, useMemo, useRef } from "react";
import { useConclave } from "../hooks/use-conclave";

const LEVEL_COLORS = {
  log: "var(--rpg-text-dim)",
  info: "var(--rpg-sage)",
  warn: "var(--rpg-sand)",
  error: "var(--rpg-danger)",
  debug: "var(--rpg-gold)",
} as const;

const SOURCE_COLORS = {
  bun: "rgba(200, 169, 110, 0.16)",
  webview: "rgba(129, 178, 154, 0.16)",
} as const;

export function DebugConsole({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { debugConsoleEntries } = useConclave();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) {
      return;
    }

    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [debugConsoleEntries.length]);

  const summary = useMemo(() => {
    return debugConsoleEntries.reduce(
      (accumulator, entry) => {
        accumulator[entry.level] += 1;
        accumulator[entry.source] += 1;
        return accumulator;
      },
      {
        log: 0,
        info: 0,
        warn: 0,
        error: 0,
        debug: 0,
        bun: 0,
        webview: 0,
      },
    );
  }, [debugConsoleEntries]);

  const body = (
    <>
      <div className="hud-panel-scroll" style={{ flex: "0 0 auto" }}>
        <div className="hud-summary-card m-3">
          <div className="hud-summary-card__header">
            <span className="hud-summary-card__eyebrow">Console Summary</span>
            <span className="hud-summary-card__time">{debugConsoleEntries.length} entries</span>
          </div>
          <div className="hud-inline-tags">
            <ConsoleTag label={`bun ${summary.bun}`} tone="bun" />
            <ConsoleTag label={`webview ${summary.webview}`} tone="webview" />
            <ConsoleTag label={`warn ${summary.warn}`} tone="warn" />
            <ConsoleTag label={`error ${summary.error}`} tone="error" />
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className={`min-h-0 ${embedded ? "flex-1" : "max-h-[520px]"} overflow-y-auto px-3 pb-3`}
      >
        {debugConsoleEntries.length === 0 ? (
          <p className="hud-empty-state">Waiting for Bun or webview console output.</p>
        ) : (
          <div className="space-y-2">
            {debugConsoleEntries.map((entry) => (
              <article key={entry.id} className="hud-log-card">
                <div className="hud-log-card__header">
                  <div className="hud-log-card__meta">
                    <span
                      className="hud-log-card__agent"
                      style={{ color: LEVEL_COLORS[entry.level] }}
                    >
                      {entry.level}
                    </span>
                    <span
                      className="hud-file-chip"
                      style={{
                        background: SOURCE_COLORS[entry.source],
                        borderColor: "rgba(90, 102, 82, 0.35)",
                        color: "var(--rpg-text-dim)",
                      }}
                    >
                      {entry.source}
                    </span>
                  </div>
                  <span className="hud-log-card__time">{formatTime(entry.occurredAt)}</span>
                </div>
                <pre className="hud-console-message">{entry.message}</pre>
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );

  if (embedded) {
    return <div className="flex min-h-0 flex-1 flex-col">{body}</div>;
  }

  return <section className="rpg-panel overflow-hidden">{body}</section>;
}

function ConsoleTag({
  label,
  tone,
}: {
  label: string;
  tone: "bun" | "webview" | "warn" | "error";
}) {
  const styleMap = {
    bun: {
      background: SOURCE_COLORS.bun,
      color: "var(--rpg-gold)",
    },
    webview: {
      background: SOURCE_COLORS.webview,
      color: "var(--rpg-sage)",
    },
    warn: {
      background: "rgba(242, 204, 143, 0.12)",
      color: "var(--rpg-sand)",
    },
    error: {
      background: "rgba(196, 92, 74, 0.12)",
      color: "var(--rpg-danger)",
    },
  } as const;

  const style = styleMap[tone];

  return (
    <span
      className="hud-tag rpg-mono"
      style={{ background: style.background, borderColor: "rgba(90, 102, 82, 0.35)", color: style.color }}
    >
      {label}
    </span>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

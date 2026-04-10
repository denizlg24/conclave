import type { ConclaveConnectionStatus } from "../../hooks/use-conclave";

const STATUS_LABELS: Record<ConclaveConnectionStatus["state"], string> = {
  unknown: "Status unknown",
  connected: "Connected",
  failed: "Connection failed",
  not_configured: "Configuration needed",
};

const STATUS_STYLES: Record<
  ConclaveConnectionStatus["state"],
  { border: string; background: string; color: string; dot: string }
> = {
  unknown: {
    border: "rgba(161, 188, 152, 0.24)",
    background: "rgba(161, 188, 152, 0.12)",
    color: "var(--rpg-sand)",
    dot: "var(--rpg-sand)",
  },
  connected: {
    border: "rgba(129, 178, 154, 0.32)",
    background: "rgba(129, 178, 154, 0.12)",
    color: "var(--rpg-forest)",
    dot: "var(--rpg-forest)",
  },
  failed: {
    border: "rgba(196, 92, 74, 0.36)",
    background: "rgba(196, 92, 74, 0.12)",
    color: "var(--rpg-danger)",
    dot: "var(--rpg-danger)",
  },
  not_configured: {
    border: "rgba(212, 163, 115, 0.36)",
    background: "rgba(212, 163, 115, 0.12)",
    color: "var(--rpg-copper)",
    dot: "var(--rpg-copper)",
  },
};

export function ConnectionStatusBadge({
  status,
}: {
  status: ConclaveConnectionStatus;
}) {
  const palette = STATUS_STYLES[status.state];

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 rpg-mono text-[9px] tracking-[0.14em] uppercase"
      style={{
        border: `1px solid ${palette.border}`,
        background: palette.background,
        color: palette.color,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: palette.dot }}
      />
      {STATUS_LABELS[status.state]}
    </span>
  );
}

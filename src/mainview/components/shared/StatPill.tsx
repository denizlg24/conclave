import { cn } from "@/lib/utils";

interface StatPillProps {
  readonly label: string;
  readonly value: string;
  readonly className?: string;
}

export function StatPill({ label, value, className }: StatPillProps) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-full border border-[rgba(90,110,82,0.36)] bg-[rgba(15,20,16,0.84)] px-4 py-2 shadow-[0_10px_18px_rgba(0,0,0,0.2)]",
        className,
      )}
    >
      <div className="rpg-mono text-[10px] uppercase tracking-[0.14em] text-[var(--rpg-text-muted)]">
        {label}
      </div>
      <div className="rpg-mono truncate pt-1 text-[12px] text-[var(--rpg-text)]">
        {value}
      </div>
    </div>
  );
}

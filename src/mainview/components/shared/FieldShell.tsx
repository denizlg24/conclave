import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface FieldShellProps {
  readonly label: string;
  readonly hint?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

export function FieldShell({
  label,
  hint,
  className,
  children,
}: FieldShellProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex flex-col gap-1">
        <span className="rpg-mono text-[10px] uppercase tracking-[0.14em] text-[var(--rpg-text-muted)]">
          {label}
        </span>
        {hint ? (
          <p className="rpg-mono text-[10px] leading-5 text-[var(--rpg-text-dim)]">
            {hint}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

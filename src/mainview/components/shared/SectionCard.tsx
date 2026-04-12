import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

interface SectionCardProps {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly className?: string;
  readonly contentClassName?: string;
  readonly children: ReactNode;
}

export function SectionCard({
  title,
  description,
  action,
  className,
  contentClassName,
  children,
}: SectionCardProps) {
  return (
    <Card
      className={cn(
        "overflow-hidden rounded-[24px] border-[rgba(58,74,53,0.72)] bg-[linear-gradient(180deg,rgba(34,45,33,0.96)_0%,rgba(21,28,21,0.98)_100%)] py-0 text-[var(--rpg-text)] shadow-[0_24px_60px_rgba(0,0,0,0.32)]",
        className,
      )}
    >
      <CardHeader className="gap-3 border-b border-[rgba(90,110,82,0.24)] px-5 py-5 sm:px-6">
        <div className="space-y-1">
          <CardTitle className="rpg-mono text-sm font-medium tracking-[0.08em] text-[var(--rpg-text)]">
            {title}
          </CardTitle>
          {description ? (
            <CardDescription className="rpg-mono text-[11px] leading-5 text-[var(--rpg-text-dim)]">
              {description}
            </CardDescription>
          ) : null}
        </div>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className={cn("px-5 py-5 sm:px-6", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}

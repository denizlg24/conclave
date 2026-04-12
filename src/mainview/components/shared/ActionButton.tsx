import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/shared/components/ui/button";

type ActionTone = "primary" | "secondary" | "danger";

const TONE_STYLES: Record<ActionTone, string> = {
  primary:
    "border-[rgba(200,169,110,0.52)] bg-[rgba(200,169,110,0.12)] text-[var(--rpg-gold)] hover:border-[rgba(200,169,110,0.72)] hover:bg-[rgba(200,169,110,0.18)]",
  secondary:
    "border-[rgba(90,110,82,0.44)] bg-[rgba(255,255,255,0.03)] text-[var(--rpg-text)] hover:border-[rgba(200,169,110,0.42)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[var(--rpg-gold)]",
  danger:
    "border-[rgba(196,92,74,0.44)] bg-[rgba(196,92,74,0.1)] text-[var(--rpg-danger)] hover:border-[rgba(196,92,74,0.62)] hover:bg-[rgba(196,92,74,0.16)]",
};

type ActionButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "variant"
> & {
  readonly tone?: ActionTone;
  readonly loading?: boolean;
  readonly active?: boolean;
  readonly icon?: ReactNode;
  readonly size?:
    | "default"
    | "xs"
    | "sm"
    | "lg"
    | "icon"
    | "icon-xs"
    | "icon-sm"
    | "icon-lg";
};

export function ActionButton({
  className,
  children,
  tone = "secondary",
  loading = false,
  active = false,
  disabled,
  icon,
  size = "sm",
  ...props
}: ActionButtonProps) {
  return (
    <Button
      variant="outline"
      size={size}
      className={cn(
        "rpg-mono rounded-full border px-4 tracking-[0.08em] shadow-none transition-transform hover:-translate-y-0.5",
        TONE_STYLES[tone],
        active &&
          "border-[rgba(200,169,110,0.74)] bg-[rgba(200,169,110,0.18)] text-[var(--rpg-gold)]",
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </Button>
  );
}

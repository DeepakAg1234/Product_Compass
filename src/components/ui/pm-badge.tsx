import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pmBadgeVariants = cva(
  "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-white/10 text-muted-foreground",
        success: "bg-success/15 text-success",
        warning: "bg-warning/15 text-warning",
        info: "bg-info/15 text-info",
        purple: "bg-purple/15 text-purple",
        high: "bg-success/15 text-success",
        medium: "bg-info/15 text-info",
        low: "bg-white/10 text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface PMBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pmBadgeVariants> {}

function PMBadge({ className, variant, ...props }: PMBadgeProps) {
  return (
    <span className={cn(pmBadgeVariants({ variant }), className)} {...props} />
  );
}

export { PMBadge, pmBadgeVariants };

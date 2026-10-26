import * as React from "react";
import { cn } from "@/lib/utils";

export interface PMInputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const PMInput = React.forwardRef<HTMLInputElement, PMInputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "h-11 w-full rounded-md border border-border bg-card/50 px-3.5 text-sm text-foreground placeholder:text-muted-foreground transition-all duration-200",
          "focus:outline-none focus:border-primary focus:shadow-focus",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
PMInput.displayName = "PMInput";

export { PMInput };

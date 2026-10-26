import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";

const pmButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 rounded-md",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary-hover hover:shadow-glow",
        secondary:
          "bg-card border border-border text-secondary-foreground hover:bg-muted hover:border-border-hover",
        ghost:
          "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        danger:
          "bg-error text-error-foreground hover:opacity-90",
        google:
          "bg-white text-gray-900 border border-white/20 hover:bg-gray-100 font-medium",
        hero:
          "bg-primary text-primary-foreground hover:bg-primary-hover shadow-glow hover:shadow-glow-strong hover:-translate-y-0.5",
        glass:
          "glass text-foreground hover:bg-white/10",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface PMButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof pmButtonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const PMButton = React.forwardRef<HTMLButtonElement, PMButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : motion.button;
    return (
      <Comp
        className={cn(pmButtonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        whileTap={{ scale: 0.97 }}
        transition={{ duration: 0.1 }}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </Comp>
    );
  }
);
PMButton.displayName = "PMButton";

export { PMButton, pmButtonVariants };

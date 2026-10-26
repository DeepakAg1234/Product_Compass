import * as React from "react";
import { cn } from "@/lib/utils";

interface PMCardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
  glass?: boolean;
}

const PMCard = React.forwardRef<HTMLDivElement, PMCardProps>(
  ({ className, hoverable = false, glass = true, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-lg p-5 transition-all duration-200",
          glass
            ? "glass"
            : "bg-card border border-border",
          hoverable && "hover:shadow-glow hover:scale-[1.01] cursor-pointer",
          className
        )}
        {...props}
      />
    );
  }
);
PMCard.displayName = "PMCard";

const PMCardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center gap-2 mb-4", className)} {...props} />
  )
);
PMCardHeader.displayName = "PMCardHeader";

const PMCardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-card-title", className)} {...props} />
  )
);
PMCardTitle.displayName = "PMCardTitle";

const PMCardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("", className)} {...props} />
  )
);
PMCardContent.displayName = "PMCardContent";

const PMCardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("mt-4 pt-4 border-t border-white/10", className)} {...props} />
  )
);
PMCardFooter.displayName = "PMCardFooter";

export { PMCard, PMCardHeader, PMCardTitle, PMCardContent, PMCardFooter };

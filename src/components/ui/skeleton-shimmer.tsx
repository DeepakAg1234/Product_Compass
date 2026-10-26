import { cn } from "@/lib/utils";

interface SkeletonShimmerProps {
  className?: string;
}

const SkeletonShimmer = ({ className }: SkeletonShimmerProps) => (
  <div className={cn("relative overflow-hidden rounded-md bg-muted", className)}>
    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/5 to-transparent" />
  </div>
);

export { SkeletonShimmer };

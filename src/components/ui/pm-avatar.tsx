import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pmAvatarVariants = cva(
  "inline-flex items-center justify-center rounded-full font-medium",
  {
    variants: {
      size: {
        sm: "h-8 w-8 text-xs",
        md: "h-10 w-10 text-sm",
        lg: "h-12 w-12 text-base",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
);

// Generate gradient based on name hash
function getGradient(name: string): string {
  const gradients = [
    "from-blue-400 to-blue-600",
    "from-purple-400 to-purple-600",
    "from-green-400 to-green-600",
    "from-orange-400 to-orange-600",
    "from-pink-400 to-pink-600",
    "from-teal-400 to-teal-600",
    "from-indigo-400 to-indigo-600",
    "from-rose-400 to-rose-600",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return gradients[Math.abs(hash) % gradients.length];
}

function getInitials(name: string): string {
  const parts = name.trim().split(" ");
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

interface PMAvatarProps extends VariantProps<typeof pmAvatarVariants> {
  name: string;
  image?: string;
  className?: string;
}

const PMAvatar = ({ name, image, size, className }: PMAvatarProps) => {
  const [imgError, setImgError] = React.useState(false);
  const showFallback = !image || imgError;

  return (
    <div
      className={cn(
        pmAvatarVariants({ size }),
        showFallback && `bg-gradient-to-br ${getGradient(name)} text-white`,
        className
      )}
    >
      {!showFallback ? (
        <img
          src={image}
          alt={name}
          className="h-full w-full rounded-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        getInitials(name)
      )}
    </div>
  );
};

export { PMAvatar };

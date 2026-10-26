import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface StaggerContainerProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

const StaggerContainer = ({ children, className, delay = 0.06 }: StaggerContainerProps) => (
  <motion.div
    initial="hidden"
    animate="visible"
    variants={{
      hidden: {},
      visible: {
        transition: {
          staggerChildren: delay,
        },
      },
    }}
    className={cn(className)}
  >
    {children}
  </motion.div>
);

interface StaggerItemProps {
  children: React.ReactNode;
  className?: string;
}

const StaggerItem = ({ children, className }: StaggerItemProps) => (
  <motion.div
    variants={{
      hidden: { opacity: 0, y: 12 },
      visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] } },
    }}
    className={cn(className)}
  >
    {children}
  </motion.div>
);

export { StaggerContainer, StaggerItem };

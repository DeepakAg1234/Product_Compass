import * as React from "react";
import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface PMTabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
}

const PMTabs = ({ tabs, activeTab, onChange, className }: PMTabsProps) => {
  return (
    <div className={cn("flex items-center border-b border-border", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "relative px-4 py-3 text-sm font-medium transition-colors duration-150",
            activeTab === tab.id
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="flex items-center gap-2">
            {tab.label}
            {tab.count !== undefined && (
              <span className={cn(
                "text-xs px-1.5 py-0.5 rounded-full",
                activeTab === tab.id
                  ? "bg-primary/15 text-primary"
                  : "bg-white/10 text-muted-foreground"
              )}>
                {tab.count}
              </span>
            )}
          </span>
          {activeTab === tab.id && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
          )}
        </button>
      ))}
    </div>
  );
};

export { PMTabs };
export type { Tab };

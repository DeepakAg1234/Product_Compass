import * as React from "react";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";

interface PMSearchBarProps extends React.InputHTMLAttributes<HTMLInputElement> {
  onSearch?: (query: string) => void;
  showShortcut?: boolean;
}

const PMSearchBar = React.forwardRef<HTMLInputElement, PMSearchBarProps>(
  ({ className, onSearch, showShortcut = true, ...props }, ref) => {
    const [value, setValue] = React.useState("");
    const inputRef = React.useRef<HTMLInputElement>(null);

    React.useImperativeHandle(ref, () => inputRef.current!);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (value.trim() && onSearch) {
        onSearch(value.trim());
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && value.trim() && onSearch) {
        onSearch(value.trim());
      }
    };

    return (
      <form onSubmit={handleSubmit} className="relative w-full">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className={cn(
            "h-14 w-full rounded-lg glass pl-12 pr-16 text-base text-foreground placeholder:text-muted-foreground/60 transition-all duration-200",
            "focus:outline-none focus:shadow-glow",
            className
          )}
          {...props}
        />
        {showShortcut && (
          <div className="absolute right-5 top-1/2 -translate-y-1/2 hidden sm:flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
            <span>{"\u2318"}</span>
            <span>K</span>
          </div>
        )}
      </form>
    );
  }
);
PMSearchBar.displayName = "PMSearchBar";

export { PMSearchBar };
